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
  User,
  PlayCircle,
} from 'lucide-react'
import { toast } from 'sonner'

interface CustomerDownloadProps {
  code: string
  name: string
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

export function CustomerDownload({ code, name, onBack }: CustomerDownloadProps) {
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

  // Download a zip file containing the binary + session.json config.
  // The customer extracts the zip and double-clicks the binary — no
  // command-line args, no .bat files, no prompts.
  const downloadLauncher = (platform: 'windows' | 'mac' | 'linux') => {
    setDownloadStarted(platform)
    const params = new URLSearchParams({ code: code.toUpperCase() })
    if (name) params.set('name', name)
    const url = `/api/session-zip/${platform}?${params.toString()}`
    // Trigger download
    const a = document.createElement('a')
    a.href = url
    a.download = `marqueeit-${code.toUpperCase()}.zip`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    toast.success('Download started — extract the zip and double-click the file inside')
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
                  {name && (
                    <p className="text-sm text-slate-600 mt-0.5 flex items-center gap-1">
                      <User className="w-3 h-3" />
                      <span>You: <span className="font-medium">{name}</span></span>
                    </p>
                  )}
                </div>
                <button
                  onClick={copyCode}
                  className="text-right bg-[#FFC425]/15 hover:bg-[#FFC425]/30 transition-colors rounded-lg p-2.5 border border-[#FFC425]/50"
                  title="Click to copy"
                >
                  <p className="text-[10px] text-slate-600 uppercase tracking-wide">Session code</p>
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
                  <h3 className="text-xl font-bold text-slate-900">Download &amp; run</h3>
                  <p className="text-sm text-slate-600">
                    Click your computer type below. The launcher will download the helper app
                    and start your session automatically — no code or name to enter.
                  </p>
                </div>
              </div>

              {/* Step 1: pick your computer type */}
              <div className="mb-5">
                <div className="flex items-center gap-2 mb-2.5">
                  <div className="w-6 h-6 rounded-full bg-[#1B3A6B] text-white flex items-center justify-center text-xs font-bold">1</div>
                  <h4 className="font-semibold text-slate-900">Pick your computer type and click to download</h4>
                </div>

                <div className="grid sm:grid-cols-3 gap-3">
                  <button
                    onClick={() => downloadLauncher('windows')}
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
                    onClick={() => downloadLauncher('mac')}
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
                    onClick={() => downloadLauncher('linux')}
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

                {/* Chromebook / browser-only fallback */}
                <div className="mt-3 p-4 rounded-lg bg-amber-50 border border-amber-200">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2">
                      <MonitorIcon className="w-5 h-5 text-amber-700" />
                      <div>
                        <p className="font-semibold text-slate-900 text-sm">Using a Chromebook?</p>
                        <p className="text-xs text-slate-600">Share your screen directly from the browser — no download needed. View-only (no remote control).</p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      className="bg-amber-600 hover:bg-amber-700 text-white"
                      onClick={() => {
                        // Redirect to the browser-based screen share
                        window.location.hash = `#browser-share/${code.toUpperCase()}${name ? '/' + encodeURIComponent(name) : ''}`
                        // Reload to trigger the hash handler
                        window.location.reload()
                      }}
                    >
                      <MonitorIcon className="w-4 h-4 mr-1" />
                      Share from browser
                    </Button>
                  </div>
                </div>

                {downloadStarted && (
                  <div className="mt-3 p-3 bg-[#1B3A6B]/5 border border-[#1B3A6B]/20 rounded-lg flex items-center gap-2 text-sm text-slate-700">
                    <Check className="w-4 h-4 text-[#1B3A6B] shrink-0" />
                    <span>
                      Zip file downloaded! <strong>Extract it</strong> (right-click → Extract All on Windows,
                      double-click on Mac) then <strong>double-click the file inside</strong> to start your session.
                      Your code <strong className="font-mono">{code.toUpperCase()}</strong>
                      {name && <> and name <strong>&ldquo;{name}&rdquo;</strong></>} are already configured — you don&apos;t need to enter anything.
                    </span>
                  </div>
                )}
              </div>

              {/* Step 2: extract and run */}
              <div className="mb-5">
                <div className="flex items-center gap-2 mb-2.5">
                  <div className="w-6 h-6 rounded-full bg-[#1B3A6B] text-white flex items-center justify-center text-xs font-bold">2</div>
                  <h4 className="font-semibold text-slate-900">Extract the zip and double-click the file inside</h4>
                </div>
                <BrowserInstructions browser={browser} os={os} code={code} />
              </div>

              {/* Step 3: what happens next */}
              <div>
                <div className="flex items-center gap-2 mb-2.5">
                  <div className="w-6 h-6 rounded-full bg-[#1B3A6B] text-white flex items-center justify-center text-xs font-bold">3</div>
                  <h4 className="font-semibold text-slate-900">That&apos;s it! Your session starts automatically.</h4>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <PlayCircle className="w-5 h-5 text-[#1B3A6B] shrink-0 mt-0.5" />
                    <div className="text-sm text-slate-700 space-y-1.5">
                      <p>When you double-click the binary:</p>
                      <ul className="list-disc list-inside space-y-1 ml-2">
                        <li>It connects to your technician using code <span className="font-mono font-bold text-[#1B3A6B]">{code.toUpperCase()}</span></li>
                        {name && <li>Your name <strong>&ldquo;{name}&rdquo;</strong> is sent automatically</li>}
                        <li>A small status indicator appears — leave it running</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>

              {/* Safety note */}
              <div className="mt-5 p-3 bg-[#1B3A6B]/5 border border-[#1B3A6B]/20 rounded-lg flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 text-[#1B3A6B] shrink-0 mt-0.5" />
                <p className="text-xs text-slate-700">
                  Runs only during this session. Nothing is installed permanently. Close the status window any time to end the session.
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
// Browser-specific instructions for opening the launcher file
// ---------------------------------------------------------------------------

function BrowserInstructions({ browser, os, code }: { browser: Browser; os: OS; code: string }) {
  const browserName = {
    chrome: 'Chrome',
    edge: 'Edge',
    firefox: 'Firefox',
    safari: 'Safari',
    other: 'your browser',
  }[browser]

  const BrowserIcon = browser === 'chrome' ? Chrome : browser === 'edge' ? Globe : Globe
  const fileName = os === 'windows' ? `marqueeit-start-${code.toUpperCase()}.bat` : `marqueeit-start-${code.toUpperCase()}.sh`

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
        <BrowserIcon className="w-4 h-4 text-slate-600" />
        <span className="text-sm font-medium text-slate-700">
          For {browserName}{os !== 'other' ? ` on ${os === 'mac' ? 'Mac' : os === 'windows' ? 'Windows' : 'Linux'}` : ''}
        </span>
      </div>
      <div className="p-3">
        {browser === 'chrome' && <ChromeInstructions os={os} fileName={fileName} />}
        {browser === 'edge' && <EdgeInstructions os={os} fileName={fileName} />}
        {browser === 'firefox' && <FirefoxInstructions os={os} fileName={fileName} />}
        {browser === 'safari' && <SafariInstructions fileName={fileName} />}
        {browser === 'other' && <GenericInstructions os={os} fileName={fileName} />}
      </div>
    </div>
  )
}

function ChromeInstructions({ os, fileName }: { os: OS; fileName: string }) {
  return (
    <ol className="space-y-2 text-sm text-slate-700">
      <li className="flex gap-2">
        <span className="font-bold text-[#1B3A6B] shrink-0">1.</span>
        <span>Look at the <strong>top-right corner</strong> of this browser. Click the downloaded zip file.</span>
      </li>
      <li className="flex gap-2">
        <span className="font-bold text-[#1B3A6B] shrink-0">2.</span>
        <span>
          {os === 'windows' && <><strong>Extract</strong> the zip (right-click → "Extract All"). Open the extracted folder and double-click <code className="bg-slate-100 px-1 rounded text-xs">marqueeit-client.exe</code>. If Windows says "protected your PC", click "More info" then "Run anyway".</>}
          {os === 'mac' && <>Double-click the zip to extract it. Then open the folder and <strong>right-click</strong> (or Control-click) <code className="bg-slate-100 px-1 rounded text-xs">marqueeit-client</code> → choose <strong>"Open"</strong>, then confirm.</>}
          {os === 'linux' && <>Extract the zip. In a terminal, run <code className="bg-slate-100 px-1 rounded text-xs">chmod +x marqueeit-client && ./marqueeit-client</code>.</>}
          {!['windows', 'mac', 'linux'].includes(os) && <>Extract the zip and double-click the binary inside.</>}
        </span>
      </li>
      <li className="flex gap-2">
        <span className="font-bold text-[#1B3A6B] shrink-0">3.</span>
        <span>The binary connects to your technician automatically. A small status indicator appears — leave it running.</span>
      </li>
    </ol>
  )
}

function EdgeInstructions({ os, fileName }: { os: OS; fileName: string }) {
  return (
    <ol className="space-y-2 text-sm text-slate-700">
      <li className="flex gap-2">
        <span className="font-bold text-[#1B3A6B] shrink-0">1.</span>
        <span>Click the <strong>download arrow</strong> (top-right), then click the zip file.</span>
      </li>
      <li className="flex gap-2">
        <span className="font-bold text-[#1B3A6B] shrink-0">2.</span>
        <span>
          {os === 'windows' && <><strong>Extract</strong> the zip, then double-click <code className="bg-slate-100 px-1 rounded text-xs">marqueeit-client.exe</code>. If Windows says "protected your PC", click "More info" then "Run anyway".</>}
          {!['windows'].includes(os) && <>Extract the zip and double-click the binary inside.</>}
        </span>
      </li>
      <li className="flex gap-2">
        <span className="font-bold text-[#1B3A6B] shrink-0">3.</span>
        <span>The binary connects automatically. Leave it running.</span>
      </li>
    </ol>
  )
}

function FirefoxInstructions({ os, fileName }: { os: OS; fileName: string }) {
  return (
    <ol className="space-y-2 text-sm text-slate-700">
      <li className="flex gap-2">
        <span className="font-bold text-[#1B3A6B] shrink-0">1.</span>
        <span>If a popup appears, choose <strong>Save File</strong> and click OK.</span>
      </li>
      <li className="flex gap-2">
        <span className="font-bold text-[#1B3A6B] shrink-0">2.</span>
        <span>Click the <strong>blue down-arrow</strong> at top-right, then click the zip file. Extract it.</span>
      </li>
      <li className="flex gap-2">
        <span className="font-bold text-[#1B3A6B] shrink-0">3.</span>
        <span>
          Double-click the binary inside.
          {os === 'windows' && <> If Windows says "protected your PC", click "More info" then "Run anyway".</>}
        </span>
      </li>
      <li className="flex gap-2">
        <span className="font-bold text-[#1B3A6B] shrink-0">4.</span>
        <span>Leave it running.</span>
      </li>
    </ol>
  )
}

function SafariInstructions({ fileName }: { fileName: string }) {
  return (
    <ol className="space-y-2 text-sm text-slate-700">
      <li className="flex gap-2">
        <span className="font-bold text-[#1B3A6B] shrink-0">1.</span>
        <span>Downloads window pops up, or click <strong>View → Downloads</strong>.</span>
      </li>
      <li className="flex gap-2">
        <span className="font-bold text-[#1B3A6B] shrink-0">2.</span>
        <span>Double-click the zip file to extract it. Find <code className="bg-slate-100 px-1 rounded text-xs">marqueeit-client</code> in the extracted folder.</span>
      </li>
      <li className="flex gap-2">
        <span className="font-bold text-[#1B3A6B] shrink-0">3.</span>
        <span><strong>Right-click</strong> (or Control-click) the file and choose <strong>Open</strong>, then confirm.</span>
      </li>
      <li className="flex gap-2">
        <span className="font-bold text-[#1B3A6B] shrink-0">4.</span>
        <span>The binary connects automatically. Leave it running.</span>
      </li>
    </ol>
  )
}

function GenericInstructions({ os, fileName }: { os: OS; fileName: string }) {
  return (
    <ol className="space-y-2 text-sm text-slate-700">
      <li className="flex gap-2">
        <span className="font-bold text-[#1B3A6B] shrink-0">1.</span>
        <span>Click the download indicator (top-right) to open the zip file.</span>
      </li>
      <li className="flex gap-2">
        <span className="font-bold text-[#1B3A6B] shrink-0">2.</span>
        <span>Extract the zip and open the extracted folder.</span>
      </li>
      <li className="flex gap-2">
        <span className="font-bold text-[#1B3A6B] shrink-0">3.</span>
        <span>
          Double-click the binary inside.
          {os === 'windows' && <> If Windows says "protected your PC", click "More info" then "Run anyway".</>}
          {(os === 'mac' || os === 'linux') && <> On Mac, right-click and choose "Open" the first time.</>}
        </span>
      </li>
      <li className="flex gap-2">
        <span className="font-bold text-[#1B3A6B] shrink-0">4.</span>
        <span>Leave it running.</span>
      </li>
    </ol>
  )
}
