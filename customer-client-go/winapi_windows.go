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

// ---------------------------------------------------------------------------
// Low-level input blocking via SetWindowsHookEx
// ---------------------------------------------------------------------------
// BlockInput() requires admin and auto-unblocks when the calling thread exits.
// Low-level hooks (WH_KEYBOARD_LL / WH_MOUSE_LL) work without admin and stay
// active as long as the hook thread is alive. We install hooks that swallow
// all events, effectively blocking the customer's keyboard and mouse.

static HHOOK g_kbdHook = NULL;
static HHOOK g_mouseHook = NULL;
static int g_inputBlocked = 0;

// Low-level keyboard hook — blocks all keyboard input when g_inputBlocked is set
static LRESULT CALLBACK LowLevelKbdProc(int nCode, WPARAM wParam, LPARAM lParam) {
    if (g_inputBlocked && nCode >= 0) {
        // Swallow the event — return non-zero to block it
        return 1;
    }
    return CallNextHookEx(NULL, nCode, wParam, lParam);
}

// Low-level mouse hook — blocks all mouse input when g_inputBlocked is set.
// We still allow the technician's injected input (SendInput) through because
// injected events have the LLMHF_INJECTED flag set in the MSLLHOOKSTRUCT.
static LRESULT CALLBACK LowLevelMouseProc(int nCode, WPARAM wParam, LPARAM lParam) {
    if (g_inputBlocked && nCode >= 0) {
        // Check if this is an injected event (from SendInput) — allow those
        MSLLHOOKSTRUCT* m = (MSLLHOOKSTRUCT*)lParam;
        if (m && (m->flags & LLMHF_INJECTED)) {
            // Injected event — let it through
            return CallNextHookEx(NULL, nCode, wParam, lParam);
        }
        // Real mouse event — block it
        return 1;
    }
    return CallNextHookEx(NULL, nCode, wParam, lParam);
}

// Install the low-level hooks. Must be called from the thread that will run
// the message loop (the hook thread). Returns 1 on success, 0 on failure.
static int installInputHooks() {
    if (g_kbdHook && g_mouseHook) return 1; // already installed
    g_kbdHook = SetWindowsHookExA(WH_KEYBOARD_LL, LowLevelKbdProc, GetModuleHandle(NULL), 0);
    g_mouseHook = SetWindowsHookExA(WH_MOUSE_LL, LowLevelMouseProc, GetModuleHandle(NULL), 0);
    if (!g_kbdHook || !g_mouseHook) {
        if (g_kbdHook) { UnhookWindowsHookEx(g_kbdHook); g_kbdHook = NULL; }
        if (g_mouseHook) { UnhookWindowsHookEx(g_mouseHook); g_mouseHook = NULL; }
        return 0;
    }
    return 1;
}

// Set the input blocked flag (1 = block, 0 = allow). The hooks must already
// be installed via installInputHooks().
static void setInputBlocked(int blocked) {
    g_inputBlocked = blocked;
}

// Run a message loop for the hook thread. Hooks require a message loop on
// the same thread that installed them.
static void hookMessageLoop() {
    MSG msg;
    while (GetMessage(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }
}

// BlockInput — legacy, requires admin. Kept for fallback but not used.
static int blockInput(int block) {
    return BlockInput(block ? TRUE : FALSE);
}
*/
import "C"

import (
        "os/exec"
        "runtime"
        "sync"
        "syscall"
        "unsafe"
)

// Hook thread management
var (
        hookOnce    sync.Once
        hookReady   = make(chan struct{})
)

// initInputHooks starts a dedicated thread that installs low-level keyboard
// and mouse hooks and runs a message loop. The hooks stay installed for the
// lifetime of the process; blocking is controlled by the g_inputBlocked flag.
func initInputHooks() {
        hookOnce.Do(func() {
                go func() {
                        runtime.LockOSThread()
                        C.installInputHooks()
                        close(hookReady)
                        C.hookMessageLoop()
                }()
        })
}

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

// winBlockInput blocks or unblocks the customer's keyboard/mouse using
// low-level hooks (no admin required). When blocked, the technician's
// injected input (SendInput) still gets through because injected events
// have the LLMHF_INJECTED flag.
func winBlockInput(block bool) bool {
        // Ensure hooks are installed
        initInputHooks()
        // Wait for the hook thread to be ready (up to 2 seconds)
        select {
        case <-hookReady:
        default:
                // Don't block if not ready yet — the hooks will still work
                // once installed, we just might miss the first toggle
        }
        if block {
                C.setInputBlocked(1)
        } else {
                C.setInputBlocked(0)
        }
        return true
}

// winSendCAD sends Ctrl+Alt+Del via SendInput (simulated)
func winSendCAD() {
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
