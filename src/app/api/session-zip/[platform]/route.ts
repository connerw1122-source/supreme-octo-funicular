import { NextRequest, NextResponse } from 'next/server'
import { createGzip } from 'zlib'
import { execSync } from 'child_process'

// ===========================================================================
// GET /api/session-zip/[platform]?code=ABC123&name=Margaret
// ===========================================================================
// Returns a ZIP file containing:
//   1. The MarqueeIT binary for the requested platform
//   2. A session.json file with the code, name, and server URL embedded
//
// The customer downloads ONE zip file, extracts it, and double-clicks the
// binary. The binary reads session.json from its own directory and connects
// automatically — no command-line args, no prompts, no .bat files.
//
// Platform can be: windows | mac | linux
//
// The zip is generated on-the-fly using the `zip` command (available in the
// Docker image). For environments without `zip`, we fall back to a tar.gz.
// ===========================================================================

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ platform: string }> }
) {
  const { platform } = await params
  const url = new URL(req.url)
  const code = (url.searchParams.get('code') || '').toUpperCase().trim()
  const name = (url.searchParams.get('name') || '').trim()

  if (!code || code.length < 4) {
    return NextResponse.json({ error: 'Invalid code' }, { status: 400 })
  }

  // Determine the public server URL (same logic as the launcher route)
  const publicUrl = process.env.PUBLIC_URL
  let origin: string
  if (publicUrl) {
    origin = publicUrl.replace(/\/+$/, '')
  } else {
    const forwardedProto = req.headers.get('x-forwarded-proto') || 'https'
    const forwardedHost = req.headers.get('x-forwarded-host')
    const host = req.headers.get('host')
    const realHost = forwardedHost || host || url.host
    origin = `${forwardedProto}://${realHost}`
  }

  // Escape for JSON safety
  const safeName = name.replace(/[^a-zA-Z0-9 \-']/g, '').slice(0, 50)
  const safeCode = code.replace(/[^A-Z0-9]/g, '').slice(0, 8)

  // Determine which binary to include
  const binaryMap: Record<string, { filename: string; path: string; contentType: string }> = {
    windows: { filename: 'marqueeit-client.exe', path: 'public/downloads/marqueeit-client-windows.exe', contentType: 'application/vnd.microsoft.portable-executable' },
    mac: { filename: 'marqueeit-client', path: 'public/downloads/marqueeit-client-mac', contentType: 'application/octet-stream' },
    linux: { filename: 'marqueeit-client', path: 'public/downloads/marqueeit-client-linux', contentType: 'application/octet-stream' },
  }

  const binary = binaryMap[platform]
  if (!binary) {
    return NextResponse.json({ error: 'Invalid platform. Use: windows, mac, or linux' }, { status: 400 })
  }

  // Build the session.json content
  const sessionConfig = {
    code: safeCode,
    name: safeName,
    server: origin,
  }
  const sessionJson = JSON.stringify(sessionConfig, null, 2)

  // Build the zip file using a temp directory
  // We use the `zip` command which is available in the Docker image
  const tmpDir = `/tmp/marqueeit-${safeCode}-${Date.now()}`
  const fs = await import('fs/promises')
  const path = await import('path')

  try {
    await fs.mkdir(tmpDir, { recursive: true })
    // Copy the binary
    const binarySrc = path.join(process.cwd(), binary.path)
    await fs.copyFile(binarySrc, path.join(tmpDir, binary.filename))
    // Make it executable on Mac/Linux
    if (platform !== 'windows') {
      await fs.chmod(path.join(tmpDir, binary.filename), 0o755)
    }
    // Write session.json
    await fs.writeFile(path.join(tmpDir, 'session.json'), sessionJson)

    // Create a README.txt with simple instructions
    const readme = `MarqueeIT Support Session
=========================
Code: ${safeCode}
${safeName ? `Name: ${safeName}\n` : ''}Server: ${origin}

HOW TO START:
${platform === 'windows' ? '1. Double-click marqueeit-client.exe' : '1. Double-click marqueeit-client (or run it in a terminal)'}
2. A "MarqueeIT Active" window will appear — leave it open.
3. Your technician is now connected.

To end the session: close the window or press Ctrl+C.
`
    await fs.writeFile(path.join(tmpDir, 'README.txt'), readme)

    // Create the zip
    const zipPath = `${tmpDir}.zip`
    try {
      execSync(`cd "${tmpDir}" && zip -r "${zipPath}" .`, { stdio: 'pipe' })
    } catch {
      // zip not available, try tar.gz
      execSync(`cd "${tmpDir}" && tar czf "${zipPath}.tar.gz" .`, { stdio: 'pipe' })
      const tarData = await fs.readFile(`${zipPath}.tar.gz`)
      await fs.rm(tmpDir, { recursive: true, force: true })
      await fs.rm(`${zipPath}.tar.gz`, { force: true })
      return new NextResponse(tarData, {
        headers: {
          'Content-Type': 'application/gzip',
          'Content-Disposition': `attachment; filename="marqueeit-${safeCode}.tar.gz"`,
          'Cache-Control': 'no-store',
        },
      })
    }

    const zipData = await fs.readFile(zipPath)
    // Cleanup
    await fs.rm(tmpDir, { recursive: true, force: true })
    await fs.rm(zipPath, { force: true })

    return new NextResponse(zipData, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="marqueeit-${safeCode}.zip"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err: any) {
    // Cleanup on error
    try { await fs.rm(tmpDir, { recursive: true, force: true }) } catch {}
    console.error('session-zip error:', err)
    return NextResponse.json({ error: err?.message ?? 'Failed to create zip' }, { status: 500 })
  }
}
