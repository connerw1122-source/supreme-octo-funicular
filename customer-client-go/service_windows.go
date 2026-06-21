//go:build windows

package main

import (
        "context"
        "fmt"
        "log"
        "os"
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

                // Winlogon desktop monitor — spawns a SYSTEM helper on the secure
                // desktop when UAC prompts appear. This is the technique UltraVNC
                // and TeamViewer use for UAC interaction. The helper captures the
                // UAC prompt screen and injects input (works because SYSTEM > any
                // integrity level, bypassing UIPI).
                go func() {
                        var winlogonPid uint32
                        for {
                                select {
                                case <-ctx.Done():
                                        return
                                case <-time.After(1 * time.Second):
                                }

                                deskName := getActiveDesktopNameString()
                                if deskName == "Winlogon" {
                                        // Get the current session code from the global client
                                        var sessionCode string
                                        if globalClient != nil {
                                                globalClient.connMu.Lock()
                                                if globalClient.code != "" {
                                                        sessionCode = globalClient.code
                                                }
                                                globalClient.connMu.Unlock()
                                        }
                                        if sessionCode != "" && winlogonPid == 0 {
                                                exe, _ := os.Executable()
                                                pid, err := launchHelperOnWinlogonDesktop(exe,
                                                        fmt.Sprintf("--winlogon-helper --code %s --server %s",
                                                                sessionCode, s.serverURL))
                                                if err != nil {
                                                        log.Printf("[svc] Winlogon helper failed: %v", err)
                                                } else {
                                                        winlogonPid = pid
                                                        log.Printf("[svc] Launched Winlogon helper (pid=%d) for UAC", pid)
                                                }
                                        }
                                } else {
                                        winlogonPid = 0
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
