'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
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
  Clipboard,
  Lock,
  Unlock,
  Terminal,
  Activity,
  MonitorSmartphone,
  Power,
  RefreshCw,
  Shield,
  ShieldAlert,
  ShieldCheck,
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
  const [controlMode, setControlMode] = useState(false)
  const [connected, setConnected] = useState(false)
  const [customerConnected, setCustomerConnected] = useState(false)
  const [machineSpecs, setMachineSpecs] = useState<{
    os?: string
    hostname?: string
    cpu?: string
    ram?: string
    screen?: string
    arch?: string
  }>({})
  // --- New feature state ---
  const [activeTab, setActiveTab] = useState<'info' | 'cmd' | 'tasks' | 'clipboard' | 'events'>('info')
  const [clipboardHistory, setClipboardHistory] = useState<{ id: string; text: string; direction: 'in' | 'out'; timestamp: string }[]>([])
  const [cmdInput, setCmdInput] = useState('')
  const [cmdElevated, setCmdElevated] = useState(false)
  const [cmdOutput, setCmdOutput] = useState<{ id: string; command: string; output: string }[]>([])
  const [processList, setProcessList] = useState<{ pid: number; name: string; cpu: string; memory: string }[]>([])
  const [monitors, setMonitors] = useState<{ index: number; width: number; height: number }[]>([])
  const [currentMonitorIdx, setCurrentMonitorIdx] = useState(0)
  const [qualityLevel, setQualityLevel] = useState(55)
  const [fpsLevel, setFpsLevel] = useState(30)
  const [inputLocked, setInputLocked] = useState(false)
  const [screenLocked, setScreenLocked] = useState(false)
  const [expandedSysInfo, setExpandedSysInfo] = useState<Record<string, any> | null>(null)
  const [uacSecureDesktopEnabled, setUacSecureDesktopEnabled] = useState<boolean | null>(null) // null = unknown
  // --- Event Viewer state ---
  const [eventLogName, setEventLogName] = useState<'System' | 'Application' | 'Security' | 'Setup'>('System')
  const [eventLogs, setEventLogs] = useState<{ id: string; logName: string; output: string; pending?: boolean }[]>([])
  // --- Live indicators (updated by a 1s interval, NOT on every frame) ---
  // Using refs for the high-frequency timestamps avoids 30 re-renders/sec
  // which was the root cause of the seizure-inducing flashing.
  const [receivingFrames, setReceivingFrames] = useState(false)
  const [sendingInput, setSendingInput] = useState(false)
  const lastFrameAtRef = useRef<number>(0)
  const lastInputSentRef = useRef<number>(0)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const drawFrameRef = useRef<(buffer: ArrayBuffer) => void>(() => {})
  const lastMouseMoveRef = useRef<number>(0)
  const pressedKeysRef = useRef<Set<string>>(new Set())
  // --- Send system commands to the customer ---
  // Declared early so the WS onmessage handler can use it
  const wsRef = useRef<WebSocket | null>(null)
  const sendSystemCommand = useCallback((msg: Record<string, any>) => {
    wsRef.current?.send(JSON.stringify(msg))
  }, [])

  // -------------------------------------------------------------------------
  // Connect to signaling server via plain WebSocket (browser technician side)
  // Includes automatic reconnection with exponential backoff.
  // -------------------------------------------------------------------------
  useEffect(() => {
    let ws: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let reconnectAttempts = 0
    let intentionallyClosed = false

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

    const connect = () => {
      ws = new WebSocket(wsUrl)
      ws.binaryType = 'arraybuffer'
      wsRef.current = ws

      ws.onopen = () => {
        reconnectAttempts = 0
        setConnected(true)
        // Send join-room message to register
        ws!.send(JSON.stringify({
          type: 'join-room',
          roomCode,
          role: 'technician',
          name: displayName,
        }))
      }

      ws.onclose = () => {
        setConnected(false)
        wsRef.current = null
        if (intentionallyClosed) return
        // Exponential backoff: 1s, 2s, 4s, 8s, max 15s
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 15000)
        reconnectAttempts++
        console.log(`[ws] disconnected, reconnecting in ${delay}ms...`)
        reconnectTimer = setTimeout(connect, delay)
      }

      ws.onerror = () => {
        // onclose will handle reconnection
        setConnected(false)
      }

      ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          // Binary = JPEG screen frame
          // Update the ref (no re-render) — the 1s interval will pick it up
          lastFrameAtRef.current = Date.now()
          drawFrameRef.current(event.data)
          return
        }
        // Text = JSON control message
        try {
          const msg = JSON.parse(event.data)
          switch (msg.type) {
            case 'joined-room':
              setPeers(msg.peers || [])
              {
                const hasCustomer = (msg.peers || []).some((p: Peer) => p.role === 'customer')
                setCustomerConnected(hasCustomer)
                // If the customer is already in the room (technician rejoined),
                // trigger the auto-grab sequence — peer-joined won't fire because
                // the customer didn't just join, we did.
                if (hasCustomer) {
                  setInputLocked(false)
                  setScreenLocked(false)
                  setControlMode(false)
                  setCurrentMonitorIdx(0)
                  setQualityLevel(55)
                  setFpsLevel(30)
                  setUacSecureDesktopEnabled(null)
                  setExpandedSysInfo(null)
                  setCmdOutput([])
                  setProcessList([])
                  setEventLogs([])
                  pressedKeysRef.current.clear()
                  setTimeout(() => sendSystemCommand({ type: 'get-sysinfo' }), 1000)
                  setTimeout(() => sendSystemCommand({ type: 'list-monitors' }), 1500)
                  setTimeout(() => sendSystemCommand({ type: 'get-uac-secure-desktop' }), 2000)
                }
              }
              break
            case 'peer-joined':
              setPeers((prev) => prev.some((p) => p.id === msg.id) ? prev : [...prev, msg])
              if (msg.role === 'customer') {
                // Don't reset state or toast if this is the UAC helper process
                // (it joins with "(UAC)" in the name). The helper is a temporary
                // process that captures the Winlogon desktop during UAC prompts.
                const isUacHelper = msg.name && msg.name.includes('(UAC)')
                if (isUacHelper) {
                  setCustomerConnected(true)
                  break
                }
                setCustomerConnected(true)
                toast.success(`${msg.name} connected`)
                // Reset all customer-derived state — the new customer process
                // starts fresh, so the UI must match. Without this, the technician
                // could click "Unlock input" and actually LOCK it (because the UI
                // thinks it's locked from the previous session, but the new
                // customer process has input unlocked).
                setInputLocked(false)
                setScreenLocked(false)
                setControlMode(false)
                setCurrentMonitorIdx(0)
                setQualityLevel(55)
                setFpsLevel(30)
                setUacSecureDesktopEnabled(null) // unknown — will be queried
                setExpandedSysInfo(null) // clear old sysinfo from previous session
                setCmdOutput([]) // clear old command output
                setProcessList([]) // clear old process list
                setEventLogs([]) // clear old event logs
                pressedKeysRef.current.clear()
                // Auto-grab system info when customer connects
                setTimeout(() => sendSystemCommand({ type: 'get-sysinfo' }), 1000)
                // Auto-list monitors
                setTimeout(() => sendSystemCommand({ type: 'list-monitors' }), 1500)
                // Query UAC secure desktop status
                setTimeout(() => sendSystemCommand({ type: 'get-uac-secure-desktop' }), 2000)
              }
              break
            case 'peer-left':
              setPeers((prev) => {
                const next = prev.filter((p) => p.id !== msg.id)
                // Don't mark customer as disconnected if the UAC helper left
                // (the regular customer client is still connected)
                const isUacHelper = msg.name && msg.name.includes('(UAC)')
                if (!isUacHelper) {
                  setCustomerConnected(next.some((p) => p.role === 'customer'))
                }
                return next
              })
              break
            case 'presence':
              {
                const rawPeers = msg.peers || []
                // Dedup by id (the server may send duplicates if there's a race
                // between peer-joined and presence broadcast)
                const seen = new Set<string>()
                const deduped = rawPeers.filter((p: Peer) => {
                  if (seen.has(p.id)) return false
                  seen.add(p.id)
                  return true
                })
                setPeers(deduped)
                setCustomerConnected(deduped.some((p: Peer) => p.role === 'customer'))
              }
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
              }, 2000)
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
            // --- New feature handlers ---
            case 'clipboard-data':
              setClipboardHistory((prev) => [{
                id: Math.random().toString(36).slice(2),
                text: msg.text || '',
                direction: 'in' as const,
                timestamp: new Date().toISOString(),
              }, ...prev].slice(0, 20))
              break
            case 'command-output':
              if (msg.final) {
                // Final output — replace the '[running...]' entry with the real output
                setCmdOutput((prev) => prev.map((c) =>
                  c.id === msg.id ? { ...c, output: msg.output || '' } : c
                ))
              } else {
                // Initial '[running...]' — add as new entry
                setCmdOutput((prev) => [...prev, {
                  id: msg.id || Math.random().toString(36).slice(2),
                  command: msg.command || '',
                  output: msg.output || '',
                }])
              }
              break
            case 'process-list':
              setProcessList(msg.processes || [])
              break
            case 'monitor-list':
              setMonitors(msg.monitors || [])
              break
            case 'sysinfo':
              setExpandedSysInfo(msg.details || {})
              break
            case 'unattended-result':
              if (msg.result === 'removed') {
                toast.success('Unattended access removed from this machine.')
              } else if (msg.result === 'removing') {
                toast.info('Removing unattended access...')
              } else if (msg.result === 'installed' || (msg.result && !msg.result.startsWith('error'))) {
                toast.success('Unattended access installed! You can now reconnect anytime from the dashboard.')
              } else {
                toast.error('Failed: ' + (msg.result || 'unknown error'))
              }
              break
            case 'elevate-result':
              if (msg.result && (msg.result.startsWith('error') || msg.result.startsWith('Error'))) {
                toast.error('Elevation failed: ' + msg.result)
              } else {
                toast.success('Customer is restarting with admin privileges. They will reconnect shortly.')
              }
              break
            case 'uac-secure-desktop-result':
              if (msg.result === 'success') {
                setUacSecureDesktopEnabled(msg.enabled === true)
                if (msg.enabled === false) {
                  toast.success('UAC Secure Desktop DISABLED. You can now SEE UAC prompts. To INTERACT with them, the session must be elevated (click the amber Shield button first).')
                } else {
                  toast.success('UAC Secure Desktop ENABLED. Default security restored.')
                }
              } else {
                toast.error('UAC toggle failed: ' + (msg.result || 'unknown error'))
              }
              break
            case 'uac-secure-desktop-status':
              setUacSecureDesktopEnabled(msg.enabled === true)
              break
            case 'event-logs':
              // Either the initial "[loading...]" ack or the final output.
              // If it's the final (no pending flag), replace the pending entry;
              // otherwise add a new entry.
              setEventLogs((prev) => {
                const existing = prev.find((e) => e.id === msg.id)
                if (existing) {
                  return prev.map((e) => e.id === msg.id ? {
                    ...e,
                    output: msg.output || '',
                    pending: !!msg.pending,
                  } : e)
                }
                return [{
                  id: msg.id || Math.random().toString(36).slice(2),
                  logName: msg.logName || 'System',
                  output: msg.output || '',
                  pending: !!msg.pending,
                }, ...prev].slice(0, 20)
              })
              break
          }
        } catch (err) {
          console.error('ws message parse error', err)
        }
      }
    }

    connect()

    return () => {
      intentionallyClosed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (ws) ws.close()
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

    let bitmap: ImageBitmap | null = null
    try {
      const blob = new Blob([buffer], { type: 'image/jpeg' })
      bitmap = await createImageBitmap(blob)
      if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
        canvas.width = bitmap.width
        canvas.height = bitmap.height
      }
      ctx.drawImage(bitmap, 0, 0)
    } catch (err) {
      console.error('drawFrame error', err)
    } finally {
      // Always close the bitmap to avoid GPU memory leaks, even on error.
      if (bitmap) {
        try { bitmap.close() } catch {}
      }
    }
  }, [])

  // Keep latest drawFrame in a ref so the socket effect doesn't need it as a dep
  useEffect(() => {
    drawFrameRef.current = drawFrame
  }, [drawFrame])

  // ------------------------------------------------------------------------- 
  // Live indicator poller — updates receivingFrames/sendingInput at most 1/sec.
  // This replaces the old pattern of setState on every frame, which was
  // causing 30 React re-renders per second and triggering the canvas to
  // flash ~5 times a second (seizure-inducing).
  // -------------------------------------------------------------------------
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now()
      setReceivingFrames(now - lastFrameAtRef.current < 2000)
      setSendingInput(now - lastInputSentRef.current < 1500)
    }, 1000)
    return () => clearInterval(interval)
  }, [])

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

    // If canvas has no intrinsic dimensions yet (no frames received),
    // fall back to simple bounding-rect-relative coordinates
    const imgW = canvas.width
    const imgH = canvas.height
    if (imgW === 0 || imgH === 0) {
      const x = (e.clientX - rect.left) / rect.width
      const y = (e.clientY - rect.top) / rect.height
      if (x < 0 || x > 1 || y < 0 || y > 1) return null
      return { x, y }
    }

    // Account for object-contain letterboxing
    const canvasW = rect.width
    const canvasH = rect.height
    const scaleX = canvasW / imgW
    const scaleY = canvasH / imgH
    const scale = Math.min(scaleX, scaleY)
    const dispW = imgW * scale
    const dispH = imgH * scale
    const offsetX = (canvasW - dispW) / 2
    const offsetY = (canvasH - dispH) / 2
    const imgX = (e.clientX - rect.left - offsetX) / dispW
    const imgY = (e.clientY - rect.top - offsetY) / dispH
    if (imgX < 0 || imgX > 1 || imgY < 0 || imgY > 1) return null
    return { x: imgX, y: imgY }
  }, [])

  const sendInput = useCallback((event: Record<string, any>): boolean => {
    if (!wsRef.current) return false
    wsRef.current.send(JSON.stringify({ type: 'input-event', payload: event }))
    lastInputSentRef.current = Date.now()
    return true
  }, [])

  // sendSystemCommand is declared above (before the WS effect)

  const sendClipboard = useCallback((text: string, asKeystrokes: boolean = false) => {
    if (asKeystrokes) {
      // Send text as individual keystrokes to type it on the customer's machine
      sendSystemCommand({ type: 'clipboard-keystrokes', text })
      toast.success('Sent as keystrokes to customer')
    } else {
      sendSystemCommand({ type: 'clipboard-set', text })
      toast.success('Clipboard sent to customer')
    }
    setClipboardHistory((prev) => [{
      id: Math.random().toString(36).slice(2),
      text,
      direction: 'out' as const,
      timestamp: new Date().toISOString(),
    }, ...prev].slice(0, 20))
  }, [sendSystemCommand])

  const getClipboard = useCallback(() => {
    sendSystemCommand({ type: 'clipboard-get' })
  }, [sendSystemCommand])

  const execCommand = useCallback(() => {
    if (!cmdInput.trim()) return
    const id = Math.random().toString(36).slice(2)
    sendSystemCommand({ type: 'exec-command', command: cmdInput.trim(), id, elevated: cmdElevated })
    setCmdInput('')
  }, [cmdInput, cmdElevated, sendSystemCommand])

  const refreshProcesses = useCallback(() => {
    sendSystemCommand({ type: 'list-processes' })
  }, [sendSystemCommand])

  const killProc = useCallback((pid: number) => {
    sendSystemCommand({ type: 'kill-process', pid })
    toast.info(`Killing PID ${pid}...`)
    setTimeout(refreshProcesses, 1500)
  }, [sendSystemCommand, refreshProcesses])

  const refreshMonitors = useCallback(() => {
    sendSystemCommand({ type: 'list-monitors' })
  }, [sendSystemCommand])

  const switchMon = useCallback((index: number) => {
    sendSystemCommand({ type: 'switch-monitor', index })
    setCurrentMonitorIdx(index)
    toast.info(`Switching to monitor ${index + 1}...`)
  }, [sendSystemCommand])

  const changeQuality = useCallback((quality: number, fps: number) => {
    sendSystemCommand({ type: 'set-quality', quality, fps })
    setQualityLevel(quality)
    setFpsLevel(fps)
  }, [sendSystemCommand])

  const toggleInputLock = useCallback(() => {
    const newLock = !inputLocked
    sendSystemCommand({ type: newLock ? 'lock-input' : 'unlock-input' })
    setInputLocked(newLock)
    toast.info(newLock ? 'Locking customer input...' : 'Unlocking customer input...')
  }, [inputLocked, sendSystemCommand])

  const toggleScreenLock = useCallback(() => {
    if (!screenLocked) {
      // Locking — this works (calls LockWorkStation)
      sendSystemCommand({ type: 'lock-screen' })
      setScreenLocked(true)
      toast.info('Locking customer screen... The customer will need to enter their password/PIN to unlock.')
    } else {
      // Already locked — can't unlock remotely (Windows security)
      toast.warning('Cannot unlock the screen remotely. The customer must enter their password/PIN at their keyboard.')
    }
  }, [screenLocked, sendSystemCommand])

  const sendCAD = useCallback(() => {
    sendSystemCommand({ type: 'send-cad' })
    toast.success('Ctrl+Alt+Del sent')
  }, [sendSystemCommand])

  const getExpandedInfo = useCallback(() => {
    sendSystemCommand({ type: 'get-sysinfo' })
  }, [sendSystemCommand])

  const rebootCustomer = useCallback(() => {
    if (!confirm('Reboot the customer\'s machine? They will disconnect temporarily.')) return
    sendSystemCommand({ type: 'reboot' })
    toast.success('Reboot command sent')
  }, [sendSystemCommand])

  const installUnattended = useCallback(() => {
    if (!confirm('Install unattended access on this machine? This will set up the MarqueeIT client to start on boot, so you can reconnect without the customer being present.')) return
    toast.info('Installing unattended access...')
    sendSystemCommand({ type: 'install-unattended' })
  }, [sendSystemCommand])

  const removeUnattended = useCallback(() => {
    if (!confirm('Remove unattended access from this machine?\n\nThis will stop and delete the MarqueeIT Windows service.\n\nIf the customer is running as a standard user, they will see a UAC prompt and need to click YES. If running as admin/SYSTEM, it will remove silently.')) return
    toast.info('Removing unattended access — this may take up to 30 seconds...')
    sendSystemCommand({ type: 'remove-unattended' })
  }, [sendSystemCommand])

  const elevateSession = useCallback(() => {
    if (!confirm('Restart the customer\'s MarqueeIT with admin privileges? The customer will see a UAC prompt and needs to click YES. The session will briefly disconnect and reconnect.')) return
    toast.info('Requesting elevation — customer will see a UAC prompt...')
    sendSystemCommand({ type: 'elevate-session' })
  }, [sendSystemCommand])

  const toggleUACSecureDesktop = useCallback(() => {
    const currentState = uacSecureDesktopEnabled
    if (currentState === null) {
      // Unknown state — query first, then the user can click again
      toast.info('Checking UAC Secure Desktop status...')
      sendSystemCommand({ type: 'get-uac-secure-desktop' })
      return
    }
    const newState = !currentState
    if (newState) {
      // Re-enabling (restoring default security)
      if (!confirm('Re-enable UAC Secure Desktop? This restores the default Windows security behavior.')) return
      toast.info('Enabling UAC Secure Desktop...')
    } else {
      // Disabling (allows UAC interaction)
      if (!confirm(
        'Disable UAC Secure Desktop?\n\n' +
        'When disabled, UAC prompts will appear on the normal desktop instead of ' +
        'the isolated secure desktop. This allows you to SEE UAC prompts.\n\n' +
        'IMPORTANT: To also INTERACT with UAC prompts (click Yes/No), the session ' +
        'must be running as admin. Click the amber Shield button to elevate first.\n\n' +
        'The customer will see a UAC prompt and needs to click YES.\n\n' +
        'Note: This slightly reduces security. Re-enable after the session.'
      )) return
      toast.info('Disabling UAC Secure Desktop — customer will see a UAC prompt...')
    }
    sendSystemCommand({ type: 'set-uac-secure-desktop', enabled: newState })
  }, [sendSystemCommand, uacSecureDesktopEnabled])

  const fetchEventLogs = useCallback((logName: string, maxEvents: number = 50) => {
    const id = Math.random().toString(36).slice(2)
    sendSystemCommand({ type: 'get-event-logs', logName, maxEvents, id })
  }, [sendSystemCommand])

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
    e.preventDefault()
    const coords = getRelativeCoords(e)
    if (!coords) return
    const button = e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left'
    sendInput({ type: 'mouse_up', x: coords.x, y: coords.y, button })
  }, [controlMode, getRelativeCoords, sendInput])

  const handleControlWheel = useCallback((e: React.WheelEvent) => {
    if (!controlMode) return
    // Invert deltaY: scrolling up (negative deltaY) should scroll up on remote
    sendInput({ type: 'mouse_scroll', dx: e.deltaX / 100, dy: -e.deltaY / 100 })
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
      // Send keyup for any keys that are still held down when control mode ends,
      // so the customer's OS doesn't think the key is stuck.
      pressedKeysRef.current.forEach((code) => {
        sendInput({ type: 'key_up', key: code })
      })
      pressedKeysRef.current.clear()
    }
  }, [controlMode, sendInput])

  // Clear pressed keys when the customer disconnects (sends keyup for all
  // held keys so the customer's OS doesn't think keys are stuck).
  useEffect(() => {
    if (customerConnected) return
    if (pressedKeysRef.current.size === 0) return
    pressedKeysRef.current.forEach((code) => {
      sendInput({ type: 'key_up', key: code })
    })
    pressedKeysRef.current.clear()
  }, [customerConnected, sendInput])

  const clearAnnotations = () => {
    setAnnotations([])
    wsRef.current?.send(JSON.stringify({ type: 'clear-annotations' }))
  }

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
    }, 2000)
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

  // Stable canvas style — declared OUTSIDE the render return so the same object
  // reference is reused across renders. This prevents React from re-applying
  // the inline style on every render, which contributed to the flashing.
  const canvasStyle = {
    imageRendering: 'auto' as const,
    maxWidth: '100%',
    maxHeight: '100%',
    border: '2px solid #FFC425',
    borderRadius: '4px',
    boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
  }

  return (
    <div className="h-full flex flex-col bg-slate-900 text-slate-100">
      {/* Session header (compact — console provides the top bar) */}
      <header className="border-b border-slate-800 bg-slate-900 px-4 py-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onExit} className="text-slate-300 hover:text-white">
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back
          </Button>
          <div className="h-6 w-px bg-slate-700" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-semibold text-white text-sm">{sessionTitle}</h1>
              <Badge variant="outline" className="bg-[#1B3A6B]/50 text-[#FFC425] border-[#1B3A6B] text-[10px]">
                {roomCode}
              </Badge>
            </div>
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
            onClick={controlMode ? undefined : (e) => handleStageClick(e)}
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
                style={canvasStyle}
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

            {/* Annotations — positioned relative to the canvas (not the stage) */}
            {annotations.map((a) => {
              const canvas = canvasRef.current
              if (!canvas) return null
              const rect = canvas.getBoundingClientRect()
              const stageRect = stageRef.current?.getBoundingClientRect()
              if (!stageRect) return null
              // Position relative to the stage div, offset by the canvas position within the stage
              const leftPx = rect.left - stageRect.left + a.x * rect.width
              const topPx = rect.top - stageRect.top + a.y * rect.height
              return (
                <div
                  key={a.id}
                  className="absolute pointer-events-none"
                  style={{ left: `${leftPx}px`, top: `${topPx}px`, transform: 'translate(-50%, -50%)' }}
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
              )
            })}

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
              {sendingInput && (
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

        {/* Right sidebar — multi-tab: Info / CMD / Tasks / Clipboard */}
        <aside className="w-80 border-l border-slate-800 bg-slate-900 flex flex-col shrink-0">
          {/* Action toolbar */}
          {customerConnected && (
            <div className="px-2 py-2 border-b border-slate-800 flex items-center gap-1 flex-wrap">
              <Button size="sm" variant="ghost" className="h-7 px-2 text-slate-300 hover:text-white" onClick={toggleInputLock} title={inputLocked ? 'Unlock customer input' : 'Lock customer input'}>
                {inputLocked ? <Lock className="w-3.5 h-3.5 text-amber-400" /> : <Unlock className="w-3.5 h-3.5" />}
              </Button>
              <Button size="sm" variant="ghost" className="h-7 px-2 text-slate-300 hover:text-white" onClick={toggleScreenLock} title={screenLocked ? 'Unlock customer screen' : 'Lock customer screen'}>
                <Monitor className={`w-3.5 h-3.5 ${screenLocked ? 'text-amber-400' : ''}`} />
              </Button>
              <Button size="sm" variant="ghost" className="h-7 px-2 text-slate-300 hover:text-white" onClick={sendCAD} title="Send Ctrl+Alt+Del">
                <Keyboard className="w-3.5 h-3.5" />
              </Button>
              <Button size="sm" variant="ghost" className="h-7 px-2 text-slate-300 hover:text-white" onClick={getClipboard} title="Get customer clipboard">
                <Clipboard className="w-3.5 h-3.5" />
              </Button>
              <Button size="sm" variant="ghost" className="h-7 px-2 text-slate-300 hover:text-white" onClick={refreshMonitors} title="List monitors">
                <MonitorSmartphone className="w-3.5 h-3.5" />
              </Button>
              <Button size="sm" variant="ghost" className="h-7 px-2 text-amber-400 hover:text-amber-300" onClick={elevateSession} title="Restart with admin privileges (UAC)">
                <Shield className="w-3.5 h-3.5" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className={`h-7 px-2 ${
                  uacSecureDesktopEnabled === false
                    ? 'text-green-400 hover:text-green-300' // green = UAC prompts visible (disabled secure desktop)
                    : uacSecureDesktopEnabled === true
                    ? 'text-purple-400 hover:text-purple-300' // purple = secure desktop ON (default)
                    : 'text-slate-400 hover:text-slate-300' // gray = unknown
                }`}
                onClick={toggleUACSecureDesktop}
                title={
                  uacSecureDesktopEnabled === false
                    ? 'UAC Secure Desktop is DISABLED (you can interact with UAC prompts). Click to re-enable.'
                    : uacSecureDesktopEnabled === true
                    ? 'UAC Secure Desktop is ENABLED (cannot interact with UAC prompts). Click to disable.'
                    : 'UAC Secure Desktop status unknown. Click to query.'
                }
              >
                {uacSecureDesktopEnabled === false
                  ? <ShieldCheck className="w-3.5 h-3.5" />
                  : <ShieldAlert className="w-3.5 h-3.5" />
                }
              </Button>
              <Button size="sm" variant="ghost" className="h-7 px-2 text-emerald-400 hover:text-emerald-300" onClick={installUnattended} title="Setup unattended access on this machine">
                <MonitorSmartphone className="w-3.5 h-3.5" />
              </Button>
              <Button size="sm" variant="ghost" className="h-7 px-2 text-orange-400 hover:text-orange-300" onClick={removeUnattended} title="Remove unattended access (uninstall service)">
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
              <Button size="sm" variant="ghost" className="h-7 px-2 text-red-400 hover:text-red-300" onClick={rebootCustomer} title="Reboot customer machine">
                <Power className="w-3.5 h-3.5" />
              </Button>
            </div>
          )}

          {/* Monitor switcher + quality controls */}
          {customerConnected && monitors.length > 0 && (
            <div className="px-3 py-2 border-b border-slate-800 flex items-center gap-2 flex-wrap">
              <select
                className="bg-slate-800 text-slate-200 text-xs rounded px-2 py-1 border border-slate-700"
                value={currentMonitorIdx}
                onChange={(e) => switchMon(parseInt(e.target.value))}
              >
                {monitors.map((m) => (
                  <option key={m.index} value={m.index}>Monitor {m.index + 1} ({m.width}x{m.height})</option>
                ))}
              </select>
              <select
                className="bg-slate-800 text-slate-200 text-xs rounded px-2 py-1 border border-slate-700"
                value={`${qualityLevel}-${fpsLevel}`}
                onChange={(e) => {
                  const [q, f] = e.target.value.split('-').map(Number)
                  changeQuality(q, f)
                }}
              >
                <option value="80-30">High Quality</option>
                <option value="55-30">Balanced (default)</option>
                <option value="30-30">Low Bandwidth</option>
                <option value="55-15">Power Saver (15 FPS)</option>
                <option value="90-60">Max Quality (60 FPS)</option>
              </select>
            </div>
          )}

          {/* Tab buttons */}
          <div className="flex border-b border-slate-800">
            {(['info', 'cmd', 'events', 'tasks', 'clipboard'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => {
                  setActiveTab(tab)
                  if (tab === 'tasks') refreshProcesses()
                  if (tab === 'clipboard') getClipboard()
                  if (tab === 'events' && eventLogs.length === 0) fetchEventLogs(eventLogName)
                }}
                className={`flex-1 px-2 py-2 text-xs font-medium transition-colors ${
                  activeTab === tab ? 'bg-slate-800 text-[#FFC425] border-b-2 border-[#FFC425]' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab === 'info' && <FileText className="w-3.5 h-3.5 inline mr-1" />}
                {tab === 'cmd' && <Terminal className="w-3.5 h-3.5 inline mr-1" />}
                {tab === 'events' && <AlertCircle className="w-3.5 h-3.5 inline mr-1" />}
                {tab === 'tasks' && <Activity className="w-3.5 h-3.5 inline mr-1" />}
                {tab === 'clipboard' && <Clipboard className="w-3.5 h-3.5 inline mr-1" />}
                {tab === 'info' ? 'Info' : tab === 'cmd' ? 'CMD' : tab === 'events' ? 'Events' : tab === 'tasks' ? 'Tasks' : 'Clipboard'}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto">
            {activeTab === 'info' && (
              <div className="p-4 space-y-3 text-sm">
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
                      <span className="text-slate-500 text-xs">(you)</span>
                    </div>
                    {peers.map((p) => (
                      <div key={p.id} className="flex items-center gap-2 text-sm">
                        <div className="w-2 h-2 rounded-full bg-[#FFC425]" />
                        <span className="text-slate-200">{p.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
                {machineSpecs.os && (
                  <div>
                    <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">Customer Machine</p>
                    <div className="space-y-1 text-xs text-slate-300">
                      {machineSpecs.hostname && <div className="flex justify-between"><span className="text-slate-500">Hostname</span><span className="font-mono">{machineSpecs.hostname}</span></div>}
                      {machineSpecs.os && <div className="flex justify-between"><span className="text-slate-500">OS</span><span>{machineSpecs.os} {machineSpecs.arch && `(${machineSpecs.arch})`}</span></div>}
                      {machineSpecs.cpu && <div className="flex justify-between gap-2"><span className="text-slate-500 shrink-0">CPU</span><span className="text-right">{machineSpecs.cpu}</span></div>}
                      {machineSpecs.ram && <div className="flex justify-between"><span className="text-slate-500">RAM</span><span>{machineSpecs.ram}</span></div>}
                      {machineSpecs.screen && <div className="flex justify-between"><span className="text-slate-500">Screen</span><span className="font-mono">{machineSpecs.screen}</span></div>}
                    </div>
                  </div>
                )}
                {expandedSysInfo && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs text-slate-500 uppercase tracking-wide">System Details</p>
                      <button
                        onClick={getExpandedInfo}
                        className="text-slate-500 hover:text-[#FFC425] transition-colors"
                        title="Refresh system info"
                      >
                        <RefreshCw className="w-3 h-3" />
                      </button>
                    </div>
                    <div className="space-y-2 text-xs text-slate-300">
                      {expandedSysInfo.uptime && (
                        <div>
                          <span className="text-slate-500 font-medium">How long since last restart:</span>
                          <span className="ml-1">{expandedSysInfo.uptime}</span>
                        </div>
                      )}
                      {expandedSysInfo.cpus && (
                        <div>
                          <span className="text-slate-500 font-medium">CPU cores:</span>
                          <span className="ml-1">{expandedSysInfo.cpus}</span>
                        </div>
                      )}
                      {expandedSysInfo.disks && (
                        <div>
                          <p className="text-slate-500 font-medium mb-1">Disk space (Used / Free):</p>
                          <pre className="bg-slate-800 p-2 rounded text-[10px] overflow-x-auto max-h-32 scroll-thin">{expandedSysInfo.disks}</pre>
                        </div>
                      )}
                      {expandedSysInfo.network && (
                        <div>
                          <p className="text-slate-500 font-medium mb-1">Network adapters (IP addresses):</p>
                          <pre className="bg-slate-800 p-2 rounded text-[10px] overflow-x-auto max-h-32 scroll-thin">{expandedSysInfo.network}</pre>
                        </div>
                      )}
                      {expandedSysInfo.installed_software && (
                        <div>
                          <p className="text-slate-500 font-medium mb-1">Installed programs:</p>
                          <pre className="bg-slate-800 p-2 rounded text-[10px] overflow-y-auto max-h-48 scroll-thin">{expandedSysInfo.installed_software}</pre>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'cmd' && (
              <div className="flex flex-col h-full">
                {/* Quick actions */}
                <div className="px-2 py-1.5 border-b border-slate-800 flex flex-wrap gap-1">
                  <button onClick={() => { setCmdInput('eventvwr'); }} className="text-[10px] px-2 py-1 rounded bg-slate-800 text-slate-300 hover:bg-slate-700">Event Viewer</button>
                  <button onClick={() => { setCmdInput('taskmgr'); }} className="text-[10px] px-2 py-1 rounded bg-slate-800 text-slate-300 hover:bg-slate-700">Task Manager</button>
                  <button onClick={() => { setCmdInput('appwiz.cpl'); }} className="text-[10px] px-2 py-1 rounded bg-slate-800 text-slate-300 hover:bg-slate-700">Programs</button>
                  <button onClick={() => { setCmdInput('sysdm.cpl'); }} className="text-[10px] px-2 py-1 rounded bg-slate-800 text-slate-300 hover:bg-slate-700">System Props</button>
                  <button onClick={() => { setCmdInput('ncpa.cpl'); }} className="text-[10px] px-2 py-1 rounded bg-slate-800 text-slate-300 hover:bg-slate-700">Network</button>
                  <button onClick={() => { setCmdInput('services.msc'); }} className="text-[10px] px-2 py-1 rounded bg-slate-800 text-slate-300 hover:bg-slate-700">Services</button>
                  <button onClick={() => { setCmdInput('diskmgmt.msc'); }} className="text-[10px] px-2 py-1 rounded bg-slate-800 text-slate-300 hover:bg-slate-700">Disk Mgmt</button>
                  <button onClick={() => { setCmdInput('devmgmt.msc'); }} className="text-[10px] px-2 py-1 rounded bg-slate-800 text-slate-300 hover:bg-slate-700">Device Mgr</button>
                  <button onClick={() => { setCmdInput('ipconfig /all'); }} className="text-[10px] px-2 py-1 rounded bg-slate-800 text-slate-300 hover:bg-slate-700">IP Config</button>
                  <button onClick={() => { setCmdInput('systeminfo'); }} className="text-[10px] px-2 py-1 rounded bg-slate-800 text-slate-300 hover:bg-slate-700">Sys Info</button>
                  <button onClick={() => { setCmdInput('whoami /all'); }} className="text-[10px] px-2 py-1 rounded bg-slate-800 text-slate-300 hover:bg-slate-700">Whoami</button>
                  <button onClick={() => { setCmdInput('net user'); }} className="text-[10px] px-2 py-1 rounded bg-slate-800 text-slate-300 hover:bg-slate-700">Users</button>
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-2">
                  {cmdOutput.length === 0 ? (
                    <p className="text-slate-500 text-xs text-center py-4">Run a command on the customer&apos;s machine. Click a quick action above or type below.</p>
                  ) : (
                    cmdOutput.map((c) => (
                      <div key={c.id} className="bg-slate-800 rounded p-2">
                        <p className="text-[#FFC425] text-xs font-mono mb-1">$ {c.command}</p>
                        <pre className="text-slate-300 text-[11px] font-mono whitespace-pre overflow-x-auto max-h-64 overflow-y-auto scroll-thin leading-tight">{c.output?.replace(/\r\n/g, '\n').trim() || '(waiting for output...)'}</pre>
                      </div>
                    ))
                  )}
                </div>
                <div className="border-t border-slate-800 p-2 space-y-1.5">
                  <label className="flex items-center gap-1.5 text-[10px] text-slate-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={cmdElevated}
                      onChange={(e) => setCmdElevated(e.target.checked)}
                      className="w-3 h-3"
                    />
                    Run as Administrator (shows UAC prompt on customer's machine)
                  </label>
                  <div className="flex gap-1">
                    <Input
                      value={cmdInput}
                      onChange={(e) => setCmdInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') execCommand() }}
                      placeholder="Enter command..."
                      className="bg-slate-800 border-slate-700 text-slate-100 text-xs h-8 font-mono"
                    />
                    <Button size="sm" onClick={execCommand} disabled={!cmdInput.trim()} className="bg-[#1B3A6B] hover:bg-[#0F2A52] h-8 px-2">
                      <Send className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'events' && (
              <EventLogPanel
                eventLogs={eventLogs}
                eventLogName={eventLogName}
                onRefresh={() => fetchEventLogs(eventLogName)}
                onSwitchLog={(name) => {
                  setEventLogName(name)
                  fetchEventLogs(name)
                }}
              />
            )}

            {activeTab === 'tasks' && (
              <div className="flex flex-col h-full">
                <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800 shrink-0">
                  <span className="text-xs text-slate-400">Processes ({processList.length})</span>
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-slate-400" onClick={refreshProcesses}>
                    <RefreshCw className="w-3.5 h-3.5" />
                  </Button>
                </div>
                <div className="flex-1 overflow-auto scroll-thin">
                  {processList.length === 0 ? (
                    <p className="text-slate-500 text-xs text-center py-4">Click refresh to list processes.</p>
                  ) : (
                    <table className="w-full text-xs table-fixed">
                      <thead className="sticky top-0 bg-slate-900 z-10">
                        <tr className="text-slate-500 text-left">
                          <th className="px-2 py-1 w-12">PID</th>
                          <th className="px-2 py-1 truncate">Name</th>
                          <th className="px-2 py-1 text-right w-12">CPU</th>
                          <th className="px-2 py-1 text-right w-16">Mem</th>
                          <th className="px-1 py-1 w-8"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {processList.map((p) => (
                          <tr key={p.pid} className="border-t border-slate-800 hover:bg-slate-800">
                            <td className="px-2 py-1 text-slate-400 font-mono truncate">{p.pid}</td>
                            <td className="px-2 py-1 text-slate-200 truncate" title={p.name}>{p.name}</td>
                            <td className="px-2 py-1 text-right text-slate-400">{p.cpu}</td>
                            <td className="px-2 py-1 text-right text-slate-400">{p.memory}</td>
                            <td className="px-1 py-1">
                              <button onClick={() => killProc(p.pid)} className="text-red-500 hover:text-red-400" title="Kill process">
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'clipboard' && (
              <div className="flex flex-col h-full">
                <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800">
                  <span className="text-xs text-slate-400">Clipboard History</span>
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-slate-400" onClick={getClipboard}>
                    <RefreshCw className="w-3.5 h-3.5" />
                  </Button>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                  {clipboardHistory.length === 0 ? (
                    <p className="text-slate-500 text-xs text-center py-4">No clipboard history yet. Click refresh or paste text below to send.</p>
                  ) : (
                    clipboardHistory.map((item) => (
                      <div key={item.id} className="bg-slate-800 rounded p-2 group">
                        <div className="flex items-center justify-between mb-1">
                          <span className={`text-[10px] font-semibold ${item.direction === 'in' ? 'text-[#FFC425]' : 'text-blue-400'}`}>
                            {item.direction === 'in' ? '← From customer' : '→ To customer'}
                          </span>
                          <button
                            onClick={() => navigator.clipboard.writeText(item.text)}
                            className="text-slate-500 hover:text-slate-200 opacity-0 group-hover:opacity-100"
                            title="Copy to your clipboard"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                        </div>
                        <p className="text-xs text-slate-300 break-all line-clamp-3">{item.text || '(empty)'}</p>
                      </div>
                    ))
                  )}
                </div>
                <div className="border-t border-slate-800 p-2 space-y-1.5">
                  <Input
                    id="clipboard-input"
                    placeholder="Type text to send to customer..."
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                        sendClipboard(e.currentTarget.value.trim(), true)
                        e.currentTarget.value = ''
                      }
                    }}
                    className="bg-slate-800 border-slate-700 text-slate-100 text-xs h-8"
                  />
                  <Button
                    size="sm"
                    onClick={() => {
                      const input = document.getElementById('clipboard-input') as HTMLInputElement
                      if (input?.value?.trim()) {
                        sendClipboard(input.value.trim(), true)
                        input.value = ''
                      }
                    }}
                    className="bg-[#1B3A6B] hover:bg-[#0F2A52] h-8 px-2 w-full"
                  >
                    <Keyboard className="w-3.5 h-3.5 mr-1" />
                    Type as Keystrokes
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Remote uninstall — at the bottom */}
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

// ---------------------------------------------------------------------------
// EventLogPanel — clean, structured view of Windows Event Viewer logs.
// Renders each event as a colored card (red=Error, amber=Warning, blue=Info)
// instead of a cramped fixed-width table that doesn't fit in the sidebar.
// ---------------------------------------------------------------------------

interface EventLogEntry {
  id: string
  logName: string
  output: string
  pending?: boolean
}

interface ParsedEvent {
  time?: string
  id?: number
  level?: string
  provider?: string
  message?: string
}

function EventLogPanel({
  eventLogs,
  eventLogName,
  onRefresh,
  onSwitchLog,
}: {
  eventLogs: EventLogEntry[]
  eventLogName: 'System' | 'Application' | 'Security' | 'Setup'
  onRefresh: () => void
  onSwitchLog: (name: 'System' | 'Application' | 'Security' | 'Setup') => void
}) {
  const [filter, setFilter] = useState<'all' | 'error' | 'warning'>('all')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // Take the most recent fetch for the currently-selected log.
  const current = eventLogs.find((e) => e.logName === eventLogName && !e.pending)
    || eventLogs.find((e) => e.logName === eventLogName)
    || null

  // Parse the JSON output. If parsing fails (e.g. plain-text fallback from
  // wevtutil), display it as raw text.
  let parsedEvents: ParsedEvent[] = []
  let isPlainText = false
  if (current?.output && !current.pending) {
    if (current.output.startsWith('PLAIN_TEXT_FALLBACK:')) {
      isPlainText = true
    } else {
      try {
        const arr = JSON.parse(current.output)
        if (Array.isArray(arr)) {
          parsedEvents = arr
        }
      } catch {
        isPlainText = true
      }
    }
  }

  // Apply level filter
  const filtered = parsedEvents.filter((e) => {
    if (filter === 'all') return true
    const lvl = (e.level || '').toLowerCase()
    if (filter === 'error') return lvl.includes('error') || lvl.includes('critical')
    if (filter === 'warning') return lvl.includes('warn')
    return true
  })

  // Count by level for the filter badges
  const counts = {
    all: parsedEvents.length,
    error: parsedEvents.filter((e) => (e.level || '').toLowerCase().includes('error') || (e.level || '').toLowerCase().includes('critical')).length,
    warning: parsedEvents.filter((e) => (e.level || '').toLowerCase().includes('warn')).length,
  }

  const levelColor = (level?: string): { bg: string; text: string; border: string; dot: string } => {
    const l = (level || '').toLowerCase()
    if (l.includes('error') || l.includes('critical')) {
      return { bg: 'bg-red-950/40', text: 'text-red-300', border: 'border-red-800/50', dot: 'bg-red-500' }
    }
    if (l.includes('warn')) {
      return { bg: 'bg-amber-950/40', text: 'text-amber-300', border: 'border-amber-800/50', dot: 'bg-amber-500' }
    }
    if (l.includes('verbose') || l.includes('debug')) {
      return { bg: 'bg-slate-800/40', text: 'text-slate-400', border: 'border-slate-700/50', dot: 'bg-slate-500' }
    }
    return { bg: 'bg-blue-950/30', text: 'text-blue-300', border: 'border-blue-800/40', dot: 'bg-blue-500' }
  }

  const toggleExpand = (idx: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header: log selector + refresh */}
      <div className="px-2 py-2 border-b border-slate-800 flex items-center gap-1.5 shrink-0">
        <select
          className="bg-slate-800 text-slate-200 text-xs rounded px-2 py-1 border border-slate-700 flex-1"
          value={eventLogName}
          onChange={(e) => onSwitchLog(e.target.value as typeof eventLogName)}
        >
          <option value="System">System Log</option>
          <option value="Application">Application Log</option>
          <option value="Security">Security Log</option>
          <option value="Setup">Setup Log</option>
        </select>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-slate-300 hover:text-white"
          onClick={onRefresh}
          title="Refresh event logs"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${current?.pending ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* Filter pills */}
      {parsedEvents.length > 0 && (
        <div className="px-2 py-1.5 border-b border-slate-800 flex items-center gap-1 shrink-0">
          {(['all', 'error', 'warning'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-[10px] px-2 py-0.5 rounded-full transition-colors ${
                filter === f
                  ? f === 'error'
                    ? 'bg-red-900 text-red-200'
                    : f === 'warning'
                    ? 'bg-amber-900 text-amber-200'
                    : 'bg-slate-700 text-slate-100'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              {f === 'all' ? 'All' : f === 'error' ? 'Errors' : 'Warnings'}
              <span className="ml-1 opacity-70">{counts[f]}</span>
            </button>
          ))}
        </div>
      )}

      {/* Output */}
      <div className="flex-1 overflow-y-auto scroll-thin">
        {!current ? (
          <p className="text-slate-500 text-xs text-center py-8 px-4">
            No event logs loaded yet.
            <br />
            <button onClick={onRefresh} className="text-[#FFC425] hover:underline mt-2">
              Click here to fetch the latest {eventLogName} events.
            </button>
          </p>
        ) : current.pending ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-500">
            <RefreshCw className="w-6 h-6 animate-spin mb-2 text-[#FFC425]" />
            <p className="text-xs">Fetching {eventLogName} events…</p>
          </div>
        ) : isPlainText ? (
          // Plain-text fallback (wevtutil / journalctl output)
          <pre className="text-slate-300 text-[10px] whitespace-pre-wrap break-words p-2 font-mono">
            {current.output?.replace('PLAIN_TEXT_FALLBACK:\n', '')}
          </pre>
        ) : filtered.length === 0 ? (
          <p className="text-slate-500 text-xs text-center py-8 px-4">
            No {filter !== 'all' ? `${filter} events ` : ''}found in the {eventLogName} log.
          </p>
        ) : (
          <div className="p-2 space-y-1.5">
            {filtered.map((evt, i) => {
              const colors = levelColor(evt.level)
              const cardKey = `${current.id}-${i}`
              const isExpanded = expanded.has(cardKey)
              const message = evt.message || '(no message)'
              const shouldTruncate = message.length > 120 && !isExpanded
              return (
                <div
                  key={cardKey}
                  className={`rounded border ${colors.border} ${colors.bg} p-2 cursor-pointer transition-colors hover:bg-opacity-60`}
                  onClick={() => toggleExpand(cardKey)}
                >
                  {/* Top row: time + level badge */}
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${colors.dot}`} />
                      <span className="text-[10px] text-slate-400 font-mono truncate">
                        {evt.time || 'unknown time'}
                      </span>
                    </div>
                    {evt.level && (
                      <span className={`text-[9px] font-semibold uppercase tracking-wide ${colors.text} shrink-0`}>
                        {evt.level}
                      </span>
                    )}
                  </div>
                  {/* Provider + Event ID */}
                  <div className="flex items-center gap-2 mb-1 text-[10px]">
                    {evt.provider && (
                      <span className="text-slate-300 truncate" title={evt.provider}>
                        {evt.provider}
                      </span>
                    )}
                    {evt.id !== undefined && evt.id !== 0 && (
                      <span className="text-slate-500 font-mono shrink-0">
                        ID: {evt.id}
                      </span>
                    )}
                  </div>
                  {/* Message */}
                  <p className={`text-[11px] text-slate-200 leading-snug ${shouldTruncate ? 'line-clamp-2' : ''}`}>
                    {message}
                  </p>
                  {message.length > 120 && (
                    <span className="text-[9px] text-[#FFC425] mt-0.5 inline-block">
                      {isExpanded ? 'Click to collapse' : 'Click to expand'}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Footer: event count */}
      {parsedEvents.length > 0 && (
        <div className="px-3 py-1.5 border-t border-slate-800 bg-slate-950/50 shrink-0">
          <p className="text-[10px] text-slate-500 text-center">
            Showing {filtered.length} of {parsedEvents.length} events from {eventLogName} log
          </p>
        </div>
      )}
    </div>
  )
}
