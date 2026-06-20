//go:build windows

package main

/*
#cgo LDFLAGS: -luser32 -lgdi32
#include <windows.h>

// captureActiveDesktop captures whatever desktop is currently active
// (including the lock screen / Winlogon desktop).
// Returns 1 on success, 0 on failure. Writes pixels to the provided buffer.
static int captureActiveDesktop(char* outBuf, int* width, int* height) {
    // Open the active input desktop (handles lock screen)
    HDESK hDesk = OpenInputDesktop(0, FALSE, GENERIC_READ);
    if (!hDesk) return 0;

    // Set this thread to the active desktop
    HDESK hOldDesk = GetThreadDesktop(GetCurrentThreadId());
    SetThreadDesktop(hDesk);

    // Get the screen DC
    HDC hdcScreen = GetDC(NULL);
    if (!hdcScreen) { CloseDesktop(hDesk); return 0; }

    int w = GetSystemMetrics(SM_CXSCREEN);
    int h = GetSystemMetrics(SM_CYSCREEN);

    HDC hdcMem = CreateCompatibleDC(hdcScreen);
    HBITMAP hBitmap = CreateCompatibleBitmap(hdcScreen, w, h);
    HBITMAP hOld = SelectObject(hdcMem, hBitmap);

    BitBlt(hdcMem, 0, 0, w, h, hdcScreen, 0, 0, SRCCOPY);

    // Get the bitmap data
    BITMAPINFOHEADER bih;
    ZeroMemory(&bih, sizeof(bih));
    bih.biSize = sizeof(BITMAPINFOHEADER);
    bih.biWidth = w;
    bih.biHeight = -h; // top-down
    bih.biPlanes = 1;
    bih.biBitCount = 32;
    bih.biCompression = BI_RGB;

    GetDIBits(hdcMem, hBitmap, 0, h, outBuf, (BITMAPINFO*)&bih, DIB_RGB_COLORS);

    *width = w;
    *height = h;

    SelectObject(hdcMem, hOld);
    DeleteObject(hBitmap);
    DeleteDC(hdcMem);
    ReleaseDC(NULL, hdcScreen);

    // Restore the original desktop
    SetThreadDesktop(hOldDesk);
    CloseDesktop(hDesk);

    return 1;
}

// getActiveDesktopName returns the name of the currently active input desktop.
// Useful for debugging — returns "Winlogon" when locked, "Default" when unlocked.
static const char* getActiveDesktopName() {
    static char name[256];
    HDESK hDesk = OpenInputDesktop(0, FALSE, GENERIC_READ);
    if (!hDesk) return "error";
    DWORD len = 0;
    GetUserObjectInformationA(hDesk, UOI_NAME, name, sizeof(name), &len);
    CloseDesktop(hDesk);
    return name;
}
*/
import "C"

import (
	"image"
	"unsafe"

	"github.com/kbinani/screenshot"
)

// captureScreenWindows captures the active desktop (including lock screen)
// using OpenInputDesktop + BitBlt.
func captureScreenWindows() (*image.RGBA, error) {
	// First try the desktop-aware capture
	var w, h C.int
	// Allocate max buffer (4 bytes per pixel, max 4K resolution)
	maxSize := 3840 * 2160 * 4
	buf := make([]byte, maxSize)
	ret := C.captureActiveDesktop((*C.char)(unsafe.Pointer(&buf[0])), &w, &h)
	if ret == 0 {
		// Fallback to kbinani/screenshot
		return captureScreenKbinani()
	}

	width := int(w)
	height := int(h)
	img := image.NewRGBA(image.Rect(0, 0, width, height))
	// The buffer is BGRA, convert to RGBA
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			idx := (y*width + x) * 4
			img.Pix[idx+0] = buf[idx+2]   // R from B
			img.Pix[idx+1] = buf[idx+1]   // G
			img.Pix[idx+2] = buf[idx+0]   // B from R
			img.Pix[idx+3] = 255           // A
		}
	}
	return img, nil
}

// captureScreenKbinani is the fallback using the kbinani library
func captureScreenKbinani() (*image.RGBA, error) {
	return screenshot.CaptureDisplay(currentMonitor)
}
