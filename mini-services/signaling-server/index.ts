// MarqueeIT Signaling Server — Bun native WebSocket
// Uses Bun.serve with built-in WebSocket support for maximum stability.

interface WsData {
  role: 'technician' | 'customer'
  name: string
  roomCode: string
  peerId: string
  joinedAt: number
}

const peersByRoom = new Map<string, Map<string, any>>()

function getRoom(code: string) {
  if (!peersByRoom.has(code)) peersByRoom.set(code, new Map())
  return peersByRoom.get(code)!
}

function listRoomPeers(code: string, excludeId?: string) {
  return Array.from(getRoom(code).entries())
    .filter(([id]) => id !== excludeId)
    .map(([id, ws]) => {
      const d = ws.data as WsData
      return { id, role: d.role, name: d.name, joinedAt: d.joinedAt }
    })
}

function broadcastPresence(code: string) {
  const peers = listRoomPeers(code)
  const text = JSON.stringify({ type: 'presence', peers })
  getRoom(code).forEach((ws) => {
    try { if (ws.readyState === 1) ws.send(text) } catch {}
  })
}

function relayToRoom(code: string, message: string | Buffer, excludeId?: string) {
  getRoom(code).forEach((ws, id) => {
    if (id === excludeId) return
    try { if (ws.readyState === 1) ws.send(message) } catch {}
  })
}

// cleanupRoom removes the room from peersByRoom if it's empty.
// Called after a peer leaves to prevent unbounded memory growth.
function cleanupRoom(code: string) {
  const room = peersByRoom.get(code)
  if (room && room.size === 0) {
    peersByRoom.delete(code)
  }
}

function joinRoom(ws: any, roomCode: string, role: 'technician' | 'customer', name: string) {
  const code = roomCode.toUpperCase().trim()
  const d = ws.data as WsData
  if (d.roomCode && d.roomCode !== code) {
    getRoom(d.roomCode).delete(d.peerId)
    relayToRoom(d.roomCode, JSON.stringify({ type: 'peer-left', id: d.peerId, name: d.name }))
    broadcastPresence(d.roomCode)
  }
  d.roomCode = code
  d.role = role
  d.name = name
  getRoom(code).set(d.peerId, ws)
  console.log(`[ws] ${name} (${role}) joined room ${code}`)
  const peers = listRoomPeers(code, d.peerId)
  ws.send(JSON.stringify({ type: 'joined-room', peers }))
  relayToRoom(code, JSON.stringify({
    type: 'peer-joined', id: d.peerId, role, name, joinedAt: d.joinedAt,
  }), d.peerId)
  if (role === 'customer') {
    relayToRoom(code, JSON.stringify({ type: 'stream-ready', from: d.peerId }), d.peerId)
  }
  broadcastPresence(code)
}

const server = Bun.serve({
  port: Number(process.env.PORT) || 3003,
  hostname: process.env.HOSTNAME || '0.0.0.0',
  fetch(req, srv) {
    const code = (req.headers.get('x-marqueeit-code') || '').toUpperCase().trim()
    const name = req.headers.get('x-marqueeit-name') || ''
    const role = (req.headers.get('x-marqueeit-role') || 'customer') as 'technician' | 'customer'
    const data: WsData = {
      role, name, roomCode: code,
      peerId: `peer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      joinedAt: Date.now(),
    }
    if (srv.upgrade(req, { data })) return
    if (req.url.includes('/health')) return new Response('ok')
    return new Response('MarqueeIT Signaling Server', { status: 200 })
  },
  websocket: {
    open(ws) {
      const d = ws.data as WsData
      if (d.roomCode) joinRoom(ws, d.roomCode, d.role, d.name || 'Customer')
    },
    message(ws, msg) {
      try {
        const d = ws.data as WsData
        if (typeof msg === 'string') {
          const m = JSON.parse(msg)
          if (m.type === 'join-room' && m.roomCode) {
            joinRoom(ws, m.roomCode, m.role || 'customer', m.name || 'Peer')
            return
          }
          if (m.type === 'chat' && d.roomCode) {
            relayToRoom(d.roomCode, JSON.stringify({
              type: 'chat-message', id: Math.random().toString(36).slice(2),
              sender: m.sender || d.name, content: m.content,
              timestamp: new Date().toISOString(),
            }), d.peerId)
            return
          }
          if (m.type === 'input-event' && d.roomCode) {
            relayToRoom(d.roomCode, JSON.stringify({
              type: 'input-event', payload: m.payload || m,
            }), d.peerId)
            return
          }
          if (m.type === 'annotation' && d.roomCode) {
            relayToRoom(d.roomCode, JSON.stringify({ type: 'annotation', ...m }), d.peerId)
            return
          }
          if (m.type === 'clear-annotations' && d.roomCode) {
            relayToRoom(d.roomCode, JSON.stringify({ type: 'clear-annotations' }), d.peerId)
            return
          }
          if (m.type === 'end-session' && d.roomCode) {
            relayToRoom(d.roomCode, JSON.stringify({ type: 'session-ended' }), d.peerId)
            return
          }
          if (m.type === 'self-uninstall' && d.roomCode) {
            relayToRoom(d.roomCode, JSON.stringify({ type: 'self-uninstall' }), d.peerId)
            return
          }
          if (m.type === 'stream-ready' && d.roomCode) {
            relayToRoom(d.roomCode, JSON.stringify({ type: 'stream-ready', from: d.peerId }), d.peerId)
            return
          }
          if (m.type === 'machine-specs' && d.roomCode) {
            relayToRoom(d.roomCode, JSON.stringify(m), d.peerId)
            return
          }
          // --- Relay all system commands to the customer ---
          // These are commands FROM the technician TO the customer
          const systemCommandTypes = [
            'clipboard-set', 'clipboard-get', 'clipboard-keystrokes', 'lock-input', 'unlock-input',
            'lock-screen', 'unlock-screen', 'send-cad', 'exec-command',
            'list-processes', 'kill-process', 'list-monitors', 'switch-monitor',
            'set-quality', 'get-sysinfo', 'reboot',
            'recording-start', 'recording-stop',
            'install-unattended', 'elevate-session', 'remove-unattended',
            'get-event-logs',
            'set-uac-secure-desktop', 'get-uac-secure-desktop',
          ]
          if (systemCommandTypes.includes(m.type) && d.roomCode) {
            relayToRoom(d.roomCode, JSON.stringify(m), d.peerId)
            return
          }
          // --- Relay responses FROM the customer TO the technician ---
          const responseTypes = [
            'clipboard-data', 'command-output', 'process-list',
            'monitor-list', 'sysinfo', 'recording-ack',
            'unattended-result', 'elevate-result',
            'event-logs',
            'uac-secure-desktop-result', 'uac-secure-desktop-status',
          ]
          if (responseTypes.includes(m.type) && d.roomCode) {
            relayToRoom(d.roomCode, JSON.stringify(m), d.peerId)
            return
          }
        } else {
          // Binary = screen frame
          if (d.roomCode) relayToRoom(d.roomCode, msg as Buffer, d.peerId)
        }
      } catch (err) {
        console.error('[ws] message error:', err)
      }
    },
    close(ws) {
      try {
        const d = ws.data as WsData
        if (d && d.roomCode) {
          getRoom(d.roomCode).delete(d.peerId)
          relayToRoom(d.roomCode, JSON.stringify({ type: 'peer-left', id: d.peerId, name: d.name }))
          broadcastPresence(d.roomCode)
          // Clean up empty rooms to prevent unbounded memory growth
          cleanupRoom(d.roomCode)
          console.log(`[ws] ${d.name} left room ${d.roomCode}`)
        }
      } catch (err) {
        console.error('[ws] close error:', err)
      }
    },
  },
})

console.log(`Signaling server on port 3003 (Bun native WS)`)

process.on('SIGTERM', () => { console.log('SIGTERM'); server.stop(); process.exit(0) })
process.on('SIGINT', () => { console.log('SIGINT'); server.stop(); process.exit(0) })
