//go:build windows

package main

/*
#cgo LDFLAGS: -luser32 -lgdi32 -lkernel32
#include <windows.h>
#include <string.h>

// Chat window state
static HWND g_chatHwnd = NULL;
static HWND g_chatInput = NULL;
static HWND g_chatSendBtn = NULL;
static int g_chatW = 360;
static int g_chatH = 280;
static char g_chatLines[15][512];
static int g_chatLineCount = 0;
static char g_replyFilePath[MAX_PATH] = {0};

// Set the reply file path (called from Go with the actual temp dir)
static void setReplyFilePath(const char* path) {
    strncpy(g_replyFilePath, path, MAX_PATH - 1);
    g_replyFilePath[MAX_PATH - 1] = 0;
}

// Add a chat line and repaint
static void addChatLine(const char* sender, const char* text) {
    if (g_chatLineCount >= 15) {
        memmove(g_chatLines[0], g_chatLines[1], 14 * 512);
        g_chatLineCount = 14;
    }
    snprintf(g_chatLines[g_chatLineCount], 512, "%s: %s", sender, text);
    g_chatLineCount++;
    if (g_chatHwnd) InvalidateRect(g_chatHwnd, NULL, TRUE);
}

// Get the text from the input field (returns length, fills buf)
static int getInputText(char* buf, int bufLen) {
    if (!g_chatInput) { buf[0] = 0; return 0; }
    int len = GetWindowTextA(g_chatInput, buf, bufLen);
    return len;
}

// Clear the input field
static void clearInput() {
    if (g_chatInput) SetWindowTextA(g_chatInput, "");
}

// Window procedure for the chat overlay
static LRESULT CALLBACK ChatWndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    switch (msg) {
    case WM_COMMAND: {
        // Button click or Enter in input
        WORD cmd = LOWORD(wParam);
        if (cmd == 2 || cmd == 3) { // Send button or Enter
            // Get input text and send it
            char buf[1024];
            int len = getInputText(buf, sizeof(buf));
            if (len > 0) {
                // Write to the reply file that the Go code reads and sends
                if (strlen(g_replyFilePath) > 0) {
                    HANDLE hFile = CreateFileA(g_replyFilePath,
                        GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
                    if (hFile != INVALID_HANDLE_VALUE) {
                        DWORD written;
                        WriteFile(hFile, buf, len, &written, NULL);
                        CloseHandle(hFile);
                    }
                }
                clearInput();
            }
        }
        return 0;
    }
    case WM_PAINT: {
        PAINTSTRUCT ps;
        HDC hdc = BeginPaint(hwnd, &ps);

        RECT rc;
        GetClientRect(hwnd, &rc);
        HBRUSH bg = CreateSolidBrush(RGB(26, 26, 46));
        FillRect(hdc, &rc, bg);
        DeleteObject(bg);

        // Header bar
        RECT header = {0, 0, rc.right, 32};
        HBRUSH hdrBrush = CreateSolidBrush(RGB(27, 58, 107));
        FillRect(hdc, &header, hdrBrush);
        DeleteObject(hdrBrush);

        // Header text
        SetTextColor(hdc, RGB(255, 196, 37));
        SetBkMode(hdc, TRANSPARENT);
        HFONT hFont = CreateFont(16, 0, 0, 0, FW_BOLD, 0, 0, 0, 0, 0, 0, 0, 0, "Segoe UI");
        HFONT hOld = SelectObject(hdc, hFont);
        TextOutA(hdc, 12, 7, "MarqueeIT Chat", 14);

        // Messages (bigger text: 14pt)
        SetTextColor(hdc, RGB(238, 238, 238));
        HFONT hSmall = CreateFont(14, 0, 0, 0, FW_NORMAL, 0, 0, 0, 0, 0, 0, 0, 0, "Segoe UI");
        SelectObject(hdc, hSmall);
        int yPos = 40;
        int maxLines = 15;
        int startLine = g_chatLineCount > maxLines ? g_chatLineCount - maxLines : 0;
        for (int i = startLine; i < g_chatLineCount && yPos < g_chatH - 60; i++) {
            TextOutA(hdc, 10, yPos, g_chatLines[i], strlen(g_chatLines[i]));
            yPos += 20;
        }

        SelectObject(hdc, hOld);
        DeleteObject(hFont);
        DeleteObject(hSmall);

        EndPaint(hwnd, &ps);
        return 0;
    }
    case WM_CLOSE:
        ShowWindow(hwnd, SW_HIDE);
        return 0;
    case WM_LBUTTONDOWN: {
        ReleaseCapture();
        SendMessage(hwnd, WM_NCLBUTTONDOWN, HTCAPTION, 0);
        return 0;
    }
    case WM_RBUTTONDOWN: {
        ShowWindow(hwnd, SW_HIDE);
        return 0;
    }
    }
    return DefWindowProcA(hwnd, msg, wParam, lParam);
}

// Subclass procedure for the input field — intercept Enter key
static LRESULT CALLBACK InputProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
    if (msg == WM_KEYDOWN && wParam == VK_RETURN) {
        // Send WM_COMMAND to the parent
        SendMessage(GetParent(hwnd), WM_COMMAND, 3, 0);
        return 0;
    }
    return CallWindowProcA((WNDPROC)GetWindowLongPtrA(hwnd, GWLP_USERDATA), hwnd, msg, wParam, lParam);
}

static WNDPROC g_inputOldProc = NULL;

// Create the chat overlay window
static int createChatWindow() {
    if (g_chatHwnd) return 1;

    WNDCLASSEXA wc = {0};
    wc.cbSize = sizeof(wc);
    wc.lpfnWndProc = ChatWndProc;
    wc.hInstance = GetModuleHandle(NULL);
    wc.lpszClassName = "MarqueeITChat";
    wc.hCursor = LoadCursor(NULL, IDC_ARROW);
    RegisterClassExA(&wc);

    int screenW = GetSystemMetrics(SM_CXSCREEN);
    int screenH = GetSystemMetrics(SM_CYSCREEN);

    g_chatHwnd = CreateWindowExA(
        WS_EX_TOPMOST | WS_EX_LAYERED | WS_EX_TOOLWINDOW,
        "MarqueeITChat", "MarqueeIT Chat",
        WS_POPUP,
        screenW - g_chatW - 20, screenH - g_chatH - 60,
        g_chatW, g_chatH,
        NULL, NULL, GetModuleHandle(NULL), NULL);

    if (!g_chatHwnd) return 0;

    SetLayeredWindowAttributes(g_chatHwnd, 0, 240, LWA_ALPHA);

    // Create the input field (single-line edit)
    g_chatInput = CreateWindowExA(0, "EDIT", "",
        WS_CHILD | WS_VISIBLE | ES_AUTOHSCROLL | WS_BORDER,
        10, g_chatH - 45, g_chatW - 100, 28,
        g_chatHwnd, (HMENU)1, GetModuleHandle(NULL), NULL);

    // Create the Send button
    g_chatSendBtn = CreateWindowExA(0, "BUTTON", "Send",
        WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON,
        g_chatW - 80, g_chatH - 45, 70, 28,
        g_chatHwnd, (HMENU)2, GetModuleHandle(NULL), NULL);

    // Set fonts on the child controls
    HFONT hCtrlFont = CreateFont(14, 0, 0, 0, FW_NORMAL, 0, 0, 0, 0, 0, 0, 0, 0, "Segoe UI");
    SendMessageA(g_chatInput, WM_SETFONT, (WPARAM)hCtrlFont, 0);
    SendMessageA(g_chatSendBtn, WM_SETFONT, (WPARAM)hCtrlFont, 0);

    // Subclass the input field to intercept Enter
    g_inputOldProc = (WNDPROC)SetWindowLongPtrA(g_chatInput, GWLP_WNDPROC, (LONG_PTR)InputProc);
    SetWindowLongPtrA(g_chatInput, GWLP_USERDATA, (LONG_PTR)g_inputOldProc);

    return 1;
}

static void showChatWindow() {
    if (g_chatHwnd) {
        ShowWindow(g_chatHwnd, SW_SHOWNOACTIVATE);
        InvalidateRect(g_chatHwnd, NULL, TRUE);
    }
}

static void chatMessageLoop() {
    MSG msg;
    while (GetMessage(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }
}
*/
import "C"

import (
        "encoding/json"
        "fmt"
        "os"
        "path/filepath"
        "runtime"
        "sync"
        "time"
        "unsafe"
)

var (
        chatMu          sync.Mutex
        chatInitialized bool
        chatReady       = make(chan struct{})
)

// showChatOverlay creates the always-on-top chat window and adds a message.
func showChatOverlay(sender, content string) {
        if runtime.GOOS != "windows" {
                showToast(sender, content)
                return
        }

        chatMu.Lock()
        if !chatInitialized {
                chatInitialized = true
                chatMu.Unlock()
                // Set the reply file path before creating the window
                replyPath := filepath.Join(os.TempDir(), "marqueeit-chat-reply.txt")
                cReplyPath := C.CString(replyPath)
                C.setReplyFilePath(cReplyPath)
                C.free(unsafe.Pointer(cReplyPath))
                go func() {
                        runtime.LockOSThread()
                        C.createChatWindow()
                        close(chatReady)
                        C.chatMessageLoop()
                }()
                // Start a goroutine to poll for chat replies
                go chatReplyPoller()
        } else {
                chatMu.Unlock()
        }

        select {
        case <-chatReady:
        case <-time.After(2 * time.Second):
                return
        }

        cSender := C.CString(sender)
        cContent := C.CString(content)
        C.addChatLine(cSender, cContent)
        C.showChatWindow()
        C.free(unsafe.Pointer(cSender))
        C.free(unsafe.Pointer(cContent))
}

// chatReplyPoller checks for chat reply files and sends them to the technician.
// The C code writes replies to a temp file when the customer types and presses
// Enter or clicks Send.
func chatReplyPoller() {
        replyPath := filepath.Join(os.TempDir(), "marqueeit-chat-reply.txt")
        for {
                time.Sleep(500 * time.Millisecond)
                if globalClient == nil || globalClient.conn == nil {
                        continue
                }
                // Check if the reply file exists
                data, err := os.ReadFile(replyPath)
                if err != nil {
                        continue
                }
                // Delete the file so we don't send it twice
                os.Remove(replyPath)
                reply := string(data)
                if reply == "" {
                        continue
                }
                // Send the reply to the technician via the signaling server
                msg, _ := json.Marshal(map[string]interface{}{
                        "type":    "chat",
                        "sender":  hostname(),
                        "content": reply,
                })
                globalClient.connMu.Lock()
                if globalClient.conn != nil {
                        globalClient.conn.WriteMessage(1, msg)
                        fmt.Printf("[chat] Sent reply: %s\n", reply)
                }
                globalClient.connMu.Unlock()
        }
}
