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
        "os/signal"
        "path/filepath"
        "runtime"
        "strconv"
        "strings"
        "sync"
        "syscall"
        "time"

        "github.com/gorilla/websocket"
        "github.com/kbinani/screenshot"
)

// Version is set at build time via -ldflags
var Version = "dev"

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DefaultServer = "http://localhost:81"

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
        return &Client{
                serverURL: strings.TrimRight(serverURL, "/"),
                code:      strings.ToUpper(strings.TrimSpace(code)),
                name:      name,
                hostname:  hostname(),
                os:        runtime.GOOS + " " + runtime.GOARCH,
        }
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

        rect := image.Rect(0, 0, 1920, 1080)
        if probe, err := screenshot.CaptureDisplay(0); err == nil {
                rect = probe.Bounds()
        }
        c.Log("Streaming screen at %dx%d, ~30 FPS", rect.Dx(), rect.Dy())

        ticker := time.NewTicker(33 * time.Millisecond) // ~30 FPS
        defer ticker.Stop()

        for {
                select {
                case <-c.ctx.Done():
                        return
                case <-ticker.C:
                        img, err := screenshot.CaptureDisplay(0)
                        if err != nil {
                                c.Log("Capture error: %v", err)
                                continue
                        }
                        var buf bytes.Buffer
                        if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 55}); err != nil {
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
                }
        }
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
                case "session-ended", "end-session":
                        c.Log("Session ended by technician")
                        c.shutdown()
                        return
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

        // Register
        registerURL := fmt.Sprintf("%s/api/unattended/%s/register", c.serverURL, c.machineCode)
        body, _ := json.Marshal(map[string]string{"hostname": c.hostname, "os": c.os})
        resp, err := http.Post(registerURL, "application/json", bytes.NewReader(body))
        if err != nil {
                return fmt.Errorf("register: %w", err)
        }
        if resp.StatusCode >= 400 {
                b, _ := io.ReadAll(resp.Body)
                resp.Body.Close()
                return fmt.Errorf("register failed (%d): %s", resp.StatusCode, string(b))
        }
        resp.Body.Close()

        fmt.Printf("\nMarqueeIT unattended access set up on this machine.\n")
        fmt.Printf("  Machine code: %s\n", c.machineCode)
        fmt.Printf("  Hostname:     %s\n", c.hostname)
        fmt.Printf("  OS:           %s\n", c.os)
        fmt.Printf("\nYour technician can connect any time from the MarqueeIT dashboard.\n")
        fmt.Printf("Press Ctrl+C to stop.\n\n")

        installAutostart(c.serverURL, c.machineCode)

        ticker := time.NewTicker(5 * time.Second)
        defer ticker.Stop()

        for {
                select {
                case <-ctx.Done():
                        return nil
                case <-ticker.C:
                        pending, err := c.heartbeat()
                        if err != nil {
                                c.Log("heartbeat error: %v", err)
                                continue
                        }
                        if pending != "" {
                                c.Log("Technician is connecting with session %s", pending)
                                c.code = pending
                                // Run a normal client session
                                subCtx, subCancel := context.WithCancel(ctx)
                                if err := c.Run(subCtx); err != nil {
                                        c.Log("Connect failed: %v", err)
                                }
                                subCancel()
                                // Reset for next session
                                c.ctx, c.cancel = context.WithCancel(ctx)
                                c.Log("Session ended. Listening for new connections...")
                        }
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
                code       string
                name       string
                server     string
                unattended string
                showVer    bool
        )
        flag.StringVar(&code, "code", "", "6-character session code (will prompt if omitted)")
        flag.StringVar(&name, "name", "", "Your name (will prompt if omitted)")
        flag.StringVar(&server, "server", DefaultServer, "MarqueeIT server URL")
        flag.StringVar(&unattended, "unattended", "", "Run in unattended mode (provide machine code)")
        flag.BoolVar(&showVer, "version", false, "Print version and exit")
        flag.Parse()

        if showVer {
                fmt.Printf("MarqueeIT client %s (%s/%s)\n", Version, runtime.GOOS, runtime.GOARCH)
                return
        }

        if env := os.Getenv("MARQUEEIT_SERVER"); env != "" {
                server = env
        }

        // Try to read session.json from the binary's directory.
        // This is the no-command-line-args path: the customer downloads a zip
        // with the binary + session.json, double-clicks the binary, and it
        // reads the config automatically.
        if code == "" && name == "" && unattended == "" {
                if config := readSessionConfig(); config != nil {
                        if code == "" {
                                code = config.Code
                        }
                        if name == "" {
                                name = config.Name
                        }
                        if server == DefaultServer && config.Server != "" {
                                server = config.Server
                        }
                        log.Printf("Loaded session config: code=%s server=%s", code, server)
                }
        }

        if unattended != "" {
                if len(unattended) < 4 {
                        fmt.Fprintln(os.Stderr, "Invalid machine code")
                        os.Exit(1)
                }
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
                fmt.Print("Enter your 6-character session code: ")
                fmt.Scanln(&code)
        }
        if name == "" {
                // Default to hostname. Customers don't need to type their name —
                // the launcher passes it via --name if they entered it on the
                // landing page. If they skipped the name field, we just use
                // the machine's hostname so the technician has something to call them.
                name = hostname()
        }
        if len(code) < 4 {
                fmt.Fprintln(os.Stderr, "Invalid code")
                os.Exit(1)
        }

        c := NewClient(server, code, name)
        ctx, cancel := context.WithCancel(context.Background())
        defer cancel()
        go handleSignals(cancel)

        if err := c.Run(ctx); err != nil {
                log.Fatalf("Client error: %v", err)
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

// trick to keep the strconv import used (for future key code conversions)
var _ = strconv.Itoa
