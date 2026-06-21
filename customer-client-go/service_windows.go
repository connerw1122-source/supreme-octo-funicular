//go:build windows

package main

import (
        "context"
        "log"
        "os"
        "time"

        "golang.org/x/sys/windows/svc"
)

// marqueeITService implements the svc.Handler interface.
// When Windows starts the service, SCM calls Execute() — we immediately
// report SERVICE_RUNNING (so the SCM doesn't time out at 30s and kill us)
// then run the actual unattended client in a goroutine.
type marqueeITService struct {
        serverURL   string
        machineCode string
}

// Execute is called by the SCM when the service starts.
// args contains the service arguments (from binPath).
// r <-chan svc.ChangeRequest receives control requests (Stop, Pause, etc.)
// changes chan<- svc.Status is used to report status back to SCM.
func (s *marqueeITService) Execute(args []string, r <-chan svc.ChangeRequest, changes chan<- svc.Status) (ssec bool, errno uint32) {
        // Report START_PENDING immediately so SCM knows we're alive.
        // The default 30s timeout starts counting from when SCM launched us.
        changes <- svc.Status{State: svc.StartPending, Accepts: 0}

        ctx, cancel := context.WithCancel(context.Background())
        defer cancel()

        // If we have a machine code, run the full unattended client (screen
        // capture + heartbeat). This is used when the service runs directly
        // in the user's session (e.g., via scheduled task).
        //
        // If machineCode is empty, we're in --unattended-svc mode (Session 0).
        // We can't capture the screen from Session 0, so we just block and
        // keep the service alive. The user-session helper (launched via
        // scheduled task) does the actual work.
        if s.machineCode != "" {
                go func() {
                        c := NewClient(s.serverURL, "", hostname())
                        go handleSignals(cancel)
                        if err := c.RunUnattended(ctx, s.machineCode); err != nil {
                                log.Printf("[service] RunUnattended failed: %v", err)
                        }
                }()
        } else {
                log.Printf("[service] Running in Session 0 mode (no screen capture). " +
                        "User-session helper should be launched via scheduled task.")
        }

        // Give the goroutine a moment to start, then report RUNNING.
        // This must happen well within the 30s SCM timeout.
        time.Sleep(500 * time.Millisecond)
        changes <- svc.Status{State: svc.Running, Accepts: svc.AcceptStop | svc.AcceptShutdown}
        log.Printf("[service] MarqueeIT service is running (pid=%d)", os.Getpid())

        // Block here, processing SCM control requests, until we get Stop/Shutdown.
        for {
                cr := <-r
                switch cr.Cmd {
                case svc.Interrogate:
                        // SCM is checking we're still alive — echo back the current status.
                        changes <- cr.CurrentStatus
                case svc.Stop, svc.Shutdown:
                        log.Printf("[service] Received %v, shutting down...", cr.Cmd)
                        cancel()
                        changes <- svc.Status{State: svc.StopPending}
                        return false, 0
                }
        }
}

// runAsWindowsService is called from main() when --unattended is specified
// and we detect we're running under the SCM (i.e., started by the service
// manager, not interactively). It blocks until the service stops.
func runAsWindowsService(serverURL, machineCode string) error {
        return svc.Run("MarqueeIT", &marqueeITService{
                serverURL:   serverURL,
                machineCode: machineCode,
        })
}

// isWindowsService returns true if the current process was started by the
// Windows Service Control Manager (i.e., we're running as a service).
// If false, we're running interactively (double-clicked, command line, etc.)
// and should NOT call svc.Run (which would fail with an error).
func isWindowsService() bool {
        is, err := svc.IsWindowsService()
        if err != nil {
                return false
        }
        return is
}
