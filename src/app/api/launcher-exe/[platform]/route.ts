import { NextRequest, NextResponse } from 'next/server'
import { existsSync } from 'fs'

// ===========================================================================
// GET /api/launcher-exe/[platform]?code=ABC123&name=Margaret
// ===========================================================================
// Serves the customer client binary DIRECTLY, renamed to include the
// session code in the filename. The client binary reads the code from its
// own filename on startup — no launcher, no second download, no config file.
//
// Windows: serves marqueeit-client-windows.exe as "marqueeit-AHC6E.exe"
// Mac:     serves marqueeit-client-mac as "marqueeit-AHC6E"
// Linux:   serves marqueeit-client-linux as "marqueeit-AHC6E"
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

  const safeCode = code.replace(/[^A-Z0-9]/g, '').slice(0, 8)

  // Map platform to the pre-built binary path + download filename
  const platformMap: Record<string, { srcPath: string; fileName: string; contentType: string }> = {
    windows: {
      srcPath: '/downloads/marqueeit-client-windows.exe',
      fileName: `marqueeit-${safeCode}.exe`,
      contentType: 'application/vnd.microsoft.portable-executable',
    },
    mac: {
      srcPath: '/downloads/marqueeit-client-mac',
      fileName: `marqueeit-${safeCode}`,
      contentType: 'application/octet-stream',
    },
    linux: {
      srcPath: '/downloads/marqueeit-client-linux',
      fileName: `marqueeit-${safeCode}`,
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
  const data = await fs.readFile(fullPath)

  return new NextResponse(data, {
    headers: {
      'Content-Type': platformConfig.contentType,
      'Content-Disposition': `attachment; filename="${platformConfig.fileName}"`,
      'Cache-Control': 'no-store',
    },
  })
}
