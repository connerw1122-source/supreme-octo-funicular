'use client'

import { io, Socket } from 'socket.io-client'
import { useCallback, useEffect, useRef, useState } from 'react'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type Role = 'technician' | 'customer'

export interface Peer {
  id: string
  role: Role
  name: string
  joinedAt: number
}

export interface ChatMessage {
  id: string
  sender: string
  content: string
  timestamp: string
}

export interface FileMeta {
  fileId: string
  name: string
  size: number
  mime: string
  fromPeerId: string
}

export interface Annotation {
  id: string
  x: number // 0..1 (relative)
  y: number // 0..1
  label?: string
  createdAt: number
}

interface UseSessionOptions {
  roomCode: string
  role: Role
  name: string
  // Customer mode only: a MediaStream to send (e.g. getDisplayMedia)
  localStream?: MediaStream | null
  // Called when the remote track arrives (technician view)
  onRemoteStream?: (stream: MediaStream) => void
  // Called when a chat message arrives through the data channel
  onChatMessage?: (msg: ChatMessage) => void
  // Called when an annotation arrives
  onAnnotation?: (a: Annotation) => void
  // Called when peer presence changes
  onPeers?: (peers: Peer[]) => void
  // Called when a file is incoming (metadata)
  onFileMeta?: (meta: FileMeta) => void
  // Called for file progress (0..1)
  onFileProgress?: (fileId: string, progress: number) => void
  // Called when a file has been fully received
  onFileComplete?: (fileId: string, blob: Blob) => void
  // Called when the session has been ended by anyone
  onSessionEnded?: () => void
}

// ---------------------------------------------------------------------------
// Signaling + WebRTC hook
// ---------------------------------------------------------------------------

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
]

const DATA_CHANNEL_LABEL = 'remotehelp-data'

export function useSession(opts: UseSessionOptions) {
  const {
    roomCode,
    role,
    name,
    localStream,
    onRemoteStream,
    onChatMessage,
    onAnnotation,
    onPeers,
    onFileMeta,
    onFileProgress,
    onFileComplete,
    onSessionEnded,
  } = opts

  const socketRef = useRef<Socket | null>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const dcRef = useRef<RTCDataChannel | null>(null)
  // Keep latest callbacks in refs so we don't have to re-run the effect on every render
  const cbRefs = useRef({
    onRemoteStream,
    onChatMessage,
    onAnnotation,
    onPeers,
    onFileMeta,
    onFileProgress,
    onFileComplete,
    onSessionEnded,
  })
  useEffect(() => {
    cbRefs.current = {
      onRemoteStream,
      onChatMessage,
      onAnnotation,
      onPeers,
      onFileMeta,
      onFileProgress,
      onFileComplete,
      onSessionEnded,
    }
  })

  const localStreamRef = useRef<MediaStream | null>(null)
  useEffect(() => {
    localStreamRef.current = localStream ?? null
    // If the customer's stream changes mid-call, re-negotiate by replacing tracks
    if (pcRef.current && localStream) {
      const senders = pcRef.current.getSenders()
      const newTracks = localStream.getTracks()
      senders.forEach((sender) => {
        if (sender.track?.kind === 'video') {
          const newVid = newTracks.find((t) => t.kind === 'video')
          if (newVid) sender.replaceTrack(newVid)
        }
        if (sender.track?.kind === 'audio') {
          const newAud = newTracks.find((t) => t.kind === 'audio')
          if (newAud) sender.replaceTrack(newAud)
        }
      })
    }
  }, [localStream])

  const [connected, setConnected] = useState(false)
  const [peers, setPeers] = useState<Peer[]>([])
  const [iceState, setIceState] = useState<'new' | 'connecting' | 'connected' | 'failed' | 'disconnected' | 'closed'>('new')
  const [error, setError] = useState<string | null>(null)

  // Incoming file buffers, keyed by fileId
  const incomingFiles = useRef<Map<string, { meta: FileMeta; chunks: ArrayBuffer[]; received: number }>>(new Map())

  // -------------------------------------------------------------------------
  // Data channel message handlers (defined before wireDataChannel so they
  // can be safely referenced inside the onmessage closure)
  // -------------------------------------------------------------------------
  const handleDataChannelMessage = useCallback((msg: any) => {
    if (msg.type === 'chat') {
      cbRefs.current.onChatMessage?.({
        id: msg.id ?? Math.random().toString(36).slice(2),
        sender: msg.sender,
        content: msg.content,
        timestamp: msg.timestamp ?? new Date().toISOString(),
      })
    } else if (msg.type === 'annotation') {
      cbRefs.current.onAnnotation?.({
        id: msg.id ?? Math.random().toString(36).slice(2),
        x: msg.x,
        y: msg.y,
        label: msg.label,
        createdAt: Date.now(),
      })
    } else if (msg.type === 'clear-annotations') {
      // Emit an empty annotation as a clear signal
      cbRefs.current.onAnnotation?.({ id: '__clear__', x: -1, y: -1, createdAt: Date.now() })
    } else if (msg.type === 'file-meta') {
      const meta: FileMeta = {
        fileId: msg.fileId,
        name: msg.name,
        size: msg.size,
        mime: msg.mime,
        fromPeerId: msg.fromPeerId ?? 'unknown',
      }
      incomingFiles.current.set(meta.fileId, { meta, chunks: [], received: 0 })
      cbRefs.current.onFileMeta?.(meta)
    } else if (msg.type === 'file-end') {
      const entry = incomingFiles.current.get(msg.fileId)
      if (entry) {
        const blob = new Blob(entry.chunks, { type: entry.meta.mime || 'application/octet-stream' })
        cbRefs.current.onFileComplete?.(msg.fileId, blob)
        incomingFiles.current.delete(msg.fileId)
      }
    }
  }, [])

  const handleBinaryChunk = useCallback((buf: ArrayBuffer) => {
    const view = new DataView(buf)
    const fileIdLen = view.getUint32(0)
    let offset = 4
    const decoder = new TextDecoder()
    const fileId = decoder.decode(new Uint8Array(buf, offset, fileIdLen))
    offset += fileIdLen
    const payload = buf.slice(offset)
    const entry = incomingFiles.current.get(fileId)
    if (!entry) return
    entry.chunks.push(payload)
    entry.received += payload.byteLength
    const progress = entry.meta.size > 0 ? Math.min(1, entry.received / entry.meta.size) : 0
    cbRefs.current.onFileProgress?.(fileId, progress)
  }, [])

  const wireDataChannel = useCallback((dc: RTCDataChannel) => {
    dcRef.current = dc
    dc.binaryType = 'arraybuffer'

    dc.onopen = () => {
      console.log('[dc] open')
    }
    dc.onclose = () => {
      console.log('[dc] closed')
    }
    dc.onerror = (e) => {
      console.error('[dc] error', e)
    }

    dc.onmessage = (e) => {
      const data = e.data
      if (typeof data === 'string') {
        // JSON control message
        try {
          const msg = JSON.parse(data)
          handleDataChannelMessage(msg)
        } catch (err) {
          console.warn('[dc] non-JSON text message', data)
        }
      } else if (data instanceof ArrayBuffer) {
        // Binary chunk - format: 4-byte fileId length, fileId string, payload bytes
        handleBinaryChunk(data)
      }
    }
  }, [handleDataChannelMessage, handleBinaryChunk])

  // -------------------------------------------------------------------------
  // Build (or rebuild) the RTCPeerConnection
  // -------------------------------------------------------------------------
  const buildPeerConnection = useCallback(() => {
    if (pcRef.current) return pcRef.current
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    pcRef.current = pc

    pc.oniceconnectionstatechange = () => {
      setIceState(pc.iceConnectionState as any)
    }

    pc.ontrack = (e) => {
      const stream = e.streams[0]
      cbRefs.current.onRemoteStream?.(stream)
    }

    pc.onicecandidate = (e) => {
      if (e.candidate && socketRef.current) {
        // Send to all peers in the room (we typically have just one)
        peers.forEach((p) => {
          socketRef.current!.emit('webrtc-ice', { to: p.id, candidate: e.candidate!.toJSON() })
        })
      }
    }

    // If we're the customer, add local tracks BEFORE creating the offer
    if (role === 'customer' && localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => {
        pc.addTrack(t, localStreamRef.current!)
      })
    }

    // Data channel: technician creates it, customer receives it
    if (role === 'technician') {
      const dc = pc.createDataChannel(DATA_CHANNEL_LABEL, { ordered: true })
      wireDataChannel(dc)
    }
    pc.ondatachannel = (e) => {
      wireDataChannel(e.channel)
    }

    return pc
  }, [role, peers, wireDataChannel])

  // -------------------------------------------------------------------------
  // WebRTC negotiation
  // -------------------------------------------------------------------------
  const initiateOffer = useCallback(async (toPeerId: string) => {
    const pc = buildPeerConnection()
    try {
      const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true })
      await pc.setLocalDescription(offer)
      socketRef.current?.emit('webrtc-offer', { to: toPeerId, sdp: offer })
    } catch (err) {
      console.error('[webrtc] createOffer error', err)
      setError('Failed to create offer')
    }
  }, [buildPeerConnection])

  const handleOffer = useCallback(async (from: string, sdp: RTCSessionDescriptionInit) => {
    const pc = buildPeerConnection()
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp))
      // If we're the customer, make sure our local tracks are added
      if (role === 'customer' && localStreamRef.current) {
        const senders = pc.getSenders()
        const existing = new Set(senders.map((s) => s.track?.id))
        localStreamRef.current.getTracks().forEach((t) => {
          if (!existing.has(t.id)) pc.addTrack(t, localStreamRef.current!)
        })
      }
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      socketRef.current?.emit('webrtc-answer', { to: from, sdp: answer })
    } catch (err) {
      console.error('[webrtc] handleOffer error', err)
      setError('Failed to handle offer')
    }
  }, [buildPeerConnection, role])

  const handleAnswer = useCallback(async (_from: string, sdp: RTCSessionDescriptionInit) => {
    const pc = pcRef.current
    if (!pc) return
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp))
    } catch (err) {
      console.error('[webrtc] handleAnswer error', err)
    }
  }, [])

  const handleIce = useCallback(async (_from: string, candidate: RTCIceCandidateInit) => {
    const pc = pcRef.current
    if (!pc) return
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate))
    } catch (err) {
      console.warn('[webrtc] addIceCandidate error', err)
    }
  }, [])

  // -------------------------------------------------------------------------
  // Socket lifecycle
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!roomCode) return

    const socket = io('/?XTransformPort=3003', {
      transports: ['websocket', 'polling'],
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: 8,
      reconnectionDelay: 1000,
      timeout: 10000,
    })
    socketRef.current = socket

    socket.on('connect', () => {
      setConnected(true)
      socket.emit('join-room', { roomCode, role, name })
    })
    socket.on('disconnect', () => setConnected(false))

    socket.on('joined-room', (payload: { peers: Peer[] }) => {
      setPeers(payload.peers)
      cbRefs.current.onPeers?.(payload.peers)
      // If we're the technician and a customer is already here, offer to them
      if (role === 'technician' && payload.peers.length > 0) {
        initiateOffer(payload.peers[0].id)
      }
    })

    socket.on('peer-joined', (peer: Peer) => {
      setPeers((prev) => {
        const next = prev.some((p) => p.id === peer.id) ? prev : [...prev, peer]
        cbRefs.current.onPeers?.(next)
        return next
      })
      // If we're the technician and a customer just joined, wait for their "stream-ready"
      // signal before sending an offer. This avoids creating an offer with no tracks.
    })

    socket.on('peer-left', (peer: { id: string }) => {
      setPeers((prev) => {
        const next = prev.filter((p) => p.id !== peer.id)
        cbRefs.current.onPeers?.(next)
        return next
      })
    })

    socket.on('presence', (payload: { peers: Peer[] }) => {
      setPeers(payload.peers.filter((p) => p.id !== socket.id))
      cbRefs.current.onPeers?.(payload.peers.filter((p) => p.id !== socket.id))
    })

    socket.on('stream-ready', (payload: { from: string }) => {
      // Technician initiates the offer when customer signals readiness
      if (role === 'technician') {
        initiateOffer(payload.from)
      }
    })

    socket.on('webrtc-offer', (payload: { from: string; sdp: RTCSessionDescriptionInit }) => {
      handleOffer(payload.from, payload.sdp)
    })
    socket.on('webrtc-answer', (payload: { from: string; sdp: RTCSessionDescriptionInit }) => {
      handleAnswer(payload.from, payload.sdp)
    })
    socket.on('webrtc-ice', (payload: { from: string; candidate: RTCIceCandidateInit }) => {
      handleIce(payload.from, payload.candidate)
    })

    // Out-of-band chat relay (used before/instead of DC)
    socket.on('chat-message', (msg: ChatMessage) => {
      cbRefs.current.onChatMessage?.(msg)
    })

    socket.on('annotation', (a: any) => {
      cbRefs.current.onAnnotation?.({
        id: Math.random().toString(36).slice(2),
        x: a.x,
        y: a.y,
        label: a.label,
        createdAt: Date.now(),
      })
    })

    socket.on('clear-annotations', () => {
      cbRefs.current.onAnnotation?.({ id: '__clear__', x: -1, y: -1, createdAt: Date.now() })
    })

    socket.on('file-meta', (m: any) => {
      const meta: FileMeta = {
        fileId: m.fileId,
        name: m.name,
        size: m.size,
        mime: m.mime,
        fromPeerId: m.from,
      }
      incomingFiles.current.set(meta.fileId, { meta, chunks: [], received: 0 })
      cbRefs.current.onFileMeta?.(meta)
    })

    socket.on('file-complete', (m: { fileId: string }) => {
      cbRefs.current.onFileComplete?.(m.fileId, new Blob())
    })

    socket.on('session-ended', () => {
      cbRefs.current.onSessionEnded?.()
    })

    socket.on('error-message', (e: { message: string }) => {
      setError(e.message)
    })

    return () => {
      socket.disconnect()
      socketRef.current = null
      if (pcRef.current) {
        pcRef.current.close()
        pcRef.current = null
      }
      dcRef.current = null
    }
  }, [roomCode, role, name])

  // -------------------------------------------------------------------------
  // Public actions
  // -------------------------------------------------------------------------

  const sendChat = useCallback((sender: string, content: string) => {
    const msg = {
      type: 'chat',
      id: Math.random().toString(36).slice(2),
      sender,
      content,
      timestamp: new Date().toISOString(),
    }
    // Send via data channel if open, else fall back to socket
    if (dcRef.current && dcRef.current.readyState === 'open') {
      dcRef.current.send(JSON.stringify(msg))
    } else {
      socketRef.current?.emit('chat-message', { sender, content })
    }
  }, [])

  const sendAnnotation = useCallback((x: number, y: number, label?: string) => {
    const msg = { type: 'annotation', id: Math.random().toString(36).slice(2), x, y, label }
    if (dcRef.current && dcRef.current.readyState === 'open') {
      dcRef.current.send(JSON.stringify(msg))
    } else {
      socketRef.current?.emit('annotation', { x, y, label })
    }
  }, [])

  const clearAnnotations = useCallback(() => {
    if (dcRef.current && dcRef.current.readyState === 'open') {
      dcRef.current.send(JSON.stringify({ type: 'clear-annotations' }))
    } else {
      socketRef.current?.emit('clear-annotations')
    }
  }, [])

  // Customer: signal that the screen-share stream is ready
  const signalStreamReady = useCallback(() => {
    socketRef.current?.emit('stream-ready', {})
  }, [])

  // Send a file via the data channel (chunked)
  const sendFile = useCallback(async (file: File) => {
    const dc = dcRef.current
    if (!dc || dc.readyState !== 'open') {
      setError('Data channel is not open')
      return
    }
    const fileId = Math.random().toString(36).slice(2)
    const meta = {
      type: 'file-meta',
      fileId,
      name: file.name,
      size: file.size,
      mime: file.type,
      fromPeerId: socketRef.current?.id ?? 'me',
    }
    dc.send(JSON.stringify(meta))

    // Also notify via socket so the recipient's UI can show progress even if DC is slow
    peers.forEach((p) => {
      socketRef.current?.emit('file-meta', {
        to: p.id,
        fileId,
        name: file.name,
        size: file.size,
        mime: file.type,
      })
    })

    // Read file in chunks of 16KB (keep well under 16K SCTP safe size minus header)
    const CHUNK = 16 * 1024
    const encoder = new TextEncoder()
    const fileIdBytes = encoder.encode(fileId)
    const header = new ArrayBuffer(4 + fileIdBytes.length)
    const view = new DataView(header)
    view.setUint32(0, fileIdBytes.length)
    new Uint8Array(header, 4).set(fileIdBytes)
    const headerBytes = new Uint8Array(header)

    let offset = 0
    while (offset < file.size) {
      const slice = file.slice(offset, Math.min(offset + CHUNK, file.size))
      const buf = await slice.arrayBuffer()
      // Combine header + payload into one ArrayBuffer
      const combined = new Uint8Array(headerBytes.length + buf.byteLength)
      combined.set(headerBytes, 0)
      combined.set(new Uint8Array(buf), headerBytes.length)
      // Wait for buffer to drain if needed
      if (dc.bufferedAmount > 4 * 1024 * 1024) {
        await new Promise<void>((resolve) => {
          const interval = setInterval(() => {
            if (dc.bufferedAmount < 1 * 1024 * 1024) {
              clearInterval(interval)
              resolve()
            }
          }, 50)
        })
      }
      dc.send(combined.buffer)
      offset += buf.byteLength
    }

    // Signal end
    dc.send(JSON.stringify({ type: 'file-end', fileId }))
    peers.forEach((p) => {
      socketRef.current?.emit('file-complete', { to: p.id, fileId })
    })
  }, [peers])

  const endSession = useCallback(() => {
    socketRef.current?.emit('end-session')
  }, [])

  // -------------------------------------------------------------------------
  // Remote control input events
  // -------------------------------------------------------------------------
  // The technician sends these to the customer's native client (which uses
  // pyautogui to inject them). Coordinates are RELATIVE [0..1] so they work
  // regardless of the customer's screen resolution. All events flow over the
  // data channel for lowest latency. Returns true if sent, false if the
  // channel wasn't ready.
  const sendInput = useCallback((event: Record<string, any>): boolean => {
    const dc = dcRef.current
    if (!dc || dc.readyState !== 'open') {
      return false
    }
    try {
      dc.send(JSON.stringify(event))
      return true
    } catch (err) {
      console.warn('[dc] sendInput error', err)
      return false
    }
  }, [])

  // Convenience helpers for the most common input events
  const sendMouseMove = useCallback((x: number, y: number) => {
    return sendInput({ type: 'mouse_move', x, y })
  }, [sendInput])

  const sendMouseDown = useCallback((x: number, y: number, button: 'left' | 'right' | 'middle' = 'left') => {
    return sendInput({ type: 'mouse_down', x, y, button })
  }, [sendInput])

  const sendMouseUp = useCallback((button: 'left' | 'right' | 'middle' = 'left') => {
    return sendInput({ type: 'mouse_up', button })
  }, [sendInput])

  const sendMouseClick = useCallback((x: number, y: number, button: 'left' | 'right' | 'middle' = 'left') => {
    return sendInput({ type: 'mouse_click', x, y, button })
  }, [sendInput])

  const sendMouseScroll = useCallback((dx: number, dy: number) => {
    return sendInput({ type: 'mouse_scroll', dx, dy })
  }, [sendInput])

  const sendKeyDown = useCallback((key: string) => {
    return sendInput({ type: 'key_down', key })
  }, [sendInput])

  const sendKeyUp = useCallback((key: string) => {
    return sendInput({ type: 'key_up', key })
  }, [sendInput])

  const sendKeyPress = useCallback((key: string) => {
    return sendInput({ type: 'key_press', key })
  }, [sendInput])

  const sendKeyText = useCallback((text: string) => {
    return sendInput({ type: 'key_type', text })
  }, [sendInput])

  return {
    connected,
    peers,
    iceState,
    error,
    sendChat,
    sendAnnotation,
    clearAnnotations,
    signalStreamReady,
    sendFile,
    endSession,
    // Remote control
    sendInput,
    sendMouseMove,
    sendMouseDown,
    sendMouseUp,
    sendMouseClick,
    sendMouseScroll,
    sendKeyDown,
    sendKeyUp,
    sendKeyPress,
    sendKeyText,
    socket: socketRef,
    pc: pcRef,
    dc: dcRef,
  }
}
