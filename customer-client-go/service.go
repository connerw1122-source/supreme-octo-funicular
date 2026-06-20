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
