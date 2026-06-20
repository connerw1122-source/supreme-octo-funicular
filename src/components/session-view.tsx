'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  ArrowLeft,
  Send,
  PhoneOff,
  Monitor,
  Users,
  MessageSquare,
  FileText,
  Eraser,
  Maximize2,
  Minimize2,
  Copy,
  Check,
  Circle,
  AlertCircle,
  Hand,
  WifiOff,
  MousePointer2,
  Keyboard,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'

interface SessionViewProps {
  // Technician-only — customers use the native Go client.
  roomCode: string
  displayName: string
  sessionTitle: string
  sessionId: string
  onExit: () => void
  onEnded?: () => void
}

interface ChatMessage {
  id: string
  sender: string
  content: string
  timestamp: string
}

interface Peer {
  id: string
  role: string
  name: string
  kind?: string
  joinedAt?: number
}

interface Annotation {
  id: string
  x: number
  y: number
  label?: string
  createdAt: number
}

export function SessionView({
  roomCode,
  displayName,
  sessionTitle,
  sessionId,
  onExit,
  onEnded,
}: SessionViewProps) {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [peers, setPeers] = useState<Peer[]>([])
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [showAnnotationMode, setShowAnnotationMode] = useState(false)
  const [copiedCode, setCopiedCode] = useState(false)
  const [controlMode, setControlMode] = useState(false)
  const [lastInputSent, setLastInputSent] = useState<number>(0)
  const [connected, setConnected] = useState(false)
  const [customerConnected, setCustomerConnected] = useState(false)
  const [lastFrameAt, setLastFrameAt] = useState<number>(0)
  const [machineSpecs, setMachineSpecs] = useState<{
    os?: string
    hostname?: string
    cpu?: string
    ram?: string
    screen?: string
    arch?: string
  }>({})

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const drawFrameRef = useRef<(buffer: ArrayBuffer) => void>(() => {})
  const lastMouseMoveRef = useRef<number>(0)
  const pressedKeysRef = useRef<Set<string>>(new Set())
  const wsRef = useRef<WebSocket | null>(null)

  // -------------------------------------------------------------------------
  // Connect to signaling server via plain WebSocket (browser technician side)
  // -------------------------------------------------------------------------
  useEffect(() => {
    // Build the WebSocket URL.
    // - Production (port 80/443 via reverse proxy): connect to the same
    //   origin — the proxy routes WS upgrades to the signaling server.
    // - Sandbox/dev (port 3000 or 81): connect directly to port 3003.
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    let wsUrl: string
    const port = window.location.port
    if (port === '3000' || port === '81') {
      // Sandbox/dev: connect directly to the signaling server
      wsUrl = `${proto}//${window.location.hostname}:3003/`
    } else {
      // Production: same origin (reverse proxy handles WS routing)
      wsUrl = `${proto}//${window.location.host}/`
    }
    const ws = new WebSocket(wsUrl)
    ws.binaryType = 'arraybuffer'
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
      // Send join-room message to register
      ws.send(JSON.stringify({
        type: 'join-room',
        roomCode,
        role: 'technician',
        name: displayName,
      }))
    }

    ws.onclose = () => setConnected(false)
    ws.onerror = () => setConnected(false)

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        // Binary = JPEG screen frame
        setLastFrameAt(Date.now())
        drawFrameRef.current(event.data)
        return
      }
      // Text = JSON control message
      try {
        const msg = JSON.parse(event.data)
        switch (msg.type) {
          case 'joined-room':
            setPeers(msg.peers || [])
            setCustomerConnected((msg.peers || []).some((p: Peer) => p.role === 'customer'))
            break
          case 'peer-joined':
            setPeers((prev) => prev.some((p) => p.id === msg.id) ? prev : [...prev, msg])
            if (msg.role === 'customer') {
              setCustomerConnected(true)
              toast.success(`${msg.name} connected`)
            }
            break
          case 'peer-left':
            setPeers((prev) => {
              const next = prev.filter((p) => p.id !== msg.id)
              setCustomerConnected(next.some((p) => p.role === 'customer'))
              return next
            })
            break
          case 'presence':
            setPeers(msg.peers || [])
            setCustomerConnected((msg.peers || []).some((p: Peer) => p.role === 'customer'))
            break
          case 'chat-message':
            setChatMessages((prev) => [...prev, msg])
            break
          case 'annotation': {
            const annotation: Annotation = {
              id: Math.random().toString(36).slice(2),
              x: msg.x,
              y: msg.y,
              label: msg.label,
              createdAt: Date.now(),
            }
            setAnnotations((prev) => [...prev, annotation])
            setTimeout(() => {
              setAnnotations((prev) => prev.filter((x) => x.id !== annotation.id))
            }, 4000)
            break
          }
          case 'clear-annotations':
            setAnnotations([])
            break
          case 'session-ended':
            toast.info('Session ended')
            onEnded?.()
            break
          case 'machine-specs':
            setMachineSpecs({
              os: msg.os,
              hostname: msg.hostname,
              cpu: msg.cpu,
              ram: msg.ram,
              screen: msg.screen,
              arch: msg.arch,
            })
            break
        }
      } catch (err) {
        console.error('ws message parse error', err)
      }
    }

    return () => {
      ws.close()
      wsRef.current = null
    }
  }, [roomCode, displayName])

  // -------------------------------------------------------------------------
  // Draw a JPEG frame to the canvas
  // -------------------------------------------------------------------------
  const drawFrame = useCallback(async (buffer: ArrayBuffer) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    try {
      const blob = new Blob([buffer], { type: 'image/jpeg' })
      const bitmap = await createImageBitmap(blob)
      if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
        canvas.width = bitmap.width
        canvas.height = bitmap.height
      }
      ctx.drawImage(bitmap, 0, 0)
      bitmap.close()
    } catch (err) {
      console.error('drawFrame error', err)
    }
  }, [])

  // Keep latest drawFrame in a ref so the socket effect doesn't need it as a dep
  useEffect(() => {
    drawFrameRef.current = drawFrame
  }, [drawFrame])

  // -------------------------------------------------------------------------
  // Customer connection status (last frame within last 3 seconds)
  // -------------------------------------------------------------------------
  useEffect(() => {
    const interval = setInterval(() => {
      if (Date.now() - lastFrameAt > 3000 && customerConnected) {
        // Customer is connected but we haven't received a frame in 3s — could
        // be a temporary network issue. Don't auto-clear, just visually indicate.
      }
    }, 1000)
    return () => clearInterval(interval)
  }, [lastFrameAt, customerConnected])

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------
  const sendChat = () => {
    if (!chatInput.trim() || !wsRef.current) return
    wsRef.current.send(JSON.stringify({
      type: 'chat',
      sender: displayName,
      content: chatInput.trim(),
    }))
    setChatMessages((prev) => [
      ...prev,
      {
        id: Math.random().toString(36).slice(2),
        sender: displayName,
        content: chatInput.trim(),
        timestamp: new Date().toISOString(),
      },
    ])
    setChatInput('')
  }

  const getRelativeCoords = useCallback((e: React.MouseEvent | MouseEvent) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()

    // The canvas element may be larger than the actual image displayed
    // because of object-contain letterboxing. We need to compute the
    // actual displayed image area within the canvas.
    const canvasW = rect.width
    const canvasH = rect.height
    const imgW = canvas.width   // intrinsic image width (set by drawFrame)
    const imgH = canvas.height  // intrinsic image height

    if (imgW === 0 || imgH === 0) return null

    // Compute the scale and offset of the image within the canvas
    const scaleX = canvasW / imgW
    const scaleY = canvasH / imgH
    const scale = Math.min(scaleX, scaleY) // object-contain uses min

    // Displayed image dimensions
    const dispW = imgW * scale
    const dispH = imgH * scale

    // Offsets (letterbox borders)
    const offsetX = (canvasW - dispW) / 2
    const offsetY = (canvasH - dispH) / 2

    // Convert mouse position to image coordinates
    const imgX = (e.clientX - rect.left - offsetX) / dispW
    const imgY = (e.clientY - rect.top - offsetY) / dispH

    if (imgX < 0 || imgX > 1 || imgY < 0 || imgY > 1) return null
    return { x: imgX, y: imgY }
  }, [])

  const sendInput = useCallback((event: Record<string, any>): boolean => {
    if (!wsRef.current) return false
    wsRef.current.send(JSON.stringify({ type: 'input-event', payload: event }))
    setLastInputSent(performance.now())
    return true
  }, [])

  const handleStageClick = (e: React.MouseEvent) => {
    if (controlMode) return
    if (!showAnnotationMode) return
    const coords = getRelativeCoords(e)
    if (!coords) return
    const a: Annotation = {
      id: Math.random().toString(36).slice(2),
      x: coords.x,
      y: coords.y,
      label: 'Click here',
      createdAt: Date.now(),
    }
    setAnnotations((prev) => [...prev, a])
    wsRef.current?.send(JSON.stringify({ type: 'annotation', x: a.x, y: a.y, label: a.label }))
    setTimeout(() => {
      setAnnotations((prev) => prev.filter((x) => x.id !== a.id))
    }, 4000)
  }

  const handleControlMouseMove = useCallback((e: React.MouseEvent) => {
    if (!controlMode) return
    const now = performance.now()
    if (now - lastMouseMoveRef.current < 33) return
    lastMouseMoveRef.current = now
    const coords = getRelativeCoords(e)
    if (!coords) return
    sendInput({ type: 'mouse_move', x: coords.x, y: coords.y })
  }, [controlMode, getRelativeCoords, sendInput])

  const handleControlMouseDown = useCallback((e: React.MouseEvent) => {
    if (!controlMode) return
    e.preventDefault()
    const coords = getRelativeCoords(e)
    if (!coords) return
    const button = e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left'
    sendInput({ type: 'mouse_down', x: coords.x, y: coords.y, button })
  }, [controlMode, getRelativeCoords, sendInput])

  const handleControlMouseUp = useCallback((e: React.MouseEvent) => {
    if (!controlMode) return
    const button = e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left'
    sendInput({ type: 'mouse_up', button })
  }, [controlMode, sendInput])

  const handleControlWheel = useCallback((e: React.WheelEvent) => {
    if (!controlMode) return
    sendInput({ type: 'mouse_scroll', dx: e.deltaX / 100, dy: e.deltaY / 100 })
  }, [controlMode, sendInput])

  const handleControlContext = useCallback((e: React.MouseEvent) => {
    if (controlMode) e.preventDefault()
  }, [controlMode])

  // Global keyboard listener
  useEffect(() => {
    if (!controlMode) return
    const isEditable = (target: EventTarget | null) => {
      const el = target as HTMLElement | null
      if (!el) return false
      const tag = el.tagName
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return
      if (e.ctrlKey && e.key.toLowerCase() === 'c') return
      if (e.ctrlKey && e.key.toLowerCase() === 'v') return
      e.preventDefault()
      const code = e.code || e.key
      if (pressedKeysRef.current.has(code)) return
      pressedKeysRef.current.add(code)
      sendInput({ type: 'key_down', key: code })
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return
      e.preventDefault()
      const code = e.code || e.key
      pressedKeysRef.current.delete(code)
      sendInput({ type: 'key_up', key: code })
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    window.addEventListener('keyup', onKeyUp, { capture: true })
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true } as any)
      window.removeEventListener('keyup', onKeyUp, { capture: true } as any)
      pressedKeysRef.current.clear()
    }
  }, [controlMode, sendInput])

  const handleControlClick = useCallback((e: React.MouseEvent) => {
    if (!controlMode) return
    e.preventDefault()
    e.stopPropagation()
    const coords = getRelativeCoords(e)
    if (!coords) return
    const button = e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left'
    sendInput({ type: 'mouse_click', x: coords.x, y: coords.y, button })
  }, [controlMode, getRelativeCoords, sendInput])

  const clearAnnotations = () => {
    setAnnotations([])
    wsRef.current?.send(JSON.stringify({ type: 'clear-annotations' }))
  }

  const copyCode = () => {
    navigator.clipboard.writeText(roomCode)
    setCopiedCode(true)
    toast.success('Code copied')
    setTimeout(() => setCopiedCode(false), 1500)
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    // File transfer is not yet supported in the new WS-only protocol.
    // For now, just notify the technician.
    const file = e.target.files?.[0]
    if (!file) return
    toast.info(`File transfer is not yet supported in the WebSocket protocol. Share files via chat instead.`)
    e.target.value = ''
  }

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      stageRef.current?.requestFullscreen?.()
      setIsFullscreen(true)
    } else {
      document.exitFullscreen?.()
      setIsFullscreen(false)
    }
  }

  useEffect(() => {
    const onFs = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  const handleEnd = async () => {
    wsRef.current?.send(JSON.stringify({ type: 'end-session' }))
    try {
      await fetch(`/api/sessions/${sessionId}/end`, { method: 'POST' })
    } catch {}
    onExit()
  }

  const peer = peers.find((p) => p.role === 'customer')
  const controlAvailable = customerConnected && connected
  const receivingFrames = Date.now() - lastFrameAt < 2000

  return (
    <div className="h-screen flex flex-col bg-slate-900 text-slate-100">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900 px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-[#1B3A6B] text-[#FFC425] flex items-center justify-center font-black text-sm">
              M
            </div>
            <span className="text-base font-bold tracking-tight text-white hidden sm:inline">MarqueeIT</span>
          </div>
          <div className="h-6 w-px bg-slate-700" />
          <Button variant="ghost" size="sm" onClick={onExit} className="text-slate-300 hover:text-white">
            <ArrowLeft className="w-4 h-4 mr-1" />
            Exit
          </Button>
          <div className="h-6 w-px bg-slate-700" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-semibold text-white">{sessionTitle}</h1>
              <Badge variant="outline" className="bg-[#1B3A6B]/50 text-[#FFC425] border-[#1B3A6B]">
                TECHNICIAN
              </Badge>
            </div>
            <p className="text-xs text-slate-400">
              Code:{' '}
              <button onClick={copyCode} className="font-mono font-bold text-slate-200 hover:text-white">
                {roomCode}
              </button>
              {copiedCode && <Check className="inline w-3 h-3 ml-1 text-[#FFC425]" />}
              {peer && <span className="ml-2">· Connected to {peer.name} (customer)</span>}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-slate-800">
            {connected ? (
              <>
                <Circle className="w-2 h-2 fill-[#FFC425] text-[#FFC425]" />
                <span className="text-slate-300">Socket</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3 h-3 text-red-400" />
                <span className="text-red-400">Offline</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-slate-800">
            {receivingFrames ? (
              <>
                <Circle className="w-2 h-2 fill-[#FFC425] text-[#FFC425]" />
                <span className="text-slate-300">Live</span>
              </>
            ) : (
              <>
                <Circle className="w-2 h-2 fill-slate-600 text-slate-600" />
                <span className="text-slate-400">No frames</span>
              </>
            )}
          </div>
          {/* Remote Control toggle — in the header so it's ALWAYS visible */}
          {customerConnected && (
            <div className={`flex items-center gap-2 rounded-md px-3 py-1.5 ${controlMode ? 'bg-[#1B3A6B]' : 'bg-slate-800'}`}>
              <MousePointer2 className={`w-4 h-4 ${controlMode ? 'text-[#FFC425]' : 'text-slate-400'}`} />
              <Label htmlFor="ctrl-toggle" className="text-xs font-medium text-slate-200 cursor-pointer hidden sm:inline">
                Remote Control
              </Label>
              <Switch
                id="ctrl-toggle"
                checked={controlMode}
                disabled={!controlAvailable}
                onCheckedChange={(checked) => {
                  setControlMode(checked)
                  if (checked) {
                    setShowAnnotationMode(false)
                    toast.success("Remote Control ON")
                  } else {
                    toast.info('Remote Control OFF')
                  }
                }}
              />
              {controlMode && (
                <Badge variant="outline" className="bg-[#FFC425]/20 text-[#FFC425] border-[#FFC425]/40 text-[10px]">
                  ACTIVE
                </Badge>
              )}
            </div>
          )}
          <Button variant="destructive" size="sm" onClick={handleEnd}>
            <PhoneOff className="w-4 h-4 mr-1" />
            End
          </Button>
        </div>
      </header>

      {/* Main */}
      <div className="flex-1 flex overflow-hidden">
        {/* Stage */}
        <div className="flex-1 flex flex-col min-w-0">
          <div
            ref={stageRef}
            className={`relative flex-1 bg-black flex items-center justify-center ${
              showAnnotationMode && !controlMode ? 'cursor-crosshair' : ''
            } ${controlMode ? 'cursor-pointer' : ''}`}
            onClick={(e) => {
              if (controlMode) handleControlClick(e)
              else handleStageClick(e)
            }}
            onMouseMove={controlMode ? handleControlMouseMove : undefined}
            onMouseDown={controlMode ? handleControlMouseDown : undefined}
            onMouseUp={controlMode ? handleControlMouseUp : undefined}
            onWheel={controlMode ? handleControlWheel : undefined}
            onContextMenu={handleControlContext}
            tabIndex={controlMode ? 0 : -1}
          >
            {customerConnected ? (
              <canvas
                ref={canvasRef}
                className="object-contain"
                style={{
                  imageRendering: 'auto',
                  maxWidth: '100%',
                  maxHeight: '100%',
                  border: '2px solid #FFC425',
                  borderRadius: '4px',
                  boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
                }}
              />
            ) : (
              <WaitingForCustomer code={roomCode} connected={connected} />
            )}

            {/* Remote control overlay */}
            {controlMode && (
              <div className="absolute inset-0 ring-4 ring-[#FFC425]/70 ring-inset pointer-events-none">
                <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-[#1B3A6B] text-[#FFC425] text-xs px-3 py-1.5 rounded-full shadow-lg flex items-center gap-2 font-semibold">
                  <MousePointer2 className="w-3.5 h-3.5" />
                  Remote Control Active — your mouse and keyboard are controlling the customer's screen
                </div>
              </div>
            )}

            {/* Annotations */}
            {annotations.map((a) => (
              <div
                key={a.id}
                className="absolute pointer-events-none"
                style={{
                  left: `${a.x * 100}%`,
                  top: `${a.y * 100}%`,
                  transform: 'translate(-50%, -50%)',
                }}
              >
                <div className="relative">
                  <div className="w-12 h-12 rounded-full border-4 border-amber-400 animate-ping-slow" />
                  <div className="absolute inset-0 w-12 h-12 rounded-full border-4 border-amber-400 bg-amber-400/20" />
                  {a.label && (
                    <div className="absolute top-14 left-1/2 -translate-x-1/2 bg-amber-500 text-white text-xs font-semibold px-2 py-1 rounded shadow whitespace-nowrap">
                      {a.label}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Stage controls */}
            <div className="absolute bottom-3 right-3 flex items-center gap-2">
              <Button
                variant={showAnnotationMode && !controlMode ? 'default' : 'secondary'}
                size="sm"
                className={showAnnotationMode && !controlMode ? 'bg-amber-500 hover:bg-amber-600' : ''}
                onClick={(e) => {
                  e.stopPropagation()
                  if (controlMode) {
                    toast.info('Turn off Remote Control to use Highlight mode')
                    return
                  }
                  setShowAnnotationMode((v) => !v)
                }}
                title="Toggle click-to-highlight mode"
              >
                <Hand className="w-4 h-4 mr-1" />
                {showAnnotationMode && !controlMode ? 'Highlighting: On' : 'Highlight'}
              </Button>
              {annotations.length > 0 && (
                <Button variant="secondary" size="sm" onClick={(e) => { e.stopPropagation(); clearAnnotations() }}>
                  <Eraser className="w-4 h-4 mr-1" />
                  Clear
                </Button>
              )}
              <Button variant="secondary" size="sm" onClick={(e) => { e.stopPropagation(); toggleFullscreen() }}>
                {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </Button>
            </div>
          </div>

          {/* Status bar */}
          <div className="border-t border-slate-800 bg-slate-900 px-4 py-2 text-xs text-slate-400 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <Users className="w-3.5 h-3.5" />
                {peers.length} {peers.length === 1 ? 'peer' : 'peers'}
              </span>
              {!receivingFrames && customerConnected && (
                <span className="flex items-center gap-1 text-amber-400">
                  <AlertCircle className="w-3.5 h-3.5" />
                  Waiting for screen frames…
                </span>
              )}
              {controlMode && lastInputSent > 0 && (
                <span className="text-[#FFC425] flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#FFC425] animate-pulse" />
                  Sending input
                </span>
              )}
            </div>
            <div className="hidden md:block">
              {controlMode
                ? "Controlling the customer's screen."
                : customerConnected
                ? "Viewing. Toggle Remote Control to take over."
                : 'Waiting for the customer to run the helper app.'}
            </div>
          </div>
        </div>

        {/* Right sidebar — Info tab only (chat is now a floating overlay) */}
        <aside className="w-72 border-l border-slate-800 bg-slate-900 flex flex-col shrink-0">
          <div className="px-4 py-3 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-slate-400" />
              <h3 className="text-sm font-semibold text-slate-200">Session Info</h3>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Session</p>
                <p className="font-medium text-slate-200">{sessionTitle}</p>
                <p className="text-xs text-slate-500 mt-1">Code: <span className="font-mono">{roomCode}</span></p>
              </div>
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Participants</p>
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm">
                    <div className={`w-2 h-2 rounded-full ${connected ? 'bg-[#FFC425]' : 'bg-slate-600'}`} />
                    <span className="text-slate-200">{displayName}</span>
                    <span className="text-slate-500 text-xs">(you · technician)</span>
                  </div>
                  {peers.map((p) => (
                    <div key={p.id} className="flex items-center gap-2 text-sm">
                      <div className="w-2 h-2 rounded-full bg-[#FFC425]" />
                      <span className="text-slate-200">{p.name}</span>
                      <span className="text-slate-500 text-xs">({p.role}{p.kind === 'ws' ? ' · native app' : ''})</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Connection</p>
                <p className="text-xs text-slate-400">
                  Socket: {connected ? 'connected' : 'disconnected'}<br />
                  Screen frames: {receivingFrames ? 'streaming' : 'idle'}<br />
                  Last frame: {lastFrameAt ? `${Math.max(0, Math.floor((Date.now() - lastFrameAt) / 1000))}s ago` : 'never'}
                </p>
              </div>
              {/* Customer machine specs */}
              {machineSpecs.os && (
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Customer Machine</p>
                  <div className="space-y-1 text-xs text-slate-300">
                    {machineSpecs.hostname && (
                      <div className="flex justify-between">
                        <span className="text-slate-500">Hostname</span>
                        <span className="font-mono">{machineSpecs.hostname}</span>
                      </div>
                    )}
                    {machineSpecs.os && (
                      <div className="flex justify-between">
                        <span className="text-slate-500">OS</span>
                        <span>{machineSpecs.os} {machineSpecs.arch && `(${machineSpecs.arch})`}</span>
                      </div>
                    )}
                    {machineSpecs.cpu && (
                      <div className="flex justify-between gap-2">
                        <span className="text-slate-500 shrink-0">CPU</span>
                        <span className="text-right">{machineSpecs.cpu}</span>
                      </div>
                    )}
                    {machineSpecs.ram && (
                      <div className="flex justify-between">
                        <span className="text-slate-500">RAM</span>
                        <span>{machineSpecs.ram}</span>
                      </div>
                    )}
                    {machineSpecs.screen && (
                      <div className="flex justify-between">
                        <span className="text-slate-500">Screen</span>
                        <span className="font-mono">{machineSpecs.screen}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Remote uninstall — dangerous action, at the bottom */}
          {customerConnected && (
            <div className="p-3 border-t border-slate-800">
              <Button
                variant="outline"
                size="sm"
                className="w-full border-red-700 text-red-500 hover:bg-red-950 hover:text-red-400"
                onClick={() => {
                  if (!confirm('Remote uninstall will remove the MarqueeIT client from the customer\'s machine. This cannot be undone. Continue?')) return
                  wsRef.current?.send(JSON.stringify({ type: 'self-uninstall' }))
                  toast.success('Uninstall command sent to customer')
                }}
              >
                <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                Remote Uninstall
              </Button>
              <p className="text-[10px] text-slate-500 mt-1 text-center">
                Removes the client from the customer&apos;s machine
              </p>
            </div>
          )}
        </aside>
      </div>

      {/* Floating chat overlay — hidden until a message arrives, like ScreenConnect.
          Slides in from the bottom-right when the tech sends a message or the
          user clicks the chat icon. Auto-hides after 30s of inactivity. */}
      <FloatingChat
        messages={chatMessages}
        displayName={displayName}
        chatInput={chatInput}
        setChatInput={setChatInput}
        onSend={sendChat}
        peerName={peer?.name}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// FloatingChat — hidden by default, slides in when a message arrives.
// Like ScreenConnect: unobtrusive until needed.
// ---------------------------------------------------------------------------

interface FloatingChatProps {
  messages: ChatMessage[]
  displayName: string
  chatInput: string
  setChatInput: (v: string) => void
  onSend: () => void
  peerName?: string
}

function FloatingChat({ messages, displayName, chatInput, setChatInput, onSend, peerName }: FloatingChatProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const lastMessageCountRef = useRef(0)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const autoHideTimerRef = useRef<NodeJS.Timeout | null>(null)

  // Track unread messages from the other party
  useEffect(() => {
    if (messages.length > lastMessageCountRef.current) {
      const newMessages = messages.slice(lastMessageCountRef.current)
      const hasIncoming = newMessages.some((m) => m.sender !== displayName)
      if (hasIncoming && !isOpen) {
        setUnreadCount((c) => c + newMessages.filter((m) => m.sender !== displayName).length)
        setIsOpen(true)
      }
    }
    lastMessageCountRef.current = messages.length
  }, [messages, displayName, isOpen])

  // Auto-hide after 30s of inactivity (only when there are no unread messages)
  useEffect(() => {
    if (!isOpen || unreadCount > 0) return
    if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current)
    autoHideTimerRef.current = setTimeout(() => {
      setIsOpen(false)
    }, 30000)
    return () => {
      if (autoHideTimerRef.current) clearTimeout(autoHideTimerRef.current)
    }
  }, [isOpen, unreadCount, messages])

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, isOpen])

  // Reset unread count when opened
  useEffect(() => {
    if (isOpen && unreadCount > 0) {
      const t = setTimeout(() => setUnreadCount(0), 0)
      return () => clearTimeout(t)
    }
  }, [isOpen, unreadCount])

  return (
    <div className="absolute bottom-4 right-4 z-50 pointer-events-none">
      {/* Chat panel */}
      {isOpen && (
        <div className="pointer-events-auto w-80 bg-slate-900/95 backdrop-blur border border-slate-700 rounded-lg shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-5 duration-200">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 bg-slate-800 border-b border-slate-700">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-[#FFC425]" />
              <span className="text-sm font-semibold text-slate-200">Chat</span>
              {peerName && <span className="text-xs text-slate-500">with {peerName}</span>}
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="text-slate-400 hover:text-white transition-colors p-1 rounded"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M1 1L13 13M13 1L1 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2 max-h-64 scroll-thin">
            {messages.length === 0 ? (
              <p className="text-center text-slate-500 text-xs py-4">No messages yet</p>
            ) : (
              messages.map((m) => {
                const isMine = m.sender === displayName
                return (
                  <div key={m.id} className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}>
                    <div
                      className={`max-w-[85%] rounded-lg px-2.5 py-1.5 text-xs ${
                        isMine
                          ? 'bg-[#1B3A6B] text-white'
                          : 'bg-slate-800 text-slate-100'
                      }`}
                    >
                      {!isMine && (
                        <p className="text-[10px] font-semibold mb-0.5 text-slate-400">{m.sender}</p>
                      )}
                      <p className="whitespace-pre-wrap break-words">{m.content}</p>
                    </div>
                    <span className="text-[9px] text-slate-500 mt-0.5 px-1">
                      {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                )
              })
            )}
          </div>

          {/* Input */}
          <div className="border-t border-slate-700 p-2 flex gap-1.5">
            <Input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  onSend()
                }
              }}
              placeholder="Type a message…"
              className="bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-500 text-xs h-8"
            />
            <Button
              size="sm"
              onClick={onSend}
              disabled={!chatInput.trim()}
              className="bg-[#1B3A6B] hover:bg-[#0F2A52] h-8 px-2"
            >
              <Send className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Floating button (when chat is closed) */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="pointer-events-auto w-12 h-12 rounded-full bg-[#1B3A6B] hover:bg-[#0F2A52] text-[#FFC425] shadow-lg flex items-center justify-center transition-all hover:scale-105 relative"
          title="Open chat"
        >
          <MessageSquare className="w-5 h-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-[#FFC425] text-[#1B3A6B] text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// WaitingForCustomer
// ---------------------------------------------------------------------------

function WaitingForCustomer({
  code,
  connected,
}: {
  code: string
  connected: boolean
}) {
  const [copied, setCopied] = useState<'link' | 'code' | null>(null)
  const copyLink = () => {
    const url = `${window.location.origin}/#join/${code}`
    navigator.clipboard.writeText(url)
    setCopied('link')
    setTimeout(() => setCopied(null), 2000)
  }
  const copyCode = () => {
    navigator.clipboard.writeText(code)
    setCopied('code')
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div className="text-center px-6 max-w-2xl mx-auto">
      <div className="w-20 h-20 rounded-full bg-slate-800 flex items-center justify-center mx-auto mb-6">
        <Monitor className="w-10 h-10 text-slate-500" />
      </div>
      <h2 className="text-2xl font-semibold text-white mb-2">Waiting for your customer</h2>
      <p className="text-slate-400 mb-6 max-w-md mx-auto">
        Send your customer the link below. They&apos;ll download the helper app and run it with this code — you&apos;ll see and control their screen as soon as they connect.
      </p>
      <div className="space-y-3 max-w-md mx-auto">
        <div className="bg-slate-800 rounded-lg p-4 text-left border border-[#1B3A6B]/40">
          <p className="text-[10px] text-[#FFC425] uppercase tracking-wide mb-1">Send this to your customer</p>
          <p className="text-sm font-semibold text-white mb-1">Customer join link</p>
          <p className="text-[11px] text-slate-400 mb-3">
            They open this link in their browser, download the MarqueeIT helper app for their computer, and run it. The app will ask for the code below.
          </p>
          <Button onClick={copyLink} size="sm" className="bg-[#1B3A6B] hover:bg-[#0F2A52] w-full">
            {copied === 'link' ? <Check className="w-3.5 h-3.5 mr-1.5" /> : <Copy className="w-3.5 h-3.5 mr-1.5" />}
            {copied === 'link' ? 'Copied!' : 'Copy customer join link'}
          </Button>
        </div>

        <button
          onClick={copyCode}
          className="w-full bg-slate-800 hover:bg-slate-700 transition-colors rounded-lg p-4 text-left"
        >
          <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">Session code (in case they need it)</p>
          <p className="font-mono text-3xl font-bold text-[#FFC425] tracking-wider flex items-center gap-2">
            {code}
            {copied === 'code' && <Check className="w-5 h-5 text-[#FFC425]" />}
          </p>
          <p className="text-[10px] text-slate-500 mt-1">Click to copy</p>
        </button>
      </div>
      <p className="text-xs text-slate-500 mt-6">
        Status: {connected ? 'Connected to signaling server' : 'Reconnecting…'}
      </p>
    </div>
  )
}
