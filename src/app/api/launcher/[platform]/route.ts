import { NextRequest, NextResponse } from 'next/server'

// ===========================================================================
// GET /api/launcher/[platform]?code=ABC123&name=Margaret
// ===========================================================================
// Returns a small launcher script (Windows .bat, Mac/Linux .sh) that:
//   1. Downloads the MarqueeIT customer binary if not already present
//   2. Runs it with --code, --name, and --server args already embedded
//
// The customer downloads ONE file (the launcher), double-clicks it, and
// everything just works. No prompts for code or name.
//
// Platform can be: windows | mac | linux
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

  // Determine the public server URL.
  // Priority: PUBLIC_URL env var > x-forwarded-proto + x-forwarded-host > host header
  // Behind a reverse proxy (Caddy/Nginx), req.url is just the path
  // (/api/launcher/linux?...), so url.origin would be "http://localhost".
  const publicUrl = process.env.PUBLIC_URL
  let origin: string
  if (publicUrl) {
    origin = publicUrl.replace(/\/+$/, '') // trim trailing slash
  } else {
    const forwardedProto = req.headers.get('x-forwarded-proto') || 'https'
    const forwardedHost = req.headers.get('x-forwarded-host')
    const host = req.headers.get('host')
    const realHost = forwardedHost || host || url.host
    origin = `${forwardedProto}://${realHost}`
  }

  // Escape args for shell safety (basic — only allow alphanumerics, space, dash, apostrophe)
  const safeName = name.replace(/[^a-zA-Z0-9 \-']/g, '').slice(0, 50)
  const safeCode = code.replace(/[^A-Z0-9]/g, '').slice(0, 8)

  if (platform === 'windows') {
    // Windows .bat launcher
    const script = `@echo off
REM =========================================================================
REM  MarqueeIT Customer Launcher
REM  Session: ${safeCode}
REM  Generated: ${new Date().toISOString()}
REM =========================================================================
REM  This script downloads the MarqueeIT customer client (if not already
REM  present) and starts your support session. You can delete this file
REM  after your session ends.
REM =========================================================================

setlocal EnableDelayedExpansion

set "DIR=%~dp0"
set "BIN=%DIR%marqueeit-client-windows.exe"
set "CODE=${safeCode}"
set "NAME=${safeName}"
set "SERVER=${origin}"

echo.
echo ============================================
echo   MarqueeIT - Starting support session
echo ============================================
echo   Code: %CODE%
${safeName ? 'echo   Name: %NAME%' : 'echo   Name: (not provided)'}
echo   Server: %SERVER%
echo.

if not exist "%BIN%" (
  echo [1/2] Downloading MarqueeIT client...
  echo       (one-time setup, ~10 MB)
  powershell -NoProfile -Command "try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri '%SERVER%/downloads/marqueeit-client-windows.exe' -OutFile '%BIN%' -UseBasicParsing } catch { Write-Host 'ERROR: Download failed.'; Write-Host $_.Exception.Message; exit 1 }"
  if errorlevel 1 (
    echo.
    echo [ERROR] Could not download the MarqueeIT client.
    echo Please check your internet connection and try again,
    echo or call your technician.
    pause
    exit /b 1
  )
) else (
  echo [1/2] MarqueeIT client already downloaded.
)

echo [2/2] Starting session...
echo.

${safeName ? '"%BIN%" --code "%CODE%" --name "%NAME%" --server "%SERVER%"' : '"%BIN%" --code "%CODE%" --server "%SERVER%"'}

echo.
echo Session ended. Press any key to close this window.
pause >nul
`
    return new NextResponse(script, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="marqueeit-start-${safeCode}.bat"`,
        'Cache-Control': 'no-store',
      },
    })
  }

  if (platform === 'mac' || platform === 'linux') {
    const binaryName = platform === 'mac' ? 'marqueeit-client-mac' : 'marqueeit-client-linux'
    const script = `#!/bin/bash
# =========================================================================
#  MarqueeIT Customer Launcher
#  Session: ${safeCode}
#  Generated: ${new Date().toISOString()}
# =========================================================================
#  This script downloads the MarqueeIT customer client (if not already
#  present) and starts your support session. You can delete this file
#  after your session ends.
# =========================================================================

set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
BIN="$DIR/${binaryName}"
CODE="${safeCode}"
NAME="${safeName}"
SERVER="${origin}"

echo ""
echo "============================================"
echo "  MarqueeIT - Starting support session"
echo "============================================"
echo "  Code: $CODE"
${safeName ? 'echo "  Name: $NAME"' : 'echo "  Name: (not provided)"'}
echo "  Server: $SERVER"
echo ""

if [ ! -f "$BIN" ]; then
  echo "[1/2] Downloading MarqueeIT client..."
  echo "      (one-time setup, ~10 MB)"
  if command -v curl &>/dev/null; then
    curl -fL -o "$BIN" "$SERVER/downloads/${binaryName}" || {
      echo ""
      echo "ERROR: Could not download the MarqueeIT client."
      echo "Please check your internet connection and try again,"
      echo "or call your technician."
      exit 1
    }
  elif command -v wget &>/dev/null; then
    wget -q -O "$BIN" "$SERVER/downloads/${binaryName}" || {
      echo ""
      echo "ERROR: Could not download the MarqueeIT client."
      echo "Please check your internet connection and try again,"
      echo "or call your technician."
      exit 1
    }
  else
    echo "ERROR: Neither curl nor wget is installed. Please install one and try again."
    exit 1
  fi
  chmod +x "$BIN"
  echo "      Download complete."
else
  echo "[1/2] MarqueeIT client already downloaded."
fi

echo "[2/2] Starting session..."
echo ""

${safeName ? 'exec "$BIN" --code "$CODE" --name "$NAME" --server "$SERVER"' : 'exec "$BIN" --code "$CODE" --server "$SERVER"'}
`
    return new NextResponse(script, {
      headers: {
        'Content-Type': 'text/x-shellscript; charset=utf-8',
        'Content-Disposition': `attachment; filename="marqueeit-start-${safeCode}.sh"`,
        'Cache-Control': 'no-store',
      },
    })
  }

  return NextResponse.json({ error: 'Invalid platform. Use: windows, mac, or linux' }, { status: 400 })
}
