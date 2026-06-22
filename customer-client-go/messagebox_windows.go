//go:build windows

package main

import (
	"syscall"
	"unsafe"
)

// showMessageBox displays a Windows message box. Used for fatal errors
// since -H windowsgui means there's no console for stderr output.
func showMessageBox(title, text string) {
	user32 := syscall.NewLazyDLL("user32.dll")
	mbox := user32.NewProc("MessageBoxW")
	t, _ := syscall.UTF16PtrFromString(text)
	ti, _ := syscall.UTF16PtrFromString(title)
	mbox.Call(0, uintptr(unsafe.Pointer(t)), uintptr(unsafe.Pointer(ti)), 0x10) // MB_ICONERROR
}
