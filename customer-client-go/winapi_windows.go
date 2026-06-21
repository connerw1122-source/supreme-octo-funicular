//go:build windows

package main

/*
#cgo LDFLAGS: -luser32 -lkernel32
#include <windows.h>
#include <string.h>

// Set the clipboard text via Win32 API (Unicode, no PowerShell, no flashing)
// Makes a private copy of the text so it survives CloseClipboard.
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

// Get clipboard text via Win32 API (Unicode).
// Returns a malloc'd buffer that the caller must free via freeClipboardText().
// This avoids the use-after-free where the returned pointer pointed into
// clipboard memory that gets invalidated after CloseClipboard.
static wchar_t* getClipboardText() {
    if (!OpenClipboard(NULL)) return NULL;
    HANDLE hData = GetClipboardData(CF_UNICODETEXT);
    if (!hData) { CloseClipboard(); return NULL; }
    const wchar_t* text = (const wchar_t*)GlobalLock(hData);
    if (!text) { CloseClipboard(); return NULL; }
    // Make a private copy while the clipboard is still locked.
    size_t len = wcslen(text);
    wchar_t* copy = (wchar_t*)malloc((len + 1) * sizeof(wchar_t));
    if (copy) {
        wcscpy(copy, text);
    }
    GlobalUnlock(hData);
    CloseClipboard();
    return copy;
}

// freeClipboardText frees a buffer returned by getClipboardText.
static void freeClipboardText(wchar_t* p) {
    if (p) free(p);
}

// BlockInput — caller must be admin (SeDebugPrivilege) for this to work.
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
        // Convert Go string to UTF-16 (what Windows uses).
        // Use UTF16Count to get the correct number of wchar_t code units
        // (not rune count — astral-plane characters like emoji are 1 rune
        // but 2 wchar_t as a surrogate pair).
        wstr, err := syscall.UTF16PtrFromString(text)
        if err != nil {
                return
        }
        // Count UTF-16 code units (correct length for GlobalAlloc).
        utf16 := []uint16{}
        for _, r := range text {
                utf16 = append(utf16, uint16(r))
        }
        // syscall.UTF16FromString produces surrogate pairs, so re-count.
        wbuf, _ := syscall.UTF16FromString(text)
        length := len(wbuf)
        if length > 0 {
                length-- // exclude null terminator
        }
        C.setClipboardText((*C.wchar_t)(unsafe.Pointer(wstr)), C.int(length))
        _ = wbuf
}

func winGetClipboard() string {
        wtext := C.getClipboardText()
        if wtext == nil {
                return ""
        }
        defer C.freeClipboardText(wtext)
        ptr := (*uint16)(unsafe.Pointer(wtext))
        return syscall.UTF16ToString(unsafe.Slice(ptr, 1<<20))
}

// winBlockInput blocks or unblocks the customer's keyboard/mouse.
// Returns true if successful. NOTE: requires admin privileges — without
// admin, BlockInput returns FALSE and does nothing.
func winBlockInput(block bool) bool {
        var v C.int
        if block {
                v = 1
        }
        return C.blockInput(v) != 0
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
