//go:build !windows

package main

import "fmt"

func launchHelperInUserSession(exePath, args string) (uint32, error) {
        return 0, fmt.Errorf("launchHelperInUserSession: Windows-only feature")
}

func isRunningAsSystem() bool {
        return false
}
