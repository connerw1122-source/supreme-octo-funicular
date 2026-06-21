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
        // Transparent background — just draw the ring + label
        // Draw the outer ring (amber)
        HPEN hPen = CreatePen(PS_SOLID, 4, RGB(251, 191, 36));
        HBRUSH hBrush = CreateSolidBrush(RGB(251, 191, 36));
        // Need a transparent background brush for the fill
        HBRUSH hTrans = (HBRUSH)GetStockObject(HOLLOW_BRUSH);
        SelectObject(hdc, hPen);
        SelectObject(hdc, hTrans);
        Ellipse(hdc, 4, 4, 52, 52);
        // Inner fill (semi-transparent amber)
        DeleteObject(hBrush);
        hBrush = CreateSolidBrush(RGB(251, 191, 36));
        // Can't do alpha without layered window + UpdateLayeredWindow, so just
        // use a lighter solid color
        DeleteObject(hBrush);
        DeleteObject(hPen);
        EndPaint(hwnd, &ps);
        return 0;
    }
    case WM_ERASEBKGND:
        // Don't erase — prevents flickering
        return 1;
    }
    return DefWindowProcA(hwnd, msg, wParam, lParam);
}

// Create the annotation overlay window (a small 56x56 layered window)
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
        WS_POPUP, // not WS_VISIBLE — hidden until showAnnotation is called
        0, 0, 56, 56,
        NULL, NULL, GetModuleHandle(NULL), NULL);

    if (!g_annotHwnd) return 0;

    // Use color key for transparency (amber background becomes transparent)
    SetLayeredWindowAttributes(g_annotHwnd, RGB(0, 0, 0), 0, LWA_COLORKEY);
    return 1;
}

// Show the annotation at the given screen coordinates (0..1 range)
static void showAnnotationAt(double relX, double relY) {
    if (!g_annotHwnd) return;
    int screenW = GetSystemMetrics(SM_CXSCREEN);
    int screenH = GetSystemMetrics(SM_CYSCREEN);
    int x = (int)(relX * screenW) - 28; // center on the point
    int y = (int)(relY * screenH) - 28;
    if (x < 0) x = 0;
    if (y < 0) y = 0;
    SetWindowPos(g_annotHwnd, HWND_TOPMOST, x, y, 56, 56, SWP_SHOWWINDOW | SWP_NOACTIVATE);
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
)

var annotOnce sync.Once

// showAnnotation displays a highlight ring at the given relative coordinates
// on the customer's screen. Called when the technician clicks in highlight mode.
func showAnnotation(relX, relY float64) {
        if runtime.GOOS != "windows" {
                return
        }
        annotOnce.Do(func() {
                C.createAnnotWindow()
                go func() {
                        runtime.LockOSThread()
                        C.annotMessageLoop()
                }()
        })
        C.showAnnotationAt(C.double(relX), C.double(relY))
}

// hideAnnotationOverlay hides any visible annotation.
func hideAnnotationOverlay() {
        if runtime.GOOS != "windows" {
                return
        }
        C.hideAnnotation()
}
