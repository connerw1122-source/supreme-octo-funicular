import { NextRequest, NextResponse } from 'next/server'
import { existsSync } from 'fs'

// ===========================================================================
// GET /api/launcher-exe/[platform]?code=ABC123&name=Margaret
// ===========================================================================
// Returns a launcher file with the session code baked into the filename.
//
// Windows: serves the pre-built marqueeit-launcher-windows.exe directly,
// renamed to "marqueeit-AHC6E.exe" so the launcher can extract the code
// from its own filename. The launcher downloads the client binary on first
// run if not found in the same directory.
//
// Mac/Linux: serves a small shell script that downloads the client binary
// if needed and runs it with the code/name/server. No zip, no .bat.
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

  const safeName = name.replace(/[^a-zA-Z0-9 \-']/g, '').slice(0, 50)
  const safeCode = code.replace(/[^A-Z0-9]/g, '').slice(0, 8)

  if (platform === 'windows') {
    // Serve the pre-built launcher .exe, renamed to include the session code.
    // The launcher reads the code from its own filename at runtime.
    const exePath = `${process.cwd()}/public/downloads/marqueeit-launcher-windows.exe`
    if (!existsSync(exePath)) {
      return NextResponse.json({ error: 'Launcher binary not found' }, { status: 500 })
    }
    const fs = await import('fs/promises')
    const data = await fs.readFile(exePath)
    return new NextResponse(data, {
      headers: {
        'Content-Type': 'application/vnd.microsoft.portable-executable',
        'Content-Disposition': `attachment; filename="marqueeit-${safeCode}.exe"`,
        'Cache-Control': 'no-store',
      },
    })
  }

  if (platform === 'mac' || platform === 'linux') {
    const binaryName = platform === 'mac' ? 'marqueeit-client-mac' : 'marqueeit-client-linux'
    const script = `#!/bin/bash
# MarqueeIT Customer Launcher
# Session: ${safeCode}
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
BIN="$DIR/${binaryName}"
CODE="${safeCode}"
NAME="${safeName}"
SERVER="${origin}"

echo "Starting MarqueeIT session ${CODE}..."

if [ ! -f "$BIN" ]; then
  echo "Downloading MarqueeIT client (~6 MB)..."
  if command -v curl &>/dev/null; then
    curl -fL -o "$BIN" "$SERVER/downloads/${binaryName}" || {
      echo "ERROR: Download failed."
      exit 1
    }
  elif command -v wget &>/dev/null; then
    wget -q -O "$BIN" "$SERVER/downloads/${binaryName}" || {
      echo "ERROR: Download failed."
      exit 1
    }
  else
    echo "ERROR: Need curl or wget."
    exit 1
  fi
  chmod +x "$BIN"
fi

${safeName ? 'exec "$BIN" --code "$CODE" --name "$NAME" --server "$SERVER"' : 'exec "$BIN" --code "$CODE" --server "$SERVER"'}
`
    return new NextResponse(script, {
      headers: {
        'Content-Type': 'text/x-shellscript; charset=utf-8',
        'Content-Disposition': `attachment; filename="marqueeit-${safeCode}.sh"`,
        'Cache-Control': 'no-store',
      },
    })
  }

  return NextResponse.json({ error: 'Invalid platform' }, { status: 400 })
}
