//go:build !windows

package main

func showToast(title, text string) {
	// No-op on non-Windows
}
