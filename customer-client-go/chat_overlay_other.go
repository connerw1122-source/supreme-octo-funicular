//go:build !windows

package main

// showChatOverlay is a no-op on non-Windows (falls back to toast)
func showChatOverlay(sender, content string) {
	showToast(sender, content)
}
