package main

// Extended input and system control handlers for the Go customer client.
// These handle commands sent by the technician via WebSocket.

import (
        "bytes"
        "context"
        "encoding/json"
        "fmt"
        "net/http"
        "os"
        "os/exec"
        "path/filepath"
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

        // Run ALL system commands in a goroutine so they never block the
        // read loop (which would freeze remote control input).
        go func() {
                switch cmdType {

        // --- Clipboard sync ---
        case "clipboard-set":
                text, _ := msg["text"].(string)
                setClipboard(text)
                // Confirm to technician
                sendJSON(map[string]interface{}{
                        "type":   "clipboard-data",
                        "text":   text,
                        "source": "set-confirm",
                })
        case "clipboard-keystrokes":
                // Type text character by character (for pasting into fields that
                // don't accept clipboard paste, like password fields)
                text, _ := msg["text"].(string)
                keyType(text)

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
                elevated, _ := msg["elevated"].(bool)
                id, _ := msg["id"].(string)
                // Send immediate acknowledgment BEFORE starting the goroutine,
                // so the [running...] entry is created before the final output
                // can arrive. (Previous code started the goroutine first, causing
                // a race where the final output could arrive before the ack and
                // be silently dropped by the UI.)
                sendJSON(map[string]interface{}{
                        "type":    "command-output",
                        "output":  "[running...]",
                        "id":      id,
                        "command": command,
                        "final":   false,
                })
                // Run in a goroutine so it doesn't block the read loop
                go func() {
                        var result string
                        if elevated {
                                result = execElevatedCommand(command)
                        } else {
                                result = execRemoteCommand(command)
                        }
                        sendJSON(map[string]interface{}{
                                "type":    "command-output",
                                "output":  result,
                                "id":      id,
                                "command": command,
                                "final":   true,
                        })
                }()

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

        // --- Elevate session (restart client as admin) ---
        case "elevate-session":
                exe, _ := os.Executable()
                // Use a marker file so the OLD process knows when the NEW process
                // has fully connected and is streaming. This avoids the black-screen
                // issue where the old process shuts down before the new one is ready.
                markerFile := filepath.Join(os.TempDir(), "marqueeit-elevated-ready.txt")
                logFile := filepath.Join(os.TempDir(), "marqueeit-elevated-log.txt")
                os.Remove(markerFile) // clear any stale marker
                os.Remove(logFile)

                // Pass the marker path AND a log path as CLI args. The new process
                // will write progress to the log file so we can diagnose failures.
                // CLI args are the ONLY reliable way to pass data through
                // Start-Process -Verb RunAs (env vars don't propagate).
                //
                // SECURITY: Escape single quotes in all values by doubling them
                // (PowerShell single-quote escaping). Without this, a customer name
                // like "O'Brien" would break the command, and a malicious name like
                // "foo'; Remove-Item C:\ -Recurse; 'bar" would execute arbitrary
                // PowerShell as admin.
                escCode := strings.ReplaceAll(globalClient.code, "'", "''")
                escName := strings.ReplaceAll(globalClient.name, "'", "''")
                escServer := strings.ReplaceAll(globalClient.serverURL, "'", "''")
                escMarker := strings.ReplaceAll(markerFile, "'", "''")
                escLog := strings.ReplaceAll(logFile, "'", "''")
                psCmd := fmt.Sprintf(
                        `Start-Process -FilePath "%s" -ArgumentList '-code','%s','-name','%s','-server','%s','-ready-marker','%s','-elevated-log','%s' -Verb RunAs`,
                        exe, escCode, escName, escServer, escMarker, escLog)
                cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", psCmd)
                cmd.SysProcAttr = &syscall.SysProcAttr{}
                hideWindow(cmd.SysProcAttr)
                err := cmd.Start()
                if err != nil {
                        sendJSON(map[string]interface{}{"type": "elevate-result", "result": "error: " + err.Error()})
                        return
                }
                sendJSON(map[string]interface{}{"type": "elevate-result", "result": "restarting"})
                // Wait for the new process to signal readiness (up to 60 seconds).
                // UAC prompt + AV scan + process startup + WS dial + first capture
                // can take a while on slow machines. 60s gives plenty of room.
                ready := false
                for i := 0; i < 120; i++ { // 120 * 500ms = 60s
                        if _, err := os.Stat(markerFile); err == nil {
                                ready = true
                                break
                        }
                        time.Sleep(500 * time.Millisecond)
                }
                if !ready {
                        // New process never started (user likely clicked No on UAC, or it
                        // failed to connect, or AV blocked it, or the 60s timeout expired).
                        // Keep the old process running so the session isn't lost.
                        // Read the log file (if any) to give the technician more info.
                        logContent, _ := os.ReadFile(logFile)
                        logStr := strings.TrimSpace(string(logContent))
                        msg := "error: elevation did not complete in 60s. The customer may have clicked No on the UAC prompt, antivirus may have blocked the new process, or the machine is slow. The current (non-elevated) session is still active."
                        if logStr != "" {
                                msg += "\n\nElevated process log:\n" + logStr
                        }
                        sendJSON(map[string]interface{}{
                                "type":   "elevate-result",
                                "result": msg,
                        })
                        os.Remove(logFile)
                        return
                }
                // New process is ready — safe to shut down the old one.
                os.Remove(markerFile)
                os.Remove(logFile)
                globalClient.shutdown()

        // --- Remove unattended service ---
        case "remove-unattended":
                if runtime.GOOS == "windows" {
                        serviceName := "MarqueeIT"
                        tmpBat := filepath.Join(os.TempDir(), "marqueeit-remove-svc.bat")
                        tmpVbs := filepath.Join(os.TempDir(), "marqueeit-remove-svc.vbs")
                        donePath := filepath.Join(os.TempDir(), "marqueeit-remove-done.txt")
                        os.Remove(donePath)
                        // The bat stops and deletes the service. We add a 2-second
                        // delay at the start so this process can send the result
                        // before the service (which might be us) gets stopped.
                        bat := fmt.Sprintf(`@echo off
timeout /t 2 /nobreak >nul
sc stop "%s" >nul 2>&1
timeout /t 1 /nobreak >nul
sc delete "%s" >nul 2>&1
echo DONE > "%s"
`, serviceName, serviceName, donePath)
                        os.WriteFile(tmpBat, []byte(bat), 0644)
                        // VBS wrapper runs the bat silently (no cmd window flash)
                        vbs := fmt.Sprintf(`Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "%s", 0, True
`, tmpBat)
                        os.WriteFile(tmpVbs, []byte(vbs), 0644)
                        // Run elevated via UAC (non-blocking — we poll for the done marker)
                        psCmd := fmt.Sprintf(`Start-Process -FilePath "%s" -Verb RunAs`, tmpVbs)
                        cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", psCmd)
                        cmd.SysProcAttr = &syscall.SysProcAttr{}
                        hideWindow(cmd.SysProcAttr)
                        cmd.Start()
                        // Wait for the done marker (up to 15 seconds)
                        removed := false
                        for i := 0; i < 30; i++ {
                                if _, err := os.Stat(donePath); err == nil {
                                        removed = true
                                        break
                                }
                                time.Sleep(500 * time.Millisecond)
                        }
                        os.Remove(tmpBat)
                        os.Remove(tmpVbs)
                        os.Remove(donePath)
                        if removed {
                                sendJSON(map[string]interface{}{"type": "unattended-result", "result": "removed"})
                        } else {
                                sendJSON(map[string]interface{}{"type": "unattended-result", "result": "error: service removal timed out — the customer may need to click Yes on the UAC prompt"})
                        }
                } else {
                        uninstallService()
                        sendJSON(map[string]interface{}{"type": "unattended-result", "result": "removed"})
                }

        // --- Install as unattended service (during active session) ---
        case "install-unattended":
                serverURL, _ := msg["server"].(string)
                if serverURL == "" {
                        serverURL = globalClient.serverURL
                }
                // Register with server first
                registerURL := fmt.Sprintf("%s/api/unattended", serverURL)
                regBody, _ := json.Marshal(map[string]string{
                        "customerName": hostname(),
                })
                resp, regErr := http.Post(registerURL, "application/json", bytes.NewReader(regBody))
                machineCode := ""
                if regErr == nil {
                        var result struct {
                                MachineCode string `json:"machineCode"`
                        }
                        json.NewDecoder(resp.Body).Decode(&result)
                        resp.Body.Close()
                        machineCode = result.MachineCode
                }

                // Install the service (elevated on Windows)
                err := installServiceElevated(machineCode, serverURL)
                result := "installed"
                if err != nil {
                        result = "error: " + err.Error()
                }
                sendJSON(map[string]interface{}{
                        "type":        "unattended-result",
                        "result":      result,
                        "machineCode": machineCode,
                })

        // --- Event Viewer log retrieval ---
        // Pulls Windows Event logs via Get-WinEvent (or wevtutil as fallback)
        // and returns the text output to the technician's "Events" tab.
        case "get-event-logs":
                logName, _ := msg["logName"].(string)
                if logName == "" {
                        logName = "System"
                }
                maxEvents := 50
                if mf, ok := msg["maxEvents"].(float64); ok && mf > 0 {
                        maxEvents = int(mf)
                }
                id, _ := msg["id"].(string)
                // Send immediate acknowledgment BEFORE starting the goroutine,
                // so the [loading...] entry is created before the final output
                // can arrive (same race-condition fix as exec-command).
                sendJSON(map[string]interface{}{
                        "type":    "event-logs",
                        "id":      id,
                        "logName": logName,
                        "output":  "[loading...]",
                        "pending": true,
                })
                go func() {
                        output := getEventLogs(logName, maxEvents)
                        sendJSON(map[string]interface{}{
                                "type":    "event-logs",
                                "id":      id,
                                "logName": logName,
                                "output":  output,
                        })
                }()
        }
        }() // end goroutine
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
                cmd := exec.Command("pbpaste")
                out, _ := cmd.Output()
                return string(out)
        case "linux":
                cmd := exec.Command("xclip", "-selection", "clipboard", "-o")
                out, _ := cmd.Output()
                return string(out)
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

// execElevatedCommand runs a command with admin privileges via UAC prompt.
// Non-blocking — uses a done marker file to know when output is ready.
func execElevatedCommand(command string) string {
        if runtime.GOOS == "windows" {
                tmpBat := filepath.Join(os.TempDir(), "marqueeit-elevated.bat")
                tmpOut := filepath.Join(os.TempDir(), "marqueeit-elevated-out.txt")
                tmpDone := filepath.Join(os.TempDir(), "marqueeit-elevated-done.txt")
                // Clean up any previous files
                os.Remove(tmpOut)
                os.Remove(tmpDone)

                batContent := fmt.Sprintf(`@echo off
%s > "%s" 2>&1
echo DONE > "%s"
`, command, tmpOut, tmpDone)
                os.WriteFile(tmpBat, []byte(batContent), 0644)

                // Execute via VBS wrapper (completely silent, no cmd window)
                tmpVbs := filepath.Join(os.TempDir(), "marqueeit-elevated.vbs")
                vbs := fmt.Sprintf(`Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "%s", 0, True
`, tmpBat)
                os.WriteFile(tmpVbs, []byte(vbs), 0644)

                psCmd := fmt.Sprintf(`Start-Process -FilePath "%s" -Verb RunAs`, tmpVbs)
                cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", psCmd)
                cmd.SysProcAttr = &syscall.SysProcAttr{}
                hideWindow(cmd.SysProcAttr)
                cmd.Start() // non-blocking

                // Wait for the done marker (up to 5 minutes for long commands like sfc)
                for i := 0; i < 600; i++ {
                        if _, err := os.Stat(tmpDone); err == nil {
                                break
                        }
                        time.Sleep(500 * time.Millisecond)
                }

                out, _ := os.ReadFile(tmpOut)
                os.Remove(tmpBat)
                os.Remove(tmpVbs)
                os.Remove(tmpOut)
                os.Remove(tmpDone)
                if len(out) == 0 {
                        return "[command completed with no output]"
                }
                return string(out)
        }
        cmd := exec.Command("sudo", "sh", "-c", command)
        out, err := cmd.Output()
        if err != nil {
                return fmt.Sprintf("[error] %s\n%s", err.Error(), string(out))
        }
        return string(out)
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
                cmd := exec.Command("ps", "aux", "--sort=-rss")
                out, _ := cmd.Output()
                lines := strings.Split(string(out), "\n")
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
                cmd := exec.Command("df", "-h")
                out, _ := cmd.Output()
                info["disks"] = string(out)
        }

        // Network interfaces
        if runtime.GOOS == "windows" {
                out, _ := winExecPowerShellHidden(
                        "Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -ne '127.0.0.1' } | Select-Object InterfaceAlias, IPAddress | Format-Table -AutoSize")
                info["network"] = out
        } else {
                cmd := exec.Command("ip", "addr")
                out, _ := cmd.Output()
                info["network"] = string(out)
        }

        // Uptime
        if runtime.GOOS == "windows" {
                out, _ := winExecPowerShellHidden(
                        "$u = (Get-Date) - (Get-CimInstance Win32_OperatingSystem).LastBootUpTime; "+
                                "Write-Output ($u.Days.ToString() + 'd ' + $u.Hours.ToString() + 'h ' + $u.Minutes.ToString() + 'm')")
                info["uptime"] = strings.TrimSpace(out)
        } else {
                cmd := exec.Command("uptime", "-p")
                out, _ := cmd.Output()
                info["uptime"] = strings.TrimSpace(string(out))
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

// --- Event Viewer logs ---

// getEventLogs retrieves the most recent Windows Event log entries from the
// specified log (System, Application, Security, Setup, etc.).
// Returns a structured JSON array so the technician UI can render each event
// as a clean card (instead of a cramped fixed-width table that doesn't fit
// in a narrow sidebar).
//
// Each event has: time, id, level, provider, message.
// Falls back to wevtutil (a native Windows tool) if PowerShell is unavailable,
// in which case the output is plain text.
func getEventLogs(logName string, maxEvents int) string {
        if maxEvents <= 0 {
                maxEvents = 50
        }
        if logName == "" {
                logName = "System"
        }
        switch runtime.GOOS {
        case "windows":
                // Use ConvertTo-Json so the technician UI can render each event as a card.
                // We select and RENAME properties to lowercase so the JSON keys match
                // what the UI expects (time, id, level, provider, message).
                psScript := fmt.Sprintf(
                        "$evts = Get-WinEvent -LogName '%s' -MaxEvents %d -ErrorAction SilentlyContinue; "+
                                "if ($evts) { "+
                                "$evts | Select-Object "+
                                "@{N='time';E={$_.TimeCreated.ToString('yyyy-MM-dd HH:mm:ss')}}, "+
                                "@{N='id';E={$_.Id}}, "+
                                "@{N='level';E={$_.LevelDisplayName}}, "+
                                "@{N='provider';E={$_.ProviderName}}, "+
                                "@{N='message';E={($_.Message -replace '\\r\\n',' ' -replace '\\n',' ' -replace '\\s+',' ').Trim()}} | "+
                                "ConvertTo-Json -Compress -Depth 2 "+
                                "} else { '[]' }",
                        logName, maxEvents)
                out, err := winExecPowerShellHidden(psScript)
                if err == nil {
                        trimmed := strings.TrimSpace(out)
                        // If Get-WinEvent returned a single event, ConvertTo-Json returns an
                        // object instead of an array. Wrap it so the UI can always JSON.parse
                        // to an array. We detect this by checking if trimmed starts with '{'.
                        if trimmed != "" && trimmed != "[]" {
                                if trimmed[0] == '{' {
                                        trimmed = "[" + trimmed + "]"
                                }
                                return trimmed
                        }
                        // Empty or '[]' — return as-is so the UI shows "no events".
                        if trimmed == "" {
                                return "[]"
                        }
                        return trimmed
                }
                // Fallback to wevtutil (native command, no PowerShell dependency)
                // Returns plain text — the UI will display it in a <pre> block.
                // Uses winExecHidden for cross-platform compatibility (the HideWindow
                // and CreationFlags fields only exist on Windows syscall.SysProcAttr).
                wevtOut, _ := winExecHidden(
                        fmt.Sprintf("wevtutil qe %s /c:%d /f:text /rd:true /q:*[System[(Level=1 or Level=2 or Level=3 or Level=4 or Level=0)]]",
                                logName, maxEvents))
                if len(wevtOut) > 0 {
                        // Mark as plain-text fallback so the UI knows not to JSON-parse it.
                        return "PLAIN_TEXT_FALLBACK:\n" + wevtOut
                }
                return fmt.Sprintf("[{\"time\":\"-\",\"id\":0,\"level\":\"Error\",\"provider\":\"MarqueeIT\",\"message\":\"Could not retrieve event logs. PowerShell error: %s\"}]", err.Error())
        case "linux":
                // journalctl — return as plain text (Linux support is secondary)
                cmd := exec.Command("journalctl", "-n", fmt.Sprintf("%d", maxEvents), "--no-pager", "-o", "short-iso")
                out, err := cmd.Output()
                if err != nil {
                        return fmt.Sprintf("[{\"time\":\"-\",\"id\":0,\"level\":\"Error\",\"provider\":\"journalctl\",\"message\":\"%s\"}]", err.Error())
                }
                return "PLAIN_TEXT_FALLBACK:\n" + string(out)
        case "darwin":
                cmd := exec.Command("log", "show", "--last", "1h", "--style", "compact")
                out, err := cmd.Output()
                if err != nil {
                        return fmt.Sprintf("[{\"time\":\"-\",\"id\":0,\"level\":\"Error\",\"provider\":\"log\",\"message\":\"%s\"}]", err.Error())
                }
                return "PLAIN_TEXT_FALLBACK:\n" + string(out)
        }
        return "[{\"time\":\"-\",\"id\":0,\"level\":\"Error\",\"provider\":\"MarqueeIT\",\"message\":\"Unsupported OS for event logs\"}]"
}
