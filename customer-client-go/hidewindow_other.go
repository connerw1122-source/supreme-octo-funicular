//go:build !windows

package main

import "syscall"

func hideWindow(cmd *syscall.SysProcAttr) {
	// No-op on non-Windows
}
