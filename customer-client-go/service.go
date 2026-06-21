package main

// Service installation and auto-start management for Windows, Mac, and Linux.
// Allows the customer client to install itself as a persistent service that
// survives reboots, and to uninstall itself on remote command from the
// technician.

import (
        "bytes"
        "crypto/rand"
        "encoding/json"
        "fmt"
        "log"
        "net/http"
        "os"
        "os/exec"
        "path/filepath"
        "runtime"
        "syscall"
        "time"
)

// installService installs the current binary as a system service that starts
// on boot. The service runs in unattended mode with the given machine code.
// If machineCode is empty, a random one is generated.
func installService(machineCode, serverURL string) error {
        exe, err := os.Executable()
        if err != nil {
                return fmt.Errorf("cannot find executable: %w", err)
        }

        // Generate a machine code if not provided
        if machineCode == "" {
                machineCode = generateMachineCode()
                // Register with the server
                registerURL := fmt.Sprintf("%s/api/unattended", serverURL)
                body, _ := json.Marshal(map[string]string{
                        "customerName": hostname(),
                })
                resp, err := http.Post(registerURL, "application/json", bytes.NewReader(body))
                if err != nil {
                        return fmt.Errorf("failed to register with server: %w", err)
                }
                var result struct {
                        MachineCode string `json:"machineCode"`
                }
                json.NewDecoder(resp.Body).Decode(&result)
                resp.Body.Close()
                if result.MachineCode != "" {
                        machineCode = result.MachineCode
                }
        }

        switch runtime.GOOS {
        case "windows":
                return installWindowsService(exe, machineCode, serverURL)
        case "darwin":
                return installMacService(exe, machineCode, serverURL)
        case "linux":
                return installLinuxService(exe, machineCode, serverURL)
        default:
                return fmt.Errorf("unsupported OS: %s", runtime.GOOS)
        }
}

// generateMachineCode produces a 6-digit numeric code (matching the session
// code format) for use when the server doesn't provide one. Uses crypto/rand
// for unpredictable digits.
func generateMachineCode() string {
        b := make([]byte, 6)
        for i := range b {
                // crypto/rand.Reader is always available; fall back to time-based
                // if it somehow fails (extremely unlikely).
                var n [1]byte
                if _, err := rand.Read(n[:]); err != nil {
                        b[i] = byte('0' + (time.Now().UnixNano() % 10))
                        continue
                }
                b[i] = byte('0' + int(n[0])%10)
        }
        return string(b)
}

// installServiceElevated installs the service with admin privileges.
// On Windows, triggers a UAC prompt. On Linux/Mac, uses sudo.
func installServiceElevated(machineCode, serverURL string) error {
        exe, err := os.Executable()
        if err != nil {
                return fmt.Errorf("cannot find executable: %w", err)
        }

        if runtime.GOOS == "windows" {
                serviceName := "MarqueeIT"
                exe, _ := os.Executable()

                // IMPORTANT: We install BOTH a Windows service AND a scheduled task.
                //
                // The Windows service runs as SYSTEM in Session 0, which is isolated
                // from the user's desktop. It CANNOT capture the screen or inject
                // input into the user's session. Its only purpose is to survive reboots
                // and launch the scheduled task.
                //
                // The scheduled task runs at logon in the user's interactive session
                // (Session 1+). This is the process that actually does screen capture
                // and input injection — it CAN see the desktop and interact with windows.
                //
                // This is the same architecture used by TeamViewer, AnyDesk, etc.

                tmpVbs := filepath.Join(os.TempDir(), "marqueeit-install-svc.vbs")
                tmpBat := filepath.Join(os.TempDir(), "marqueeit-install-svc.bat")
                donePath := filepath.Join(os.TempDir(), "marqueeit-svc-done.txt")

                // Escape paths for cmd.exe (backslashes are literal in bat files,
                // but we need to quote paths with spaces)
                bat := fmt.Sprintf(`@echo off
REM Stop and delete old service if it exists
sc stop "%s" >nul 2>&1
sc delete "%s" >nul 2>&1
REM Create the service (runs as SYSTEM, just for reboot survival)
sc create "%s" binPath= "\"%s\" --unattended-svc %s --server %s" start= auto displayname= "MarqueeIT Remote Support"
sc description "%s" "MarqueeIT Remote Support - launches the user-session helper on logon"
sc failure "%s" reset= 60 actions= restart/5000/restart/10000/restart/30000
REM Start the service
sc start "%s" >nul 2>&1
REM Create a scheduled task that runs at every user logon.
REM This runs in the user's interactive session and can see the desktop.
schtasks /create /tn "MarqueeIT" /tr "\"%s\" --unattended %s --server %s" /sc onlogon /rl highest /f
REM Also run it now for the current session
schtasks /run /tn "MarqueeIT"
echo DONE > "%s"
`,
                        serviceName, serviceName,
                        serviceName, exe, machineCode, serverURL,
                        serviceName, serviceName, serviceName,
                        exe, machineCode, serverURL,
                        donePath)
                os.WriteFile(tmpBat, []byte(bat), 0644)
                // VBS wrapper runs the bat silently
                vbs := fmt.Sprintf(`Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "%s", 0, True
`, tmpBat)
                os.WriteFile(tmpVbs, []byte(vbs), 0644)

                // Elevate wscript.exe explicitly (NOT the .vbs file).
                psCmd := fmt.Sprintf(`Start-Process -FilePath "wscript.exe" -ArgumentList '"%s"' -Verb RunAs`, tmpVbs)
                cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", psCmd)
                cmd.SysProcAttr = &syscall.SysProcAttr{}
                hideWindow(cmd.SysProcAttr)
                if err := cmd.Start(); err != nil {
                        return fmt.Errorf("could not start PowerShell for UAC elevation: %w", err)
                }
                cmd.Wait()

                // Wait for the done marker (up to 30 seconds)
                os.Remove(donePath)
                done := false
                for i := 0; i < 60; i++ {
                        if _, err := os.Stat(donePath); err == nil {
                                done = true
                                break
                        }
                        time.Sleep(500 * time.Millisecond)
                }
                os.Remove(tmpBat)
                os.Remove(tmpVbs)
                os.Remove(donePath)
                if !done {
                        return fmt.Errorf("installation did not complete within 30s — the customer may have clicked No on the UAC prompt, or antivirus blocked the install")
                }
                return nil
        }

        // Linux/Mac: use sudo
        return installService(machineCode, serverURL)
}

// uninstallService removes the system service.
func uninstallService() error {
        switch runtime.GOOS {
        case "windows":
                return uninstallWindowsService()
        case "darwin":
                return uninstallMacService()
        case "linux":
                return uninstallLinuxService()
        default:
                return fmt.Errorf("unsupported OS: %s", runtime.GOOS)
        }
}

// selfUninstall removes the service AND deletes the binary. Called when the
// technician sends a "self-uninstall" command.
func selfUninstall() error {
        log.Printf("Self-uninstalling...")
        if err := uninstallService(); err != nil {
                log.Printf("Warning: service uninstall failed: %v", err)
        }
        exe, err := os.Executable()
        if err != nil {
                return err
        }
        // On Windows, we can't delete a running .exe directly. Schedule it for
        // deletion on next reboot, or use a batch script that waits and deletes.
        if runtime.GOOS == "windows" {
                // Create a small .bat that waits 3 seconds then deletes the exe
                batPath := filepath.Join(os.TempDir(), "marqueeit-cleanup.bat")
                bat := fmt.Sprintf(`@echo off
timeout /t 3 /nobreak >nul
del "%s"
del "%s"
`, exe, batPath)
                os.WriteFile(batPath, []byte(bat), 0644)
                exec.Command("cmd", "/c", "start", "/b", batPath).Start()
                log.Printf("Scheduled cleanup via %s", batPath)
        } else {
                // On Mac/Linux, fork a shell that waits then deletes
                script := fmt.Sprintf("sleep 2 && rm -f %s", exe)
                exec.Command("sh", "-c", script).Start()
        }
        return nil
}

// --- Windows ---

func installWindowsService(exe, machineCode, serverURL string) error {
        // Use sc.exe to create a Windows service.
        // The binPath must be quoted if it contains spaces (e.g., "C:\Program Files\...").
        // sc.exe's binPath= argument is special — it takes everything after "binPath= "
        // as the path, so the entire command line (exe + args) must be a single
        // double-quoted string if the path has spaces.
        serviceName := "MarqueeIT"
        binPath := fmt.Sprintf(`"%s" --unattended %s --server %s`, exe, machineCode, serverURL)
        cmd := exec.Command("sc", "create", serviceName,
                "binPath=", binPath,
                "start=", "auto",
                "displayname=", "MarqueeIT Remote Support",
        )
        if output, err := cmd.CombinedOutput(); err != nil {
                return fmt.Errorf("sc create failed: %s: %w", string(output), err)
        }
        // Set the service to restart on failure (5s, 10s, 30s) and reset the
        // failure counter after 60s.
        exec.Command("sc", "failure", serviceName, "reset=", "60",
                "actions=", "restart/5000/restart/10000/restart/30000").Run()
        // Start it now
        exec.Command("sc", "start", serviceName).Run()
        log.Printf("Installed and started Windows service: %s (binPath=%s)", serviceName, binPath)
        return nil
}

func uninstallWindowsService() error {
        serviceName := "MarqueeIT"
        // Delete the scheduled task first (non-fatal if it doesn't exist)
        exec.Command("schtasks", "/delete", "/tn", "MarqueeIT", "/f").Run()
        exec.Command("sc", "stop", serviceName).Run()
        output, err := exec.Command("sc", "delete", serviceName).CombinedOutput()
        if err != nil {
                return fmt.Errorf("sc delete failed: %s: %w", string(output), err)
        }
        log.Printf("Removed Windows service: %s", serviceName)
        return nil
}

// --- macOS ---

func installMacService(exe, machineCode, serverURL string) error {
        plistPath := os.Getenv("HOME") + "/Library/LaunchAgents/com.marqueeit.unattended.plist"
        plist := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>com.marqueeit.unattended</string>
    <key>ProgramArguments</key><array>
        <string>%s</string>
        <string>--unattended</string>
        <string>%s</string>
        <string>--server</string>
        <string>%s</string>
    </array>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
</dict>
</plist>`, exe, machineCode, serverURL)
        if err := os.MkdirAll(filepath.Dir(plistPath), 0755); err != nil {
                return err
        }
        if err := os.WriteFile(plistPath, []byte(plist), 0644); err != nil {
                return err
        }
        exec.Command("launchctl", "load", plistPath).Run()
        log.Printf("Installed macOS launchd service: %s", plistPath)
        return nil
}

func uninstallMacService() error {
        plistPath := os.Getenv("HOME") + "/Library/LaunchAgents/com.marqueeit.unattended.plist"
        exec.Command("launchctl", "unload", plistPath).Run()
        os.Remove(plistPath)
        log.Printf("Removed macOS launchd service")
        return nil
}

// --- Linux ---

func installLinuxService(exe, machineCode, serverURL string) error {
        unitPath := os.Getenv("HOME") + "/.config/systemd/user/marqueeit-unattended.service"
        unit := fmt.Sprintf(`[Unit]
Description=MarqueeIT Unattended Access
After=network.target

[Service]
ExecStart=%s --unattended %s --server %s
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`, exe, machineCode, serverURL)
        if err := os.MkdirAll(filepath.Dir(unitPath), 0755); err != nil {
                return err
        }
        if err := os.WriteFile(unitPath, []byte(unit), 0644); err != nil {
                return err
        }
        exec.Command("systemctl", "--user", "daemon-reload").Run()
        exec.Command("systemctl", "--user", "enable", "--now", "marqueeit-unattended.service").Run()
        log.Printf("Installed Linux systemd service: %s", unitPath)
        return nil
}

func uninstallLinuxService() error {
        unitPath := os.Getenv("HOME") + "/.config/systemd/user/marqueeit-unattended.service"
        exec.Command("systemctl", "--user", "stop", "marqueeit-unattended.service").Run()
        exec.Command("systemctl", "--user", "disable", "marqueeit-unattended.service").Run()
        os.Remove(unitPath)
        exec.Command("systemctl", "--user", "daemon-reload").Run()
        log.Printf("Removed Linux systemd service")
        return nil
}
