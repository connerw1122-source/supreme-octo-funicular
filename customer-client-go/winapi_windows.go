//go:build windows

package main

/*
#cgo LDFLAGS: -luser32 -lkernel32
#include <windows.h>
#include <string.h>

// Set the clipboard text via Win32 API (Unicode, no PowerShell, no flashing)
static int setClipboardText(const wchar_t* text, int len) {
    if (!OpenClipboard(NULL)) return 0;
    EmptyClipboard();
    // +1 for null terminator
    HGLOBAL hMem = GlobalAlloc(GMEM_MOVEABLE, (len + 1) * sizeof(wchar_t));
    if (!hMem) { CloseClipboard(); return 0; }
    wchar_t* pMem = (wchar_t*)GlobalLock(hMem);
    memcpy(pMem, text, len * sizeof(wchar_t));
    pMem[len] = 0;
    GlobalUnlock(hMem);
    SetClipboardData(CF_UNICODETEXT, hMem);
    CloseClipboard();
    return 1;
}

// Get clipboard text via Win32 API (Unicode)
static const wchar_t* getClipboardText() {
    if (!OpenClipboard(NULL)) return L"";
    HANDLE hData = GetClipboardData(CF_UNICODETEXT);
    if (!hData) { CloseClipboard(); return L""; }
    const wchar_t* text = (const wchar_t*)GlobalLock(hData);
    GlobalUnlock(hData);
    CloseClipboard();
    return text;
}

// BlockInput
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
        // Convert Go string to UTF-16 (what Windows uses)
        wstr, _ := syscall.UTF16PtrFromString(text)
        length := len([]rune(text))
        C.setClipboardText((*C.wchar_t)(unsafe.Pointer(wstr)), C.int(length))
}

func winGetClipboard() string {
        wtext := C.getClipboardText()
        // Convert wchar_t* back to Go string
        return syscall.UTF16ToString((*uint16)(unsafe.Pointer(wtext)))
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
