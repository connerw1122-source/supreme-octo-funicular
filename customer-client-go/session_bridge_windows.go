//go:build windows

package main

/*
#cgo LDFLAGS: -lwtsapi32 -luserenv -lkernel32 -ladvapi32
#include <windows.h>
#include <wtsapi32.h>
#include <userenv.h>
#include <stdlib.h>

// launchInUserSession launches a process in the active user's interactive
// session (Session 1+) from a SYSTEM service (Session 0). This is the key
// to interacting with UAC prompts and the user's desktop.
//
// Returns the process ID on success, 0 on failure. errorMessage is filled
// with a descriptive error if the function fails.
static DWORD launchInUserSession(const wchar_t* exePath, const wchar_t* cmdLine, char* errorMessage, int errorLen) {
    DWORD sessionId = 0;
    DWORD sessionCount = 0;
    PWTS_SESSION_INFO sessions = NULL;

    // Enumerate sessions and find the first active one (Session 1+)
    if (!WTSEnumerateSessions(WTS_CURRENT_SERVER_HANDLE, 0, 1, &sessions, &sessionCount)) {
        snprintf(errorMessage, errorLen, "WTSEnumerateSessions failed: %lu", GetLastError());
        return 0;
    }

    for (DWORD i = 0; i < sessionCount; i++) {
        if (sessions[i].State == WTSActive && sessions[i].SessionId > 0) {
            sessionId = sessions[i].SessionId;
            break;
        }
    }
    WTSFreeMemory(sessions);

    if (sessionId == 0) {
        snprintf(errorMessage, errorLen, "No active user session found");
        return 0;
    }

    // Get the user token for the active session
    HANDLE hUserToken = NULL;
    if (!WTSQueryUserToken(sessionId, &hUserToken)) {
        snprintf(errorMessage, errorLen, "WTSQueryUserToken failed: %lu (are we running as SYSTEM?)", GetLastError());
        return 0;
    }

    // Duplicate the token (so we can use it with CreateProcessAsUser)
    HANDLE hDupToken = NULL;
    if (!DuplicateTokenEx(hUserToken, MAXIMUM_ALLOWED, NULL, SecurityIdentification, TokenPrimary, &hDupToken)) {
        snprintf(errorMessage, errorLen, "DuplicateTokenEx failed: %lu", GetLastError());
        CloseHandle(hUserToken);
        return 0;
    }

    // Get the user's environment block and profile directory
    LPVOID envBlock = NULL;
    if (!CreateEnvironmentBlock(&envBlock, hDupToken, FALSE)) {
        // Non-fatal — continue without environment
        envBlock = NULL;
    }

    // Start the process in the user's session
    STARTUPINFOW si;
    PROCESS_INFORMATION pi;
    ZeroMemory(&si, sizeof(si));
    si.cb = sizeof(si);
    si.lpDesktop = L"winsta0\\default"; // The user's interactive desktop
    ZeroMemory(&pi, sizeof(pi));

    BOOL success = CreateProcessAsUserW(
        hDupToken,
        exePath,        // Application name
        (LPWSTR)cmdLine, // Command line (mutable)
        NULL,           // Process attributes
        NULL,           // Thread attributes
        FALSE,          // Don't inherit handles
        CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW,
        envBlock,       // Environment block
        NULL,           // Current directory (inherit)
        &si,
        &pi);

    DWORD result = 0;
    if (success) {
        result = pi.dwProcessId;
        CloseHandle(pi.hProcess);
        CloseHandle(pi.hThread);
    } else {
        snprintf(errorMessage, errorLen, "CreateProcessAsUserW failed: %lu", GetLastError());
    }

    if (envBlock) DestroyEnvironmentBlock(envBlock);
    CloseHandle(hDupToken);
    CloseHandle(hUserToken);
    return result;
}
*/
import "C"

import (
        "fmt"
        "syscall"
        "unsafe"
)

// launchHelperInUserSession launches the given executable in the active user's
// interactive session. This is used by the SYSTEM service to start the
// unattended client in the user's desktop session (where it can see the screen
// and inject input).
//
// Only works when running as SYSTEM (Session 0). Returns the PID of the
// launched process, or an error.
func launchHelperInUserSession(exePath, args string) (uint32, error) {
        wExe, _ := syscall.UTF16PtrFromString(exePath)
        cmdLine := fmt.Sprintf(`"%s" %s`, exePath, args)
        wCmd, _ := syscall.UTF16PtrFromString(cmdLine)

        var errBuf [512]C.char
        pid := C.launchInUserSession(
                (*C.wchar_t)(unsafe.Pointer(wExe)),
                (*C.wchar_t)(unsafe.Pointer(wCmd)),
                (*C.char)(unsafe.Pointer(&errBuf[0])),
                C.int(len(errBuf)),
        )
        if pid == 0 {
                errStr := C.GoString((*C.char)(unsafe.Pointer(&errBuf[0])))
                return 0, fmt.Errorf("launchInUserSession: %s", errStr)
        }
        return uint32(pid), nil
}

// isRunningAsSystem returns true if the current process is running as
// LocalSystem (NT AUTHORITY\SYSTEM). This determines whether we can use
// launchHelperInUserSession.
func isRunningAsSystem() bool {
        // WTSQueryUserToken only works as SYSTEM. If it succeeds, we're SYSTEM.
        // Simplest check: try to get the active session ID and query the token.
        var sessionId uint32
        // WTSGetActiveConsoleSessionId returns the active session (1+ if a user
        // is logged in, 0 if no one is logged in).
        sessionId = uint32(C.WTSGetActiveConsoleSessionId())
        if sessionId == 0 {
                return false
        }
        // Try to query the token — only works as SYSTEM
        var hToken C.HANDLE
        if C.WTSQueryUserToken(C.DWORD(sessionId), &hToken) != 0 {
                C.CloseHandle(hToken)
                return true
        }
        return false
}
