#!/bin/bash
# =============================================================================
#  RemoteHelp Customer Client - Mac & Linux Installer
#
#  Usage:
#    ./install_mac_linux.sh                  # will prompt for code & name
#    ./install_mac_linux.sh ABC123 "Margaret"
#
#  What this does:
#    1. Checks Python 3.9+ is installed
#    2. Installs the required Python packages (in a virtualenv to keep things clean)
#    3. Launches the RemoteHelp client with your session code
#
#  Your technician will give you:
#    - The server URL (already filled in below)
#    - A 6-character session code (or you'll be asked for it)
# =============================================================================

set -e

# --- CONFIGURATION -----------------------------------------------------------
# Your technician's RemoteHelp server URL. Edit this if your technician gave
# you a different URL.
SERVER_URL="https://preview-YOUR-BOT-ID.space-z.ai"

# --- Determine script location ----------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLIENT_SCRIPT="$SCRIPT_DIR/remotehelp_client.py"

if [[ ! -f "$CLIENT_SCRIPT" ]]; then
    echo "[ERROR] remotehelp_client.py not found in $SCRIPT_DIR"
    echo "Please make sure this installer and remotehelp_client.py are in the same folder."
    exit 1
fi

echo ""
echo "============================================"
echo "  RemoteHelp - Mac/Linux Installer"
echo "============================================"
echo "Server: $SERVER_URL"
echo ""

# --- Check Python ------------------------------------------------------------
echo "[1/3] Checking Python 3.9+..."
if command -v python3 &>/dev/null; then
    PYTHON=python3
elif command -v python &>/dev/null; then
    PYTHON=python
else
    echo ""
    echo "Python 3 is not installed."
    echo ""
    if [[ "$(uname)" == "Darwin" ]]; then
        echo "Install Python via Homebrew:"
        echo "  /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
        echo "  brew install python"
    else
        echo "Install Python 3.9+ using your package manager, e.g.:"
        echo "  Ubuntu/Debian:  sudo apt-get install python3 python3-python3-venv python3-tk"
        echo "  Fedora:         sudo dnf install python3 python3-tkinter"
        echo "  Arch:           sudo pacman -S python tk"
    fi
    echo ""
    exit 1
fi

PY_VERSION=$($PYTHON -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
echo "Using Python: $PY_VERSION ($PYTHON)"
if [[ "$PY_VERSION" < "3.9" ]]; then
    echo "[ERROR] Python 3.9+ required. You have $PY_VERSION."
    exit 1
fi

# --- Create virtualenv -------------------------------------------------------
VENV_DIR="$SCRIPT_DIR/.remotehelp_venv"
if [[ ! -d "$VENV_DIR" ]]; then
    echo ""
    echo "[2/3] Setting up a virtual environment (one-time, may take a minute)..."
    $PYTHON -m venv "$VENV_DIR"
fi

# Activate and install
# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"

echo "Installing required packages..."
python -m pip install --upgrade pip --quiet
python -m pip install --quiet \
    aiortc \
    pyautogui \
    mss \
    pillow \
    python-socketio \
    numpy \
    av \
    opencv-python-headless \
    tk || {
        # On Linux, tkinter may need a system package - try without it
        echo ""
        echo "NOTE: If you saw a tkinter error, install it via your package manager:"
        echo "  Ubuntu/Debian:  sudo apt-get install python3-tk"
        echo "  Fedora:         sudo dnf install python3-tkinter"
        echo ""
        # Continue anyway - the client can run without the UI window
        python -m pip install --quiet \
            aiortc \
            pyautogui \
            mss \
            pillow \
            python-socketio \
            numpy \
            av \
            opencv-python-headless
    }
echo "Done."
echo ""

# --- Launch client -----------------------------------------------------------
echo "[3/3] Launching RemoteHelp client..."
echo ""

# Parse args
SESSION_CODE="${1:-}"
CUSTOMER_NAME="${2:-}"

if [[ -z "$SESSION_CODE" ]]; then
    read -r -p "Enter your 6-character session code: " SESSION_CODE
fi
if [[ -z "$CUSTOMER_NAME" ]]; then
    read -r -p "Enter your name: " CUSTOMER_NAME
fi

if [[ -z "$SESSION_CODE" ]]; then
    echo "No session code entered. Exiting."
    exit 1
fi

echo ""
echo "Starting session $SESSION_CODE ..."
echo ""

export REMOTEHELP_SERVER="$SERVER_URL"
exec python "$CLIENT_SCRIPT" \
    --code "$SESSION_CODE" \
    --name "$CUSTOMER_NAME" \
    --server "$SERVER_URL"
