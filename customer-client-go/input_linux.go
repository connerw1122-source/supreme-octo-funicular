//go:build linux

package main

/*
#cgo LDFLAGS: -lX11
#include <X11/Xlib.h>
#include <X11/Xutil.h>
#include <X11/keysym.h>
*/
import "C"

import (
        "fmt"
        "strings"
        "unicode"
        "unsafe"

        "github.com/kbinani/screenshot"
)

var xDisplay *C.Display

func initX11() error {
        if xDisplay != nil {
                return nil
        }
        d := C.XOpenDisplay(nil)
        if d == nil {
                return fmt.Errorf("cannot open X11 display (no X server running?)")
        }
        xDisplay = d
        return nil
}

// Display size for relative -> absolute coordinate conversion
func displaySize() (int, int) {
        if n := screenshot.NumActiveDisplays(); n > 0 {
                if img, err := screenshot.CaptureDisplay(0); err == nil {
                        b := img.Bounds()
                        return b.Dx(), b.Dy()
                }
        }
        return 1920, 1080
}

func buttonCode(button string) int {
        switch button {
        case "right":
                return 3
        case "middle":
                return 2
        default:
                return 1
        }
}

var keySymMap = map[string]C.KeySym{
        "Enter":        0xFF0D,
        "Backspace":    0xFF08,
        "Tab":          0xFF09,
        "Escape":       0xFF1B,
        "Space":        0x20,
        "ArrowUp":      0xFF52,
        "ArrowDown":    0xFF54,
        "ArrowLeft":    0xFF51,
        "ArrowRight":   0xFF53,
        "ShiftLeft":    0xFFE1,
        "ShiftRight":   0xFFE2,
        "ControlLeft":  0xFFE3,
        "ControlRight": 0xFFE4,
        "AltLeft":      0xFFE9,
        "AltRight":     0xFFEA,
        "CapsLock":     0xFFE5,
        "Delete":       0xFFFF,
        "End":          0xFF57,
        "Home":         0xFF50,
        "PageUp":       0xFF55,
        "PageDown":     0xFF56,
        "F1":           0xFFBE,
        "F2":           0xFFBF,
        "F3":           0xFFC0,
        "F4":           0xFFC1,
        "F5":           0xFFC2,
        "F6":           0xFFC3,
        "F7":           0xFFC4,
        "F8":           0xFFC5,
        "F9":           0xFFC6,
        "F10":          0xFFC7,
        "F11":          0xFFC8,
        "F12":          0xFFC9,
}

func keySymFor(code string) C.KeySym {
        if sym, ok := keySymMap[code]; ok {
                return sym
        }
        if strings.HasPrefix(code, "Key") && len(code) == 4 {
                c := code[3]
                if c >= 'A' && c <= 'Z' {
                        return C.KeySym(unicode.ToLower(rune(c)))
                }
        }
        if strings.HasPrefix(code, "Digit") && len(code) == 6 {
                c := code[5]
                if c >= '0' && c <= '9' {
                        return C.KeySym(c)
                }
        }
        if len(code) == 1 {
                return C.KeySym(code[0])
        }
        return 0
}

// sendButtonEvent sends a ButtonPress or ButtonRelease event via XSendEvent.
// NOTE: XSendEvent is intercepted by most modern apps because they detect the
// send_event flag. For real input injection, install libxtst-dev and use
// XTestFakeButtonEvent instead. We use XSendEvent here because libxtst-dev
// is not available in this build environment.
func sendButtonEvent(button int, pressed bool) {
        if err := initX11(); err != nil {
                return
        }
        root := C.XDefaultRootWindow(xDisplay)
        var ev C.XButtonEvent
        if pressed {
                ev._type = C.ButtonPress
        } else {
                ev._type = C.ButtonRelease
        }
        ev.serial = 0
        ev.send_event = 1
        ev.display = xDisplay
        ev.window = root
        ev.root = root
        ev.subwindow = 0
        ev.time = C.CurrentTime
        ev.x = 0
        ev.y = 0
        ev.x_root = 0
        ev.y_root = 0
        ev.state = 0
        ev.button = C.uint(button)
        ev.same_screen = 1
        C.XSendEvent(xDisplay, root, 0, C.ButtonPressMask|C.ButtonReleaseMask, (*C.XEvent)(unsafe.Pointer(&ev)))
        C.XFlush(xDisplay)
}

func mouseMove(relX, relY float64) {
        if err := initX11(); err != nil {
                return
        }
        w, h := displaySize()
        x := int(relX * float64(w))
        y := int(relY * float64(h))
        if x < 0 {
                x = 0
        }
        if y < 0 {
                y = 0
        }
        if x >= w {
                x = w - 1
        }
        if y >= h {
                y = h - 1
        }
        C.XWarpPointer(xDisplay, 0, C.XDefaultRootWindow(xDisplay), 0, 0, 0, 0, C.int(x), C.int(y))
        C.XFlush(xDisplay)
}

func mouseDown(button string) {
        sendButtonEvent(buttonCode(button), true)
}

func mouseUp(button string) {
        sendButtonEvent(buttonCode(button), false)
}

func mouseScroll(amount int) {
        if amount == 0 {
                return
        }
        button := 4
        if amount < 0 {
                button = 5
                amount = -amount
        }
        for i := 0; i < amount; i++ {
                sendButtonEvent(button, true)
                sendButtonEvent(button, false)
        }
}

func keyDown(code string) {
        if err := initX11(); err != nil {
                return
        }
        sym := keySymFor(code)
        if sym == 0 {
                return
        }
        keycode := C.XKeysymToKeycode(xDisplay, C.ulong(sym))
        if keycode == 0 {
                return
        }
        root := C.XDefaultRootWindow(xDisplay)
        var ev C.XKeyEvent
        ev._type = C.KeyPress
        ev.display = xDisplay
        ev.window = root
        ev.root = root
        ev.keycode = C.uint(keycode)
        ev.time = C.CurrentTime
        ev.same_screen = 1
        C.XSendEvent(xDisplay, root, 0, C.KeyPressMask, (*C.XEvent)(unsafe.Pointer(&ev)))
        C.XFlush(xDisplay)
}

func keyUp(code string) {
        if err := initX11(); err != nil {
                return
        }
        sym := keySymFor(code)
        if sym == 0 {
                return
        }
        keycode := C.XKeysymToKeycode(xDisplay, C.ulong(sym))
        if keycode == 0 {
                return
        }
        root := C.XDefaultRootWindow(xDisplay)
        var ev C.XKeyEvent
        ev._type = C.KeyRelease
        ev.display = xDisplay
        ev.window = root
        ev.root = root
        ev.keycode = C.uint(keycode)
        ev.time = C.CurrentTime
        ev.same_screen = 1
        C.XSendEvent(xDisplay, root, 0, C.KeyReleaseMask, (*C.XEvent)(unsafe.Pointer(&ev)))
        C.XFlush(xDisplay)
}

func keyPress(code string) {
        keyDown(code)
        keyUp(code)
}

func keyType(text string) {
        for _, r := range text {
                sym := C.KeySym(r)
                keycode := C.XKeysymToKeycode(xDisplay, C.ulong(sym))
                if keycode == 0 {
                        continue
                }
                shift := unicode.IsUpper(r) || (r >= '!' && r <= '&') || r == '(' || r == ')' || r == '*' || r == '+'
                if shift {
                        keyDown("ShiftLeft")
                }
                root := C.XDefaultRootWindow(xDisplay)
                var down C.XKeyEvent
                down._type = C.KeyPress
                down.display = xDisplay
                down.window = root
                down.root = root
                down.keycode = C.uint(keycode)
                down.time = C.CurrentTime
                down.same_screen = 1
                C.XSendEvent(xDisplay, root, 0, C.KeyPressMask, (*C.XEvent)(unsafe.Pointer(&down)))
                var up C.XKeyEvent
                up._type = C.KeyRelease
                up.display = xDisplay
                up.window = root
                up.root = root
                up.keycode = C.uint(keycode)
                up.time = C.CurrentTime
                up.same_screen = 1
                C.XSendEvent(xDisplay, root, 0, C.KeyReleaseMask, (*C.XEvent)(unsafe.Pointer(&up)))
                if shift {
                        keyUp("ShiftLeft")
                }
        }
        C.XFlush(xDisplay)
}
