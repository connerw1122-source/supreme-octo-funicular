'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Progress } from '@/components/ui/progress'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  ArrowLeft,
  Send,
  PhoneOff,
  Monitor,
  Users,
  MessageSquare,
  FileText,
  Paperclip,
  Eraser,
  Maximize2,
  Minimize2,
  Copy,
  Check,
  Loader2,
  Circle,
  AlertCircle,
  Hand,
  WifiOff,
  MousePointer2,
  Keyboard,
  Lock,
  ShieldAlert,
  Download,
} from 'lucide-react'
import { toast } from 'sonner'
import { useSession, type ChatMessage, type Peer, type FileMeta } from '@/lib/use-session'

interface SessionViewProps {
  role: 'technician' | 'customer'
  roomCode: string
  displayName: string
  sessionTitle: string
  sessionId: string
  // Customer must pass their local screen-share stream
  localStream?: MediaStream | null
  onExit: () => void
  onEnded?: () => void
}

interface Annotation {
  id: string
  x: number
  y: number
  label?: string
  createdAt: number
}

interface IncomingFile {
  meta: FileMeta
  progress: number
  blob?: Blob
  done: boolean
}

export function SessionView({
  role,
  roomCode,
  displayName,
  sessionTitle,
  sessionId,
  localStream,
  onExit,
  onEnded,
}: SessionViewProps) {
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [peers, setPeers] = useState<Peer[]>([])
  const [annotations, setAnnotations] = useState<Annotation[]>([])
  const [incomingFiles, setIncomingFiles] = useState<Map<string, IncomingFile>>(new Map())
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [showAnnotationMode, setShowAnnotationMode] = useState(false)
  const [copiedCode, setCopiedCode] = useState(false)
  // Remote control state (technician only)
  const [controlMode, setControlMode] = useState(false)
  const [keyboardFocused, setKeyboardFocused] = useState(false)
  const [lastInputSent, setLastInputSent] = useState<number>(0)

  const remoteVideoRef = useRef<HTMLVideoElement | null>(null)
  const localVideoRef = useRef<HTMLVideoElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const chatScrollRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  // Track the last mouse-move send time for throttling
  const lastMouseMoveRef = useRef<number>(0)
  // Track pressed keys to avoid repeat-fire
  const pressedKeysRef = useRef<Set<string>>(new Set())

  // -------------------------------------------------------------------------
  // Session hook
  // -------------------------------------------------------------------------
  const session = useSession({
    roomCode,
    role,
    name: displayName,
    localStream: role === 'customer' ? localStream : undefined,
    onRemoteStream: (stream) => {
      console.log('[session] remote stream arrived')
      setRemoteStream(stream)
    },
    onChatMessage: (msg) => {
      setChatMessages((prev) => [...prev, msg])
    },
    onAnnotation: (a) => {
      if (a.id === '__clear__') {
        setAnnotations([])
      } else {
        setAnnotations((prev) => [...prev, a])
        // Auto-clear annotations after 4 seconds
        setTimeout(() => {
          setAnnotations((prev) => prev.filter((x) => x.id !== a.id))
        }, 4000)
      }
    },
    onPeers: (p) => setPeers(p),
    onFileMeta: (meta) => {
      setIncomingFiles((prev) => {
        const next = new Map(prev)
        next.set(meta.fileId, { meta, progress: 0, done: false })
        return next
      })
      toast.info(`Receiving file: ${meta.name}`)
    },
    onFileProgress: (fileId, progress) => {
      setIncomingFiles((prev) => {
        const next = new Map(prev)
        const entry = next.get(fileId)
        if (entry) next.set(fileId, { ...entry, progress })
        return next
      })
    },
    onFileComplete: (fileId, blob) => {
      setIncomingFiles((prev) => {
        const next = new Map(prev)
        const entry = next.get(fileId)
        if (entry) {
          next.set(fileId, { ...entry, progress: 1, blob, done: true })
          // Auto-download
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = entry.meta.name
          document.body.appendChild(a)
          a.click()
          document.body.removeChild(a)
          setTimeout(() => URL.revokeObjectURL(url), 5000)
          toast.success(`File received: ${entry.meta.name}`)
        }
        return next
      })
    },
    onSessionEnded: () => {
      toast.info('Session ended')
      onEnded?.()
    },
  })

  // -------------------------------------------------------------------------
  // Attach remote stream to video element
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream
    }
  }, [remoteStream])

  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream
    }
  }, [localStream])

  // Customer signals stream ready once the local stream is set
  useEffect(() => {
    if (role === 'customer' && localStream && session.connected) {
      // Give the technician a moment to receive the joined-room event
      const t = setTimeout(() => session.signalStreamReady(), 500)
      return () => clearTimeout(t)
    }
  }, [role, localStream, session.connected, session])

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight
    }
  }, [chatMessages])

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------
  const sendChat = () => {
    if (!chatInput.trim()) return
    session.sendChat(displayName, chatInput.trim())
    // Show our own message immediately
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

  const handleStageClick = (e: React.MouseEvent) => {
    if (!showAnnotationMode) return
    const stage = stageRef.current
    if (!stage) return
    const rect = stage.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    if (x < 0 || x > 1 || y < 0 || y > 1) return
    const a: Annotation = {
      id: Math.random().toString(36).slice(2),
      x,
      y,
      label: 'Click here',
      createdAt: Date.now(),
    }
    setAnnotations((prev) => [...prev, a])
    session.sendAnnotation(a.x, a.y, a.label)
    setTimeout(() => {
      setAnnotations((prev) => prev.filter((x) => x.id !== a.id))
    }, 4000)
  }

  const clearAnnotations = () => {
    setAnnotations([])
    session.clearAnnotations()
  }

  const copyCode = () => {
    navigator.clipboard.writeText(roomCode)
    setCopiedCode(true)
    toast.success('Code copied')
    setTimeout(() => setCopiedCode(false), 1500)
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 100 * 1024 * 1024) {
      toast.error('Files are limited to 100 MB in this demo.')
      return
    }
    toast.info(`Sending ${file.name}…`)
    await session.sendFile(file)
    toast.success(`Sent ${file.name}`)
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
    session.endSession()
    try {
      await fetch(`/api/sessions/${sessionId}/end`, { method: 'POST' })
    } catch {}
    // Stop local tracks
    localStream?.getTracks().forEach((t) => t.stop())
    onExit()
  }

  // -------------------------------------------------------------------------
  // Remote control handlers (technician only)
  // -------------------------------------------------------------------------
  const isTechnician = role === 'technician'

  // Convert a mouse event on the stage to relative [0..1] coordinates
  // accounting for the video's "object-contain" letterboxing.
  const getRelativeCoords = useCallback((e: React.MouseEvent | MouseEvent) => {
    const video = remoteVideoRef.current
    if (!video) return null
    const rect = video.getBoundingClientRect()
    // The video uses object-contain, so the actual displayed area may be
    // smaller than the bounding rect. We don't know the video aspect ratio
    // here in detail, but getBoundingClientRect on the video element gives
    // the rendered area which is good enough for our purposes.
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height
    if (x < 0 || x > 1 || y < 0 || y > 1) return null
    return { x, y }
  }, [])

  const handleControlMouseMove = useCallback((e: React.MouseEvent) => {
    if (!controlMode) return
    const now = performance.now()
    // Throttle to ~30 moves per second
    if (now - lastMouseMoveRef.current < 33) return
    lastMouseMoveRef.current = now
    const coords = getRelativeCoords(e)
    if (!coords) return
    if (session.sendMouseMove(coords.x, coords.y)) {
      setLastInputSent(now)
    }
  }, [controlMode, getRelativeCoords, session])

  const handleControlMouseDown = useCallback((e: React.MouseEvent) => {
    if (!controlMode) return
    e.preventDefault()
    const coords = getRelativeCoords(e)
    if (!coords) return
    const button = e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left'
    if (session.sendMouseDown(coords.x, coords.y, button)) {
      setLastInputSent(performance.now())
    }
  }, [controlMode, getRelativeCoords, session])

  const handleControlMouseUp = useCallback((e: React.MouseEvent) => {
    if (!controlMode) return
    const button = e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left'
    if (session.sendMouseUp(button)) {
      setLastInputSent(performance.now())
    }
  }, [controlMode, session])

  const handleControlWheel = useCallback((e: React.WheelEvent) => {
    if (!controlMode) return
    const dx = e.deltaX / 100
    const dy = e.deltaY / 100
    if (session.sendMouseScroll(dx, dy)) {
      setLastInputSent(performance.now())
    }
  }, [controlMode, session])

  const handleControlContext = useCallback((e: React.MouseEvent) => {
    if (controlMode) e.preventDefault()
  }, [controlMode])

  // Global keyboard listener - only active when control mode is ON and the
  // keyboard input isn't focused on a text field
  useEffect(() => {
    if (!isTechnician || !controlMode) return
    const isEditable = (target: EventTarget | null) => {
      const el = target as HTMLElement | null
      if (!el) return false
      const tag = el.tagName
      return (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        el.isContentEditable
      )
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return
      // Don't capture our own shortcuts
      if (e.ctrlKey && e.key.toLowerCase() === 'c') return
      if (e.ctrlKey && e.key.toLowerCase() === 'v') return
      // Don't prevent Ctrl+Tab etc
      e.preventDefault()
      const code = e.code || e.key
      if (pressedKeysRef.current.has(code)) return
      pressedKeysRef.current.add(code)
      if (session.sendKeyDown(code)) {
        setLastInputSent(performance.now())
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return
      e.preventDefault()
      const code = e.code || e.key
      pressedKeysRef.current.delete(code)
      if (session.sendKeyUp(code)) {
        setLastInputSent(performance.now())
      }
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    window.addEventListener('keyup', onKeyUp, { capture: true })
    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true } as any)
      window.removeEventListener('keyup', onKeyUp, { capture: true } as any)
      pressedKeysRef.current.clear()
    }
  }, [isTechnician, controlMode, session])

  const handleControlClick = useCallback((e: React.MouseEvent) => {
    if (!controlMode) return
    e.preventDefault()
    e.stopPropagation()
    const coords = getRelativeCoords(e)
    if (!coords) return
    const button = e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left'
    if (session.sendMouseClick(coords.x, coords.y, button)) {
      setLastInputSent(performance.now())
    }
  }, [controlMode, getRelativeCoords, session])

  const handleControlDoubleClick = useCallback((e: React.MouseEvent) => {
    if (!controlMode) return
    e.preventDefault()
    const coords = getRelativeCoords(e)
    if (!coords) return
    if (session.sendInput({ type: 'mouse_doubleclick', x: coords.x, y: coords.y })) {
      setLastInputSent(performance.now())
    }
  }, [controlMode, getRelativeCoords, session])

  const copyDownloadLink = useCallback(() => {
    const url = `${window.location.origin}/downloads/install_mac_linux.sh`
    navigator.clipboard.writeText(url)
    toast.success('Download link copied')
  }, [])

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  const iceConnected = session.iceState === 'connected' || session.iceState === 'completed'
  const peer = peers[0]
  const otherRole = isTechnician ? 'customer' : 'technician'
  const dcOpen = !!session.dc.current && session.dc.current.readyState === 'open'
  const controlAvailable = isTechnician && iceConnected && dcOpen

  return (
    <div className="h-screen flex flex-col bg-slate-900 text-slate-100">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900 px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onExit} className="text-slate-300 hover:text-white">
            <ArrowLeft className="w-4 h-4 mr-1" />
            Exit
          </Button>
          <div className="h-6 w-px bg-slate-700" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-semibold text-white">{sessionTitle}</h1>
              <Badge
                variant="outline"
                className={
                  isTechnician
                    ? 'bg-emerald-950/50 text-emerald-400 border-emerald-800'
                    : 'bg-amber-950/50 text-amber-400 border-amber-800'
                }
              >
                {isTechnician ? 'TECHNICIAN' : 'CUSTOMER'}
              </Badge>
            </div>
            <p className="text-xs text-slate-400">
              Code:{' '}
              <button onClick={copyCode} className="font-mono font-bold text-slate-200 hover:text-white">
                {roomCode}
              </button>
              {copiedCode && <Check className="inline w-3 h-3 ml-1 text-emerald-400" />}
              {peer && <span className="ml-2">· Connected to {peer.name} ({otherRole})</span>}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-slate-800">
            {session.connected ? (
              <>
                <Circle className="w-2 h-2 fill-emerald-400 text-emerald-400" />
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
            {iceConnected ? (
              <>
                <Circle className="w-2 h-2 fill-emerald-400 text-emerald-400" />
                <span className="text-slate-300">WebRTC</span>
              </>
            ) : (
              <>
                <Circle className="w-2 h-2 fill-amber-400 text-amber-400" />
                <span className="text-slate-300 capitalize">{session.iceState}</span>
              </>
            )}
          </div>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleEnd}
          >
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
              if (controlMode) {
                handleControlClick(e)
              } else {
                handleStageClick(e)
              }
            }}
            onDoubleClick={controlMode ? handleControlDoubleClick : undefined}
            onMouseMove={controlMode ? handleControlMouseMove : undefined}
            onMouseDown={controlMode ? handleControlMouseDown : undefined}
            onMouseUp={controlMode ? handleControlMouseUp : undefined}
            onWheel={controlMode ? handleControlWheel : undefined}
            onContextMenu={handleControlContext}
            tabIndex={controlMode ? 0 : -1}
          >
            {isTechnician ? (
              remoteStream ? (
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-contain"
                />
              ) : (
                <WaitingForCustomer
                  code={roomCode}
                  connected={session.connected}
                  peerPresent={!!peer}
                />
              )
            ) : (
              // Customer: show their own preview
              <>
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-contain"
                />
                <div className="absolute top-3 left-3 bg-black/60 text-white text-xs px-2 py-1 rounded">
                  You are sharing your screen
                </div>
              </>
            )}

            {/* Remote control overlay - dims the edges when active */}
            {controlMode && isTechnician && (
              <div className="absolute inset-0 ring-4 ring-emerald-500/60 ring-inset pointer-events-none">
                <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-emerald-600 text-white text-xs px-3 py-1.5 rounded-full shadow-lg flex items-center gap-2 font-semibold">
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
              {isTechnician && (
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
              )}
              {annotations.length > 0 && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    clearAnnotations()
                  }}
                >
                  <Eraser className="w-4 h-4 mr-1" />
                  Clear
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation()
                  toggleFullscreen()
                }}
              >
                {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </Button>
            </div>
          </div>

          {/* Control bar (technician only) */}
          {isTechnician && remoteStream && (
            <div className="border-t border-slate-800 bg-slate-950/60 px-4 py-2.5 shrink-0">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                {/* Left: remote control toggle */}
                <div className="flex items-center gap-3">
                  <TooltipProvider>
                    <div className="flex items-center gap-2 bg-slate-800 rounded-md px-3 py-1.5">
                      <MousePointer2 className={`w-4 h-4 ${controlMode ? 'text-emerald-400' : 'text-slate-400'}`} />
                      <Label htmlFor="ctrl-toggle" className="text-xs font-medium text-slate-200 cursor-pointer">
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
                            toast.success('Remote Control ON — your mouse and keyboard now control the customer\'s screen.')
                          } else {
                            toast.info('Remote Control OFF — back to view-only mode.')
                          }
                        }}
                      />
                      {controlMode ? (
                        <Badge variant="outline" className="ml-1 bg-emerald-950/60 text-emerald-300 border-emerald-800 text-[10px]">
                          ACTIVE
                        </Badge>
                      ) : !controlAvailable ? (
                        <span className="text-[10px] text-slate-500 ml-1">
                          {!dcOpen ? 'needs data channel' : !iceConnected ? 'connecting…' : ''}
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-500 ml-1">view-only</span>
                      )}
                    </div>
                  </TooltipProvider>
                </div>

                {/* Right: download link + help */}
                <div className="flex items-center gap-2">
                  {!controlAvailable && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-slate-300 hover:text-white hover:bg-slate-800 text-xs h-8"
                            onClick={copyDownloadLink}
                          >
                            <Download className="w-3.5 h-3.5 mr-1.5" />
                            Copy customer app link
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          <p>The customer needs to run the RemoteHelp desktop app for full remote control. Copy this link and send it to them.</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                  {controlMode && lastInputSent > 0 && (
                    <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      Sending input
                    </span>
                  )}
                </div>
              </div>
              {controlMode && (
                <p className="text-[11px] text-slate-400 mt-1.5 flex items-center gap-1">
                  <Keyboard className="w-3 h-3" />
                  Your keyboard is captured. Click any text field on the right to type chat messages without affecting the remote screen.
                </p>
              )}
            </div>
          )}

          {/* Status bar */}
          <div className="border-t border-slate-800 bg-slate-900 px-4 py-2 text-xs text-slate-400 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <Users className="w-3.5 h-3.5" />
                {peers.length} {peers.length === 1 ? 'peer' : 'peers'}
              </span>
              {session.error && (
                <span className="flex items-center gap-1 text-red-400">
                  <AlertCircle className="w-3.5 h-3.5" />
                  {session.error}
                </span>
              )}
            </div>
            <div>
              {isTechnician
                ? controlMode
                  ? 'Controlling the customer\'s screen. Click the Remote Control switch again to stop.'
                  : 'Viewing the customer\'s screen. Turn on Remote Control to take over — requires the customer app.'
                : 'Your screen is being shared. You can chat with your technician at any time.'}
            </div>
          </div>
        </div>

        {/* Right sidebar */}
        <aside className="w-80 border-l border-slate-800 bg-slate-900 flex flex-col shrink-0">
          <Tabs defaultValue="chat" className="flex-1 flex flex-col">
            <TabsList className="grid grid-cols-2 bg-slate-800 rounded-none border-b border-slate-800">
              <TabsTrigger value="chat" className="data-[state=active]:bg-slate-700">
                <MessageSquare className="w-3.5 h-3.5 mr-1.5" />
                Chat
              </TabsTrigger>
              <TabsTrigger value="files" className="data-[state=active]:bg-slate-700">
                <FileText className="w-3.5 h-3.5 mr-1.5" />
                Files
              </TabsTrigger>
            </TabsList>

            {/* Chat tab */}
            <TabsContent value="chat" className="flex-1 flex flex-col m-0 data-[state=inactive]:hidden">
              <ScrollArea className="flex-1" >
                <div ref={chatScrollRef} className="p-3 space-y-2 max-h-full">
                  {chatMessages.length === 0 ? (
                    <div className="text-center text-slate-500 text-sm py-8">
                      <MessageSquare className="w-6 h-6 mx-auto mb-2 opacity-40" />
                      No messages yet.
                      <br />
                      Say hello to {peer?.name ?? (isTechnician ? 'the customer' : 'your technician')}!
                    </div>
                  ) : (
                    chatMessages.map((m) => {
                      const isMine = m.sender === displayName
                      return (
                        <div
                          key={m.id}
                          className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}
                        >
                          <div
                            className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                              isMine
                                ? 'bg-emerald-600 text-white'
                                : m.sender === 'System'
                                ? 'bg-slate-800 text-slate-300 italic text-xs'
                                : 'bg-slate-800 text-slate-100'
                            }`}
                          >
                            {!isMine && (
                              <p className="text-xs font-semibold mb-0.5 text-slate-400">
                                {m.sender}
                              </p>
                            )}
                            <p className="whitespace-pre-wrap break-words">{m.content}</p>
                          </div>
                          <span className="text-[10px] text-slate-500 mt-0.5 px-1">
                            {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      )
                    })
                  )}
                </div>
              </ScrollArea>
              <div className="border-t border-slate-800 p-3 flex gap-2">
                <Input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      sendChat()
                    }
                  }}
                  placeholder="Type a message…"
                  className="bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-500"
                />
                <Button size="sm" onClick={sendChat} disabled={!chatInput.trim()} className="bg-emerald-600 hover:bg-emerald-700">
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </TabsContent>

            {/* Files tab */}
            <TabsContent value="files" className="flex-1 flex flex-col m-0 data-[state=inactive]:hidden">
              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                <Button
                  variant="outline"
                  className="w-full border-slate-700 text-slate-200 hover:bg-slate-800"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Paperclip className="w-4 h-4 mr-2" />
                  Send a file
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={handleFileSelect}
                />
                <p className="text-xs text-slate-500 text-center">
                  Files transfer directly between you and the other party.
                </p>

                {incomingFiles.size === 0 ? (
                  <div className="text-center text-slate-500 text-sm py-6">
                    <FileText className="w-6 h-6 mx-auto mb-2 opacity-40" />
                    No files transferred yet.
                  </div>
                ) : (
                  Array.from(incomingFiles.values()).map((f) => (
                    <Card key={f.meta.fileId} className="bg-slate-800 border-slate-700">
                      <CardContent className="p-3">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-100 truncate">{f.meta.name}</p>
                            <p className="text-xs text-slate-400">
                              {(f.meta.size / 1024).toFixed(1)} KB · from{' '}
                              {isTechnician ? 'customer' : 'technician'}
                            </p>
                          </div>
                          {f.done && (
                            <Badge variant="outline" className="bg-emerald-900/50 text-emerald-300 border-emerald-800">
                              <Check className="w-3 h-3 mr-1" />
                              Saved
                            </Badge>
                          )}
                        </div>
                        {!f.done && <Progress value={f.progress * 100} className="h-1" />}
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            </TabsContent>
          </Tabs>

          {/* Peer info footer */}
          <div className="border-t border-slate-800 p-3 shrink-0">
            <div className="text-xs text-slate-500 uppercase tracking-wide mb-2">Participants</div>
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-sm">
                <div className={`w-2 h-2 rounded-full ${session.connected ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                <span className="text-slate-200">{displayName}</span>
                <span className="text-slate-500 text-xs">(you · {role})</span>
              </div>
              {peers.map((p) => (
                <div key={p.id} className="flex items-center gap-2 text-sm">
                  <div className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span className="text-slate-200">{p.name}</span>
                  <span className="text-slate-500 text-xs">({p.role})</span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}

function WaitingForCustomer({
  code,
  connected,
  peerPresent,
}: {
  code: string
  connected: boolean
  peerPresent: boolean
}) {
  const [copied, setCopied] = useState<'link' | 'app' | null>(null)
  const copyLink = () => {
    const url = `${window.location.origin}/#join/${code}`
    navigator.clipboard.writeText(url)
    setCopied('link')
    setTimeout(() => setCopied(null), 2000)
  }
  const copyAppLink = () => {
    const url = `${window.location.origin}/downloads/`
    navigator.clipboard.writeText(url)
    setCopied('app')
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div className="text-center px-6 max-w-2xl mx-auto">
      <div className="w-20 h-20 rounded-full bg-slate-800 flex items-center justify-center mx-auto mb-6">
        {peerPresent ? (
          <Loader2 className="w-10 h-10 text-emerald-400 animate-spin" />
        ) : (
          <Monitor className="w-10 h-10 text-slate-500" />
        )}
      </div>
      <h2 className="text-2xl font-semibold text-white mb-2">
        {peerPresent ? 'Connecting…' : 'Waiting for your customer'}
      </h2>
      <p className="text-slate-400 mb-6 max-w-md mx-auto">
        {peerPresent
          ? 'The customer has joined. Establishing a secure WebRTC connection — this usually takes a few seconds.'
          : 'Share the link or code below with your customer. For full remote control, ask them to download the customer app.'}
      </p>
      {!peerPresent && (
        <div className="grid sm:grid-cols-2 gap-3 max-w-xl mx-auto">
          {/* Join link card */}
          <div className="bg-slate-800 rounded-lg p-4 text-left">
            <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-1">Browser join (view-only)</p>
            <p className="font-mono text-2xl font-bold text-emerald-400 tracking-wider mb-3">{code}</p>
            <Button onClick={copyLink} variant="outline" size="sm" className="border-slate-700 text-slate-200 hover:bg-slate-700 w-full">
              {copied === 'link' ? <Check className="w-3.5 h-3.5 mr-1.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 mr-1.5" />}
              {copied === 'link' ? 'Copied!' : 'Copy join link'}
            </Button>
            <p className="text-[10px] text-slate-500 mt-2">
              Customer opens this in their browser. No download needed, but you can only view, not control.
            </p>
          </div>

          {/* App download card */}
          <div className="bg-slate-800 rounded-lg p-4 text-left border border-emerald-700/40">
            <p className="text-[10px] text-emerald-400 uppercase tracking-wide mb-1">Customer app (full control)</p>
            <p className="text-sm font-semibold text-white mb-1">RemoteHelp Desktop Client</p>
            <p className="text-[11px] text-slate-400 mb-3">
              For Windows · Mac · Linux. Customer runs it once — no permanent install.
            </p>
            <Button onClick={copyAppLink} size="sm" className="bg-emerald-600 hover:bg-emerald-700 w-full">
              {copied === 'app' ? <Check className="w-3.5 h-3.5 mr-1.5" /> : <Download className="w-3.5 h-3.5 mr-1.5" />}
              {copied === 'app' ? 'Copied!' : 'Copy app download link'}
            </Button>
            <p className="text-[10px] text-slate-500 mt-2">
              Send this link with the session code. Once they run it, you can move their mouse and type.
            </p>
          </div>
        </div>
      )}
      <p className="text-xs text-slate-500 mt-6">
        Status: {connected ? 'Connected to signaling server' : 'Reconnecting…'}
      </p>
    </div>
  )
}
