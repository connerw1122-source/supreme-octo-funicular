'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  ArrowLeft,
  Monitor,
  ShieldCheck,
  Loader2,
  CheckCircle2,
  PhoneCall,
  Lock,
  Download,
  MousePointer2,
  Eye,
  Apple,
  Monitor as MonitorIcon,
} from 'lucide-react'
import { toast } from 'sonner'

type Step = 'choose-method' | 'enter-name' | 'ready' | 'sharing' | 'waiting' | 'connected' | 'error'

interface CustomerJoinProps {
  code: string
  onBack: () => void
  onConnected: (sessionId: string, customerName: string, localStream: MediaStream) => void
}

interface SessionInfo {
  id: string
  code: string
  title: string
  technician: { id: string; name: string } | null
  status: string
}

export function CustomerJoin({ code, onBack, onConnected }: CustomerJoinProps) {
  const [step, setStep] = useState<Step>('choose-method')
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null)
  const [customerName, setCustomerName] = useState('')
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [errorMsg, setErrorMsg] = useState<string>('')
  const [loadingSession, setLoadingSession] = useState(true)

  // Lookup session by code
  useEffect(() => {
    let cancelled = false
    async function lookup() {
      try {
        const res = await fetch(`/api/sessions/${code.toUpperCase()}`)
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error ?? 'Session not found')
        }
        const data = await res.json()
        if (cancelled) return
        setSessionInfo(data)
      } catch (err: any) {
        if (cancelled) return
        setErrorMsg(err?.message ?? 'Session not found')
        setStep('error')
      } finally {
        if (!cancelled) setLoadingSession(false)
      }
    }
    lookup()
    return () => {
      cancelled = true
    }
  }, [code])

  const handleStart = async () => {
    if (!customerName.trim() || !sessionInfo) return
    try {
      // Tell backend the customer joined
      const res = await fetch(`/api/sessions/${sessionInfo.code}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerName: customerName.trim() }),
      })
      if (!res.ok) throw new Error('Failed to join session')

      setStep('ready')
    } catch (err: any) {
      toast.error(err?.message ?? 'Could not join session')
    }
  }

  const startScreenShare = async () => {
    if (!sessionInfo) return
    try {
      setStep('sharing')
      // Prompt user to pick a screen/window/tab to share
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 10 },
        audio: false, // Keep it simple for older users
      })
      setLocalStream(stream)
      // If the user stops sharing via browser UI, end gracefully
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        // They clicked "Stop sharing" in the browser
        toast.info('Screen sharing stopped')
      })
      setStep('connected')
      // Notify parent
      onConnected(sessionInfo.id, customerName.trim(), stream)
    } catch (err: any) {
      console.error(err)
      if (err?.name === 'NotAllowedError') {
        toast.error('You need to allow screen sharing to continue.')
      } else {
        toast.error('Could not start screen sharing. Please try again.')
      }
      setStep('ready')
    }
  }

  if (loadingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-amber-50">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-amber-600 mx-auto mb-3" />
          <p className="text-amber-900">Looking up your session…</p>
        </div>
      </div>
    )
  }

  if (step === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-amber-50 px-4">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center">
            <div className="w-14 h-14 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto mb-4">
              <PhoneCall className="w-7 h-7" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 mb-2">We couldn&apos;t find that session</h1>
            <p className="text-slate-600 mb-1">Code: <span className="font-mono font-bold">{code}</span></p>
            <p className="text-slate-600 mb-6">{errorMsg}</p>
            <p className="text-sm text-slate-500 mb-6">
              Please double-check the code with your technician and try again.
            </p>
            <Button onClick={onBack} className="bg-amber-600 hover:bg-amber-700">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to start
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-orange-50">
      <header className="border-b bg-white/80 backdrop-blur">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back
          </Button>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Lock className="w-3.5 h-3.5" />
            Secure connection
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-10 md:py-16">
        <div className="max-w-2xl mx-auto">
          {/* Session header card */}
          {sessionInfo && (
            <Card className="mb-6 border-amber-200 bg-white">
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-amber-700 font-semibold mb-1">
                      Your support session
                    </p>
                    <h2 className="text-xl font-bold text-slate-900">{sessionInfo.title}</h2>
                    {sessionInfo.technician && (
                      <p className="text-sm text-slate-600 mt-1">
                        with <span className="font-semibold">{sessionInfo.technician.name}</span>
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-slate-500">Your code</p>
                    <p className="font-mono font-bold text-2xl tracking-wider text-amber-700">
                      {sessionInfo.code}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Step: choose method (download app vs browser) */}
          {step === 'choose-method' && (
            <div className="space-y-4">
              <Card className="border-emerald-300 bg-gradient-to-br from-emerald-50 to-white">
                <CardContent className="p-7">
                  <div className="flex items-start gap-4 mb-5">
                    <div className="w-12 h-12 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0">
                      <Download className="w-6 h-6" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-xl font-bold text-slate-900">Download the customer app</h3>
                        <span className="px-2 py-0.5 bg-emerald-600 text-white text-[10px] font-bold rounded-full">
                          RECOMMENDED
                        </span>
                      </div>
                      <p className="text-slate-700">
                        Best for full help. Your technician will be able to see your screen AND
                        move your mouse / type for you — just like sitting next to you.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <p className="text-sm font-semibold text-slate-900">Choose your computer type:</p>
                    <div className="grid sm:grid-cols-2 gap-3">
                      <a
                        href="/downloads/install_windows.bat"
                        download
                        className="flex items-center gap-3 p-4 rounded-lg bg-white border-2 border-slate-200 hover:border-emerald-400 hover:bg-emerald-50 transition-colors group"
                      >
                        <MonitorIcon className="w-7 h-7 text-slate-700 group-hover:text-emerald-700" />
                        <div>
                          <p className="font-semibold text-slate-900">Windows</p>
                          <p className="text-xs text-slate-500">Windows 10 or newer</p>
                        </div>
                      </a>
                      <a
                        href="/downloads/install_mac_linux.sh"
                        download
                        className="flex items-center gap-3 p-4 rounded-lg bg-white border-2 border-slate-200 hover:border-emerald-400 hover:bg-emerald-50 transition-colors group"
                      >
                        <Apple className="w-7 h-7 text-slate-700 group-hover:text-emerald-700" />
                        <div>
                          <p className="font-semibold text-slate-900">Mac / Linux</p>
                          <p className="text-xs text-slate-500">macOS 11+ or any Linux</p>
                        </div>
                      </a>
                    </div>
                  </div>

                  <div className="mt-5 p-4 bg-white/70 rounded-lg border border-emerald-200">
                    <p className="text-sm font-semibold text-emerald-900 mb-2">After downloading:</p>
                    <ol className="space-y-1.5 text-sm text-slate-700">
                      <li className="flex gap-2">
                        <span className="font-bold text-emerald-700">1.</span>
                        <span>Double-click the downloaded file to run it.</span>
                      </li>
                      <li className="flex gap-2">
                        <span className="font-bold text-emerald-700">2.</span>
                        <span>When it asks for a code, type: <span className="font-mono font-bold text-lg text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded">{code}</span></span>
                      </li>
                      <li className="flex gap-2">
                        <span className="font-bold text-emerald-700">3.</span>
                        <span>Type your first name when prompted.</span>
                      </li>
                      <li className="flex gap-2">
                        <span className="font-bold text-emerald-700">4.</span>
                        <span>A small status window will appear — that means your technician is connected. Leave it open until they&apos;re done.</span>
                      </li>
                    </ol>
                  </div>

                  <div className="mt-5 flex items-center gap-2 text-xs text-slate-500">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    <span>Safe to run. Closes completely when your technician is done. Nothing is installed permanently.</span>
                  </div>
                </CardContent>
              </Card>

              <div className="text-center">
                <p className="text-sm text-slate-500 mb-3">
                  Don&apos;t want to download anything? You can also join in your browser —
                  your technician will be able to see but not control your screen.
                </p>
                <Button
                  variant="outline"
                  size="lg"
                  className="border-amber-400 text-amber-700 hover:bg-amber-50"
                  onClick={() => setStep('enter-name')}
                >
                  <Eye className="w-4 h-4 mr-2" />
                  Continue in browser (view only)
                </Button>
              </div>
            </div>
          )}

          {/* Step: enter name */}
          {step === 'enter-name' && (
            <Card className="border-amber-200">
              <CardContent className="p-8">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center font-bold">
                    1
                  </div>
                  <h3 className="text-xl font-semibold text-slate-900">What&apos;s your name?</h3>
                </div>
                <p className="text-slate-600 mb-4">
                  This helps your technician know who they&apos;re helping today.
                </p>
                <div className="space-y-2">
                  <Label htmlFor="cust-name" className="text-base">Your first name</Label>
                  <Input
                    id="cust-name"
                    placeholder="e.g. Margaret"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && customerName.trim()) handleStart()
                    }}
                    className="text-lg h-12"
                    autoFocus
                  />
                </div>
                <div className="flex items-center gap-2 mt-3 text-xs text-slate-500">
                  <Eye className="w-3.5 h-3.5" />
                  Browser mode: your technician can see but not control your screen.
                  For full help,{' '}
                  <button
                    onClick={() => setStep('choose-method')}
                    className="text-emerald-700 underline font-medium"
                  >
                    download the app instead
                  </button>
                  .
                </div>
                <Button
                  className="w-full mt-6 h-12 text-base bg-amber-600 hover:bg-amber-700"
                  disabled={!customerName.trim()}
                  onClick={handleStart}
                >
                  Continue
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Step: ready to share */}
          {step === 'ready' && (
            <Card className="border-amber-200">
              <CardContent className="p-8">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center font-bold">
                    2
                  </div>
                  <h3 className="text-xl font-semibold text-slate-900">Share your screen</h3>
                </div>
                <p className="text-slate-600 mb-5">
                  Click the button below, then pick the screen you want to share. Your browser will
                  ask permission — click <span className="font-semibold">Allow</span> or <span className="font-semibold">Share</span>.
                </p>

                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-5">
                  <p className="text-sm text-amber-900 font-medium mb-2">What happens next:</p>
                  <ol className="space-y-2 text-sm text-amber-900">
                    <li className="flex items-start gap-2">
                      <span className="font-bold">1.</span>
                      <span>Your browser will show a window asking what to share.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="font-bold">2.</span>
                      <span>Click on <span className="font-semibold">Entire screen</span> at the top, then click <span className="font-semibold">Share</span>.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="font-bold">3.</span>
                      <span>Your technician will see your screen and start helping.</span>
                    </li>
                  </ol>
                </div>

                <Button
                  className="w-full h-14 text-lg bg-amber-600 hover:bg-amber-700"
                  onClick={startScreenShare}
                >
                  <Monitor className="w-5 h-5 mr-2" />
                  Share my screen
                </Button>

                <div className="mt-4 flex items-center justify-center gap-2 text-xs text-slate-500">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  Your technician can only see what you share — nothing else.
                </div>
              </CardContent>
            </Card>
          )}

          {/* Step: sharing (transition) */}
          {step === 'sharing' && (
            <Card className="border-amber-200">
              <CardContent className="p-12 text-center">
                <Loader2 className="w-12 h-12 animate-spin text-amber-600 mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-slate-900 mb-2">Waiting for permission…</h3>
                <p className="text-slate-600">
                  Please click <span className="font-semibold">Share</span> in the popup window.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Step: connected */}
          {step === 'connected' && (
            <Card className="border-emerald-200 bg-emerald-50">
              <CardContent className="p-8 text-center">
                <CheckCircle2 className="w-16 h-16 text-emerald-600 mx-auto mb-4" />
                <h3 className="text-2xl font-bold text-slate-900 mb-2">You&apos;re connected!</h3>
                <p className="text-slate-600 mb-4">
                  Your screen is now being shared with your technician. Loading the support room…
                </p>
                <Loader2 className="w-6 h-6 animate-spin text-emerald-600 mx-auto" />
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  )
}
