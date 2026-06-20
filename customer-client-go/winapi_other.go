//go:build !windows

package main

// Stubs for non-Windows — these functions are never called on Mac/Linux
// but need to exist for compilation.

func winSetClipboard(text string)      {}
func winGetClipboard() string          { return "" }
func winBlockInput(block bool) bool    { return false }
func winSendCAD()                      {}
func winLockWorkStation()              {}
func winExecHidden(command string) (string, error) {
        return execRemoteCommand(command)
}
func winExecPowerShellHidden(command string) (string, error) {
        return "", nil
}
