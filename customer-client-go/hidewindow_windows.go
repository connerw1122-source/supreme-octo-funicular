//go:build windows

package main

import "syscall"

func hideWindow(cmd *syscall.SysProcAttr) {
	cmd.HideWindow = true
}
