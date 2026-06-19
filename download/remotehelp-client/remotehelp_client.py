#!/usr/bin/env python3
"""
RemoteHelp Customer Client
==========================

A small desktop application that lets a trusted technician remotely view
AND control your computer with your permission. This is the program your
technician asked you to download.

WHAT IT DOES
------------
1. Connects to your technician using the 6-character code they gave you.
2. Shares your screen so they can see what you see.
3. Lets them move your mouse and type on your keyboard - but ONLY while
   this program is running.
4. Shows a small status window. Close it any time to end the session.

PRIVACY
-------
- Nothing is installed permanently. Closing this program ends the session
  and the technician can no longer see or control anything.
- Your technician can only see the screen, not your files or passwords.
- All traffic is end-to-end encrypted via WebRTC.

USAGE
-----
    python remotehelp_client.py --code ABC123 --name "Margaret"
    python remotehelp_client.py                    # will prompt for code
    python remotehelp_client.py --server https://example.com --code ABC123

REQUIREMENTS
------------
Python 3.9 or newer. The installers (install_windows.bat or
install_mac_linux.sh) install all required Python packages automatically.
If you run this script directly, install requirements with:

    pip install aiortc pyautogui mss pillow python-socketio opencv-python numpy av tkinter
"""

import argparse
import asyncio
import json
import logging
import os
import sys
import threading
import time
from typing import Optional

# --- Soft imports: we'll print a friendly error if a dep is missing ---------
try:
    import pyautogui
    pyautogui.FAILSAFE = True   # Move mouse to corner to abort
    pyautogui.PAUSE = 0
except ImportError:
    print("ERROR: pyautogui is not installed. Run the installer, or:")
    print("    pip install pyautogui")
    sys.exit(1)

try:
    import socketio
except ImportError:
    print("ERROR: python-socketio is not installed. Run the installer, or:")
    print("    pip install python-socketio")
    sys.exit(1)

try:
    from aiortc import RTCPeerConnection, RTCSessionDescription, RTCConfiguration, RTCIceServer, VideoStreamTrack
except ImportError:
    print("ERROR: aiortc is not installed. Run the installer, or:")
    print("    pip install aiortc")
    sys.exit(1)

try:
    from mss import mss
except ImportError:
    print("ERROR: mss is not installed. Run the installer, or:")
    print("    pip install mss")
    sys.exit(1)

try:
    import numpy as np
except ImportError:
    print("ERROR: numpy is not installed. Run the installer, or:")
    print("    pip install numpy")
    sys.exit(1)

try:
    import av
except ImportError:
    print("ERROR: av is not installed. Run the installer, or:")
    print("    pip install av")
    sys.exit(1)


# --- Configuration ----------------------------------------------------------

# Default server URL - the installers override this with your technician's
# actual server. You can also override with --server or REMOTEHELP_SERVER env var.
DEFAULT_SERVER = os.environ.get("REMOTEHELP_SERVER", "http://localhost:81")

ICE_SERVERS = [
    RTCIceServer(urls="stun:stun.l.google.com:19302"),
    RTCIceServer(urls="stun:stun1.l.google.com:19302"),
]

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("remotehelp")


# --- Screen capture track ---------------------------------------------------

class ScreenShareTrack(VideoStreamTrack):
    """Captures the screen at ~10 FPS and serves it as a WebRTC video track."""

    def __init__(self, monitor_index: int = 1, target_fps: int = 10, max_width: int = 1280):
        super().__init__()
        self.sct = mss()
        self.monitor = self.sct.monitors[monitor_index]
        self.target_fps = target_fps
        self.max_width = max_width
        self._last_frame_time = 0.0

    async def recv(self):
        pts, time_base = await self.next_timestamp()

        # Throttle to target FPS
        elapsed = time.time() - self._last_frame_time
        target_interval = 1.0 / self.target_fps
        if elapsed < target_interval:
            await asyncio.sleep(target_interval - elapsed)

        # Capture
        raw = self.sct.grab(self.monitor)
        img = np.frombuffer(raw.rgb, dtype=np.uint8)
        img = img.reshape(raw.height, raw.width, 3)  # already RGB

        # Downscale if needed
        h, w = img.shape[:2]
        if w > self.max_width:
            scale = self.max_width / w
            new_w = self.max_width
            new_h = int(h * scale)
            img = _resize_nearest(img, new_w, new_h)

        frame = av.VideoFrame.from_ndarray(img, format="rgb24")
        frame.pts = pts
        frame.time_base = time_base
        self._last_frame_time = time.time()
        return frame


def _resize_nearest(img: np.ndarray, new_w: int, new_h: int) -> np.ndarray:
    """Fast nearest-neighbor resize - avoids opencv dependency."""
    h, w = img.shape[:2]
    if new_w == w and new_h == h:
        return img
    xs = (np.arange(new_w) * (w / new_w)).astype(np.int32).clip(0, w - 1)
    ys = (np.arange(new_h) * (h / new_h)).astype(np.int32).clip(0, h - 1)
    return img[np.ix_(ys, xs)]


# --- PyAutoGUI key mapping --------------------------------------------------

# Translate browser KeyboardEvent.code values to pyautogui keys
KEY_MAP = {
    "Enter": "enter",
    "Backspace": "backspace",
    "Tab": "tab",
    "Escape": "escape",
    "Space": "space",
    "ArrowUp": "up",
    "ArrowDown": "down",
    "ArrowLeft": "left",
    "ArrowRight": "right",
    "ShiftLeft": "shiftleft",
    "ShiftRight": "shiftright",
    "ControlLeft": "ctrlleft",
    "ControlRight": "ctrlright",
    "AltLeft": "altleft",
    "AltRight": "altright",
    "MetaLeft": "cmdleft" if sys.platform == "darwin" else "winleft",
    "MetaRight": "cmdright" if sys.platform == "darwin" else "winright",
    "CapsLock": "capslock",
    "Delete": "delete",
    "End": "end",
    "Home": "home",
    "PageUp": "pageup",
    "PageDown": "pagedown",
    "F1": "f1", "F2": "f2", "F3": "f3", "F4": "f4", "F5": "f5", "F6": "f6",
    "F7": "f7", "F8": "f8", "F9": "f9", "F10": "f10", "F11": "f11", "F12": "f12",
}


def map_key(browser_code: str) -> Optional[str]:
    """Map a browser KeyboardEvent.code to a pyautogui key name."""
    if browser_code in KEY_MAP:
        return KEY_MAP[browser_code]
    # Letter or digit: e.g. "KeyA" -> "a", "Digit1" -> "1"
    if browser_code.startswith("Key") and len(browser_code) == 4:
        return browser_code[3].lower()
    if browser_code.startswith("Digit") and len(browser_code) == 6:
        return browser_code[5]
    # Fall back to lowercased character
    return browser_code.lower() if len(browser_code) == 1 else None


# --- Main client ------------------------------------------------------------

class RemoteHelpClient:
    """The customer-side client. Connects to signaling server, shares screen,
    receives and injects input events."""

    def __init__(self, code: str, name: str, signaling_url: str):
        self.code = code.upper().strip()
        self.name = name
        self.signaling_url = signaling_url.rstrip("/")
        self.sio = socketio.AsyncClient()
        self.pc: Optional[RTCPeerConnection] = None
        self.dc = None  # Data channel
        self.screen_track: Optional[ScreenShareTrack] = None
        self._running = True
        self._technician_name: Optional[str] = None
        self._on_status = None  # callback for UI status updates

    def set_status_callback(self, cb):
        self._on_status = cb

    def _status(self, text: str):
        log.info(text)
        if self._on_status:
            try:
                self._on_status(text)
            except Exception:
                pass

    async def connect(self):
        url = f"{self.signaling_url}/?XTransformPort=3003"
        self._status(f"Connecting to {self.signaling_url}...")
        await self.sio.connect(
            url,
            transports=["websocket", "polling"],
            socketio_path="/",
        )
        self._status("Connected to server. Joining session...")

        self.sio.on("webrtc-offer", self._on_offer)
        self.sio.on("webrtc-ice", self._on_ice)
        self.sio.on("session-ended", self._on_session_ended)
        self.sio.on("peer-joined", self._on_peer_joined)
        self.sio.on("peer-left", self._on_peer_left)
        self.sio.on("chat-message", self._on_chat)

        await self.sio.emit("join-room", {
            "roomCode": self.code,
            "role": "customer",
            "name": self.name,
        })
        self._status(f"Joined session {self.code}. Waiting for technician...")
        # Notify any waiting technician that we're ready
        await self.sio.emit("stream-ready", {})

    async def _on_peer_joined(self, data):
        name = data.get("name", "Technician")
        self._technician_name = name
        self._status(f"Technician connected: {name}")

    async def _on_peer_left(self, data):
        self._status(f"Peer left: {data.get('name', 'unknown')}")

    async def _on_chat(self, data):
        sender = data.get("sender", "?")
        content = data.get("content", "")
        self._status(f"[Chat] {sender}: {content}")

    async def _on_session_ended(self, data):
        self._status("Session ended by technician.")
        self._running = False

    async def _on_offer(self, data):
        """Receive WebRTC offer from technician, create answer."""
        self._status("Technician is connecting...")
        if self.pc:
            await self.pc.close()

        config = RTCConfiguration(iceServers=ICE_SERVERS)
        self.pc = RTCPeerConnection(configuration=config)

        # Add the screen-share track
        self.screen_track = ScreenShareTrack()
        self.pc.addTrack(self.screen_track)

        @self.pc.on("datachannel")
        def on_datachannel(channel):
            self.dc = channel
            self._status(f"Control channel open: {channel.label}")

            @channel.on("message")
            def on_message(message):
                if isinstance(message, (bytes, bytearray)):
                    return  # Binary file chunk - we don't process files in client
                asyncio.ensure_future(self._handle_input(message))

        # Set remote description
        sdp_data = data["sdp"]
        offer = RTCSessionDescription(
            sdp=sdp_data["sdp"],
            type=sdp_data["type"],
        )
        await self.pc.setRemoteDescription(offer)

        # Create and send answer
        answer = await self.pc.createAnswer()
        await self.pc.setLocalDescription(answer)
        await self.sio.emit("webrtc-answer", {
            "to": data["from"],
            "sdp": {
                "sdp": self.pc.localDescription.sdp,
                "type": self.pc.localDescription.type,
            },
        })

        @self.pc.on("connectionstatechange")
        async def on_state_change():
            state = self.pc.connectionState
            self._status(f"WebRTC state: {state}")
            if state in ("failed", "closed"):
                self._running = False

        self._status("Connected! Technician can now see and control your screen.")

    async def _on_ice(self, data):
        if not self.pc:
            return
        try:
            candidate = data.get("candidate")
            if not candidate:
                return
            # aiortc accepts RTCIceCandidate objects. Parse the sdp string.
            from aiortc import RTCIceCandidate
            # The candidate dict from the server is the JSON form of an
            # RTCIceCandidateInit: { candidate: "candidate:...", sdpMid, sdpMLineIndex }
            if isinstance(candidate, dict) and "candidate" in candidate:
                cand_str = candidate["candidate"]
                # Very simple parse - aiortc's own from_sdp would be ideal but
                # for simplicity we let aiortc handle it via addIceCandidate
                await self.pc.addIceCandidate(candidate)
            else:
                await self.pc.addIceCandidate(candidate)
        except Exception as e:
            log.debug(f"ICE candidate error: {e}")

    async def _handle_input(self, raw_message: str):
        """Process an input event from the technician."""
        try:
            event = json.loads(raw_message)
        except json.JSONDecodeError:
            log.debug(f"Non-JSON message: {raw_message[:80]}")
            return

        etype = event.get("type")
        try:
            if etype == "mouse_move":
                self._mouse_move(event["x"], event["y"])

            elif etype == "mouse_down":
                self._mouse_move(event["x"], event["y"])
                pyautogui.mouseDown(button=event.get("button", "left"), _pause=False)

            elif etype == "mouse_up":
                pyautogui.mouseUp(button=event.get("button", "left"), _pause=False)

            elif etype == "mouse_click":
                self._mouse_move(event["x"], event["y"])
                pyautogui.click(
                    button=event.get("button", "left"),
                    _pause=False,
                )

            elif etype == "mouse_doubleclick":
                self._mouse_move(event["x"], event["y"])
                pyautogui.doubleClick(_pause=False)

            elif etype == "mouse_rightclick":
                self._mouse_move(event["x"], event["y"])
                pyautogui.rightClick(_pause=False)

            elif etype == "mouse_scroll":
                dx = event.get("dx", 0)
                dy = event.get("dy", 0)
                # pyautogui.scroll is vertical only; horizontal clicks work on mac
                if dy != 0:
                    pyautogui.scroll(int(dy * 5), _pause=False)

            elif etype == "key_down":
                key = map_key(event.get("key", ""))
                if key:
                    try:
                        pyautogui.keyDown(key, _pause=False)
                    except ValueError:
                        log.debug(f"Unknown key down: {key}")

            elif etype == "key_up":
                key = map_key(event.get("key", ""))
                if key:
                    try:
                        pyautogui.keyUp(key, _pause=False)
                    except ValueError:
                        log.debug(f"Unknown key up: {key}")

            elif etype == "key_press":
                key = map_key(event.get("key", ""))
                if key:
                    try:
                        pyautogui.press(key, _pause=False)
                    except ValueError:
                        log.debug(f"Unknown key press: {key}")

            elif etype == "key_type":
                text = event.get("text", "")
                if text:
                    pyautogui.typewrite(text, interval=0, _pause=False)

            elif etype == "chat":
                self._status(f"[Chat] {event.get('sender', '?')}: {event.get('content', '')}")

        except Exception as e:
            log.warning(f"Input event error ({etype}): {e}")

    def _mouse_move(self, rel_x: float, rel_y: float):
        """Move mouse to relative coordinates [0..1]."""
        sw, sh = pyautogui.size()
        # Account for capture region vs full screen mismatch by using full screen
        x = max(0, min(sw - 1, int(rel_x * sw)))
        y = max(0, min(sh - 1, int(rel_y * sh)))
        pyautogui.moveTo(x, y, _pause=False)

    async def run(self):
        await self.connect()
        while self._running:
            await asyncio.sleep(0.5)
        # Cleanup
        try:
            if self.pc:
                await self.pc.close()
            await self.sio.disconnect()
        except Exception:
            pass
        self._status("Session ended. You can close this window.")


# --- Tkinter status window --------------------------------------------------

def _start_ui(client: RemoteHelpClient, code: str):
    """Run a small status window in a separate thread."""
    try:
        import tkinter as tk
        from tkinter import ttk, scrolledtext
    except ImportError:
        log.warning("tkinter not available - running without UI window.")
        return

    root = tk.Tk()
    root.title(f"RemoteHelp - Session {code}")
    root.geometry("440x360")
    root.resizable(False, False)

    # Style
    style = ttk.Style(root)
    try:
        style.theme_use("clam")
    except Exception:
        pass

    # Header
    header = ttk.Frame(root, padding=12)
    header.pack(fill="x")
    title = ttk.Label(
        header,
        text="RemoteHelp Active",
        font=("TkDefaultFont", 16, "bold"),
    )
    title.pack(anchor="w")
    sub = ttk.Label(
        header,
        text=f"Session code: {code}\nA technician can currently see and control your screen.",
        foreground="#444",
    )
    sub.pack(anchor="w", pady=(4, 0))

    # Status line
    status_var = tk.StringVar(value="Starting...")
    status_label = ttk.Label(root, textvariable=status_var, foreground="#0a7", font=("TkDefaultFont", 10, "bold"))
    status_label.pack(anchor="w", padx=12)

    # Log area
    log_area = scrolledtext.ScrolledText(root, height=12, wrap="word", state="disabled")
    log_area.pack(fill="both", expand=True, padx=12, pady=8)

    def append_log(text: str):
        log_area.configure(state="normal")
        log_area.insert("end", text + "\n")
        log_area.see("end")
        log_area.configure(state="disabled")

    def on_status(text: str):
        status_var.set(text)
        append_log(text)

    client.set_status_callback(on_status)

    # Stop button
    def on_stop():
        client._running = False
        root.destroy()

    btn_frame = ttk.Frame(root, padding=12)
    btn_frame.pack(fill="x")
    stop_btn = ttk.Button(btn_frame, text="End Session", command=on_stop)
    stop_btn.pack(side="right")
    note = ttk.Label(btn_frame, text="Tip: move mouse to a screen corner to abort.", foreground="#888")
    note.pack(side="left")

    # Make the window stay on top initially so the user sees it
    root.attributes("-topmost", True)
    root.after(3000, lambda: root.attributes("-topmost", False))

    root.mainloop()
    # If the user closes the window, end the session
    client._running = False


# --- Entry point ------------------------------------------------------------

def parse_args():
    parser = argparse.ArgumentParser(
        description="RemoteHelp Customer Client",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--code", help="6-character session code (will prompt if omitted)")
    parser.add_argument("--name", help="Your name (will prompt if omitted)")
    parser.add_argument(
        "--server",
        default=DEFAULT_SERVER,
        help=f"Signaling server URL (default: {DEFAULT_SERVER})",
    )
    parser.add_argument("--no-ui", action="store_true", help="Run without the Tkinter status window")
    return parser.parse_args()


async def main_async():
    args = parse_args()

    code = args.code
    name = args.name
    if not code:
        try:
            code = input("Enter your 6-character session code: ").strip()
        except EOFError:
            print("No code provided. Exiting.")
            sys.exit(1)
    if not name:
        try:
            name = input("Enter your name: ").strip()
        except EOFError:
            name = "Customer"
    if not code or len(code) < 4:
        print("Invalid code. Exiting.")
        sys.exit(1)

    print(f"\nRemoteHelp starting...\n  Server: {args.server}\n  Code: {code}\n  Name: {name}\n")

    client = RemoteHelpClient(code=code, name=name, signaling_url=args.server)

    # Start UI thread (unless --no-ui)
    if not args.no_ui:
        ui_thread = threading.Thread(target=_start_ui, args=(client, code), daemon=True)
        ui_thread.start()

    try:
        await client.run()
    except (KeyboardInterrupt, asyncio.CancelledError):
        pass
    finally:
        client._running = False


if __name__ == "__main__":
    try:
        asyncio.run(main_async())
    except KeyboardInterrupt:
        print("\nGoodbye!")
