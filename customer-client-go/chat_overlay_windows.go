//go:build windows

package main

/*
#cgo LDFLAGS: -luser32 -lgdi32 -lkernel32
#include <windows.h>
#include <string.h>

// Chat window state
static HWND g_chatHwnd = NULL;
static HDC g_chatDC = NULL;
static HBITMAP g_chatBitmap = NULL;
static int g_chatW = 320;
static int g_chatH = 200;
static char g_chatLines[10][256];
static int g_chatLineCount = 0;
static WNDPROC g_oldProc = NULL;

// Add a chat line and repaint
static void addChatLine(const char* sender, const char* text) {
    if (g_chatLineCount >= 10) {
        // Shift up
        memmove(g_chatLines[0], g_chatLines[1], 9 * 256);
        g_chatLineCount = 9;
    }
    snprintf(g_chatLines[g_chatLineCount], 256, "%s: %s", sender, text);
    g_chatLineCount++;
    if (g_chatHwnd) InvalidateRect(g_chatHwnd, NULL, TRUE);
}

// Window procedure for the chat overlay
static LRESULT CALLBACK ChatWndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    switch (msg) {
    case WM_PAINT: {
        PAINTSTRUCT ps;
        HDC hdc = BeginPaint(hwnd, &ps);

        // Background
        RECT rc;
        GetClientRect(hwnd, &rc);
        HBRUSH bg = CreateSolidBrush(RGB(26, 26, 46));
        FillRect(hdc, &rc, bg);
        DeleteObject(bg);

        // Header bar
        RECT header = {0, 0, rc.right, 28};
        HBRUSH hdrBrush = CreateSolidBrush(RGB(27, 58, 107));
        FillRect(hdc, &header, hdrBrush);
        DeleteObject(hdrBrush);

        // Header text
        SetTextColor(hdc, RGB(255, 196, 37));
        SetBkMode(hdc, TRANSPARENT);
        HFONT hFont = CreateFont(14, 0, 0, 0, FW_BOLD, 0, 0, 0, 0, 0, 0, 0, 0, "Segoe UI");
        HFONT hOld = SelectObject(hdc, hFont);
        TextOutA(hdc, 10, 6, "MarqueeIT Chat", 14);

        // Messages
        SetTextColor(hdc, RGB(238, 238, 238));
        HFONT hSmall = CreateFont(12, 0, 0, 0, FW_NORMAL, 0, 0, 0, 0, 0, 0, 0, 0, "Segoe UI");
        SelectObject(hdc, hSmall);
        for (int i = 0; i < g_chatLineCount; i++) {
            TextOutA(hdc, 8, 35 + i * 16, g_chatLines[i], strlen(g_chatLines[i]));
        }

        SelectObject(hdc, hOld);
        DeleteObject(hFont);
        DeleteObject(hSmall);

        EndPaint(hwnd, &ps);
        return 0;
    }
    case WM_DESTROY:
        g_chatHwnd = NULL;
        PostQuitMessage(0);
        return 0;
    case WM_LBUTTONDOWN: {
        // Allow dragging the window
        ReleaseCapture();
        SendMessage(hwnd, WM_NCLBUTTONDOWN, HTCAPTION, 0);
        return 0;
    }
    }
    return DefWindowProcA(hwnd, msg, wParam, lParam);
}

// Create the chat overlay window
static int createChatWindow() {
    if (g_chatHwnd) return 1;

    WNDCLASSEXA wc = {0};
    wc.cbSize = sizeof(wc);
    wc.lpfnWndProc = ChatWndProc;
    wc.hInstance = GetModuleHandle(NULL);
    wc.lpszClassName = "MarqueeITChat";
    wc.hCursor = LoadCursor(NULL, IDC_ARROW);
    RegisterClassExA(&wc);

    // Position bottom-right
    int screenW = GetSystemMetrics(SM_CXSCREEN);
    int screenH = GetSystemMetrics(SM_CYSCREEN);

    g_chatHwnd = CreateWindowExA(
        WS_EX_TOPMOST | WS_EX_LAYERED | WS_EX_TOOLWINDOW,
        "MarqueeITChat", "MarqueeIT Chat",
        WS_POPUP | WS_VISIBLE,
        screenW - g_chatW - 20, screenH - g_chatH - 60,
        g_chatW, g_chatH,
        NULL, NULL, GetModuleHandle(NULL), NULL);

    if (!g_chatHwnd) return 0;

    // Set transparency (90% opaque)
    SetLayeredWindowAttributes(g_chatHwnd, 0, 230, LWA_ALPHA);

    ShowWindow(g_chatHwnd, SW_SHOW);
    UpdateWindow(g_chatHwnd);

    // Run message pump in a separate thread
    return 1;
}

static void chatMessageLoop() {
    MSG msg;
    while (GetMessage(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }
}
*/
import "C"

import (
	"runtime"
	"sync"
	"unsafe"
)

var chatWindowOnce sync.Once

// showChatOverlay creates the always-on-top chat window and adds a message.
// On non-Windows, this is a no-op (falls back to toast/log).
func showChatOverlay(sender, content string) {
	if runtime.GOOS != "windows" {
		showToast(sender, content)
		return
	}

	chatWindowOnce.Do(func() {
		C.createChatWindow()
		go func() {
			C.chatMessageLoop()
		}()
	})

	cSender := C.CString(sender)
	cContent := C.CString(content)
	C.addChatLine(cSender, cContent)
	C.free(unsafe.Pointer(cSender))
	C.free(unsafe.Pointer(cContent))
}
