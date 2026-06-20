//go:build !windows

package main

import (
        "image"

        "github.com/kbinani/screenshot"
)

func captureScreenWindows() (*image.RGBA, error) {
        return screenshot.CaptureDisplay(currentMonitor)
}
