//go:build windows

package main

/*
#cgo LDFLAGS: -lwtsapi32 -luserenv -lkernel32 -ladvapi32 -lpsapi
#include <windows.h>
#include <wtsapi32.h>
#include <userenv.h>
#include <psapi.h>
#include <stdlib.h>

// launchInUserSession launches a process in the active user's interactive
// session (Session 1+) from a SYSTEM service (Session 0).
static DWORD launchInUserSession(const wchar_t* exePath, const wchar_t* cmdLine, char* errorMessage, int errorLen) {
    DWORD sessionId = 0;
    DWORD sessionCount = 0;
    PWTS_SESSION_INFO sessions = NULL;

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

    HANDLE hUserToken = NULL;
    if (!WTSQueryUserToken(sessionId, &hUserToken)) {
        snprintf(errorMessage, errorLen, "WTSQueryUserToken failed: %lu (are we running as SYSTEM?)", GetLastError());
        return 0;
    }

    HANDLE hDupToken = NULL;
    if (!DuplicateTokenEx(hUserToken, MAXIMUM_ALLOWED, NULL, SecurityIdentification, TokenPrimary, &hDupToken)) {
        snprintf(errorMessage, errorLen, "DuplicateTokenEx failed: %lu", GetLastError());
        CloseHandle(hUserToken);
        return 0;
    }

    LPVOID envBlock = NULL;
    if (!CreateEnvironmentBlock(&envBlock, hDupToken, FALSE)) {
        envBlock = NULL;
    }

    STARTUPINFOW si;
    PROCESS_INFORMATION pi;
    ZeroMemory(&si, sizeof(si));
    si.cb = sizeof(si);
    si.lpDesktop = L"winsta0\\default";
    ZeroMemory(&pi, sizeof(pi));

    BOOL success = CreateProcessAsUserW(
        hDupToken,
        exePath,
        (LPWSTR)cmdLine,
        NULL, NULL, FALSE,
        CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW,
        envBlock, NULL,
        &si, &pi);

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

// launchOnWinlogonDesktop launches a process on the WinSta0\Winlogon desktop
// (the SECURE DESKTOP where UAC prompts appear). This is the key technique for
// UAC interaction: the helper runs as SYSTEM on the Winlogon desktop, where it
// can capture the UAC prompt screen and inject input (SendInput works because
// SYSTEM > any integrity level).
//
// The process is launched using the token from winlogon.exe in the target
// session, which gives us SYSTEM identity + the correct session ID.
static DWORD launchOnWinlogonDesktop(const wchar_t* exePath, const wchar_t* cmdLine, char* errorMessage, int errorLen) {
    DWORD targetSessionId = WTSGetActiveConsoleSessionId();
    if (targetSessionId == 0) {
        snprintf(errorMessage, errorLen, "No active console session");
        return 0;
    }

    // Find winlogon.exe in the target session — it runs as SYSTEM and its
    // token has the right session ID. This is the technique UltraVNC uses.
    DWORD procIds[1024], bytesReturned;
    if (!EnumProcesses(procIds, sizeof(procIds), &bytesReturned)) {
        snprintf(errorMessage, errorLen, "EnumProcesses failed: %lu", GetLastError());
        return 0;
    }
    DWORD count = bytesReturned / sizeof(DWORD);
    HANDLE hToken = NULL;

    for (DWORD i = 0; i < count; i++) {
        HANDLE hProc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, procIds[i]);
        if (!hProc) continue;

        WCHAR path[MAX_PATH];
        DWORD sz = MAX_PATH;
        if (QueryFullProcessImageNameW(hProc, 0, path, &sz)) {
            // Get filename only
            WCHAR* fname = wcsrchr(path, L'\\');
            if (fname) fname++;
            else fname = path;

            if (_wcsicmp(fname, L"winlogon.exe") == 0) {
                // Check session ID
                DWORD sid = 0;
                if (ProcessIdToSessionId(procIds[i], &sid) && sid == targetSessionId) {
                    if (OpenProcessToken(hProc, TOKEN_QUERY | TOKEN_DUPLICATE | TOKEN_ASSIGN_PRIMARY, &hToken)) {
                        CloseHandle(hProc);
                        break;
                    }
                }
            }
        }
        CloseHandle(hProc);
    }

    if (!hToken) {
        snprintf(errorMessage, errorLen, "Could not find/open winlogon.exe token in session %lu", targetSessionId);
        return 0;
    }

    // Duplicate the token
    HANDLE hDupToken = NULL;
    if (!DuplicateTokenEx(hToken, MAXIMUM_ALLOWED, NULL, SecurityImpersonation, TokenPrimary, &hDupToken)) {
        snprintf(errorMessage, errorLen, "DuplicateTokenEx failed: %lu", GetLastError());
        CloseHandle(hToken);
        return 0;
    }

    // Create environment block
    LPVOID envBlock = NULL;
    if (!CreateEnvironmentBlock(&envBlock, hDupToken, FALSE)) {
        envBlock = NULL;
    }

    // Launch on the Winlogon desktop
    STARTUPINFOW si;
    PROCESS_INFORMATION pi;
    ZeroMemory(&si, sizeof(si));
    si.cb = sizeof(si);
    si.lpDesktop = L"WinSta0\\Winlogon";  // THE SECURE DESKTOP
    ZeroMemory(&pi, sizeof(pi));

    BOOL success = CreateProcessAsUserW(
        hDupToken,
        exePath,
        (LPWSTR)cmdLine,
        NULL, NULL, FALSE,
        CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW,
        envBlock, NULL,
        &si, &pi);

    DWORD result = 0;
    if (success) {
        result = pi.dwProcessId;
        CloseHandle(pi.hProcess);
        CloseHandle(pi.hThread);
    } else {
        snprintf(errorMessage, errorLen, "CreateProcessAsUserW(Winlogon) failed: %lu", GetLastError());
    }

    if (envBlock) DestroyEnvironmentBlock(envBlock);
    CloseHandle(hDupToken);
    CloseHandle(hToken);
    return result;
}

// getActiveDesktopName returns the name of the currently active input desktop.
// Returns "Winlogon" when UAC prompt or lock screen is showing, "Default" normally.
// Used by the service to detect when to spawn the Winlogon helper.
static int getActiveDesktopName(char* buf, int bufLen) {
    HDESK hDesk = OpenInputDesktop(0, FALSE, GENERIC_READ);
    if (!hDesk) {
        snprintf(buf, bufLen, "error:%lu", GetLastError());
        return 0;
    }
    DWORD len = 0;
    GetUserObjectInformationA(hDesk, UOI_NAME, buf, bufLen, &len);
    CloseDesktop(hDesk);
    return 1;
}
*/
import "C"

import (
        "fmt"
        "syscall"
        "unsafe"
)

// launchHelperInUserSession launches the given executable in the active user's
// interactive session on the Default desktop.
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

// launchHelperOnWinlogonDesktop launches the given executable on the
// WinSta0\Winlogon desktop (the secure desktop where UAC prompts appear).
// The process runs as SYSTEM, so it can capture and interact with UAC prompts.
//
// This is the technique used by UltraVNC, TeamViewer, and AnyDesk for UAC
// interaction. Only works when called from a SYSTEM service (Session 0).
func launchHelperOnWinlogonDesktop(exePath, args string) (uint32, error) {
        wExe, _ := syscall.UTF16PtrFromString(exePath)
        cmdLine := fmt.Sprintf(`"%s" %s`, exePath, args)
        wCmd, _ := syscall.UTF16PtrFromString(cmdLine)

        var errBuf [512]C.char
        pid := C.launchOnWinlogonDesktop(
                (*C.wchar_t)(unsafe.Pointer(wExe)),
                (*C.wchar_t)(unsafe.Pointer(wCmd)),
                (*C.char)(unsafe.Pointer(&errBuf[0])),
                C.int(len(errBuf)),
        )
        if pid == 0 {
                errStr := C.GoString((*C.char)(unsafe.Pointer(&errBuf[0])))
                return 0, fmt.Errorf("launchOnWinlogonDesktop: %s", errStr)
        }
        return uint32(pid), nil
}

// getActiveDesktopNameString returns the name of the currently active desktop.
func getActiveDesktopNameString() string {
        var buf [256]C.char
        ret := C.getActiveDesktopName((*C.char)(unsafe.Pointer(&buf[0])), C.int(len(buf)))
        if ret == 0 {
                return "unknown"
        }
        return C.GoString((*C.char)(unsafe.Pointer(&buf[0])))
}

// isRunningAsSystem returns true if the current process is running as
// LocalSystem (NT AUTHORITY\SYSTEM).
func isRunningAsSystem() bool {
        var sessionId uint32
        sessionId = uint32(C.WTSGetActiveConsoleSessionId())
        if sessionId == 0 {
                return false
        }
        var hToken C.HANDLE
        if C.WTSQueryUserToken(C.DWORD(sessionId), &hToken) != 0 {
                C.CloseHandle(hToken)
                return true
        }
        return false
}
