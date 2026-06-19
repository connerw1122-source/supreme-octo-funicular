'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  ArrowLeft,
  ShieldCheck,
  Loader2,
  PhoneCall,
  Lock,
  Monitor,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react'
import { toast } from 'sonner'

interface BrowserShareProps {
  code: string
  name: string
  onBack: () => void
}

export function BrowserShare({ code, name, onBack }: BrowserShareProps) {
  const [status, setStatus] = useState<'connecting' | 'sharing' | 'error'>('connecting')
  const [errorMsg, setErrorMsg] = useState('')
  const wsRef = useRef<WebSocket | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    let cancelled = false

    async function start() {
      try {
        // 1. Get the screen share stream
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: 30 },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream

        // 2. Connect to the signaling server via WebSocket
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
        let wsUrl: string
        const port = window.location.port
        if (port === '3000' || port === '81' || port === '') {
          wsUrl = `${proto}//${window.location.host}/`
        } else {
          wsUrl = `${proto}//${window.location.hostname}:3003/`
        }
        const ws = new WebSocket(wsUrl)
        ws.binaryType = 'arraybuffer'
        wsRef.current = ws

        ws.onopen = () => {
          // Join the room as a customer
          ws.send(JSON.stringify({
            type: 'join-room',
            roomCode: code,
            role: 'customer',
            name: name || 'Chromebook user',
          }))
          // Send machine specs
          ws.send(JSON.stringify({
            type: 'machine-specs',
            os: navigator.platform || 'ChromeOS',
            hostname: 'chromebook',
            cpu: navigator.hardwareConcurrency + ' cores',
            ram: (navigator as any).deviceMemory ? (navigator as any).deviceMemory + ' GB' : 'unknown',
            screen: `${window.screen.width}x${window.screen.height}`,
            arch: 'browser',
          }))
          setStatus('sharing')
          toast.success('Connected to your technician')
        }

        ws.onclose = () => {
          if (!cancelled) {
            setStatus('error')
            setErrorMsg('Connection closed')
          }
        }

        ws.onerror = () => {
          setStatus('error')
          setErrorMsg('Connection error')
        }

        ws.onmessage = (event) => {
          // We don't process input events in browser mode (view-only)
          // Just listen for session-ended
          try {
            const msg = JSON.parse(event.data)
            if (msg.type === 'session-ended') {
              toast.info('Session ended')
              cleanup()
              onBack()
            }
          } catch {}
        }

        // 3. Start capturing frames from the video stream and sending them
        const video = document.createElement('video')
        video.srcObject = stream
        video.autoplay = true
        video.muted = true
        video.play()

        const canvas = canvasRef.current!
        const ctx = canvas.getContext('2d')!

        // Send frames at ~15 FPS (lower than the Go client to save bandwidth
        // for browser-based sharing)
        intervalRef.current = setInterval(() => {
          if (ws.readyState !== WebSocket.OPEN) return
          if (video.videoWidth === 0) return
          // Scale down to max 1280 wide for bandwidth
          const scale = Math.min(1, 1280 / video.videoWidth)
          canvas.width = video.videoWidth * scale
          canvas.height = video.videoHeight * scale
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
          canvas.toBlob((blob) => {
            if (!blob || ws.readyState !== WebSocket.OPEN) return
            blob.arrayBuffer().then((buf) => {
              ws.send(buf)
            })
          }, 'image/jpeg', 0.5)
        }, 66) // ~15 FPS

        // Handle the user stopping screen share via browser UI
        stream.getVideoTracks()[0].addEventListener('ended', () => {
          toast.info('Screen sharing stopped')
          cleanup()
          onBack()
        })
      } catch (err: any) {
        if (cancelled) return
        setStatus('error')
        if (err?.name === 'NotAllowedError') {
          setErrorMsg('You need to allow screen sharing to continue.')
        } else {
          setErrorMsg(err?.message ?? 'Could not start screen sharing')
        }
      }
    }

    function cleanup() {
      cancelled = true
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop())
        streamRef.current = null
      }
    }

    start()
    return cleanup
  }, [code, name, onBack])

  if (status === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-amber-50 px-4">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center">
            <div className="w-14 h-14 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="w-7 h-7" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 mb-2">Could not start screen sharing</h1>
            <p className="text-slate-600 mb-6">{errorMsg}</p>
            <Button onClick={onBack} className="bg-amber-600 hover:bg-amber-700">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to start
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (status === 'connecting') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-amber-50">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-amber-600 mx-auto mb-3" />
          <p className="text-amber-900">Starting screen share…</p>
          <p className="text-sm text-amber-700 mt-1">Your browser will ask permission to share your screen.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-amber-50 flex flex-col">
      <header className="border-b bg-white">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded bg-[#1B3A6B] text-[#FFC425] flex items-center justify-center font-black text-lg">
              M
            </div>
            <span className="text-lg font-bold tracking-tight text-[#1B3A6B]">MarqueeIT</span>
          </div>
          <Button variant="ghost" size="sm" onClick={onBack} className="text-slate-600">
            <ArrowLeft className="w-4 h-4 mr-1" />
            End session
          </Button>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <Card className="max-w-md w-full border-amber-200">
          <CardContent className="p-8 text-center">
            <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="w-7 h-7" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 mb-2">You&apos;re connected!</h1>
            <p className="text-slate-600 mb-4">
              Your screen is being shared with your technician.
              Code: <span className="font-mono font-bold text-[#1B3A6B]">{code}</span>
            </p>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-left">
              <div className="flex items-start gap-2">
                <Monitor className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                <div className="text-sm text-amber-900">
                  <p className="font-medium mb-1">Browser mode (view-only)</p>
                  <p className="text-xs text-amber-700">
                    Your technician can see your screen but cannot control it remotely.
                    For full remote control, use the downloadable app on a Windows, Mac, or Linux computer.
                  </p>
                </div>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-center gap-1.5 text-xs text-slate-500">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
              Close this tab or click "End session" to stop sharing.
            </div>
          </CardContent>
        </Card>
      </main>

      {/* Hidden canvas for frame capture */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </div>
  )
}
