package main

// Extended input and system control handlers for the Go customer client.
// These handle commands sent by the technician via WebSocket.

import (
        "bytes"
        "context"
        "encoding/json"
        "fmt"
        "os/exec"
        "runtime"
        "strings"
        "syscall"
        "time"

        "github.com/kbinani/screenshot"
)

// HandleSystemCommand processes non-input commands from the technician.
// Called from readLoop when a message with type != "input-event" arrives.
func HandleSystemCommand(msg map[string]interface{}) {
        cmdType, _ := msg["type"].(string)
        switch cmdType {

        // --- Clipboard sync ---
        case "clipboard-set":
                text, _ := msg["text"].(string)
                setClipboard(text)

        case "clipboard-get":
                text := getClipboard()
                sendJSON(map[string]interface{}{
                        "type": "clipboard-data",
                        "text": text,
                })

        // --- Lock customer input ---
        case "lock-input":
                lockInput(true)
        case "unlock-input":
                lockInput(false)

        // --- Lock screen (blank display) ---
        case "lock-screen":
                lockScreen(true)
        case "unlock-screen":
                lockScreen(false)

        // --- Send Ctrl+Alt+Del ---
        case "send-cad":
                sendCtrlAltDel()

        // --- Remote CMD/PowerShell ---
        case "exec-command":
                command, _ := msg["command"].(string)
                result := execRemoteCommand(command)
                sendJSON(map[string]interface{}{
                        "type":   "command-output",
                        "output": result,
                        "id":     msg["id"],
                })

        // --- Task Manager ---
        case "list-processes":
                procs := listProcesses()
                sendJSON(map[string]interface{}{
                        "type":      "process-list",
                        "processes": procs,
                })

        case "kill-process":
                pid, _ := msg["pid"].(float64)
                killProcess(int(pid))

        // --- Multi-monitor ---
        case "list-monitors":
                monitors := listMonitors()
                sendJSON(map[string]interface{}{
                        "type":     "monitor-list",
                        "monitors": monitors,
                })

        case "switch-monitor":
                idx, _ := msg["index"].(float64)
                switchMonitor(int(idx))

        // --- Quality/FPS control ---
        case "set-quality":
                quality, _ := msg["quality"].(float64)
                fps, _ := msg["fps"].(float64)
                setQuality(int(quality), int(fps))

        // --- Expanded system info ---
        case "get-sysinfo":
                info := getExpandedSysInfo()
                sendJSON(map[string]interface{}{
                        "type":    "sysinfo",
                        "details": info,
                })

        // --- Reboot ---
        case "reboot":
                rebootMachine()

        // --- Session recording control (customer-side no-op, just acknowledge) ---
        case "recording-start":
                sendJSON(map[string]interface{}{"type": "recording-ack", "recording": true})
        case "recording-stop":
                sendJSON(map[string]interface{}{"type": "recording-ack", "recording": false})

        // --- Install as unattended service (during active session) ---
        case "install-unattended":
                serverURL, _ := msg["server"].(string)
                if serverURL == "" {
                        serverURL = globalClient.serverURL
                }
                err := installService("", serverURL)
                result := "installed"
                if err != nil {
                        result = "error: " + err.Error()
                }
                sendJSON(map[string]interface{}{
                        "type":   "unattended-result",
                        "result": result,
                })
        }
}

// sendJSON sends a JSON message to the technician via the active WebSocket.
func sendJSON(msg map[string]interface{}) {
        if globalClient != nil {
                data, _ := json.Marshal(msg)
                globalClient.connMu.Lock()
                if globalClient.conn != nil {
                        globalClient.conn.WriteMessage(1, data) // 1 = TextMessage
                }
                globalClient.connMu.Unlock()
        }
}

// globalClient is set in NewClient so system command handlers can send responses
var globalClient *Client

// --- Clipboard ---

func setClipboard(text string) {
        switch runtime.GOOS {
        case "windows":
                winSetClipboard(text)
        case "darwin":
                cmd := exec.Command("pbcopy")
                cmd.Stdin = strings.NewReader(text)
                cmd.Run()
        case "linux":
                cmd := exec.Command("xclip", "-selection", "clipboard")
                cmd.Stdin = strings.NewReader(text)
                cmd.Run()
        }
}

func getClipboard() string {
        switch runtime.GOOS {
        case "windows":
                return winGetClipboard()
        case "darwin":
                out, _ := exec.Command("pbpaste")
                return out
        case "linux":
                out, _ := exec.Command("xclip", "-selection", "clipboard", "-o")
                return out
        }
        return ""
}

// --- Lock input (block customer's keyboard/mouse) ---

var inputLocked bool

func lockInput(locked bool) {
        inputLocked = locked
        switch runtime.GOOS {
        case "windows":
                winBlockInput(locked)
        case "linux":
                // On Linux X11, we can't easily block all input without grabbing
                // the keyboard. For now this is a flag that the input handlers
                // could check (though we don't currently).
        }
}

// --- Lock screen (blank display) ---

func lockScreen(lock bool) {
        if !lock {
                // Can't unlock the workstation remotely — the user needs to enter
                // their PIN/password. This is by Windows design (security).
                // The technician should just tell the customer to log back in.
                return
        }
        switch runtime.GOOS {
        case "windows":
                winLockWorkStation()
        case "linux":
                exec.Command("xdg-screensaver", "lock").Run()
        case "darwin":
                exec.Command("/System/Library/CoreServices/Menu Extras/User.menu/Contents/Resources/CGSession", "-suspend").Run()
        }
}

// --- Send Ctrl+Alt+Del ---

func sendCtrlAltDel() {
        switch runtime.GOOS {
        case "windows":
                // Ctrl+Alt+Del is the Secure Attention Sequence (SAS) and cannot
                // be simulated by SendInput on modern Windows. The only way to
                // trigger it programmatically is via the SAS library (requires
                // running as SYSTEM) or by sending a keyboard scan code sequence.
                // We try the scan code approach which works on some Windows versions.
                winSendCAD()
        case "linux":
                exec.Command("dbus-send", "--system", "--print-reply",
                        "--dest=org.freedesktop.login1",
                        "/org/freedesktop/login1",
                        "org.freedesktop.login1.Manager.Terminate").Run()
        }
}

// --- Remote command execution ---

func execRemoteCommand(command string) string {
        var stdout, stderr bytes.Buffer
        ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
        defer cancel()
        var cmd *exec.Cmd
        if runtime.GOOS == "windows" {
                cmd = exec.CommandContext(ctx, "cmd", "/c", command)
                cmd.SysProcAttr = &syscall.SysProcAttr{}
                hideWindow(cmd.SysProcAttr)
        } else {
                cmd = exec.CommandContext(ctx, "sh", "-c", command)
        }
        cmd.Stdout = &stdout
        cmd.Stderr = &stderr
        err := cmd.Run()
        output := stdout.String()
        if stderr.Len() > 0 {
                output += "\n[stderr]\n" + stderr.String()
        }
        if err != nil {
                output += "\n[error]\n" + err.Error()
        }
        return output
}

// --- Process listing (Task Manager) ---

type ProcessInfo struct {
        PID    int    `json:"pid"`
        Name   string `json:"name"`
        CPU    string `json:"cpu"`
        Memory string `json:"memory"`
}

func listProcesses() []ProcessInfo {
        var procs []ProcessInfo
        switch runtime.GOOS {
        case "windows":
                out, _ := winExecPowerShellHidden(
                        "Get-Process | Sort-Object -Property WS -Descending | Select-Object -First 50 Id, ProcessName, CPU, @{N='Mem';E={[math]::Round($_.WS/1MB,1)}} | Format-Table -AutoSize")
                // Parse the output
                lines := strings.Split(out, "\n")
                for _, line := range lines {
                        fields := strings.Fields(line)
                        if len(fields) >= 4 {
                                var pid int
                                fmt.Sscanf(fields[0], "%d", &pid)
                                if pid > 0 {
                                        procs = append(procs, ProcessInfo{
                                                PID:    pid,
                                                Name:   fields[1],
                                                CPU:    fields[2],
                                                Memory: fields[3] + " MB",
                                        })
                                }
                        }
                }
        case "linux", "darwin":
                out, _ := exec.Command("ps", "aux", "--sort=-rss")
                lines := strings.Split(out, "\n")
                for i, line := range lines {
                        if i == 0 || line == "" {
                                continue
                        }
                        fields := strings.Fields(line)
                        if len(fields) >= 11 {
                                var pid int
                                fmt.Sscanf(fields[1], "%d", &pid)
                                procs = append(procs, ProcessInfo{
                                        PID:    pid,
                                        Name:   strings.Join(fields[10:], " "),
                                        CPU:    fields[2] + "%",
                                        Memory: fields[3] + "%",
                                })
                        }
                        if len(procs) >= 50 {
                                break
                        }
                }
        }
        return procs
}

func killProcess(pid int) {
        switch runtime.GOOS {
        case "windows":
                exec.Command("taskkill", "/PID", fmt.Sprintf("%d", pid), "/F").Run()
        default:
                exec.Command("kill", "-9", fmt.Sprintf("%d", pid)).Run()
        }
}

// --- Multi-monitor ---

type MonitorInfo struct {
        Index  int    `json:"index"`
        Width  int    `json:"width"`
        Height int    `json:"height"`
}

func listMonitors() []MonitorInfo {
        n := screenshot.NumActiveDisplays()
        var monitors []MonitorInfo
        for i := 0; i < n; i++ {
                if img, err := screenshot.CaptureDisplay(i); err == nil {
                        b := img.Bounds()
                        monitors = append(monitors, MonitorInfo{
                                Index:  i,
                                Width:  b.Dx(),
                                Height: b.Dy(),
                        })
                }
        }
        return monitors
}

var currentMonitor int = 0

func switchMonitor(index int) {
        if index >= 0 && index < screenshot.NumActiveDisplays() {
                currentMonitor = index
        }
}

// --- Quality/FPS control ---

var jpegQuality = 55
var targetFPS = 33 // ms per frame = ~30 FPS

func setQuality(quality int, fps int) {
        if quality > 0 && quality <= 100 {
                jpegQuality = quality
        }
        if fps > 0 {
                targetFPS = 1000 / fps
        }
}

// --- Expanded system info ---

func getExpandedSysInfo() map[string]interface{} {
        info := map[string]interface{}{
                "os":       runtime.GOOS,
                "arch":     runtime.GOARCH,
                "hostname": hostname(),
                "cpus":     runtime.NumCPU(),
        }

        // Installed software (Windows)
        if runtime.GOOS == "windows" {
                out, _ := winExecPowerShellHidden(
                        "Get-ItemProperty HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\* | "+
                                "Select-Object DisplayName, DisplayVersion | "+
                                "Where-Object { $_.DisplayName -ne $null } | "+
                                "Format-Table -AutoSize")
                info["installed_software"] = out
        }

        // Disk space
        if runtime.GOOS == "windows" {
                out, _ := winExecPowerShellHidden(
                        "Get-PSDrive -PSProvider FileSystem | Select-Object Name, @{N='Used(GB)';E={[math]::Round($_.Used/1GB,1)}}, @{N='Free(GB)';E={[math]::Round($_.Free/1GB,1)}} | Format-Table -AutoSize")
                info["disks"] = out
        } else {
                out, _ := exec.Command("df", "-h")
                info["disks"] = out
        }

        // Network interfaces
        if runtime.GOOS == "windows" {
                out, _ := winExecPowerShellHidden(
                        "Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -ne '127.0.0.1' } | Select-Object InterfaceAlias, IPAddress | Format-Table -AutoSize")
                info["network"] = out
        } else {
                out, _ := exec.Command("ip", "addr")
                info["network"] = out
        }

        // Uptime
        if runtime.GOOS == "windows" {
                out, _ := winExecPowerShellHidden(
                        "$u = (Get-Date) - (Get-CimInstance Win32_OperatingSystem).LastBootUpTime; "+
                                "Write-Output ($u.Days.ToString() + 'd ' + $u.Hours.ToString() + 'h ' + $u.Minutes.ToString() + 'm')")
                info["uptime"] = strings.TrimSpace(out)
        } else {
                out, _ := exec.Command("uptime", "-p")
                info["uptime"] = strings.TrimSpace(out)
        }

        return info
}

// --- Reboot ---

func rebootMachine() {
        switch runtime.GOOS {
        case "windows":
                exec.Command("shutdown", "/r", "/t", "5", "/c", "MarqueeIT remote reboot").Start()
        case "linux":
                exec.Command("sudo", "reboot").Start()
        case "darwin":
                exec.Command("sudo", "reboot").Start()
        }
}
