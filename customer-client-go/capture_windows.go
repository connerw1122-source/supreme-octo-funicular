//go:build windows

package main

/*
#cgo LDFLAGS: -luser32 -lgdi32
#include <windows.h>

// captureActiveDesktop captures whatever desktop is currently active
// (including the lock screen / Winlogon desktop).
// Returns 1 on success, 0 on failure. Writes pixels to the provided buffer.
// Also writes the desktop name to deskNameBuf so the caller can tell whether
// we captured the Default desktop or the Winlogon (lock screen) desktop.
static int captureActiveDesktop(char* outBuf, int* width, int* height, char* deskNameBuf, int deskNameLen) {
    // Open the active input desktop with broader access rights.
    // GENERIC_READ alone isn't always enough on the Winlogon desktop —
    // we also need DESKTOP_READOBJECTS to read pixels via BitBlt.
    HDESK hDesk = OpenInputDesktop(0, FALSE,
        GENERIC_READ | DESKTOP_READOBJECTS);
    if (!hDesk) return 0;

    // Get the desktop name for diagnostics
    if (deskNameBuf && deskNameLen > 0) {
        DWORD len = 0;
        GetUserObjectInformationA(hDesk, UOI_NAME, deskNameBuf, deskNameLen, &len);
        deskNameBuf[deskNameLen - 1] = 0;
    }

    // Set this thread to the active desktop
    HDESK hOldDesk = GetThreadDesktop(GetCurrentThreadId());
    if (!SetThreadDesktop(hDesk)) {
        CloseDesktop(hDesk);
        return 0;
    }

    // Get the screen DC
    HDC hdcScreen = GetDC(NULL);
    if (!hdcScreen) {
        SetThreadDesktop(hOldDesk);
        CloseDesktop(hDesk);
        return 0;
    }

    int w = GetSystemMetrics(SM_CXSCREEN);
    int h = GetSystemMetrics(SM_CYSCREEN);

    HDC hdcMem = CreateCompatibleDC(hdcScreen);
    HBITMAP hBitmap = CreateCompatibleBitmap(hdcScreen, w, h);
    HBITMAP hOld = SelectObject(hdcMem, hBitmap);

    // BitBlt with SRCCOPY | CAPTUREBLT to include layered windows
    BitBlt(hdcMem, 0, 0, w, h, hdcScreen, 0, 0, SRCCOPY | 0x40000000);

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
*/
import "C"

import (
        "image"
        "log"
        "strings"
        "sync"
        "time"
        "unsafe"

        "github.com/kbinani/screenshot"
)

// lastGoodFrame caches the most recent non-black frame. When the screen goes
// black (e.g., Winlogon desktop we can't access), we re-send the last good
// frame so the technician doesn't see a black screen.
var (
        lastGoodFrame   *image.RGBA
        lastGoodFrameMu sync.Mutex
        lastDesktopName = "Default"
        lockedNotified  = false // avoid spamming the log
        lastCacheTime   time.Time
)

// captureScreenWindows captures the active desktop (including lock screen)
// using OpenInputDesktop + BitBlt. If the capture returns all-black pixels
// (which happens on the Winlogon desktop when not running as SYSTEM), it
// falls back to the last good frame so the technician sees a frozen frame
// instead of black.
func captureScreenWindows() (*image.RGBA, error) {
        // Query the screen dimensions FIRST so we can size the buffer correctly.
        // This prevents buffer overflows on >4K displays (5K, 8K, multi-monitor
        // stitched desktops) that exceed the old hardcoded 3840*2160*4 max.
        screenW := int(C.GetSystemMetrics(C.SM_CXSCREEN))
        screenH := int(C.GetSystemMetrics(C.SM_CYSCREEN))
        if screenW <= 0 || screenH <= 0 {
                return captureScreenKbinani()
        }
        bufSize := screenW * screenH * 4
        if bufSize > 7680*4320*4 {
                // Sanity cap at 8K to prevent absurd allocations
                bufSize = 7680 * 4320 * 4
        }

        var w, h C.int
        var deskNameBuf [256]byte
        buf := make([]byte, bufSize)
        ret := C.captureActiveDesktop(
                (*C.char)(unsafe.Pointer(&buf[0])),
                &w, &h,
                (*C.char)(unsafe.Pointer(&deskNameBuf[0])),
                C.int(len(deskNameBuf)),
        )

        deskName := strings.TrimRight(string(deskNameBuf[:]), "\x00")
        if deskName != "" {
                lastDesktopName = deskName
        }

        if ret == 0 {
                // OpenInputDesktop or SetThreadDesktop failed — this happens on the
                // Winlogon desktop when the process doesn't have SYSTEM privileges.
                // Fall back to kbinani, then to the last good frame.
                return getFallbackFrame("capture failed (likely Winlogon desktop)")
        }

        width := int(w)
        height := int(h)
        // Safety: if the C function somehow wrote more than bufSize, truncate.
        // (Shouldn't happen with the pre-sized buffer, but defense in depth.)
        if width*height*4 > len(buf) {
                width = screenW
                height = screenH
        }
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

        // Detect all-black frames (happens on Winlogon desktop without SYSTEM).
        if isAllBlack(img) {
                // Try kbinani first — sometimes it captures the Default desktop
                // which has the lock screen background.
                fbImg, fbErr := captureScreenKbinani()
                if fbErr == nil && !isAllBlack(fbImg) {
                        cacheGoodFrame(fbImg)
                        return fbImg, nil
                }
                // kbinani also returned black — we're on a desktop we can't access.
                // Return the last good frame so the technician sees a frozen frame.
                return getFallbackFrame("all-black frame on " + deskName + " desktop")
        }

        // Good frame — cache it and reset the notification flag.
        cacheGoodFrame(img)
        if lockedNotified {
                log.Printf("[capture] Screen unlocked (back on %s desktop)", deskName)
                lockedNotified = false
        }
        return img, nil
}

// cacheGoodFrame stores a copy of the most recent good frame.
// Throttled to once per second to avoid 240+ MB/s of allocations at 30 FPS
// (each 1080p frame is ~8MB, 4K is ~33MB).
func cacheGoodFrame(img *image.RGBA) {
        now := time.Now()
        if now.Sub(lastCacheTime) < time.Second {
                return // already cached recently
        }
        lastCacheTime = now
        lastGoodFrameMu.Lock()
        defer lastGoodFrameMu.Unlock()
        dup := *img
        dup.Pix = make([]byte, len(img.Pix))
        copy(dup.Pix, img.Pix)
        lastGoodFrame = &dup
}

// getFallbackFrame returns the last good frame, or a kbinani capture, or nil.
// Logs a one-time warning when the screen is locked.
func getFallbackFrame(reason string) (*image.RGBA, error) {
        if !lockedNotified {
                log.Printf("[capture] Using fallback frame: %s (desktop=%s)", reason, lastDesktopName)
                lockedNotified = true
        }
        lastGoodFrameMu.Lock()
        if lastGoodFrame != nil {
                // Return a copy so the caller can't mutate our cache.
                dup := *lastGoodFrame
                dup.Pix = make([]byte, len(lastGoodFrame.Pix))
                copy(dup.Pix, lastGoodFrame.Pix)
                lastGoodFrameMu.Unlock()
                return dup, nil
        }
        lastGoodFrameMu.Unlock()
        // No cached frame — try kbinani as a last resort.
        return captureScreenKbinani()
}

// isAllBlack returns true if every pixel in the image is (0,0,0,255) or close.
// We sample a sparse grid for performance (checking every pixel on a 4K frame
// at 30 FPS would be wasteful).
func isAllBlack(img *image.RGBA) bool {
        const step = 64 // check every 64th pixel in each dimension
        b := img.Bounds()
        sampled := 0
        for y := b.Min.Y; y < b.Max.Y; y += step {
                for x := b.Min.X; x < b.Max.X; x += step {
                        idx := img.PixOffset(x, y)
                        r := img.Pix[idx]
                        g := img.Pix[idx+1]
                        bl := img.Pix[idx+2]
                        if r > 5 || g > 5 || bl > 5 {
                                return false
                        }
                        sampled++
                }
        }
        return sampled > 0
}

// captureScreenKbinani is the fallback using the kbinani library
func captureScreenKbinani() (*image.RGBA, error) {
        return screenshot.CaptureDisplay(currentMonitor)
}
