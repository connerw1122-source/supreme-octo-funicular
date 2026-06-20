//go:build linux && wayland

package main

// Wayland input injection via PipeWire + Mutter RemoteDesktop.
// This is a stub — full implementation requires:
//   1. PipeWire screen capture (replaces kbinani/screenshot)
//   2. Mutter RemoteDesktop portal for input injection
//   3. libportal bindings for xdg-desktop-portal
//
// For now, Wayland builds fall back to no input injection (view-only).
// Screen capture still works via kbinani/screenshot which uses XWayland
// if available, or falls back to PipeWire on pure Wayland.

import "log"

func mouseMove(relX, relY float64) {
	log.Printf("[wayland] mouseMove not implemented")
}

func mouseDown(button string) {
	log.Printf("[wayland] mouseDown %s not implemented", button)
}

func mouseUp(button string) {
	log.Printf("[wayland] mouseUp %s not implemented", button)
}

func mouseScroll(amount int) {
	log.Printf("[wayland] mouseScroll %d not implemented", amount)
}

func keyDown(code string) {
	log.Printf("[wayland] keyDown %s not implemented", code)
}

func keyUp(code string) {
	log.Printf("[wayland] keyUp %s not implemented", code)
}

func keyPress(code string) {
	log.Printf("[wayland] keyPress %s not implemented", code)
}

func keyType(text string) {
	log.Printf("[wayland] keyType not implemented")
}
