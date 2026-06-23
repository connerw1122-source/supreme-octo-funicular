//go:build windows

package main

/*
#cgo LDFLAGS: -luser32 -lkernel32 -lpsapi
#include <windows.h>
#include <psapi.h>
#include <string.h>

// Get the foreground window's process name and title
static int getForegroundApp(wchar_t* processName, int nameLen, wchar_t* windowTitle, int titleLen) {
    HWND hwnd = GetForegroundWindow();
    if (!hwnd) return 0;

    // Get window title
    GetWindowTextW(hwnd, windowTitle, titleLen);

    // Get process ID
    DWORD pid;
    GetWindowThreadProcessId(hwnd, &pid);
    if (pid == 0) return 0;

    // Open process and get module name
    HANDLE hProc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ, FALSE, pid);
    if (!hProc) {
        // Try without VM_READ
        hProc = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
        if (!hProc) return 1; // Return 1 = got title but not process name
    }

    HMODULE hMod;
    DWORD cbNeeded;
    if (EnumProcessModules(hProc, &hMod, sizeof(hMod), &cbNeeded)) {
        GetModuleBaseNameW(hProc, hMod, processName, nameLen);
    }

    CloseHandle(hProc);
    return 1;
}

// Get the URL from Chrome/Edge address bar via UI Automation
// This is a simplified approach — gets the omnibox text from the window title
// (browsers put the page title + browser name in the title bar)
static int getBrowserUrl(wchar_t* url, int urlLen) {
    // Full URL extraction requires UI Automation API which is complex.
    // For now, we extract from the window title (contains page title).
    // A future improvement could use IAccessible or UI Automation to
    // read the address bar directly.
    return 0;
}

// Global counters for activity tracking
static volatile LONG g_mouseClicks = 0;
static volatile LONG g_keystrokes = 0;
static volatile LONG g_mouseMoves = 0;
static volatile LONG g_lastInputTime = 0;

// Mouse hook procedure
static LRESULT CALLBACK ActivityMouseProc(int nCode, WPARAM wParam, LPARAM lParam) {
    if (nCode >= 0) {
        switch (wParam) {
        case WM_LBUTTONDOWN:
        case WM_RBUTTONDOWN:
        case WM_MBUTTONDOWN:
            InterlockedIncrement(&g_mouseClicks);
            InterlockedExchange(&g_lastInputTime, GetTickCount());
            break;
        case WM_MOUSEMOVE:
            InterlockedIncrement(&g_mouseMoves);
            break;
        }
    }
    return CallNextHookEx(NULL, nCode, wParam, lParam);
}

// Keyboard hook procedure
static LRESULT CALLBACK ActivityKbdProc(int nCode, WPARAM wParam, LPARAM lParam) {
    if (nCode >= 0 && wParam == WM_KEYDOWN) {
        InterlockedIncrement(&g_keystrokes);
        InterlockedExchange(&g_lastInputTime, GetTickCount());
    }
    return CallNextHookEx(NULL, nCode, wParam, lParam);
}

// Install activity tracking hooks
static HHOOK g_actMouseHook = NULL;
static HHOOK g_actKbdHook = NULL;

static int installActivityHooks() {
    if (g_actMouseHook && g_actKbdHook) return 1;
    g_actMouseHook = SetWindowsHookExA(WH_MOUSE_LL, ActivityMouseProc, GetModuleHandle(NULL), 0);
    g_actKbdHook = SetWindowsHookExA(WH_KEYBOARD_LL, ActivityKbdProc, GetModuleHandle(NULL), 0);
    return (g_actMouseHook && g_actKbdHook) ? 1 : 0;
}

// Get and reset counters
static int getActivityCounts(int* clicks, int* keys, int* moves, int* idleSeconds) {
    *clicks = InterlockedExchange(&g_mouseClicks, 0);
    *keys = InterlockedExchange(&g_keystrokes, 0);
    *moves = InterlockedExchange(&g_mouseMoves, 0);
    DWORD now = GetTickCount();
    DWORD last = InterlockedCompareExchange(&g_lastInputTime, 0, 0);
    if (last == 0) {
        *idleSeconds = 0;
    } else {
        DWORD elapsed = (now - last) / 1000;
        *idleSeconds = (int)elapsed;
    }
    return 1;
}

// Message pump for activity hooks
static void activityHookLoop() {
    MSG msg;
    while (GetMessage(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }
}
*/
import "C"

import (
        "bytes"
        "encoding/json"
        "fmt"
        "net/http"
        "runtime"
        "strings"
        "sync"
        "time"
        "unsafe"
)

var (
        activityHookOnce sync.Once
        activityHooksReady = make(chan struct{})
)

// initActivityHooks installs low-level mouse and keyboard hooks for counting
// clicks, keystrokes, and mouse movements. The hooks run on a dedicated
// locked OS thread.
func initActivityHooks() {
        if runtime.GOOS != "windows" {
                return
        }
        activityHookOnce.Do(func() {
                go func() {
                        runtime.LockOSThread()
                        C.installActivityHooks()
                        close(activityHooksReady)
                        C.activityHookLoop()
                }()
        })
}

// ActivityData represents the activity data collected in one interval
type ActivityData struct {
        MouseClicks   int             `json:"mouseClicks"`
        Keystrokes    int             `json:"keystrokes"`
        MouseMoves    int             `json:"mouseMoves"`
        IsActive      bool            `json:"isActive"`
        ActiveAppName string          `json:"activeAppName"`
        ActiveAppTitle string         `json:"activeAppTitle"`
        AppUsages     []AppUsageData  `json:"appUsages"`
        WebsiteVisits []WebsiteData   `json:"websiteVisits"`
        Screenshot    string          `json:"screenshot,omitempty"`
        ScreenshotWidth int           `json:"screenshotWidth,omitempty"`
        ScreenshotHeight int          `json:"screenshotHeight,omitempty"`
}

type AppUsageData struct {
        AppName     string `json:"appName"`
        WindowTitle string `json:"windowTitle"`
        Duration    int    `json:"duration"` // seconds
}

type WebsiteData struct {
        URL      string `json:"url"`
        Title    string `json:"title"`
        Browser  string `json:"browser"`
        Duration int    `json:"duration"` // seconds
}

// collectActivityData gathers activity data for the last interval and resets counters
func collectActivityData() ActivityData {
        data := ActivityData{
                AppUsages:     []AppUsageData{},
                WebsiteVisits: []WebsiteData{},
        }

        if runtime.GOOS == "windows" {
                // Wait for hooks to be ready
                select {
                case <-activityHooksReady:
                case <-time.After(2 * time.Second):
                }

                var clicks, keys, moves, idleSecs C.int
                C.getActivityCounts(&clicks, &keys, &moves, &idleSecs)
                data.MouseClicks = int(clicks)
                data.Keystrokes = int(keys)
                data.MouseMoves = int(moves)
                data.IsActive = int(idleSecs) < 60 // active if input in last 60s

                // Get foreground app
                var procName [260]C.wchar_t
                var winTitle [512]C.wchar_t
                C.getForegroundApp(
                        (*C.wchar_t)(unsafe.Pointer(&procName[0])), C.int(len(procName)),
                        (*C.wchar_t)(unsafe.Pointer(&winTitle[0])), C.int(len(winTitle)),
                )
                // Convert wchar_t to Go string
                procNameSlice := (*[260]uint16)(unsafe.Pointer(&procName[0]))[:]
                titleSlice := (*[512]uint16)(unsafe.Pointer(&winTitle[0]))[:]
                data.ActiveAppName = wcharToString(procNameSlice)
                data.ActiveAppTitle = wcharToString(titleSlice)

                // Track app usage — add the current foreground app with interval duration
                if data.ActiveAppName != "" {
                        data.AppUsages = append(data.AppUsages, AppUsageData{
                                AppName:     data.ActiveAppName,
                                WindowTitle: data.ActiveAppTitle,
                                Duration:    30, // 30 second interval
                        })
                }

                // Track website from browser title
                if isBrowser(data.ActiveAppName) && data.ActiveAppTitle != "" {
                        // Extract URL-like patterns from title (simplified)
                        // Real implementation would use UI Automation to read address bar
                        data.WebsiteVisits = append(data.WebsiteVisits, WebsiteData{
                                URL:      fmt.Sprintf("https://%s", extractDomainFromTitle(data.ActiveAppTitle)),
                                Title:    data.ActiveAppTitle,
                                Browser:  data.ActiveAppName,
                                Duration: 30,
                        })
                }
        }

        return data
}

// wcharToString converts a uint16 slice (UTF-16) to a Go string
func wcharToString(s []uint16) string {
        for i, v := range s {
                if v == 0 {
                        return string(utf16Decode(s[:i]))
                }
        }
        return string(utf16Decode(s))
}

func utf16Decode(s []uint16) []rune {
        var runes []rune
        for i := 0; i < len(s); i++ {
                r := s[i]
                if r >= 0xD800 && r <= 0xDBFF && i+1 < len(s) {
                        r2 := s[i+1]
                        if r2 >= 0xDC00 && r2 <= 0xDFFF {
                                r = (r-0xD800)*0x400 + (r2 - 0xDC00) + 0x10000
                                i++
                        }
                }
                runes = append(runes, rune(r))
        }
        return runes
}

func isBrowser(appName string) bool {
        lower := strings.ToLower(appName)
        return strings.Contains(lower, "chrome") ||
                strings.Contains(lower, "msedge") ||
                strings.Contains(lower, "firefox") ||
                strings.Contains(lower, "opera") ||
                strings.Contains(lower, "brave")
}

func extractDomainFromTitle(title string) string {
        // Browser titles often look like "Page Title - Google Chrome"
        // or "Inbox (5) - user@gmail.com - Gmail - Mozilla Firefox"
        // We can't reliably extract the URL from the title alone.
        // A future improvement would use UI Automation to read the address bar.
        return "browser"
}

// MonitoringConfig holds the server-side configurable settings
type MonitoringConfig struct {
        ActivityInterval   int    `json:"activityInterval"`
        ScreenshotInterval int    `json:"screenshotInterval"`
        IdleThreshold      int    `json:"idleThreshold"`
        ScreenshotQuality  int    `json:"screenshotQuality"`
        ScreenshotWidth    int    `json:"screenshotWidth"`
        ScreenshotHeight   int    `json:"screenshotHeight"`
        TrackMouseClicks   bool   `json:"trackMouseClicks"`
        TrackKeystrokes    bool   `json:"trackKeystrokes"`
        TrackAppUsage      bool   `json:"trackAppUsage"`
        TrackWebsites      bool   `json:"trackWebsites"`
        CaptureScreenshots bool   `json:"captureScreenshots"`
        TrackMouseMoves    bool   `json:"trackMouseMoves"`
}

// fetchMonitoringConfig retrieves the config from the server
func fetchMonitoringConfig(serverURL string) *MonitoringConfig {
        configURL := fmt.Sprintf("%s/api/activity/config", serverURL)
        resp, err := http.Get(configURL)
        if err != nil {
                return nil
        }
        defer resp.Body.Close()
        var cfg MonitoringConfig
        if err := json.NewDecoder(resp.Body).Decode(&cfg); err != nil {
                return nil
        }
        return &cfg
}

// reportActivity sends activity data to the server based on configurable settings
func startActivityReporter(serverURL, machineCode string) {
        if runtime.GOOS != "windows" {
                return
        }

        // Install hooks
        initActivityHooks()

        // Fetch config initially
        config := fetchMonitoringConfig(serverURL)
        if config == nil {
                config = &MonitoringConfig{
                        ActivityInterval:   30,
                        ScreenshotInterval: 300,
                        IdleThreshold:      60,
                        ScreenshotQuality:  40,
                        ScreenshotWidth:    320,
                        ScreenshotHeight:   180,
                        TrackMouseClicks:   true,
                        TrackKeystrokes:    true,
                        TrackAppUsage:      true,
                        TrackWebsites:      true,
                        CaptureScreenshots: true,
                        TrackMouseMoves:    false,
                }
        }

        // Config refresh interval (every 5 minutes)
        configTicker := time.NewTicker(5 * time.Minute)
        defer configTicker.Stop()

        // Activity report ticker (uses config interval)
        var activityTicker *time.Ticker
        var activityChan <-chan time.Time

        startActivityTicker := func() {
                if activityTicker != nil {
                        activityTicker.Stop()
                }
                interval := config.ActivityInterval
                if interval < 10 { interval = 10 }
                if interval > 300 { interval = 300 }
                activityTicker = time.NewTicker(time.Duration(interval) * time.Second)
                activityChan = activityTicker.C
        }
        startActivityTicker()
        defer activityTicker.Stop()

        // Screenshot counter
        screenshotCounter := 0
        screenshotEvery := config.ScreenshotInterval / config.ActivityInterval
        if screenshotEvery < 1 { screenshotEvery = 10 }

        for {
                select {
                case <-configTicker.C:
                        // Refresh config
                        if newCfg := fetchMonitoringConfig(serverURL); newCfg != nil {
                                oldInterval := config.ActivityInterval
                                config = newCfg
                                if config.ActivityInterval != oldInterval {
                                        startActivityTicker()
                                }
                                screenshotEvery = config.ScreenshotInterval / config.ActivityInterval
                                if screenshotEvery < 1 { screenshotEvery = 1 }
                        }

                case <-activityChan:
                        data := collectActivityData()

                        // Apply config: zero out disabled metrics
                        if !config.TrackMouseClicks { data.MouseClicks = 0 }
                        if !config.TrackKeystrokes { data.Keystrokes = 0 }
                        if !config.TrackMouseMoves { data.MouseMoves = 0 }
                        if !config.TrackAppUsage { data.AppUsages = []AppUsageData{} }
                        if !config.TrackWebsites { data.WebsiteVisits = []WebsiteData{} }

                        // Screenshot capture
                        screenshotCounter++
                        if config.CaptureScreenshots && screenshotCounter >= screenshotEvery {
                                screenshotCounter = 0
                                if img, err := captureScreenWindows(); err == nil {
                                        thumbImg := downscaleImage(img, config.ScreenshotWidth, config.ScreenshotHeight)
                                        if jpegData, err := encodeJPEG(thumbImg, config.ScreenshotQuality); err == nil {
                                                data.Screenshot = "data:image/jpeg;base64," + base64Encode(jpegData)
                                                data.ScreenshotWidth = config.ScreenshotWidth
                                                data.ScreenshotHeight = config.ScreenshotHeight
                                        }
                                }
                        }

                        // Send to server
                        reportURL := fmt.Sprintf("%s/api/activity/report", serverURL)
                        body, _ := json.Marshal(map[string]interface{}{
                                "machineCode":      machineCode,
                                "mouseClicks":      data.MouseClicks,
                                "keystrokes":       data.Keystrokes,
                                "mouseMoves":       data.MouseMoves,
                                "isActive":         data.IsActive,
                                "activeAppName":    data.ActiveAppName,
                                "activeAppTitle":   data.ActiveAppTitle,
                                "appUsages":        data.AppUsages,
                                "websiteVisits":    data.WebsiteVisits,
                                "screenshot":       data.Screenshot,
                                "screenshotWidth":  data.ScreenshotWidth,
                                "screenshotHeight": data.ScreenshotHeight,
                        })

                        resp, err := http.Post(reportURL, "application/json", bytes.NewReader(body))
                        if err != nil {
                                fmt.Printf("[activity] Report failed: %v\n", err)
                        } else {
                                resp.Body.Close()
                        }
                }
        }
}
