@echo off
REM ===========================================================================
REM  RemoteHelp Customer Client - Windows Installer
REM  Usage: double-click this file, OR run from Command Prompt:
REM    install_windows.bat ABC123 "Margaret"
REM
REM  What this does:
REM    1. Checks Python is installed (and offers to install it if not)
REM    2. Installs the required Python packages
REM    3. Launches the RemoteHelp client with your session code
REM
REM  Your technician will give you:
REM    - The server URL (already filled in below)
REM    - A 6-character session code (or you'll be asked for it)
REM ===========================================================================

setlocal EnableDelayedExpansion

REM --- CONFIGURATION ---------------------------------------------------------
REM Your technician's RemoteHelp server URL. Edit this if your technician gave
REM you a different URL.
set "SERVER_URL=https://preview-YOUR-BOT-ID.space-z.ai"

REM --- Determine script location --------------------------------------------
set "SCRIPT_DIR=%~dp0"
set "CLIENT_SCRIPT=%SCRIPT_DIR%remotehelp_client.py"

if not exist "%CLIENT_SCRIPT%" (
    echo [ERROR] remotehelp_client.py not found in %SCRIPT_DIR%
    echo Please make sure this installer and remotehelp_client.py are in the same folder.
    pause
    exit /b 1
)

echo.
echo ============================================
echo   RemoteHelp - Windows Installer
echo ============================================
echo Server: %SERVER_URL%
echo.

REM --- Check Python ----------------------------------------------------------
echo [1/3] Checking Python...
python --version >nul 2>&1
if errorlevel 1 (
    py --version >nul 2>&1
    if errorlevel 1 (
        echo.
        echo Python is not installed or not in your PATH.
        echo.
        echo Please install Python 3.9 or newer from: https://www.python.org/downloads/windows/
        echo.
        echo IMPORTANT: During installation, check the box that says
        echo "Add Python to PATH" at the bottom of the installer.
        echo.
        pause
        start https://www.python.org/downloads/windows/
        exit /b 1
    )
    set "PYTHON=py"
) else (
    set "PYTHON=python"
)

echo Using: 
%PYTHON% --version
echo.

REM --- Install dependencies -------------------------------------------------
echo [2/3] Installing required packages (one-time setup, may take a minute)...
%PYTHON% -m pip install --upgrade pip >nul 2>&1
%PYTHON% -m pip install ^
    aiortc ^
    pyautogui ^
    mss ^
    pillow ^
    python-socketio ^
    numpy ^
    av ^
    opencv-python-headless

if errorlevel 1 (
    echo.
    echo [ERROR] Failed to install packages. See message above.
    pause
    exit /b 1
)
echo Done.
echo.

REM --- Launch client --------------------------------------------------------
echo [3/3] Launching RemoteHelp client...
echo.

REM Take code from first arg, or prompt
if "%~1"=="" (
    set /p SESSION_CODE="Enter your 6-character session code: "
) else (
    set "SESSION_CODE=%~1"
)

REM Take name from second arg, or prompt
if "%~2"=="" (
    set /p CUSTOMER_NAME="Enter your name: "
) else (
    set "CUSTOMER_NAME=%~2"
)

if "!SESSION_CODE!"=="" (
    echo No session code entered. Exiting.
    pause
    exit /b 1
)

echo.
echo Starting session !SESSION_CODE! ...
echo You can close this window once the RemoteHelp status window appears.
echo.

set "REMOTEHELP_SERVER=%SERVER_URL%"
%PYTHON% "%CLIENT_SCRIPT%" --code "!SESSION_CODE!" --name "!CUSTOMER_NAME!" --server "%SERVER_URL%"

echo.
echo Session ended. Press any key to close.
pause >nul
