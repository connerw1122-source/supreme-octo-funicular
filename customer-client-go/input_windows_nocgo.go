//go:build windows && !cgo

package main

// Fallback input injection when CGO is not available.
// Real implementation is in input_windows_cgo.go (requires MinGW).

import "log"

func mouseMove(relX, relY float64) {
	log.Printf("[windows] mouseMove not available (built without CGO)")
}

func mouseDown(button string) {}

func mouseUp(button string) {}

func mouseScroll(amount int) {}

func keyDown(code string) {}

func keyUp(code string) {}

func keyPress(code string) {}

func keyType(text string) {}
