//go:build windows

package main

import (
        "context"
        "fmt"
        "log"
        "os"
        "path/filepath"
        "strings"
        "time"

        "golang.org/x/sys/windows/svc"
)

// marqueeITService implements the svc.Handler interface.
type marqueeITService struct {
        serverURL   string
        machineCode string
}

func (s *marqueeITService) Execute(args []string, r <-chan svc.ChangeRequest, changes chan<- svc.Status) (ssec bool, errno uint32) {
        changes <- svc.Status{State: svc.StartPending, Accepts: 0}

        ctx, cancel := context.WithCancel(context.Background())
        defer cancel()

        if s.machineCode != "" {
                // Run the unattended client (heartbeat + session management)
                go func() {
                        c := NewClient(s.serverURL, "", hostname())
                        go handleSignals(cancel)
                        if err := c.RunUnattended(ctx, s.machineCode); err != nil {
                                log.Printf("[service] RunUnattended failed: %v", err)
                        }
                }()

                // Winlogon desktop monitor — the SYSTEM service polls for a signal
                // file written by the user-session process. The user-session process
                // CAN detect the desktop change (it's in the user's session) but
                // CANNOT launch the helper (needs SeDebugPrivilege). The SYSTEM
                // service CAN launch the helper (it has the privileges) but CANNOT
                // detect the desktop change (it's in Session 0). So we use a file
                // as IPC between them.
                go func() {
                        signalPath := filepath.Join(os.TempDir(), "marqueeit-winlogon-signal.txt")
                        launchedPath := filepath.Join(os.TempDir(), "marqueeit-winlogon-launched.txt")
                        var winlogonPid uint32
                        for {
                                select {
                                case <-ctx.Done():
                                        os.Remove(signalPath)
                                        os.Remove(launchedPath)
                                        return
                                case <-time.After(500 * time.Millisecond):
                                }

                                // Check if the user-session process wrote a signal
                                data, err := os.ReadFile(signalPath)
                                if err != nil {
                                        // No signal — back on Default desktop
                                        winlogonPid = 0
                                        os.Remove(launchedPath)
                                        continue
                                }

                                lines := strings.Split(strings.TrimSpace(string(data)), "\n")
                                if len(lines) < 2 {
                                        continue
                                }
                                sessionCode := strings.TrimSpace(lines[0])
                                serverURL := strings.TrimSpace(lines[1])
                                if sessionCode == "" {
                                        continue
                                }

                                // Only launch once per signal (don't spam processes)
                                if winlogonPid != 0 {
                                        // Check if the previous helper is still running
                                        if _, err := os.FindProcess(int(winlogonPid)); err == nil {
                                                continue // still running
                                        }
                                        winlogonPid = 0
                                }

                                // Launch the Winlogon helper as SYSTEM on the secure desktop
                                exe, _ := os.Executable()
                                pid, err := launchHelperOnWinlogonDesktop(exe,
                                        fmt.Sprintf("--winlogon-helper --code %s --server %s",
                                                sessionCode, serverURL))
                                if err != nil {
                                        log.Printf("[svc] Winlogon helper failed: %v", err)
                                } else {
                                        winlogonPid = pid
                                        log.Printf("[svc] Launched Winlogon helper (pid=%d) for UAC interaction", pid)
                                }
                        }
                }()
        } else {
                log.Printf("[service] Session 0 mode (no machine code)")
        }

        time.Sleep(500 * time.Millisecond)
        changes <- svc.Status{State: svc.Running, Accepts: svc.AcceptStop | svc.AcceptShutdown}
        log.Printf("[service] Running (pid=%d)", os.Getpid())

        for {
                cr := <-r
                switch cr.Cmd {
                case svc.Interrogate:
                        changes <- cr.CurrentStatus
                case svc.Stop, svc.Shutdown:
                        log.Printf("[service] Received %v, shutting down...", cr.Cmd)
                        cancel()
                        changes <- svc.Status{State: svc.StopPending}
                        return false, 0
                }
        }
}

func runAsWindowsService(serverURL, machineCode string) error {
        return svc.Run("MarqueeIT", &marqueeITService{
                serverURL:   serverURL,
                machineCode: machineCode,
        })
}

func isWindowsService() bool {
        is, err := svc.IsWindowsService()
        if err != nil {
                return false
        }
        return is
}
