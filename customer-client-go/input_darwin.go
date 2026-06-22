//go:build darwin

package main

// macOS input injection using CGEventCreate from ApplicationServices framework.
// Real implementation requires CGo linking against ApplicationServices.
// For now, stubs log and no-op. To enable, build with:
//   go build -tags darwin -ldflags '-framework ApplicationServices'

import "log"

func mouseMove(relX, relY float64) {
	// TODO: implement via CGEventCreateMouseEvent with kCGEventMouseMoved
	log.Printf("[darwin] mouseMove %.2f,%.2f (not yet implemented)", relX, relY)
}

func mouseDown(button string) {
	log.Printf("[darwin] mouseDown %s (not yet implemented)", button)
}

func mouseUp(button string) {
	log.Printf("[darwin] mouseUp %s (not yet implemented)", button)
}

func mouseScroll(amount int) {
	log.Printf("[darwin] mouseScroll %d (not yet implemented)", amount)
}

func keyDown(code string) {
	log.Printf("[darwin] keyDown %s (not yet implemented)", code)
}

func keyUp(code string) {
	log.Printf("[darwin] keyUp %s (not yet implemented)", code)
}

func keyPress(code string) {
	log.Printf("[darwin] keyPress %s (not yet implemented)", code)
}

func keyType(text string) {
	log.Printf("[darwin] keyType %q (not yet implemented)", text)
}
