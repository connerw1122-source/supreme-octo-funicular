//go:build windows

package main

/*
#cgo LDFLAGS: -luser32 -lgdi32 -lkernel32
#include <windows.h>
#include <string.h>

// Annotation overlay state
static HWND g_annotHwnd = NULL;
static int g_annotX = 0;
static int g_annotY = 0;
static char g_annotLabel[128] = {0};
static int g_annotVisible = 0;

// Window procedure for the annotation overlay
static LRESULT CALLBACK AnnotWndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    switch (msg) {
    case WM_PAINT: {
        PAINTSTRUCT ps;
        HDC hdc = BeginPaint(hwnd, &ps);
        RECT rc;
        GetClientRect(hwnd, &rc);
        int w = rc.right - rc.left;
        int h = rc.bottom - rc.top;

        // Draw the ring (amber, centered in the window)
        HPEN hPen = CreatePen(PS_SOLID, 4, RGB(251, 191, 36));
        HBRUSH hTrans = (HBRUSH)GetStockObject(HOLLOW_BRUSH);
        SelectObject(hdc, hPen);
        SelectObject(hdc, hTrans);
        int ringSize = 48;
        int cx = w / 2;
        int cy = h / 2;
        Ellipse(hdc, cx - ringSize/2, cy - ringSize/2, cx + ringSize/2, cy + ringSize/2);
        DeleteObject(hPen);

        // Draw the label below the ring (white text on amber background)
        if (strlen(g_annotLabel) > 0) {
            HFONT hFont = CreateFont(16, 0, 0, 0, FW_BOLD, 0, 0, 0, 0, 0, 0, 0, 0, "Segoe UI");
            HFONT hOld = SelectObject(hdc, hFont);
            SetBkMode(hdc, TRANSPARENT);
            // Measure the text
            SIZE sz;
            GetTextExtentPoint32A(hdc, g_annotLabel, strlen(g_annotLabel), &sz);
            // Draw label background (amber rounded rect)
            int labelY = cy + ringSize/2 + 4;
            RECT labelBg = {cx - sz.cx/2 - 6, labelY, cx + sz.cx/2 + 6, labelY + sz.cy + 4};
            HBRUSH hBgBrush = CreateSolidBrush(RGB(251, 191, 36));
            FillRect(hdc, &labelBg, hBgBrush);
            DeleteObject(hBgBrush);
            // Draw text (dark blue)
            SetTextColor(hdc, RGB(27, 58, 107));
            TextOutA(hdc, cx - sz.cx/2, labelY + 2, g_annotLabel, strlen(g_annotLabel));
            SelectObject(hdc, hOld);
            DeleteObject(hFont);
        }

        EndPaint(hwnd, &ps);
        return 0;
    }
    case WM_ERASEBKGND:
        // Don't erase — prevents flickering. The layered window handles transparency.
        return 1;
    }
    return DefWindowProcA(hwnd, msg, wParam, lParam);
}

// Create the annotation overlay window (a 200x120 layered window to fit the label)
static int createAnnotWindow() {
    if (g_annotHwnd) return 1;

    WNDCLASSEXA wc = {0};
    wc.cbSize = sizeof(wc);
    wc.lpfnWndProc = AnnotWndProc;
    wc.hInstance = GetModuleHandle(NULL);
    wc.lpszClassName = "MarqueeITAnnot";
    wc.hCursor = LoadCursor(NULL, IDC_ARROW);
    RegisterClassExA(&wc);

    g_annotHwnd = CreateWindowExA(
        WS_EX_TOPMOST | WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_TRANSPARENT,
        "MarqueeITAnnot", "MarqueeIT Annot",
        WS_POPUP,
        0, 0, 200, 120,
        NULL, NULL, GetModuleHandle(NULL), NULL);

    if (!g_annotHwnd) return 0;

    // Use color key for transparency: black (0,0,0) becomes transparent
    SetLayeredWindowAttributes(g_annotHwnd, RGB(0, 0, 0), 0, LWA_COLORKEY);
    return 1;
}

// Show the annotation at the given screen coordinates (0..1 range) with a label
static void showAnnotationAt(double relX, double relY, const char* label) {
    if (!g_annotHwnd) return;
    int screenW = GetSystemMetrics(SM_CXSCREEN);
    int screenH = GetSystemMetrics(SM_CYSCREEN);
    // Window is 200x120, center the ring on the click point
    int winW = 200;
    int winH = 120;
    int x = (int)(relX * screenW) - winW / 2;
    int y = (int)(relY * screenH) - winH / 2;
    if (x < 0) x = 0;
    if (y < 0) y = 0;
    // Set the label
    if (label && strlen(label) > 0) {
        strncpy(g_annotLabel, label, 127);
        g_annotLabel[127] = 0;
    } else {
        g_annotLabel[0] = 0;
    }
    SetWindowPos(g_annotHwnd, HWND_TOPMOST, x, y, winW, winH, SWP_SHOWWINDOW | SWP_NOACTIVATE);
    g_annotVisible = 1;
    InvalidateRect(g_annotHwnd, NULL, FALSE);

    // Set a timer to hide after 4 seconds
    SetTimer(g_annotHwnd, 1, 4000, NULL);
}

// Hide the annotation
static void hideAnnotation() {
    if (g_annotHwnd && g_annotVisible) {
        ShowWindow(g_annotHwnd, SW_HIDE);
        g_annotVisible = 0;
        g_annotLabel[0] = 0;
    }
}

// Annotation message loop (runs on a dedicated thread)
static void annotMessageLoop() {
    MSG msg;
    while (GetMessage(&msg, NULL, 0, 0)) {
        if (msg.message == WM_TIMER && msg.hwnd == g_annotHwnd) {
            KillTimer(g_annotHwnd, 1);
            hideAnnotation();
        }
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }
}
*/
import "C"

import (
        "runtime"
        "sync"
        "time"
        "unsafe"
)

var (
        annotOnce  sync.Once
        annotReady = make(chan struct{})
)

// showAnnotation displays a highlight ring at the given relative coordinates
// on the customer's screen. Called when the technician clicks in highlight mode.
func showAnnotation(relX, relY float64, label string) {
        if runtime.GOOS != "windows" {
                return
        }
        annotOnce.Do(func() {
                go func() {
                        runtime.LockOSThread()
                        C.createAnnotWindow()
                        close(annotReady)
                        C.annotMessageLoop()
                }()
        })
        // Wait for the window to be created (up to 2 seconds)
        select {
        case <-annotReady:
        case <-time.After(2 * time.Second):
                return
        }
        cLabel := C.CString(label)
        C.showAnnotationAt(C.double(relX), C.double(relY), cLabel)
        C.free(unsafe.Pointer(cLabel))
}

// hideAnnotationOverlay hides any visible annotation.
func hideAnnotationOverlay() {
        if runtime.GOOS != "windows" {
                return
        }
        C.hideAnnotation()
}
