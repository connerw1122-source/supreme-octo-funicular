// MarqueeIT Launcher — a tiny Windows .exe that reads the session code
// from its own filename and runs the main marqueeit-client binary.
//
// Example: customer downloads "marqueeit-AHC6E.exe". When double-clicked,
// this launcher extracts "AHC6E" from the filename, looks for
// marqueeit-client.exe in the same directory, and runs it with
// --code AHC6E --server <embedded URL>.
//
// The server URL is baked in at build time via:
//   -ldflags "-X main.serverURL=https://support.wizardyoda.com"
//
// Build (pure Go, no CGO needed):
//   GOOS=windows GOARCH=amd64 CGO_ENABLED=0 \
//   go build -ldflags="-s -w -H windowsgui -X main.serverURL=https://support.wizardyoda.com" \
//   -o marqueeit-launcher.exe

package main

import (
        "fmt"
        "io"
        "net/http"
        "os"
        "os/exec"
        "path/filepath"
        "strings"
        "syscall"
        "unsafe"
)

// downloadFile downloads a URL to a local path.
func downloadFile(url, dest string) error {
        resp, err := http.Get(url)
        if err != nil {
                return err
        }
        defer resp.Body.Close()
        if resp.StatusCode != 200 {
                return fmt.Errorf("HTTP %d", resp.StatusCode)
        }
        out, err := os.Create(dest)
        if err != nil {
                return err
        }
        defer out.Close()
        _, err = io.Copy(out, resp.Body)
        return err
}

var serverURL = "https://support.wizardyoda.com"

func main() {
        exePath, err := os.Executable()
        if err != nil {
                messageBox("MarqueeIT", "Could not determine executable path: "+err.Error())
                os.Exit(1)
        }

        dir := filepath.Dir(exePath)
        base := filepath.Base(exePath)

        code := extractCode(base)
        if code == "" {
                messageBox("MarqueeIT", "Could not find a session code in the filename.\nPlease make sure you downloaded the correct file from your technician's link.")
                os.Exit(1)
        }

        // Find the main client binary
        clientExe := filepath.Join(dir, "marqueeit-client.exe")
        if _, err := os.Stat(clientExe); err != nil {
                clientExe2 := filepath.Join(dir, "marqueeit-client-windows.exe")
                if _, err := os.Stat(clientExe2); err == nil {
                        clientExe = clientExe2
                } else {
                        // Download the client binary from the server
                        downloadURL := serverURL + "/downloads/marqueeit-client-windows.exe"
                        messageBox("MarqueeIT", "Downloading MarqueeIT client (~6 MB)...")
                        if err := downloadFile(downloadURL, clientExe); err != nil {
                                messageBox("MarqueeIT", "Could not download the client:\n"+err.Error()+
                                        "\n\nPlease check your internet connection and try again.")
                                os.Exit(1)
                        }
                }
        }

        cmd := exec.Command(clientExe, "--code", code, "--server", serverURL)
        cmd.Dir = dir
        cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
        cmd.Stdin = nil
        cmd.Stdout = nil
        cmd.Stderr = nil

        if err := cmd.Start(); err != nil {
                messageBox("MarqueeIT", "Could not start the client: "+err.Error())
                os.Exit(1)
        }

        os.Exit(0)
}

func extractCode(filename string) string {
        name := strings.TrimSuffix(filename, filepath.Ext(filename))
        parts := strings.Split(name, "-")
        for i := len(parts) - 1; i >= 0; i-- {
                p := strings.TrimSpace(parts[i])
                if len(p) >= 4 && len(p) <= 8 && isAllUpperAlnum(p) {
                        return p
                }
        }
        return ""
}

func isAllUpperAlnum(s string) bool {
        for _, c := range s {
                if !((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) {
                        return false
                }
        }
        return true
}

// messageBox shows a Windows message box via user32.dll MessageBoxW.
// On non-Windows builds it just prints to stderr.
func messageBox(title, text string) {
        fmt.Fprintf(os.Stderr, "[%s] %s\n", title, text)

        user32 := syscall.NewLazyDLL("user32.dll")
        mbox := user32.NewProc("MessageBoxW")
        t, _ := syscall.UTF16PtrFromString(text)
        ti, _ := syscall.UTF16PtrFromString(title)
        mbox.Call(0, uintptr(unsafe.Pointer(t)), uintptr(unsafe.Pointer(ti)), 0x10)
}
