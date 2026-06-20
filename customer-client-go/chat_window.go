package main

// Customer chat window — a small floating browser window that shows
// chat messages from the technician, like ScreenConnect.
//
// The Go client runs a tiny HTTP server on a random localhost port.
// When a chat message arrives, it opens the system browser to
// http://localhost:PORT/ which serves a minimal HTML chat page.
// The page connects to a local WebSocket for real-time message delivery.
//
// The browser window is opened with window features that make it small
// and keep it on top (via JavaScript).

import (
        "encoding/json"
        "fmt"
        "net"
        "net/http"
        "os/exec"
        "runtime"
        "sync"
        "time"

        "github.com/gorilla/websocket"
)

var (
        chatServerOnce sync.Once
        chatPort       int
        chatMessages   = make(chan ChatMsg, 100)
        chatOpen       bool
        chatMu         sync.Mutex
)

type ChatMsg struct {
        Sender  string `json:"sender"`
        Content string `json:"content"`
        Time    string `json:"time"`
}

// startChatServer starts the local HTTP server for the customer chat window.
// It's called once on the first chat message.
func startChatServer() {
        chatServerOnce.Do(func() {
                // Find a free port
                listener, err := net.Listen("tcp", "127.0.0.1:0")
                if err != nil {
                        return
                }
                chatPort = listener.Addr().(*net.TCPAddr).Port

                http.HandleFunc("/", serveChatPage)
                http.HandleFunc("/ws", serveChatWS)

                go http.Serve(listener, nil)
        })
}

// deliverChatMessage sends a message to the chat window (if open) and
// opens the window if it's not already open.
func deliverChatMessage(sender, content string) {
        startChatServer()

        msg := ChatMsg{
                Sender:  sender,
                Content: content,
                Time:    fmt.Sprintf("%s", currentTime()),
        }

        chatMu.Lock()
        alreadyOpen := chatOpen
        chatMu.Unlock()

        if !alreadyOpen {
                openChatWindow()
        }

        // Send to any connected WebSocket clients
        select {
        case chatMessages <- msg:
        default:
        }
}

func openChatWindow() {
        chatMu.Lock()
        chatOpen = true
        chatMu.Unlock()

        url := fmt.Sprintf("http://127.0.0.1:%d/", chatPort)
        openBrowser(url)
}

// openBrowser opens the default browser to the given URL.
func openBrowser(url string) {
        switch runtime.GOOS {
        case "windows":
                exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
        case "darwin":
                exec.Command("open", url).Start()
        default:
                exec.Command("xdg-open", url).Start()
        }
}

func currentTime() string {
        return time.Now().Format("3:04 PM")
}

var chatUpgrader = websocket.Upgrader{
        CheckOrigin: func(r *http.Request) bool { return true },
}

func serveChatWS(w http.ResponseWriter, r *http.Request) {
        ws, err := chatUpgrader.Upgrade(w, r, nil)
        if err != nil {
                return
        }
        defer ws.Close()

        // Read loop — receives replies from the customer
        go func() {
                for {
                        var msg ChatMsg
                        err := ws.ReadJSON(&msg)
                        if err != nil {
                                return
                        }
                        // Send the customer's reply to the technician via the main WebSocket
                        // The signaling server expects { type: "chat", sender, content }
                        if globalClient != nil {
                                reply := map[string]interface{}{
                                        "type":    "chat",
                                        "sender":  globalClient.name,
                                        "content": msg.Content,
                                }
                                data, _ := json.Marshal(reply)
                                globalClient.connMu.Lock()
                                if globalClient.conn != nil {
                                        globalClient.conn.WriteMessage(1, data)
                                }
                                globalClient.connMu.Unlock()
                        }
                }
        }()

        // Write loop — sends technician messages to the chat window
        for msg := range chatMessages {
                ws.WriteJSON(msg)
        }
}

func serveChatPage(w http.ResponseWriter, r *http.Request) {
        w.Header().Set("Content-Type", "text/html; charset=utf-8")
        fmt.Fprint(w, chatPageHTML)
}

const chatPageHTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>MarqueeIT Chat</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  background: #1a1a2e; color: #eee; font-family: 'Segoe UI', Arial, sans-serif;
  height: 100vh; display: flex; flex-direction: column; overflow: hidden;
}
#header {
  background: #1B3A6B; color: #FFC425; padding: 10px 16px; font-weight: bold;
  font-size: 14px; display: flex; align-items: center; gap: 8px;
  border-bottom: 2px solid #FFC425;
}
#header .dot { width: 8px; height: 8px; border-radius: 50%; background: #4ade80; }
#messages {
  flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px;
}
.msg {
  max-width: 80%; padding: 8px 12px; border-radius: 12px; font-size: 13px;
  word-wrap: break-word; line-height: 1.4;
}
.msg.tech {
  background: #1B3A6B; color: #fff; align-self: flex-start; border-bottom-left-radius: 4px;
}
.msg.me {
  background: #2d4a22; color: #fff; align-self: flex-end; border-bottom-right-radius: 4px;
}
.msg .sender { font-size: 10px; opacity: 0.7; margin-bottom: 2px; }
.msg .time { font-size: 9px; opacity: 0.5; margin-top: 2px; text-align: right; }
#input-bar {
  display: flex; gap: 8px; padding: 10px; background: #16213e; border-top: 1px solid #333;
}
#msg-input {
  flex: 1; background: #0f3460; border: 1px solid #333; color: #eee;
  padding: 8px 12px; border-radius: 8px; font-size: 13px; outline: none;
}
#msg-input:focus { border-color: #FFC425; }
#send-btn {
  background: #1B3A6B; color: #FFC425; border: none; padding: 8px 16px;
  border-radius: 8px; cursor: pointer; font-weight: bold; font-size: 13px;
}
#send-btn:hover { background: #0F2A52; }
.scroll-thin::-webkit-scrollbar { width: 4px; }
.scroll-thin::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }
</style>
</head>
<body>
<div id="header"><span class="dot"></span> MarqueeIT Support Chat</div>
<div id="messages" class="scroll-thin"></div>
<div id="input-bar">
  <input id="msg-input" placeholder="Type a reply..." autocomplete="off" autofocus>
  <button id="send-btn" onclick="send()">Send</button>
</div>
<script>
const ws = new WebSocket('ws://' + location.host + '/ws');
const msgArea = document.getElementById('messages');
const input = document.getElementById('msg-input');

ws.onmessage = function(e) {
  const msg = JSON.parse(e.data);
  addMessage(msg.sender, msg.content, msg.time, msg.sender === 'You' ? 'me' : 'tech');
};

function addMessage(sender, content, time, cls) {
  const div = document.createElement('div');
  div.className = 'msg ' + cls;
  div.innerHTML = '<div class="sender">' + escapeHtml(sender) + '</div>' +
                  '<div>' + escapeHtml(content) + '</div>' +
                  '<div class="time">' + escapeHtml(time || '') + '</div>';
  msgArea.appendChild(div);
  msgArea.scrollTop = msgArea.scrollHeight;
}

function send() {
  const text = input.value.trim();
  if (!text) return;
  ws.send(JSON.stringify({sender: 'You', content: text}));
  addMessage('You', text, '', 'me');
  input.value = '';
}

input.addEventListener('keydown', function(e) {
  if (e.key === 'Enter') send();
});

function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

// Try to keep window focused and small
window.moveTo(screen.width - 360, screen.height - 500);
window.resizeTo(340, 440);
</script>
</body>
</html>`
