import { NextRequest, NextResponse } from 'next/server'
import { existsSync } from 'fs'

// ===========================================================================
// GET /api/launcher-exe/[platform]?code=ABC123&name=Margaret
// ===========================================================================
// Serves the customer client binary with the session code + server URL
// embedded as a trailer at the end of the file. The Go client reads this
// trailer on startup — no filename parsing needed, no session.json needed.
//
// The trailer format is:
//   MARQUEEIT_CONFIG{"code":"ABC123","name":"Margaret","server":"https://..."}\n
//
// Go binaries ignore extra data appended after the executable, so this is
// safe and doesn't break the binary.
// ===========================================================================

const TRAILER_PREFIX = 'MARQUEEIT_CONFIG'
const TRAILER_SUFFIX = '\n'

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

  // Determine the public server URL
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

  const safeCode = code.replace(/[^A-Z0-9]/g, '').slice(0, 8)
  const safeName = name.replace(/[^a-zA-Z0-9 \-']/g, '').slice(0, 50)

  // Map platform to the pre-built binary path
  const platformMap: Record<string, { srcPath: string; fileName: string; contentType: string }> = {
    windows: {
      srcPath: '/downloads/marqueeit-client-windows.exe',
      fileName: 'marqueeit-client.exe',
      contentType: 'application/vnd.microsoft.portable-executable',
    },
    mac: {
      srcPath: '/downloads/marqueeit-client-mac',
      fileName: 'marqueeit-client',
      contentType: 'application/octet-stream',
    },
    linux: {
      srcPath: '/downloads/marqueeit-client-linux',
      fileName: 'marqueeit-client',
      contentType: 'application/octet-stream',
    },
  }

  const platformConfig = platformMap[platform]
  if (!platformConfig) {
    return NextResponse.json({ error: 'Invalid platform. Use: windows, mac, or linux' }, { status: 400 })
  }

  const fullPath = `${process.cwd()}/public${platformConfig.srcPath}`
  if (!existsSync(fullPath)) {
    return NextResponse.json({ error: 'Client binary not found' }, { status: 500 })
  }

  const fs = await import('fs/promises')
  const binaryData = await fs.readFile(fullPath)

  // Build the config trailer
  const config = JSON.stringify({
    code: safeCode,
    name: safeName,
    server: origin,
  })
  const trailer = `${TRAILER_PREFIX}${config}${TRAILER_SUFFIX}`
  const trailerBuffer = Buffer.from(trailer, 'utf-8')

  // Append the trailer to the binary
  const combined = Buffer.concat([binaryData, trailerBuffer])

  return new NextResponse(combined, {
    headers: {
      'Content-Type': platformConfig.contentType,
      'Content-Disposition': `attachment; filename="${platformConfig.fileName}"`,
      'Cache-Control': 'no-store',
    },
  })
}

