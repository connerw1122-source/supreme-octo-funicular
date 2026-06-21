package main

// Plain-WebSocket-based customer client for MarqueeIT.
//
// Architecture:
// - The Next.js app exposes /api/ws/[code] as a plain WebSocket endpoint.
// - The Go customer client connects to that endpoint, sends screen frames
//   as binary JPEG, receives input events as JSON text messages.
// - The technician's browser connects to the SAME endpoint via the
//   existing socket.io signaling server (no changes needed there) - actually
//   no, we'll have the technician also use the plain WS endpoint for screen
//   frames. The browser session-view.tsx will switch from WebRTC to plain
//   WebSocket for the screen stream.
//
// This is intentionally simple. We avoid WebRTC entirely for the screen
// stream because:
// 1. No browser-Go WebRTC interop headaches
// 2. No video codec negotiation
// 3. Server-side proxying keeps the architecture simple
// 4. Latency over LAN is fine for an IT support tool
// 5. Single-binary Go client has no CGO dependencies

import (
        "bytes"
        "context"
        "encoding/json"
        "flag"
        "fmt"
        "image"
        "image/jpeg"
        "io"
        "log"
        "net/http"
        "net/url"
        "os"
        "os/exec"
        "os/signal"
        "path/filepath"
        "runtime"
        "strings"
        "sync"
        "syscall"
        "time"

        "github.com/gorilla/websocket"
        "github.com/kbinani/screenshot"
)

// Version is set at build time via -ldflags
var Version = "dev"

// DefaultServer is the server URL baked in at build time.
// Override with: -ldflags "-X main.DefaultServer=https://your-domain.com"
// This is CRITICAL: without it, the customer's binary doesn't know where
// to connect and fails silently.
var DefaultServer = "https://support.wizardyoda.com"

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

type Client struct {
        serverURL string
        code      string
        name      string
        hostname  string
        os        string
        conn      *websocket.Conn
        connMu    sync.Mutex
        ctx       context.Context
        cancel    context.CancelFunc
        wg        sync.WaitGroup
        // unattended state
        machineCode string
        unattended  bool
}

func NewClient(serverURL, code, name string) *Client {
        c := &Client{
                serverURL: strings.TrimRight(serverURL, "/"),
                code:      strings.ToUpper(strings.TrimSpace(code)),
                name:      name,
                hostname:  hostname(),
                os:        runtime.GOOS + " " + runtime.GOARCH,
        }
        globalClient = c
        return c
}

func (c *Client) Log(format string, args ...interface{}) {
        log.Printf("[client] "+format, args...)
}

// ---------------------------------------------------------------------------
// Connect to the WebSocket endpoint
// ---------------------------------------------------------------------------

func (c *Client) Connect() error {
        // Try to mark the session as active in the database (best-effort).
        if !strings.Contains(c.serverURL, ":3003") {
                joinURL := fmt.Sprintf("%s/api/sessions/%s/join", c.serverURL, c.code)
                body, _ := json.Marshal(map[string]string{"customerName": c.name})
                resp, err := http.Post(joinURL, "application/json", bytes.NewReader(body))
                if err != nil {
                        c.Log("Warning: could not mark session as active: %v", err)
                } else {
                        resp.Body.Close()
                }
        }

        // Build WebSocket URL
        wsURL := strings.Replace(c.serverURL, "http://", "ws://", 1)
        wsURL = strings.Replace(wsURL, "https://", "wss://", 1)
        if u, err := url.Parse(wsURL); err == nil {
                switch u.Port() {
                case "", "80", "443":
                        u.Path = "/"
                        u.RawQuery = ""
                        wsURL = u.String()
                case "81", "3000":
                        u.Host = u.Hostname() + ":3003"
                        u.Path = "/"
                        u.RawQuery = ""
                        wsURL = u.String()
                }
        }

        c.Log("Connecting to %s ...", wsURL)
        hdr := http.Header{}
        hdr.Set("X-Marqueeit-Code", c.code)
        hdr.Set("X-Marqueeit-Name", c.name)
        hdr.Set("X-Marqueeit-Role", "customer")
        // Send machine specs via headers so the server has them immediately
        specs := collectMachineSpecs()
        hdr.Set("X-Marqueeit-Os", specs.OS)
        hdr.Set("X-Marqueeit-Hostname", specs.Hostname)
        hdr.Set("X-Marqueeit-Cpu", specs.CPU)
        hdr.Set("X-Marqueeit-Ram", specs.RAM)
        hdr.Set("X-Marqueeit-Screen", specs.Screen)
        hdr.Set("X-Marqueeit-Arch", specs.Arch)

        dialer := websocket.Dialer{
                HandshakeTimeout: 10 * time.Second,
        }
        conn, _, err := dialer.Dial(wsURL, hdr)
        if err != nil {
                return fmt.Errorf("ws dial: %w", err)
        }
        c.connMu.Lock()
        c.conn = conn
        c.connMu.Unlock()
        c.Log("Connected")

        // Send machine specs as a JSON message too (for the browser to display)
        specsMsg, _ := json.Marshal(map[string]interface{}{
                "type":     "machine-specs",
                "os":       specs.OS,
                "hostname": specs.Hostname,
                "cpu":      specs.CPU,
                "ram":      specs.RAM,
                "screen":   specs.Screen,
                "arch":     specs.Arch,
        })
        conn.WriteMessage(websocket.TextMessage, specsMsg)

        // Start the screen stream
        c.wg.Add(1)
        go c.screenLoop()

        // Read incoming messages
        c.wg.Add(1)
        go c.readLoop()

        return nil
}

// ---------------------------------------------------------------------------
// Screen capture & streaming
// ---------------------------------------------------------------------------

func (c *Client) screenLoop() {
        defer c.wg.Done()

        c.Log("Streaming screen at ~30 FPS (adjustable via set-quality)")

        firstFrameSent := false
        for {
                select {
                case <-c.ctx.Done():
                        return
                case <-time.After(time.Duration(targetFPS) * time.Millisecond):
                        // Use desktop-aware capture (handles lock screen on Windows)
                        var img *image.RGBA
                        var err error
                        if runtime.GOOS == "windows" {
                                img, err = captureScreenWindows()
                        } else {
                                monIdx := currentMonitor
                                if monIdx >= screenshot.NumActiveDisplays() {
                                        monIdx = 0
                                }
                                img, err = screenshot.CaptureDisplay(monIdx)
                        }
                        if err != nil {
                                c.Log("Capture error: %v", err)
                                continue
                        }
                        var buf bytes.Buffer
                        if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: jpegQuality}); err != nil {
                                c.Log("JPEG encode error: %v", err)
                                continue
                        }
                        c.connMu.Lock()
                        if c.conn == nil {
                                c.connMu.Unlock()
                                return
                        }
                        err = c.conn.WriteMessage(websocket.BinaryMessage, buf.Bytes())
                        c.connMu.Unlock()
                        if err != nil {
                                c.Log("Write error: %v", err)
                                return
                        }
                        // On the first successful frame, signal readiness to the
                        // OLD process (if any) via the marker file. This lets the
                        // elevation handoff complete cleanly without a black screen.
                        if !firstFrameSent {
                                firstFrameSent = true
                                signalReadyMarker()
                        }
                }
        }
}

// signalReadyMarker writes a marker file (path from MARQUEEIT_READY_MARKER env
// var) so the OLD process knows the NEW one is streaming. No-op if the env var
// is not set (normal first-run, no elevation in progress).
func signalReadyMarker() {
        markerPath := os.Getenv("MARQUEEIT_READY_MARKER")
        if markerPath == "" {
                return
        }
        // Write a small marker file. Content doesn't matter — existence is the signal.
        if err := os.WriteFile(markerPath, []byte("ready"), 0644); err == nil {
                log.Printf("[client] Wrote ready marker: %s", markerPath)
        }
        // Clear the env var so we don't keep writing it on reconnects.
        os.Unsetenv("MARQUEEIT_READY_MARKER")
}

// ---------------------------------------------------------------------------
// Read loop — handle incoming JSON input events
// ---------------------------------------------------------------------------

func (c *Client) readLoop() {
        defer c.wg.Done()
        for {
                select {
                case <-c.ctx.Done():
                        return
                default:
                }
                c.connMu.Lock()
                conn := c.conn
                c.connMu.Unlock()
                if conn == nil {
                        return
                }
                _, data, err := conn.ReadMessage()
                if err != nil {
                        if !isClosedErr(err) {
                                c.Log("Read error: %v", err)
                        }
                        c.shutdown()
                        return
                }
                // Parse the envelope. Messages look like:
                //   { "type": "input-event", "payload": { "type": "mouse_move", ... } }
                //   { "type": "chat", "sender": "...", "content": "..." }
                //   { "type": "session-ended" }
                var envelope struct {
                        Type    string          `json:"type"`
                        Payload json.RawMessage `json:"payload"`
                        Sender  string          `json:"sender"`
                        Content string          `json:"content"`
                }
                if err := json.Unmarshal(data, &envelope); err != nil {
                        continue
                }

                switch envelope.Type {
                case "input-event", "input":
                        var event InputEvent
                        if len(envelope.Payload) > 0 {
                                if err := json.Unmarshal(envelope.Payload, &event); err == nil {
                                        HandleInput(event)
                                }
                        } else {
                                // Maybe the whole envelope is the event itself
                                if err := json.Unmarshal(data, &event); err == nil && event.Type != "" {
                                        HandleInput(event)
                                }
                        }
                case "chat", "chat-message":
                        c.Log("[chat] %s: %s", envelope.Sender, envelope.Content)
                        // Show in the on-screen overlay window (no browser)
                        showChatOverlay(envelope.Sender, envelope.Content)
                case "annotation":
                        // Highlight annotation from the technician — show a ring
                        // overlay on the customer's screen at the given coords.
                        var annot struct {
                                X     float64 `json:"x"`
                                Y     float64 `json:"y"`
                                Label string  `json:"label"`
                        }
                        if err := json.Unmarshal(data, &annot); err == nil {
                                showAnnotation(annot.X, annot.Y, annot.Label)
                        }
                case "clear-annotations":
                        hideAnnotationOverlay()
                case "session-ended", "end-session":
                        c.Log("Session ended by technician")
                        c.shutdown()
                        return
                case "self-uninstall":
                        c.Log("Received self-uninstall command from technician")
                        c.shutdown()
                        selfUninstall()
                        return
                default:
                        // Try to parse as a system command (clipboard, lock, CMD, etc.)
                        var sysMsg map[string]interface{}
                        if err := json.Unmarshal(data, &sysMsg); err == nil {
                                if sysType, ok := sysMsg["type"].(string); ok {
                                        switch sysType {
                                        case "clipboard-set", "clipboard-get", "clipboard-keystrokes", "lock-input", "unlock-input",
                                                "lock-screen", "unlock-screen", "send-cad", "exec-command",
                                                "list-processes", "kill-process", "list-monitors", "switch-monitor",
                                                "set-quality", "get-sysinfo", "reboot",
                                                "recording-start", "recording-stop",
                                                "install-unattended", "elevate-session", "remove-unattended",
                                                "get-event-logs",
                                                "set-uac-secure-desktop", "get-uac-secure-desktop":
                                                HandleSystemCommand(sysMsg)
                                        }
                                }
                        }
                }
        }
}

func isClosedErr(err error) bool {
        if err == nil {
                return false
        }
        s := err.Error()
        return strings.Contains(s, "close") || strings.Contains(s, "EOF") || strings.Contains(s, "use of closed")
}

// ---------------------------------------------------------------------------
// Shutdown
// ---------------------------------------------------------------------------

func (c *Client) shutdown() {
        c.Log("Shutting down...")
        if c.cancel != nil {
                c.cancel()
        }
        c.connMu.Lock()
        if c.conn != nil {
                c.conn.Close()
                c.conn = nil
        }
        c.connMu.Unlock()
}

func (c *Client) Run(ctx context.Context) error {
        c.ctx, c.cancel = context.WithCancel(ctx)
        if err := c.Connect(); err != nil {
                c.cancel() // prevent context leak on connect failure
                return err
        }
        <-c.ctx.Done()
        c.shutdown()
        c.wg.Wait()
        return nil
}

// ---------------------------------------------------------------------------
// Unattended mode
// ---------------------------------------------------------------------------

func (c *Client) RunUnattended(ctx context.Context, machineCode string) error {
        c.unattended = true
        c.machineCode = strings.ToUpper(strings.TrimSpace(machineCode))
        c.ctx, c.cancel = context.WithCancel(ctx)

        // Register with retry (network might not be ready on boot)
        var registered bool
        for i := 0; i < 12; i++ { // retry for up to 60 seconds
                registerURL := fmt.Sprintf("%s/api/unattended/%s/register", c.serverURL, c.machineCode)
                body, _ := json.Marshal(map[string]string{"hostname": c.hostname, "os": c.os})
                resp, err := http.Post(registerURL, "application/json", bytes.NewReader(body))
                if err == nil && resp.StatusCode < 400 {
                        resp.Body.Close()
                        registered = true
                        break
                }
                if resp != nil {
                        resp.Body.Close()
                }
                c.Log("Registration attempt %d failed, retrying in 5s...", i+1)
                select {
                case <-ctx.Done():
                        return nil
                case <-time.After(5 * time.Second):
                }
        }
        if !registered {
                return fmt.Errorf("failed to register after 12 attempts")
        }

        c.Log("Unattended mode registered. Machine code: %s", c.machineCode)

        // Install autostart as backup (in case the service doesn't start)
        installAutostart(c.serverURL, c.machineCode)

        // Heartbeat loop — reconnect on failure
        for {
                select {
                case <-ctx.Done():
                        return nil
                default:
                }

                // Heartbeat
                pending, err := c.heartbeat()
                if err != nil {
                        c.Log("heartbeat error: %v, retrying in 5s...", err)
                        select {
                        case <-ctx.Done():
                                return nil
                        case <-time.After(5 * time.Second):
                        }
                        continue
                }

                if pending != "" {
                        c.Log("Technician is connecting with session %s", pending)
                        c.code = pending
                        // Mark session as active
                        joinURL := fmt.Sprintf("%s/api/sessions/%s/join", c.serverURL, pending)
                        joinBody, _ := json.Marshal(map[string]string{"customerName": c.hostname})
                        http.Post(joinURL, "application/json", bytes.NewReader(joinBody))

                        // Start a normal client session
                        subCtx, subCancel := context.WithCancel(ctx)
                        if err := c.Run(subCtx); err != nil {
                                c.Log("Session ended: %v", err)
                        }
                        subCancel()
                        c.ctx, c.cancel = context.WithCancel(ctx)
                        c.Log("Session ended. Listening for new connections...")
                }

                select {
                case <-ctx.Done():
                        return nil
                case <-time.After(5 * time.Second):
                }
        }
}

func (c *Client) heartbeat() (string, error) {
        url := fmt.Sprintf("%s/api/unattended/%s/heartbeat", c.serverURL, c.machineCode)
        body, _ := json.Marshal(map[string]string{"hostname": c.hostname, "os": c.os})
        resp, err := http.Post(url, "application/json", bytes.NewReader(body))
        if err != nil {
                return "", err
        }
        defer resp.Body.Close()
        if resp.StatusCode != 200 {
                return "", fmt.Errorf("status %d", resp.StatusCode)
        }
        var result struct {
                Ok                 bool   `json:"ok"`
                PendingSessionCode string `json:"pendingSessionCode"`
                PendingSessionID   string `json:"pendingSessionId"`
        }
        if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
                return "", err
        }
        return result.PendingSessionCode, nil
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

func main() {
        log.SetFlags(log.LstdFlags | log.Lmicroseconds)
        log.SetPrefix("[marqueeit] ")

        var (
                code         string
                name         string
                server       string
                unattended   string
                unattendedSvc string
                install      string
                uninstall    bool
                showVer      bool
                readyMarker  string
                elevatedLog  string
        )
        flag.StringVar(&code, "code", "", "6-character session code (will prompt if omitted)")
        flag.StringVar(&name, "name", "", "Your name (will prompt if omitted)")
        flag.StringVar(&server, "server", DefaultServer, "MarqueeIT server URL")
        flag.StringVar(&unattended, "unattended", "", "Run in unattended mode (provide machine code)")
        flag.StringVar(&unattendedSvc, "unattended-svc", "", "Run as the SYSTEM service (Session 0) — just launches the user-session helper and waits")
        flag.StringVar(&install, "install", "", "Install as a persistent service with the given machine code")
        flag.BoolVar(&uninstall, "uninstall", false, "Uninstall the persistent service")
        flag.BoolVar(&showVer, "version", false, "Print version and exit")
        flag.StringVar(&readyMarker, "ready-marker", "", "Path to a marker file to write when the first frame is sent (used during elevation handoff)")
        flag.StringVar(&elevatedLog, "elevated-log", "", "Path to a log file for elevation progress diagnostics")
        flag.Parse()

        if showVer {
                fmt.Printf("MarqueeIT client %s (%s/%s)\n", Version, runtime.GOOS, runtime.GOARCH)
                return
        }

        if env := os.Getenv("MARQUEEIT_SERVER"); env != "" {
                server = env
        }

        // Stash the marker path for signalReadyMarker() to use after the first
        // frame is sent. If empty, signalReadyMarker() is a no-op.
        if readyMarker != "" {
                os.Setenv("MARQUEEIT_READY_MARKER", readyMarker)
                log.Printf("[client] Ready marker path set: %s", readyMarker)
        }
        // Open an elevated-log file if requested. We write progress lines to it
        // so the OLD process can report what happened if elevation fails.
        if elevatedLog != "" {
                f, err := os.OpenFile(elevatedLog, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
                if err == nil {
                        defer f.Close()
                        log.SetOutput(io.MultiWriter(os.Stderr, f))
                        log.Printf("[client] Elevated process started (pid=%d)", os.Getpid())
                        log.Printf("[client] code=%s server=%s marker=%s", code, server, readyMarker)
                } else {
                        log.Printf("[client] Could not open elevated log file %s: %v", elevatedLog, err)
                }
        }

        // --install: install as a persistent service
        if install != "" {
                if err := installService(install, server); err != nil {
                        log.Fatalf("Install failed: %v", err)
                }
                fmt.Println("Service installed successfully. It will start on boot.")
                return
        }

        // --uninstall: remove the persistent service
        if uninstall {
                if err := uninstallService(); err != nil {
                        log.Fatalf("Uninstall failed: %v", err)
                }
                fmt.Println("Service uninstalled successfully.")
                return
        }

        // Try to read session config from:
        // 1. A trailer appended to the end of this binary (MARQUEEIT_CONFIG{...}\n)
        // 2. session.json in the binary's directory
        // 3. The binary's filename (legacy fallback)
        if code == "" && name == "" && unattended == "" {
                // First try the embedded trailer
                if config := readEmbeddedConfig(); config != nil {
                        code = config.Code
                        name = config.Name
                        if server == DefaultServer && config.Server != "" {
                                server = config.Server
                        }
                        log.Printf("Loaded embedded config: code=%s server=%s", code, server)
                }
                // Then try session.json
                if code == "" {
                        if config := readSessionConfig(); config != nil {
                                code = config.Code
                                name = config.Name
                                if server == DefaultServer && config.Server != "" {
                                        server = config.Server
                                }
                                log.Printf("Loaded session.json config: code=%s server=%s", code, server)
                        }
                }
                // Then try extracting from filename (legacy)
                if code == "" {
                        if fc := extractCodeFromFilename(); fc != "" {
                                code = fc
                                log.Printf("Extracted code from filename: %s", code)
                        }
                }
        }

        // --unattended-svc: We're running as the SYSTEM service in Session 0.
        // We can't capture the screen from here (Session 0 is isolated from the
        // user's desktop). Our only job is to launch the user-session helper,
        // then block forever so the SCM thinks we're running.
        //
        // The session bridge uses CreateProcessAsUserW to launch the helper
        // directly in the user's interactive session (Session 1+). This is
        // more reliable than the scheduled task approach because it works
        // immediately (no logon required) and gives us a process we can monitor.
        if unattendedSvc != "" {
                if isWindowsService() {
                        log.Printf("[svc] MarqueeIT service started (Session 0, machine code %s)", unattendedSvc)
                        // Try the session bridge first (most reliable)
                        exe, _ := os.Executable()
                        if pid, err := launchHelperInUserSession(exe, fmt.Sprintf("--unattended %s --server %s", unattendedSvc, server)); err != nil {
                                log.Printf("[svc] Session bridge failed: %v — falling back to scheduled task", err)
                                // Fallback: run the scheduled task
                                exec.Command("schtasks", "/run", "/tn", "MarqueeIT").Start()
                        } else {
                                log.Printf("[svc] Launched user-session helper (pid=%d)", pid)
                        }
                        // Block forever — the SCM will kill us on stop/shutdown.
                        // We use the SCM wrapper so we respond to control requests.
                        if err := runAsWindowsService("", ""); err != nil {
                                log.Fatalf("Service failed: %v", err)
                        }
                        return
                }
                // If not running as a service (e.g., manual test), just run unattended
                unattended = unattendedSvc
        }

        if unattended != "" {
                if len(unattended) < 4 {
                        fmt.Fprintln(os.Stderr, "Invalid machine code")
                        os.Exit(1)
                }
                // If we were launched by the Windows Service Control Manager
                // (i.e., we're running as a service), use the SCM wrapper so
                // we report SERVICE_RUNNING within the 30-second SCM timeout.
                // Otherwise the SCM kills us with Error 7000/7009.
                if isWindowsService() {
                        log.Printf("[client] Running under Windows SCM — starting service wrapper")
                        if err := runAsWindowsService(server, unattended); err != nil {
                                log.Fatalf("Service failed: %v", err)
                        }
                        return
                }
                // Interactive run (double-clicked, command line, scheduled task)
                c := NewClient(server, "", hostname())
                ctx, cancel := context.WithCancel(context.Background())
                defer cancel()
                go handleSignals(cancel)
                if err := c.RunUnattended(ctx, unattended); err != nil {
                        log.Fatalf("Unattended mode failed: %v", err)
                }
                return
        }

        if code == "" {
                // Can't prompt for code — there's no console with -H windowsgui.
                // Show a message box explaining the problem.
                showMessageBox("MarqueeIT",
                        "This program needs to be downloaded from your technician's support page.\n\n"+
                                "Please ask your technician for the download link and try again.\n\n"+
                                "If you already downloaded it from the link, make sure the filename hasn't been renamed — it should look like \"marqueeit-ABC123.exe\" with your session code in it.")
                os.Exit(1)
        }
        if name == "" {
                name = hostname()
        }
        if len(code) < 4 {
                showMessageBox("MarqueeIT", "Invalid session code in filename.\nPlease re-download from your technician's support page.")
                os.Exit(1)
        }

        c := NewClient(server, code, name)
        ctx, cancel := context.WithCancel(context.Background())
        defer cancel()
        go handleSignals(cancel)

        if err := c.Run(ctx); err != nil {
                showMessageBox("MarqueeIT", "Could not connect to your technician.\n\nError: "+err.Error()+
                        "\n\nPlease check your internet connection and try again, or call your technician.")
                os.Exit(1)
        }
}

// SessionConfig is the JSON structure the binary reads from session.json
// in its own directory. This lets the customer double-click the binary
// without any command-line arguments — the config file has everything.
type SessionConfig struct {
        Code   string `json:"code"`
        Name   string `json:"name"`
        Server string `json:"server"`
}

// readSessionConfig looks for session.json in the same directory as the
// binary and returns its contents, or nil if not found.
func readSessionConfig() *SessionConfig {
        exe, err := os.Executable()
        if err != nil {
                return nil
        }
        dir := filepath.Dir(exe)
        configPath := filepath.Join(dir, "session.json")
        data, err := os.ReadFile(configPath)
        if err != nil {
                return nil
        }
        var config SessionConfig
        if err := json.Unmarshal(data, &config); err != nil {
                return nil
        }
        if config.Code == "" {
                return nil
        }
        return &config
}

// readEmbeddedConfig reads a config trailer appended to the end of this
// binary. The trailer format is:
//   MARQUEEIT_CONFIG{"code":"ABC123","name":"Margaret","server":"https://..."}\n
//
// Go binaries ignore extra data after the executable, so this is safe.
// This is the primary config mechanism — the server appends it when serving
// the binary for download, so every download has the correct session code
// and server URL embedded. The filename doesn't matter.
func readEmbeddedConfig() *SessionConfig {
        exe, err := os.Executable()
        if err != nil {
                return nil
        }
        data, err := os.ReadFile(exe)
        if err != nil {
                return nil
        }
        // Search for the trailer prefix from the end of the file
        trailerPrefix := "MARQUEEIT_CONFIG"
        idx := strings.LastIndex(string(data), trailerPrefix)
        if idx == -1 {
                return nil
        }
        // Extract from the prefix to the next newline
        rest := string(data[idx+len(trailerPrefix):])
        newlineIdx := strings.IndexByte(rest, '\n')
        if newlineIdx == -1 {
                newlineIdx = len(rest)
        }
        jsonStr := strings.TrimSpace(rest[:newlineIdx])
        var config SessionConfig
        if err := json.Unmarshal([]byte(jsonStr), &config); err != nil {
                return nil
        }
        if config.Code == "" {
                return nil
        }
        return &config
}

// extractCodeFromFilename reads the session code from the binary's own
// filename. e.g. "marqueeit-AHC6E.exe" -> "AHC6E".
// This lets the customer download a single .exe with the code baked into
// the filename — no launcher, no second download, no config file.
func extractCodeFromFilename() string {
        exe, err := os.Executable()
        if err != nil {
                return ""
        }
        base := filepath.Base(exe)
        name := strings.TrimSuffix(base, filepath.Ext(base))
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

func handleSignals(cancel context.CancelFunc) {
        ch := make(chan os.Signal, 1)
        signal.Notify(ch, os.Interrupt, syscall.SIGTERM)
        <-ch
        fmt.Println("\nShutting down...")
        cancel()
}

func hostname() string {
        h, err := os.Hostname()
        if err != nil {
                return "unknown"
        }
        return h
}

// installAutostart installs a system-level autostart entry for unattended mode.
// Failures are logged but non-fatal.
func installAutostart(serverURL, machineCode string) {
        exe, err := os.Executable()
        if err != nil {
                log.Printf("autostart: cannot find executable path: %v", err)
                return
        }

        switch runtime.GOOS {
        case "windows":
                log.Printf("autostart: to install on Windows, add registry entry under HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run:")
                log.Printf("  %s --unattended %s --server %s", exe, machineCode, serverURL)
        case "darwin":
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
                if err := os.MkdirAll(filepath.Dir(plistPath), 0755); err == nil {
                        if err := os.WriteFile(plistPath, []byte(plist), 0644); err == nil {
                                log.Printf("autostart: installed launchd plist at %s", plistPath)
                        }
                }
        case "linux":
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
                if err := os.MkdirAll(filepath.Dir(unitPath), 0755); err == nil {
                        if err := os.WriteFile(unitPath, []byte(unit), 0644); err == nil {
                                log.Printf("autostart: installed systemd user unit at %s", unitPath)
                                log.Printf("autostart: enable with: systemctl --user enable --now marqueeit-unattended.service")
                        }
                }
        }
}
