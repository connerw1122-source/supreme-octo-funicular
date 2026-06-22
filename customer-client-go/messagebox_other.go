//go:build !windows

package main

import "fmt"

// showMessageBox is a no-op on non-Windows (use stderr instead)
func showMessageBox(title, text string) {
	fmt.Printf("[%s] %s\n", title, text)
}
