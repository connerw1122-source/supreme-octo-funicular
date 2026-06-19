//go:build windows

package main

// Windows input injection using SendInput API.
// Real implementation would use golang.org/x/sys/windows SendInput.
// For now, stubs log and no-op. To enable, install golang.org/x/sys/windows
// and implement using the user32.dll SendInput call.

import "log"

func mouseMove(relX, relY float64) {
	// TODO: implement via user32.dll SendInput with MOUSEEVENTF_ABSOLUTE
	log.Printf("[windows] mouseMove %.2f,%.2f (not yet implemented)", relX, relY)
}

func mouseDown(button string) {
	log.Printf("[windows] mouseDown %s (not yet implemented)", button)
}

func mouseUp(button string) {
	log.Printf("[windows] mouseUp %s (not yet implemented)", button)
}

func mouseScroll(amount int) {
	log.Printf("[windows] mouseScroll %d (not yet implemented)", amount)
}

func keyDown(code string) {
	log.Printf("[windows] keyDown %s (not yet implemented)", code)
}

func keyUp(code string) {
	log.Printf("[windows] keyUp %s (not yet implemented)", code)
}

func keyPress(code string) {
	log.Printf("[windows] keyPress %s (not yet implemented)", code)
}

func keyType(text string) {
	log.Printf("[windows] keyType %q (not yet implemented)", text)
}
