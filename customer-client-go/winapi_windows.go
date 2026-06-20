//go:build windows

package main

/*
#cgo LDFLAGS: -luser32 -lkernel32
#include <windows.h>
#include <string.h>

// Set the clipboard text via Win32 API (no PowerShell, no flashing window)
static int setClipboardText(const char* text, int len) {
    if (!OpenClipboard(NULL)) return 0;
    EmptyClipboard();
    HGLOBAL hMem = GlobalAlloc(GMEM_MOVEABLE, len + 1);
    if (!hMem) { CloseClipboard(); return 0; }
    char* pMem = (char*)GlobalLock(hMem);
    memcpy(pMem, text, len);
    pMem[len] = 0;
    GlobalUnlock(hMem);
    SetClipboardData(CF_TEXT, hMem);
    CloseClipboard();
    return 1;
}

// Get clipboard text via Win32 API
static const char* getClipboardText() {
    if (!OpenClipboard(NULL)) return "";
    HANDLE hData = GetClipboardData(CF_TEXT);
    if (!hData) { CloseClipboard(); return ""; }
    const char* text = (const char*)GlobalLock(hData);
    // Note: caller must not free this — it's owned by the clipboard.
    // We copy it in Go before closing.
    GlobalUnlock(hData);
    CloseClipboard();
    return text;
}

// BlockInput — blocks keyboard and mouse input on the customer's machine
static int blockInput(int block) {
    return BlockInput(block ? TRUE : FALSE);
}
*/
import "C"

import (
        "os/exec"
        "syscall"
        "unsafe"
)

func winSetClipboard(text string) {
        cText := C.CString(text)
        defer C.free(unsafe.Pointer(cText))
        C.setClipboardText(cText, C.int(len(text)))
}

func winGetClipboard() string {
        text := C.getClipboardText()
        return C.GoString(text)
}

func winBlockInput(block bool) bool {
        result := C.blockInput(0)
        if block {
                result = C.blockInput(1)
        }
        return result != 0
}

// winSendCAD sends Ctrl+Alt+Del via SendInput (simulated)
func winSendCAD() {
        // On Windows, SendInput can't directly trigger SAS (Secure Attention Sequence)
        // for Ctrl+Alt+Del. We need to use the keyboard event sequence.
        // Note: This may not work on modern Windows due to SAS protection.
        // Alternative: use rundll32 user32.dll,LockWorkStation for lock screen
        keyDown("ControlLeft")
        keyDown("AltLeft")
        keyDown("Delete")
        keyUp("Delete")
        keyUp("AltLeft")
        keyUp("ControlLeft")
}

// winLockWorkStation locks the workstation
func winLockWorkStation() {
        C.LockWorkStation()
}

// winExecHidden runs a command with the window hidden
func winExecHidden(command string) (string, error) {
        // Use PowerShell with -NoProfile -WindowStyle Hidden for complex commands
        // For simple commands, use cmd /c with CREATE_NO_WINDOW
        cmd := exec.Command("cmd", "/c", command)
        cmd.SysProcAttr = &syscall.SysProcAttr{
                HideWindow:    true,
                CreationFlags: 0x08000000, // CREATE_NO_WINDOW
        }
        out, err := cmd.Output()
        return string(out), err
}

func winExecPowerShellHidden(command string) (string, error) {
        cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", command)
        cmd.SysProcAttr = &syscall.SysProcAttr{
                HideWindow:    true,
                CreationFlags: 0x08000000, // CREATE_NO_WINDOW
        }
        out, err := cmd.Output()
        return string(out), err
}
