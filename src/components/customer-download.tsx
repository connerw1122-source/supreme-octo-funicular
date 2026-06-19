'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  ArrowLeft,
  ShieldCheck,
  Loader2,
  PhoneCall,
  Lock,
  Download,
  Apple,
  Monitor as MonitorIcon,
  Copy,
  Check,
  Chrome,
  Globe,
  Info,
} from 'lucide-react'
import { toast } from 'sonner'

interface CustomerDownloadProps {
  code: string
  onBack: () => void
}

interface SessionInfo {
  id: string
  code: string
  title: string
  technician: { id: string; name: string } | null
  status: string
}

type Browser = 'chrome' | 'edge' | 'firefox' | 'safari' | 'other'
type OS = 'windows' | 'mac' | 'linux' | 'other'

function detectBrowser(): Browser {
  if (typeof navigator === 'undefined') return 'other'
  const ua = navigator.userAgent
  if (/Edg\//i.test(ua)) return 'edge'
  if (/Chrome/i.test(ua) && !/Chromium/i.test(ua)) return 'chrome'
  if (/Firefox/i.test(ua)) return 'firefox'
  if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) return 'safari'
  return 'other'
}

function detectOS(): OS {
  if (typeof navigator === 'undefined') return 'other'
  const ua = navigator.userAgent
  const platform = (navigator.platform || '').toLowerCase()
  if (/Win/i.test(ua) || /win/i.test(platform)) return 'windows'
  if (/Mac/i.test(ua) || /mac/i.test(platform)) return 'mac'
  if (/Linux/i.test(ua) && !/Android/i.test(ua)) return 'linux'
  return 'other'
}

export function CustomerDownload({ code, onBack }: CustomerDownloadProps) {
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null)
  const [errorMsg, setErrorMsg] = useState<string>('')
  const [loadingSession, setLoadingSession] = useState(true)
  const [copied, setCopied] = useState(false)
  const [downloadStarted, setDownloadStarted] = useState<'windows' | 'mac' | 'linux' | null>(null)

  const browser = useMemo(detectBrowser, [])
  const os = useMemo(detectOS, [])

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
      } finally {
        if (!cancelled) setLoadingSession(false)
      }
    }
    lookup()
    return () => {
      cancelled = true
    }
  }, [code])

  const copyCode = () => {
    navigator.clipboard.writeText(code.toUpperCase())
    setCopied(true)
    toast.success('Code copied')
    setTimeout(() => setCopied(false), 2000)
  }

  const startDownload = (which: 'windows' | 'mac' | 'linux') => {
    setDownloadStarted(which)
    const urls = {
      windows: '/downloads/marqueeit-client-windows.exe',
      mac: '/downloads/marqueeit-client-mac',
      linux: '/downloads/marqueeit-client-linux',
    }
    const names = {
      windows: 'marqueeit-client-windows.exe',
      mac: 'marqueeit-client-mac',
      linux: 'marqueeit-client-linux',
    }
    const a = document.createElement('a')
    a.href = urls[which]
    a.download = names[which]
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    toast.success('Download started')
  }

  if (loadingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-[#1B3A6B] mx-auto mb-3" />
          <p className="text-slate-700">Looking up your session…</p>
        </div>
      </div>
    )
  }

  if (errorMsg) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center">
            <div className="w-14 h-14 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto mb-4">
              <PhoneCall className="w-7 h-7" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 mb-2">We couldn&apos;t find that session</h1>
            <p className="text-slate-600 mb-1">Code: <span className="font-mono font-bold">{code}</span></p>
            <p className="text-slate-600 mb-6">{errorMsg}</p>
            <Button onClick={onBack} className="bg-[#1B3A6B] hover:bg-[#0F2A52]">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to start
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
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
            Back
          </Button>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-4 py-8">
        <div className="max-w-2xl mx-auto">
          {/* Session header */}
          {sessionInfo && (
            <Card className="mb-5 border-slate-200 bg-white">
              <CardContent className="p-4 flex items-start justify-between gap-4 flex-wrap">
                <div className="min-w-0 flex-1">
                  <p className="text-xs uppercase tracking-wide text-[#1B3A6B] font-semibold mb-0.5">
                    Your support session
                  </p>
                  <h2 className="text-lg font-bold text-slate-900">{sessionInfo.title}</h2>
                  {sessionInfo.technician && (
                    <p className="text-sm text-slate-600 mt-0.5">
                      with <span className="font-semibold">{sessionInfo.technician.name}</span>
                    </p>
                  )}
                </div>
                <button
                  onClick={copyCode}
                  className="text-right bg-[#FFC425]/15 hover:bg-[#FFC425]/30 transition-colors rounded-lg p-2.5 border border-[#FFC425]/50"
                  title="Click to copy"
                >
                  <p className="text-[10px] text-slate-600 uppercase tracking-wide">Your code</p>
                  <p className="font-mono font-bold text-xl tracking-wider text-[#1B3A6B] flex items-center gap-1">
                    {sessionInfo.code}
                    {copied ? <Check className="w-3.5 h-3.5 text-[#1B3A6B]" /> : <Copy className="w-3 h-3 text-slate-400" />}
                  </p>
                </button>
              </CardContent>
            </Card>
          )}

          {/* Download card */}
          <Card className="border-slate-200 shadow-sm">
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-11 h-11 rounded-lg bg-[#1B3A6B] text-[#FFC425] flex items-center justify-center shrink-0">
                  <Download className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-xl font-bold text-slate-900">Download the helper app</h3>
                  <p className="text-sm text-slate-600">Lets your technician see and control your screen.</p>
                </div>
              </div>

              {/* Step 1: pick your computer type */}
              <div className="mb-5">
                <div className="flex items-center gap-2 mb-2.5">
                  <div className="w-6 h-6 rounded-full bg-[#1B3A6B] text-white flex items-center justify-center text-xs font-bold">1</div>
                  <h4 className="font-semibold text-slate-900">Pick your computer type</h4>
                </div>

                <div className="grid sm:grid-cols-3 gap-3">
                  <button
                    onClick={() => startDownload('windows')}
                    className={`flex flex-col items-center gap-2 p-4 rounded-lg bg-white border-2 transition-all text-center ${
                      downloadStarted === 'windows'
                        ? 'border-[#1B3A6B] bg-[#1B3A6B]/5'
                        : 'border-slate-200 hover:border-[#1B3A6B] hover:bg-[#1B3A6B]/5'
                    } ${os === 'windows' ? 'ring-2 ring-[#FFC425] ring-offset-1' : ''}`}
                  >
                    <MonitorIcon className="w-8 h-8 text-slate-700" />
                    <div>
                      <div className="flex items-center justify-center gap-2">
                        <p className="font-semibold text-slate-900">Windows</p>
                        {os === 'windows' && (
                          <span className="px-1.5 py-0.5 bg-[#FFC425] text-[#1B3A6B] text-[9px] font-bold rounded uppercase">Yours</span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500">Windows 10+</p>
                    </div>
                    <Download className="w-4 h-4 text-slate-400" />
                  </button>

                  <button
                    onClick={() => startDownload('mac')}
                    className={`flex flex-col items-center gap-2 p-4 rounded-lg bg-white border-2 transition-all text-center ${
                      downloadStarted === 'mac'
                        ? 'border-[#1B3A6B] bg-[#1B3A6B]/5'
                        : 'border-slate-200 hover:border-[#1B3A6B] hover:bg-[#1B3A6B]/5'
                    } ${os === 'mac' ? 'ring-2 ring-[#FFC425] ring-offset-1' : ''}`}
                  >
                    <Apple className="w-8 h-8 text-slate-700" />
                    <div>
                      <div className="flex items-center justify-center gap-2">
                        <p className="font-semibold text-slate-900">Mac</p>
                        {os === 'mac' && (
                          <span className="px-1.5 py-0.5 bg-[#FFC425] text-[#1B3A6B] text-[9px] font-bold rounded uppercase">Yours</span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500">macOS 11+</p>
                    </div>
                    <Download className="w-4 h-4 text-slate-400" />
                  </button>

                  <button
                    onClick={() => startDownload('linux')}
                    className={`flex flex-col items-center gap-2 p-4 rounded-lg bg-white border-2 transition-all text-center ${
                      downloadStarted === 'linux'
                        ? 'border-[#1B3A6B] bg-[#1B3A6B]/5'
                        : 'border-slate-200 hover:border-[#1B3A6B] hover:bg-[#1B3A6B]/5'
                    } ${os === 'linux' ? 'ring-2 ring-[#FFC425] ring-offset-1' : ''}`}
                  >
                    <MonitorIcon className="w-8 h-8 text-slate-700" />
                    <div>
                      <div className="flex items-center justify-center gap-2">
                        <p className="font-semibold text-slate-900">Linux</p>
                        {os === 'linux' && (
                          <span className="px-1.5 py-0.5 bg-[#FFC425] text-[#1B3A6B] text-[9px] font-bold rounded uppercase">Yours</span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500">Any Linux</p>
                    </div>
                    <Download className="w-4 h-4 text-slate-400" />
                  </button>
                </div>
              </div>

              {/* Step 2: open the file - browser-specific instructions */}
              <div className="mb-5">
                <div className="flex items-center gap-2 mb-2.5">
                  <div className="w-6 h-6 rounded-full bg-[#1B3A6B] text-white flex items-center justify-center text-xs font-bold">2</div>
                  <h4 className="font-semibold text-slate-900">Open the downloaded file</h4>
                </div>
                <BrowserInstructions browser={browser} os={os} />
              </div>

              {/* Step 3: enter the code */}
              <div>
                <div className="flex items-center gap-2 mb-2.5">
                  <div className="w-6 h-6 rounded-full bg-[#1B3A6B] text-white flex items-center justify-center text-xs font-bold">3</div>
                  <h4 className="font-semibold text-slate-900">Type in your code when asked</h4>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 flex items-center justify-between gap-3">
                  <p className="font-mono font-bold text-2xl tracking-[0.2em] text-[#1B3A6B]">{code.toUpperCase()}</p>
                  <Button onClick={copyCode} variant="outline" size="sm" className="border-[#1B3A6B] text-[#1B3A6B] hover:bg-[#1B3A6B] hover:text-white">
                    {copied ? <Check className="w-4 h-4 mr-1" /> : <Copy className="w-4 h-4 mr-1" />}
                    Copy
                  </Button>
                </div>
              </div>

              {/* Safety note */}
              <div className="mt-5 p-3 bg-[#1B3A6B]/5 border border-[#1B3A6B]/20 rounded-lg flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 text-[#1B3A6B] shrink-0 mt-0.5" />
                <p className="text-xs text-slate-700">
                  Runs only during this session. Nothing is installed permanently.
                </p>
              </div>
            </CardContent>
          </Card>

          <p className="text-center text-xs text-slate-500 mt-4 flex items-center justify-center gap-1.5">
            <Info className="w-3.5 h-3.5" />
            Stuck? Call your technician.
          </p>
        </div>
      </main>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Browser-specific instructions
// ---------------------------------------------------------------------------

function BrowserInstructions({ browser, os }: { browser: Browser; os: OS }) {
  const browserName = {
    chrome: 'Chrome',
    edge: 'Edge',
    firefox: 'Firefox',
    safari: 'Safari',
    other: 'your browser',
  }[browser]

  const BrowserIcon = browser === 'chrome' ? Chrome : browser === 'edge' ? Globe : Globe

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
        <BrowserIcon className="w-4 h-4 text-slate-600" />
        <span className="text-sm font-medium text-slate-700">
          For {browserName}{os !== 'other' ? ` on ${os === 'mac' ? 'Mac' : os === 'windows' ? 'Windows' : 'Linux'}` : ''}
        </span>
      </div>
      <div className="p-3">
        {browser === 'chrome' && <ChromeInstructions os={os} />}
        {browser === 'edge' && <EdgeInstructions os={os} />}
        {browser === 'firefox' && <FirefoxInstructions os={os} />}
        {browser === 'safari' && <SafariInstructions />}
        {browser === 'other' && <GenericInstructions os={os} />}
      </div>
    </div>
  )
}

function ChromeInstructions({ os }: { os: OS }) {
  return (
    <ol className="space-y-2 text-sm text-slate-700">
      <li className="flex gap-2">
        <span className="font-bold text-[#1B3A6B] shrink-0">1.</span>
        <span>Look at the <strong>top-right corner</strong> of this browser. Click the downloaded file box with the down arrow.</span>
      </li>
      <li className="flex gap-2">
        <span className="font-bold text-[#1B3A6B] shrink-0">2.</span>
        <span>
          {os === 'windows' && ' If Windows shows "protected your PC", click "More info" then "Run anyway".'}
          {os === 'mac' && ' On Mac, right-click (or Control-click) the file and choose "Open" the first time.'}
          {!['windows', 'mac'].includes(os) && ' Click to open the file.'}
        </span>
      </li>
      <li className="flex gap-2">
        <span className="font-bold text-[#1B3A6B] shrink-0">3.</span>
        <span>A black window opens and sets things up. When it asks for your code, type it in.</span>
      </li>
      <li className="flex gap-2">
        <span className="font-bold text-[#1B3A6B] shrink-0">4.</span>
        <span>Type your first name. A "MarqueeIT Active" window appears — leave it open.</span>
      </li>
    </ol>
  )
}

function EdgeInstructions({ os }: { os: OS }) {
  return (
    <ol className="space-y-2 text-sm text-slate-700">
      <li className="flex gap-2">
        <span className="font-bold text-[#1B3A6B] shrink-0">1.</span>
        <span>Click the <strong>download arrow</strong> (top-right, near the star).</span>
      </li>
      <li className="flex gap-2">
        <span className="font-bold text-[#1B3A6B] shrink-0">2.</span>
        <span>
          Click <strong>Open</strong> on the file.
          {os === 'windows' && ' If Windows shows "protected your PC", click "More info" then "Run anyway".'}
        </span>
      </li>
      <li className="flex gap-2">
        <span className="font-bold text-[#1B3A6B] shrink-0">3.</span>
        <span>A black window opens and sets things up. Type your code when asked.</span>
      </li>
      <li className="flex gap-2">
        <span className="font-bold text-[#1B3A6B] shrink-0">4.</span>
        <span>Type your first name. Leave the "MarqueeIT Active" window open.</span>
      </li>
    </ol>
  )
}

function FirefoxInstructions({ os }: { os: OS }) {
  return (
    <ol className="space-y-2 text-sm text-slate-700">
      <li className="flex gap-2">
        <span className="font-bold text-[#1B3A6B] shrink-0">1.</span>
        <span>If a popup appears, choose <strong>Open with</strong> and click <strong>OK</strong>.</span>
      </li>
      <li className="flex gap-2">
        <span className="font-bold text-[#1B3A6B] shrink-0">2.</span>
        <span>Or click the <strong>blue down-arrow</strong> at top-right, then click the file name.</span>
      </li>
      <li className="flex gap-2">
        <span className="font-bold text-[#1B3A6B] shrink-0">3.</span>
        <span>
          A black window opens and sets things up.
          {os === 'windows' && ' If Windows shows "protected your PC", click "More info" then "Run anyway".'}
        </span>
      </li>
      <li className="flex gap-2">
        <span className="font-bold text-[#1B3A6B] shrink-0">4.</span>
        <span>Type your code, then your first name. Leave the "MarqueeIT Active" window open.</span>
      </li>
    </ol>
  )
}

function SafariInstructions() {
  return (
    <ol className="space-y-2 text-sm text-slate-700">
      <li className="flex gap-2">
        <span className="font-bold text-[#1B3A6B] shrink-0">1.</span>
        <span>Downloads window pops up, or click <strong>View → Downloads</strong>.</span>
      </li>
      <li className="flex gap-2">
        <span className="font-bold text-[#1B3A6B] shrink-0">2.</span>
        <span>Find <strong>marqueeit-client-mac</strong>, click the magnifying glass to open in Finder.</span>
      </li>
      <li className="flex gap-2">
        <span className="font-bold text-[#1B3A6B] shrink-0">3.</span>
        <span>Double-click the file. If Mac blocks it, right-click (or Control-click) and choose <strong>Open</strong>, then confirm.</span>
      </li>
      <li className="flex gap-2">
        <span className="font-bold text-[#1B3A6B] shrink-0">4.</span>
        <span>A terminal opens and sets things up. Type your code, then your first name.</span>
      </li>
    </ol>
  )
}

function GenericInstructions({ os }: { os: OS }) {
  return (
    <ol className="space-y-2 text-sm text-slate-700">
      <li className="flex gap-2">
        <span className="font-bold text-[#1B3A6B] shrink-0">1.</span>
        <span>Click the download indicator (top-right corner) to open the file.</span>
      </li>
      <li className="flex gap-2">
        <span className="font-bold text-[#1B3A6B] shrink-0">2.</span>
        <span>Or open your Downloads folder and double-click {os === 'windows' ? 'marqueeit-client-windows.exe' : os === 'mac' ? 'marqueeit-client-mac' : 'marqueeit-client-linux'}.</span>
      </li>
      <li className="flex gap-2">
        <span className="font-bold text-[#1B3A6B] shrink-0">3.</span>
        <span>
          A window opens and sets things up.
          {os === 'windows' && ' If Windows shows "protected your PC", click "More info" then "Run anyway".'}
          {(os === 'mac' || os === 'linux') && ' On Mac, right-click and choose "Open" the first time.'}
        </span>
      </li>
      <li className="flex gap-2">
        <span className="font-bold text-[#1B3A6B] shrink-0">4.</span>
        <span>Type your code, then your first name. Leave the "MarqueeIT Active" window open.</span>
      </li>
    </ol>
  )
}
