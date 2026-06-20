package main

// Service installation and auto-start management for Windows, Mac, and Linux.
// Allows the customer client to install itself as a persistent service that
// survives reboots, and to uninstall itself on remote command from the
// technician.

import (
        "bytes"
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

func generateMachineCode() string {
        const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        b := make([]byte, 8)
        for i := range b {
                b[i] = alphabet[time.Now().UnixNano()%int64(len(alphabet))]
                time.Sleep(time.Nanosecond)
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

                // Write a VBS script that runs the batch file silently (no cmd window)
                tmpVbs := filepath.Join(os.TempDir(), "marqueeit-install-svc.vbs")
                tmpBat := filepath.Join(os.TempDir(), "marqueeit-install-svc.bat")
                bat := fmt.Sprintf(`@echo off
sc stop "%s" >nul 2>&1
sc delete "%s" >nul 2>&1
sc create "%s" binPath= "%s --unattended %s --server %s" start= auto displayname= "MarqueeIT Remote Support"
sc description "%s" "MarqueeIT Remote Support - allows technicians to connect remotely"
sc failure "%s" reset= 60 actions= restart/5000/restart/10000/restart/30000
sc start "%s"
echo DONE > "%s"
`, serviceName, serviceName, serviceName, exe, machineCode, serverURL, serviceName, serviceName, serviceName, filepath.Join(os.TempDir(), "marqueeit-svc-done.txt"))
                os.WriteFile(tmpBat, []byte(bat), 0644)
                // VBS wrapper runs the bat silently
                vbs := fmt.Sprintf(`Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "%s", 0, True
`, tmpBat)
                os.WriteFile(tmpVbs, []byte(vbs), 0644)

                // Run elevated via PowerShell (no -Wait, we poll for done marker)
                psCmd := fmt.Sprintf(`Start-Process -FilePath "%s" -Verb RunAs`, tmpVbs)
                cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", psCmd)
                cmd.SysProcAttr = &syscall.SysProcAttr{}
                hideWindow(cmd.SysProcAttr)
                cmd.Start() // non-blocking

                // Wait for the done marker (up to 30 seconds)
                donePath := filepath.Join(os.TempDir(), "marqueeit-svc-done.txt")
                os.Remove(donePath)
                for i := 0; i < 60; i++ {
                        if _, err := os.Stat(donePath); err == nil {
                                break
                        }
                        time.Sleep(500 * time.Millisecond)
                }
                os.Remove(tmpBat)
                os.Remove(tmpVbs)
                os.Remove(donePath)
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
        // Use sc.exe to create a Windows service
        serviceName := "MarqueeIT"
        cmd := exec.Command("sc", "create", serviceName,
                "binPath=", fmt.Sprintf(`"%s" --unattended %s --server %s`, exe, machineCode, serverURL),
                "start=", "auto",
                "displayname=", "MarqueeIT Remote Support",
        )
        if output, err := cmd.CombinedOutput(); err != nil {
                return fmt.Errorf("sc create failed: %s: %w", string(output), err)
        }
        // Start it now
        exec.Command("sc", "start", serviceName).Run()
        log.Printf("Installed and started Windows service: %s", serviceName)
        return nil
}

func uninstallWindowsService() error {
        serviceName := "MarqueeIT"
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
