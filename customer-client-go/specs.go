package main

import (
        "fmt"
        "os"
        "os/exec"
        "runtime"
        "strings"

        "github.com/kbinani/screenshot"
)

// MachineSpecs holds basic system information about the customer's machine.
type MachineSpecs struct {
        OS       string `json:"os"`
        Hostname string `json:"hostname"`
        CPU      string `json:"cpu"`
        RAM      string `json:"ram"`
        Screen   string `json:"screen"`
        Arch     string `json:"arch"`
}

// collectMachineSpecs gathers basic system info to display to the technician.
func collectMachineSpecs() MachineSpecs {
        specs := MachineSpecs{
                OS:       runtime.GOOS,
                Arch:     runtime.GOARCH,
                Hostname: hostname(),
                CPU:      collectCPUInfo(),
                RAM:      collectRAMInfo(),
                Screen:   collectScreenInfo(),
        }
        return specs
}

func collectCPUInfo() string {
        // Read /proc/cpuinfo on Linux
        if data, err := os.ReadFile("/proc/cpuinfo"); err == nil {
                lines := strings.Split(string(data), "\n")
                for _, line := range lines {
                        if strings.HasPrefix(line, "model name") {
                                parts := strings.SplitN(line, ":", 2)
                                if len(parts) == 2 {
                                        return strings.TrimSpace(parts[1])
                                }
                        }
                }
        }
        // Fallback
        return runtime.GOARCH + " " + runtime.GOOS
}

func collectRAMInfo() string {
        // Linux: read /proc/meminfo
        if data, err := os.ReadFile("/proc/meminfo"); err == nil {
                lines := strings.Split(string(data), "\n")
                for _, line := range lines {
                        if strings.HasPrefix(line, "MemTotal:") {
                                parts := strings.Fields(line)
                                if len(parts) >= 2 {
                                        return parts[1] + " kB"
                                }
                        }
                }
        }
        // Windows: use PowerShell to get RAM in GB
        if runtime.GOOS == "windows" {
                out, err := winExecPowerShellHidden("[math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB)")
                if err == nil && out != "" {
                        return strings.TrimSpace(out) + " GB"
                }
        }
        // Mac: use sysctl
        if runtime.GOOS == "darwin" {
                out, err := exec.Command("sysctl", "-n", "hw.memsize").Output()
                if err == nil {
                        bytes := strings.TrimSpace(string(out))
                        return bytes + " bytes"
                }
        }
        return "unknown"
}

func collectScreenInfo() string {
        // Try to get screen resolution from the screenshot library
        if img, err := screenshot.CaptureDisplay(0); err == nil {
                b := img.Bounds()
                return fmt.Sprintf("%dx%d", b.Dx(), b.Dy())
        }
        return "unknown"
}
