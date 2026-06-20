//go:build windows && cgo

package main

/*
#cgo LDFLAGS: -luser32 -lgdi32
#include <windows.h>
#include <stdint.h>

// Helper: send a mouse event via SendInput
static int sendMouse(DWORD flags, DWORD mouseData) {
    INPUT input;
    input.type = INPUT_MOUSE;
    input.mi.dx = 0;
    input.mi.dy = 0;
    input.mi.mouseData = mouseData;
    input.mi.dwFlags = flags;
    input.mi.time = 0;
    input.mi.dwExtraInfo = 0;
    return SendInput(1, &input, sizeof(INPUT));
}

// Move mouse to absolute coordinates (0..65535 range)
static int sendMouseMoveAbs(int x, int y) {
    INPUT input;
    input.type = INPUT_MOUSE;
    input.mi.dx = x;
    input.mi.dy = y;
    input.mi.mouseData = 0;
    input.mi.dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE;
    input.mi.time = 0;
    input.mi.dwExtraInfo = 0;
    return SendInput(1, &input, sizeof(INPUT));
}

// Send a key event via SendInput using a virtual key code
static int sendKey(WORD vk, int down) {
    INPUT input;
    input.type = INPUT_KEYBOARD;
    input.ki.wVk = vk;
    input.ki.wScan = 0;
    input.ki.dwFlags = down ? 0 : KEYEVENTF_KEYUP;
    input.ki.time = 0;
    input.ki.dwExtraInfo = 0;
    return SendInput(1, &input, sizeof(INPUT));
}

// Send a unicode character via SendInput
static int sendUnicodeChar(wchar_t ch, int down) {
    INPUT input;
    input.type = INPUT_KEYBOARD;
    input.ki.wVk = 0;
    input.ki.wScan = ch;
    input.ki.dwFlags = KEYEVENTF_UNICODE | (down ? 0 : KEYEVENTF_KEYUP);
    input.ki.time = 0;
    input.ki.dwExtraInfo = 0;
    return SendInput(1, &input, sizeof(INPUT));
}

// Get screen width/height
static int screenWidth() {
    return GetSystemMetrics(SM_CXSCREEN);
}
static int screenHeight() {
    return GetSystemMetrics(SM_CYSCREEN);
}
*/
import "C"

import (
        "strings"
        "unicode"
)

// Map browser KeyboardEvent.code to Windows virtual key codes
var vkMap = map[string]C.WORD{
        "Enter":        0x0D,
        "Backspace":    0x08,
        "Tab":          0x09,
        "Escape":       0x1B,
        "Space":        0x20,
        "ArrowUp":      0x26,
        "ArrowDown":    0x28,
        "ArrowLeft":    0x25,
        "ArrowRight":   0x27,
        "ShiftLeft":    0xA0,
        "ShiftRight":   0xA1,
        "ControlLeft":  0xA2,
        "ControlRight": 0xA3,
        "AltLeft":      0xA4,
        "AltRight":     0xA5,
        "CapsLock":     0x14,
        "Delete":       0x2E,
        "End":          0x23,
        "Home":         0x24,
        "PageUp":       0x21,
        "PageDown":     0x22,
        "F1":           0x70,
        "F2":           0x71,
        "F3":           0x72,
        "F4":           0x73,
        "F5":           0x74,
        "F6":           0x75,
        "F7":           0x76,
        "F8":           0x77,
        "F9":           0x78,
        "F10":          0x79,
        "F11":          0x7A,
        "F12":          0x7B,
}

func vkFor(code string) C.WORD {
        if vk, ok := vkMap[code]; ok {
                return vk
        }
        // Letter: "KeyA" -> 'A'
        if strings.HasPrefix(code, "Key") && len(code) == 4 {
                c := code[3]
                if c >= 'A' && c <= 'Z' {
                        return C.WORD(c)
                }
        }
        // Digit: "Digit1" -> '1'
        if strings.HasPrefix(code, "Digit") && len(code) == 6 {
                c := code[5]
                if c >= '0' && c <= '9' {
                        return C.WORD(c)
                }
        }
        // Single char
        if len(code) == 1 {
                c := code[0]
                if c >= 'a' && c <= 'z' {
                        return C.WORD(c - 32) // to uppercase
                }
                if c >= 'A' && c <= 'Z' {
                        return C.WORD(c)
                }
        }
        return 0
}

func mouseMove(relX, relY float64) {
        w := int(C.screenWidth())
        h := int(C.screenHeight())
        // Convert relative [0..1] to absolute [0..65535]
        ax := int(relX * 65535.0)
        ay := int(relY * 65535.0)
        if ax < 0 {
                ax = 0
        }
        if ay < 0 {
                ay = 0
        }
        if ax > 65535 {
                ax = 65535
        }
        if ay > 65535 {
                ay = 65535
        }
        C.sendMouseMoveAbs(C.int(ax), C.int(ay))
}

func mouseDown(button string) {
        var flags C.DWORD
        switch button {
        case "right":
                flags = C.MOUSEEVENTF_RIGHTDOWN
        case "middle":
                flags = C.MOUSEEVENTF_MIDDLEDOWN
        default:
                flags = C.MOUSEEVENTF_LEFTDOWN
        }
        C.sendMouse(flags, 0)
}

func mouseUp(button string) {
        var flags C.DWORD
        switch button {
        case "right":
                flags = C.MOUSEEVENTF_RIGHTUP
        case "middle":
                flags = C.MOUSEEVENTF_MIDDLEUP
        default:
                flags = C.MOUSEEVENTF_LEFTUP
        }
        C.sendMouse(flags, 0)
}

func mouseScroll(amount int) {
        if amount == 0 {
                return
        }
        // Windows wheel delta is typically 120 per notch
        C.sendMouse(C.MOUSEEVENTF_WHEEL, C.DWORD(amount*120))
}

func keyDown(code string) {
        vk := vkFor(code)
        if vk == 0 {
                return
        }
        C.sendKey(vk, 1)
}

func keyUp(code string) {
        vk := vkFor(code)
        if vk == 0 {
                return
        }
        C.sendKey(vk, 0)
}

func keyPress(code string) {
        keyDown(code)
        keyUp(code)
}

func keyType(text string) {
        for _, r := range text {
                // For uppercase letters and shifted symbols, hold shift
                shift := unicode.IsUpper(r) || (r >= '!' && r <= '&') || r == '(' || r == ')' || r == '*' || r == '+'
                if shift {
                        C.sendKey(0xA0, 1) // Shift down
                }
                C.sendUnicodeChar(C.wchar_t(r), 1)
                C.sendUnicodeChar(C.wchar_t(r), 0)
                if shift {
                        C.sendKey(0xA0, 0) // Shift up
                }
        }
}
