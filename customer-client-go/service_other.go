//go:build !windows

package main

// Stubs for non-Windows — the Windows service wrapper is not needed on
// Mac/Linux (those platforms use launchd/systemd which don't have the
// SCM's 30-second startup timeout).
func isWindowsService() bool {
        return false
}

func runAsWindowsService(serverURL, machineCode string) error {
        return nil
}
