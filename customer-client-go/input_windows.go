//go:build windows && cgo

package main

/*
#cgo LDFLAGS: -luser32 -lgdi32
#include <windows.h>
#include <stdint.h>

// Helper: send a mouse event via SendInput (uses current cursor position)
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

// Send a key event with extra flags (e.g. KEYEVENTF_EXTENDEDKEY for arrows)
static int sendKeyEx(WORD vk, int down, DWORD extraFlags) {
    INPUT input;
    input.type = INPUT_KEYBOARD;
    input.ki.wVk = vk;
    input.ki.wScan = 0;
    input.ki.dwFlags = (down ? 0 : KEYEVENTF_KEYUP) | extraFlags;
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

// Create a message queue. SendInput silently fails without one on some
// Windows versions (e.g. Windows 11 24H2+ when launched without a console).
static void ensureMessageQueue() {
    MSG msg;
    PeekMessage(&msg, NULL, 0, 0, PM_NOREMOVE);
}
*/
import "C"

import (
        "strings"
)

// init ensures a message queue exists before any input functions are called.
func init() {
        C.ensureMessageQueue()
}

// Map browser KeyboardEvent.code to Windows virtual key codes
var vkMap = map[string]C.WORD{
        "Enter":        0x0D,
        "NumpadEnter":  0x0D,
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
        "Insert":       0x2D,
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
        // Punctuation and symbol keys (these were missing — caused "/" etc. to not work)
        "Semicolon":    0xBA, // ;
        "Equal":        0xBB, // =
        "Comma":        0xBC, // ,
        "Minus":        0xBD, // -
        "Period":       0xBE, // .
        "Slash":        0xBF, // /
        "Backquote":    0xC0, // `
        "BracketLeft":  0xDB, // [
        "Backslash":    0xDC, // \
        "BracketRight": 0xDD, // ]
        "Quote":        0xDE, // '
        // Numpad keys
        "Numpad0":      0x60,
        "Numpad1":      0x61,
        "Numpad2":      0x62,
        "Numpad3":      0x63,
        "Numpad4":      0x64,
        "Numpad5":      0x65,
        "Numpad6":      0x66,
        "Numpad7":      0x67,
        "Numpad8":      0x68,
        "Numpad9":      0x69,
        "NumpadMultiply":  0x6A,
        "NumpadAdd":       0x6B,
        "NumpadSubtract":  0x6D,
        "NumpadDecimal":   0x6E,
        "NumpadDivide":    0x6F,
        // Lock keys
        "NumLock":      0x90,
        "ScrollLock":   0x91,
        // Windows key
        "MetaLeft":     0x5B,
        "MetaRight":    0x5C,
        "ContextMenu":  0x5D,
}

// Keys that require KEYEVENTF_EXTENDEDKEY flag on Windows
func isExtended(code string) bool {
        switch code {
        case "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
                "Delete", "Home", "End", "PageUp", "PageDown",
                "Insert", "NumpadDivide", "NumpadEnter":
                return true
        }
        return false
}

// symbolToVK maps single-character keys (e.key fallback when e.code is empty)
// to Windows virtual key codes. This handles the case where the browser sends
// e.key (e.g. "/") instead of e.code (e.g. "Slash").
var symbolToVK = map[byte]C.WORD{
        '/':  0xBF, // VK_OEM_2 (Slash)
        '?':  0xBF, // shifted Slash
        '.':  0xBE, // VK_OEM_PERIOD
        ',':  0xBC, // VK_OEM_COMMA
        '-':  0xBD, // VK_OEM_MINUS
        '_':  0xBD, // shifted minus
        '=':  0xBB, // VK_OEM_PLUS
        '+':  0xBB, // shifted plus
        ';':  0xBA, // VK_OEM_1
        ':':  0xBA, // shifted semicolon
        '\'': 0xDE, // VK_OEM_7
        '"':  0xDE, // shifted quote
        '[':  0xDB, // VK_OEM_4
        '{':  0xDB, // shifted
        ']':  0xDD, // VK_OEM_6
        '}':  0xDD, // shifted
        '\\': 0xDC, // VK_OEM_5
        '|':  0xDC, // shifted
        '`':  0xC0, // VK_OEM_3
        '~':  0xC0, // shifted
        '!':  0x31, // shifted 1
        '@':  0x32, // shifted 2
        '#':  0x33, // shifted 3
        '$':  0x34, // shifted 4
        '%':  0x35, // shifted 5
        '^':  0x36, // shifted 6
        '&':  0x37, // shifted 7
        '*':  0x38, // shifted 8
        '(':  0x39, // shifted 9
        ')':  0x30, // shifted 0
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
        // Single char fallback — handles both letters and symbols
        if len(code) == 1 {
                c := code[0]
                if c >= 'a' && c <= 'z' {
                        return C.WORD(c - 32) // to uppercase
                }
                if c >= 'A' && c <= 'Z' {
                        return C.WORD(c)
                }
                if c >= '0' && c <= '9' {
                        return C.WORD(c)
                }
                // Check the symbol map
                if vk, ok := symbolToVK[c]; ok {
                        return vk
                }
        }
        return 0
}

func mouseMove(relX, relY float64) {
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
        if isExtended(code) {
                C.sendKeyEx(vk, 1, C.KEYEVENTF_EXTENDEDKEY)
        } else {
                C.sendKey(vk, 1)
        }
}

func keyUp(code string) {
        vk := vkFor(code)
        if vk == 0 {
                return
        }
        if isExtended(code) {
                C.sendKeyEx(vk, 0, C.KEYEVENTF_EXTENDEDKEY)
        } else {
                C.sendKey(vk, 0)
        }
}

func keyPress(code string) {
        keyDown(code)
        keyUp(code)
}

func keyType(text string) {
        for _, r := range text {
                // sendUnicodeChar sends the character directly via KEYEVENTF_UNICODE,
                // which does NOT require shift to be held — Windows handles the
                // character as-is. The old shift logic was wrong for many symbols
                // (_, ?, ~, etc.) and caused double-shift issues.
                C.sendUnicodeChar(C.wchar_t(r), 1)
                C.sendUnicodeChar(C.wchar_t(r), 0)
        }
}
