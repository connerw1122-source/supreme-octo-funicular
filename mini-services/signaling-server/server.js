// MarqueeIT Signaling Server (Node.js + ws)
// Run with: node index.js

const http = require('http')
const { WebSocketServer, WebSocket } = require('ws')

const peersByRoom = new Map() // roomCode -> Map<peerId, ws>

function getRoom(code) {
  if (!peersByRoom.has(code)) peersByRoom.set(code, new Map())
  return peersByRoom.get(code)
}

function listRoomPeers(code, excludeId) {
  return Array.from(getRoom(code).entries())
    .filter(([id]) => id !== excludeId)
    .map(([id, ws]) => ({
      id,
      role: ws.data.role,
      name: ws.data.name,
      joinedAt: ws.data.joinedAt,
    }))
}

function broadcastPresence(code) {
  const peers = listRoomPeers(code)
  const text = JSON.stringify({ type: 'presence', peers })
  getRoom(code).forEach((ws) => {
    try {
      if (ws.readyState === WebSocket.OPEN) ws.send(text)
    } catch (e) {}
  })
}

function relayToRoom(code, message, excludeId) {
  getRoom(code).forEach((ws, id) => {
    if (id === excludeId) return
    try {
      if (ws.readyState === WebSocket.OPEN) ws.send(message)
    } catch (e) {}
  })
}

function joinRoom(ws, roomCode, role, name) {
  const code = roomCode.toUpperCase().trim()
  const d = ws.data
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
    type: 'peer-joined',
    id: d.peerId,
    role,
    name,
    joinedAt: d.joinedAt,
  }), d.peerId)
  if (role === 'customer') {
    relayToRoom(code, JSON.stringify({ type: 'stream-ready', from: d.peerId }), d.peerId)
  }
  broadcastPresence(code)
}

const httpServer = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('ok')
    return
  }
  res.writeHead(404)
  res.end('Not found')
})

const wss = new WebSocketServer({ noServer: true })

httpServer.on('upgrade', (req, socket, head) => {
  console.log(`[http] upgrade ${req.url}`)
  const code = (req.headers['x-marqueeit-code'] || '').toUpperCase().trim()
  const name = req.headers['x-marqueeit-name'] || ''
  const role = req.headers['x-marqueeit-role'] || 'customer'

  const data = {
    role,
    name,
    roomCode: code,
    peerId: `peer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    joinedAt: Date.now(),
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.data = data
    // For Go client (with headers), join immediately
    if (code) {
      joinRoom(ws, code, role, name || 'Customer')
    }
    // For browser, wait for join-room message
    setupWsHandlers(ws)
  })
})

function setupWsHandlers(ws) {
  ws.on('message', (msg, isBinary) => {
    try {
      const d = ws.data
      if (isBinary) {
        // Binary = JPEG screen frame
        if (d.roomCode) {
          // Convert Buffer to Uint8Array for consistent behavior
          const u8 = new Uint8Array(msg)
          relayToRoom(d.roomCode, u8, d.peerId)
        }
        return
      }

      const m = JSON.parse(msg.toString())
      if (m.type === 'join-room' && m.roomCode) {
        joinRoom(ws, m.roomCode, m.role || 'customer', m.name || 'Peer')
        return
      }
      if (m.type === 'chat' && d.roomCode) {
        relayToRoom(d.roomCode, JSON.stringify({
          type: 'chat-message',
          id: Math.random().toString(36).slice(2),
          sender: m.sender || d.name,
          content: m.content,
          timestamp: new Date().toISOString(),
        }), d.peerId)
        return
      }
      if (m.type === 'input-event' && d.roomCode) {
        relayToRoom(d.roomCode, JSON.stringify({
          type: 'input-event',
          payload: m.payload || m,
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
      if (m.type === 'stream-ready' && d.roomCode) {
        relayToRoom(d.roomCode, JSON.stringify({ type: 'stream-ready', from: d.peerId }), d.peerId)
        return
      }
      // Relay machine-specs from customer to technician
      if (m.type === 'machine-specs' && d.roomCode) {
        relayToRoom(d.roomCode, JSON.stringify(m), d.peerId)
        return
      }
    } catch (err) {
      console.error('[ws] message error:', err)
    }
  })

  ws.on('close', () => {
    try {
      const d = ws.data
      if (d && d.roomCode) {
        getRoom(d.roomCode).delete(d.peerId)
        relayToRoom(d.roomCode, JSON.stringify({ type: 'peer-left', id: d.peerId, name: d.name }))
        broadcastPresence(d.roomCode)
        console.log(`[ws] ${d.name} left room ${d.roomCode}`)
      }
    } catch (err) {
      console.error('[ws] close error:', err)
    }
  })

  ws.on('error', (err) => {
    console.error('[ws] socket error:', err)
  })
}

const PORT = 3003
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Signaling server running on port ${PORT} (Node.js + ws)`)
})

process.on('SIGTERM', () => {
  httpServer.close(() => process.exit(0))
})
process.on('SIGINT', () => {
  httpServer.close(() => process.exit(0))
})
