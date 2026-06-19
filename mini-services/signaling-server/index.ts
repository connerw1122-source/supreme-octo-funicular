import { createServer } from 'http'
import { Server, Socket } from 'socket.io'

const httpServer = createServer()
const io = new Server(httpServer, {
  // DO NOT change the path - Caddy uses it for routing
  path: '/',
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 5 * 1024 * 1024, // 5MB for file chunks
})

// ---------------------------------------------------------------------------
// Room model
// ---------------------------------------------------------------------------
// A "room" is identified by the session code (e.g. "ABC123").
// Two roles can join a room:
//   - "technician" : the IT support agent viewing the customer's screen
//   - "customer"   : the client sharing their screen
// All WebRTC signaling (offer / answer / ICE) is relayed peer-to-peer inside
// the room. Data-channel messages (chat, file transfer, annotations) are
// also relayed through here as a fallback / out-of-band channel.

type Role = 'technician' | 'customer'

interface Peer {
  socket: Socket
  role: Role
  name: string
  roomCode: string
  joinedAt: number
}

const rooms = new Map<string, Map<string, Peer>>() // roomCode -> socketId -> Peer

function getRoom(code: string) {
  if (!rooms.has(code)) rooms.set(code, new Map())
  return rooms.get(code)!
}

function listPeers(code: string) {
  return Array.from(getRoom(code).values()).map((p) => ({
    id: p.socket.id,
    role: p.role,
    name: p.name,
    joinedAt: p.joinedAt,
  }))
}

function broadcastPresence(code: string) {
  io.to(code).emit('presence', { peers: listPeers(code) })
}

// ---------------------------------------------------------------------------
// Connection lifecycle
// ---------------------------------------------------------------------------

io.on('connection', (socket: Socket) => {
  console.log(`[io] connected ${socket.id}`)
  let currentRoom: string | null = null
  let currentRole: Role | null = null
  let currentName: string | null = null

  socket.on('join-room', (payload: { roomCode: string; role: Role; name: string }) => {
    const { roomCode, role, name } = payload
    if (!roomCode || !role || !name) {
      socket.emit('error-message', { message: 'Invalid join payload' })
      return
    }

    // Leave any prior room
    if (currentRoom) {
      socket.leave(currentRoom)
      const prevRoom = getRoom(currentRoom)
      prevRoom.delete(socket.id)
      broadcastPresence(currentRoom)
      io.to(currentRoom).emit('peer-left', { id: socket.id, name: currentName ?? '' })
    }

    currentRoom = roomCode.toUpperCase()
    currentRole = role
    currentName = name

    socket.join(currentRoom)
    const room = getRoom(currentRoom)
    room.set(socket.id, {
      socket,
      role,
      name,
      roomCode: currentRoom,
      joinedAt: Date.now(),
    })

    console.log(`[io] ${name} (${role}) joined room ${currentRoom}`)

    // Tell the joiner who's already there
    socket.emit('joined-room', { peers: listPeers(currentRoom).filter((p) => p.id !== socket.id) })

    // Tell everyone else
    socket.to(currentRoom).emit('peer-joined', {
      id: socket.id,
      role,
      name,
      joinedAt: Date.now(),
    })

    broadcastPresence(currentRoom)
  })

  // -------------------------------------------------------------------------
  // WebRTC signaling relay
  // -------------------------------------------------------------------------

  socket.on('webrtc-offer', (payload: { to: string; sdp: RTCSessionDescriptionInit }) => {
    io.to(payload.to).emit('webrtc-offer', { from: socket.id, sdp: payload.sdp })
  })

  socket.on('webrtc-answer', (payload: { to: string; sdp: RTCSessionDescriptionInit }) => {
    io.to(payload.to).emit('webrtc-answer', { from: socket.id, sdp: payload.sdp })
  })

  socket.on('webrtc-ice', (payload: { to: string; candidate: RTCIceCandidateInit }) => {
    io.to(payload.to).emit('webrtc-ice', { from: socket.id, candidate: payload.candidate })
  })

  // Customer tells the technician that the screen-share stream is ready,
  // so the technician can initiate the offer.
  socket.on('stream-ready', (payload: { to?: string }) => {
    if (!currentRoom) return
    if (payload.to) {
      io.to(payload.to).emit('stream-ready', { from: socket.id })
    } else {
      socket.to(currentRoom).emit('stream-ready', { from: socket.id })
    }
  })

  // -------------------------------------------------------------------------
  // Out-of-band data-channel fallback (chat / annotations / file metadata)
  // -------------------------------------------------------------------------

  socket.on('chat-message', (payload: { content: string; sender: string }) => {
    if (!currentRoom) return
    io.to(currentRoom).emit('chat-message', {
      id: Math.random().toString(36).slice(2, 10),
      sender: payload.sender,
      content: payload.content,
      timestamp: new Date().toISOString(),
    })
  })

  socket.on('annotation', (payload: { x: number; y: number; label?: string }) => {
    if (!currentRoom) return
    socket.to(currentRoom).emit('annotation', { from: socket.id, ...payload })
  })

  socket.on('clear-annotations', () => {
    if (!currentRoom) return
    socket.to(currentRoom).emit('clear-annotations')
  })

  // File transfer metadata - actual bytes flow over the WebRTC data channel,
  // but we broadcast the "I'm sending you a file" notice so the recipient UI
  // can prepare a progress entry.
  socket.on('file-meta', (payload: { to: string; fileId: string; name: string; size: number; mime: string }) => {
    io.to(payload.to).emit('file-meta', {
      from: socket.id,
      fileId: payload.fileId,
      name: payload.name,
      size: payload.size,
      mime: payload.mime,
    })
  })

  socket.on('file-complete', (payload: { to: string; fileId: string }) => {
    io.to(payload.to).emit('file-complete', { from: socket.id, fileId: payload.fileId })
  })

  // -------------------------------------------------------------------------
  // Session control events
  // -------------------------------------------------------------------------

  socket.on('request-control', () => {
    if (!currentRoom) return
    socket.to(currentRoom).emit('request-control', { from: socket.id })
  })

  socket.on('end-session', () => {
    if (!currentRoom) return
    io.to(currentRoom).emit('session-ended', { by: socket.id })
  })

  // -------------------------------------------------------------------------
  // Disconnect
  // -------------------------------------------------------------------------

  socket.on('leave-room', () => {
    if (!currentRoom) return
    socket.leave(currentRoom)
    const room = getRoom(currentRoom)
    room.delete(socket.id)
    broadcastPresence(currentRoom)
    io.to(currentRoom).emit('peer-left', { id: socket.id, name: currentName ?? '' })
    currentRoom = null
    currentRole = null
    currentName = null
  })

  socket.on('disconnect', () => {
    console.log(`[io] disconnected ${socket.id}`)
    if (currentRoom) {
      const room = getRoom(currentRoom)
      room.delete(socket.id)
      broadcastPresence(currentRoom)
      io.to(currentRoom).emit('peer-left', { id: socket.id, name: currentName ?? '' })
    }
  })

  socket.on('error', (err) => {
    console.error(`[io] socket error ${socket.id}:`, err)
  })
})

const PORT = 3003
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Signaling server running on port ${PORT}`)
})

process.on('SIGTERM', () => {
  console.log('SIGTERM, shutting down...')
  httpServer.close(() => process.exit(0))
})
process.on('SIGINT', () => {
  console.log('SIGINT, shutting down...')
  httpServer.close(() => process.exit(0))
})
