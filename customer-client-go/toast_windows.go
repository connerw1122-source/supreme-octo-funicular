//go:build windows

package main

/*
#cgo LDFLAGS: -luser32 -lshell32 -lole32
#include <windows.h>
#include <shellapi.h>

// NotifyInfo shows a Windows balloon/tray notification (non-blocking)
static void notifyInfo(const wchar_t* title, const wchar_t* text) {
    // Use NOTIFYICONDATA with a balloon tip
    NOTIFYICONDATAW nid;
    ZeroMemory(&nid, sizeof(nid));
    nid.cbSize = sizeof(nid);
    nid.hWnd = NULL;
    nid.uID = 1;
    nid.uFlags = NIF_INFO;
    nid.dwInfoFlags = NIIF_INFO;
    lstrcpynW(nid.szInfoTitle, title, 64);
    lstrcpynW(nid.szInfo, text, 256);
    Shell_NotifyIconW(NIM_ADD, &nid);
    // Remove after 10 seconds (the OS handles display)
    nid.uFlags = 0;
    nid.uFlags = NIF_INFO;
    nid.szInfo[0] = 0;
    // Don't delete — let it auto-expire
}
*/
import "C"

import (
	"syscall"
	"unsafe"
)

// showToast shows a non-blocking Windows notification
func showToast(title, text string) {
	t, _ := syscall.UTF16PtrFromString(title)
	txt, _ := syscall.UTF16PtrFromString(text)
	C.notifyInfo((*C.wchar_t)(unsafe.Pointer(t)), (*C.wchar_t)(unsafe.Pointer(txt)))
}
