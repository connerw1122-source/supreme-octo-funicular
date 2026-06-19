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
  // Edge must be checked before Chrome because Edge also contains "Chrome"
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
  const [downloadStarted, setDownloadStarted] = useState<'windows' | 'mac' | null>(null)

  const browser = useMemo(detectBrowser, [])
  const os = useMemo(detectOS, [])

  // Lookup session by code so we can confirm it's valid + show technician info
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

  const startDownload = (which: 'windows' | 'mac') => {
    setDownloadStarted(which)
    const url = which === 'windows' ? '/downloads/install_windows.bat' : '/downloads/install_mac_linux.sh'
    // Trigger download
    const a = document.createElement('a')
    a.href = url
    a.download = which === 'windows' ? 'install_windows.bat' : 'install_mac_linux.sh'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    toast.success('Download started — check your browser\'s downloads')
  }

  // -------------------------------------------------------------------------
  // Loading state
  // -------------------------------------------------------------------------
  if (loadingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-emerald-50">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-emerald-600 mx-auto mb-3" />
          <p className="text-emerald-900">Looking up your session…</p>
        </div>
      </div>
    )
  }

  // -------------------------------------------------------------------------
  // Error state - invalid code
  // -------------------------------------------------------------------------
  if (errorMsg) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-emerald-50 px-4">
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
            <Button onClick={onBack} className="bg-emerald-600 hover:bg-emerald-700">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to start
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  // -------------------------------------------------------------------------
  // Main download view
  // -------------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 via-white to-teal-50">
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

      <main className="container mx-auto px-4 py-8 md:py-12">
        <div className="max-w-3xl mx-auto">
          {/* Session header */}
          {sessionInfo && (
            <Card className="mb-6 border-emerald-200 bg-white">
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs uppercase tracking-wide text-emerald-700 font-semibold mb-1">
                      Your support session
                    </p>
                    <h2 className="text-xl font-bold text-slate-900">{sessionInfo.title}</h2>
                    {sessionInfo.technician && (
                      <p className="text-sm text-slate-600 mt-1">
                        with <span className="font-semibold">{sessionInfo.technician.name}</span>
                      </p>
                    )}
                  </div>
                  <button
                    onClick={copyCode}
                    className="text-right bg-emerald-50 hover:bg-emerald-100 transition-colors rounded-lg p-3 border border-emerald-200"
                    title="Click to copy"
                  >
                    <p className="text-[10px] text-slate-500 uppercase tracking-wide">Your code</p>
                    <p className="font-mono font-bold text-2xl tracking-wider text-emerald-700 flex items-center gap-1.5">
                      {sessionInfo.code}
                      {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-3.5 h-3.5 text-slate-400" />}
                    </p>
                  </button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Download card */}
          <Card className="border-emerald-300 shadow-sm">
            <CardContent className="p-7">
              <div className="flex items-start gap-4 mb-6">
                <div className="w-14 h-14 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0">
                  <Download className="w-7 h-7" />
                </div>
                <div>
                  <h3 className="text-2xl font-bold text-slate-900 mb-1">Download the helper app</h3>
                  <p className="text-slate-600">
                    This small program lets your technician see your screen and help you directly.
                    It only runs while they&apos;re helping you — nothing is installed permanently.
                  </p>
                </div>
              </div>

              {/* Step 1: pick your computer type */}
              <div className="mb-6">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-sm font-bold">
                    1
                  </div>
                  <h4 className="font-semibold text-slate-900">Pick your computer type and click to download</h4>
                </div>

                <div className="grid sm:grid-cols-2 gap-3">
                  <button
                    onClick={() => startDownload('windows')}
                    className={`flex items-center gap-3 p-5 rounded-lg bg-white border-2 transition-all text-left ${
                      downloadStarted === 'windows'
                        ? 'border-emerald-500 bg-emerald-50'
                        : 'border-slate-200 hover:border-emerald-400 hover:bg-emerald-50'
                    } ${os === 'windows' ? 'ring-2 ring-emerald-300 ring-offset-1' : ''}`}
                  >
                    <MonitorIcon className="w-8 h-8 text-slate-700" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-slate-900">Windows</p>
                        {os === 'windows' && (
                          <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 text-[9px] font-bold rounded uppercase">Your computer</span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500">Windows 10 or newer</p>
                    </div>
                    <Download className="w-4 h-4 text-slate-400" />
                  </button>

                  <button
                    onClick={() => startDownload('mac')}
                    className={`flex items-center gap-3 p-5 rounded-lg bg-white border-2 transition-all text-left ${
                      downloadStarted === 'mac'
                        ? 'border-emerald-500 bg-emerald-50'
                        : 'border-slate-200 hover:border-emerald-400 hover:bg-emerald-50'
                    } ${os === 'mac' || os === 'linux' ? 'ring-2 ring-emerald-300 ring-offset-1' : ''}`}
                  >
                    <Apple className="w-8 h-8 text-slate-700" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-slate-900">Mac / Linux</p>
                        {(os === 'mac' || os === 'linux') && (
                          <span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 text-[9px] font-bold rounded uppercase">Your computer</span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500">macOS 11+ or any Linux</p>
                    </div>
                    <Download className="w-4 h-4 text-slate-400" />
                  </button>
                </div>

                {downloadStarted && (
                  <div className="mt-3 p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2 text-sm text-emerald-900">
                    <Check className="w-4 h-4 text-emerald-600" />
                    <span>
                      Download started! If it didn&apos;t begin automatically, look for a{' '}
                      <strong>{downloadStarted === 'windows' ? 'install_windows.bat' : 'install_mac_linux.sh'}</strong>{' '}
                      file in your downloads (see instructions below).
                    </span>
                  </div>
                )}
              </div>

              {/* Step 2: open the file - browser-specific instructions */}
              <div className="mb-6">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-sm font-bold">
                    2
                  </div>
                  <h4 className="font-semibold text-slate-900">Open the downloaded file</h4>
                </div>

                <BrowserInstructions browser={browser} os={os} />
              </div>

              {/* Step 3: enter the code */}
              <div className="mb-2">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-7 h-7 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center text-sm font-bold">
                    3
                  </div>
                  <h4 className="font-semibold text-slate-900">When the app asks for your code, type it in</h4>
                </div>
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs text-slate-500 uppercase tracking-wide mb-0.5">Your code</p>
                    <p className="font-mono font-bold text-3xl tracking-[0.2em] text-emerald-700">{code.toUpperCase()}</p>
                  </div>
                  <Button onClick={copyCode} variant="outline" className="border-emerald-300 text-emerald-700 hover:bg-emerald-50">
                    {copied ? <Check className="w-4 h-4 mr-1.5" /> : <Copy className="w-4 h-4 mr-1.5" />}
                    Copy
                  </Button>
                </div>
                <p className="text-sm text-slate-600 mt-2">
                  The app will also ask for your first name. After that, a small status window appears —
                  that means your technician is connected and ready to help.
                </p>
              </div>

              {/* Safety note */}
              <div className="mt-6 p-4 bg-emerald-50/50 border border-emerald-200 rounded-lg">
                <div className="flex items-start gap-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-emerald-900 text-sm">Safe and temporary</p>
                    <p className="text-xs text-emerald-800 mt-0.5">
                      The helper app runs only during this session. When you or your technician close
                      it, they can no longer see or control your computer. Nothing is installed
                      permanently on your computer.
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Troubleshooting tip */}
          <div className="mt-4 flex items-start gap-2 text-sm text-slate-600 px-2">
            <Info className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
            <p>
              Stuck? Call your technician and tell them you&apos;re having trouble opening the file.
              They can walk you through it over the phone.
            </p>
          </div>
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
      {/* Browser header */}
      <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
        <BrowserIcon className="w-4 h-4 text-slate-600" />
        <span className="text-sm font-medium text-slate-700">
          Instructions for {browserName}{os !== 'other' ? ` on ${os === 'mac' ? 'Mac' : os === 'windows' ? 'Windows' : 'Linux'}` : ''}
        </span>
      </div>

      <div className="p-4">
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
    <ol className="space-y-2.5 text-sm text-slate-700">
      <li className="flex gap-2.5">
        <span className="font-bold text-emerald-700 shrink-0">1.</span>
        <span>
          Look at the <strong>top-right corner</strong> of this browser window.
          You&apos;ll see the downloaded file appear as a small box with an arrow pointing down.
        </span>
      </li>
      <li className="flex gap-2.5">
        <span className="font-bold text-emerald-700 shrink-0">2.</span>
        <span>
          <strong>Click on that box</strong> to open the file.
          {os === 'windows' && ' Windows may show a blue "Windows protected your PC" message — click "More info", then "Run anyway".'}
          {os === 'mac' && ' On Mac, you may need to right-click (or Control-click) the file and choose "Open" the first time.'}
        </span>
      </li>
      <li className="flex gap-2.5">
        <span className="font-bold text-emerald-700 shrink-0">3.</span>
        <span>
          A black window will open and start setting things up. This can take a minute the first time.
          When it asks for your code, type: <span className="font-mono font-bold text-emerald-700">the code shown above</span>
        </span>
      </li>
      <li className="flex gap-2.5">
        <span className="font-bold text-emerald-700 shrink-0">4.</span>
        <span>Type your first name when prompted. A small "RemoteHelp Active" window will appear — leave it open.</span>
      </li>
    </ol>
  )
}

function EdgeInstructions({ os }: { os: OS }) {
  return (
    <ol className="space-y-2.5 text-sm text-slate-700">
      <li className="flex gap-2.5">
        <span className="font-bold text-emerald-700 shrink-0">1.</span>
        <span>
          Look at the <strong>top-right corner</strong> of this browser window, near the star icon.
          You&apos;ll see a small download arrow with a number — <strong>click it</strong>.
        </span>
      </li>
      <li className="flex gap-2.5">
        <span className="font-bold text-emerald-700 shrink-0">2.</span>
        <span>
          A small menu drops down showing the file. <strong>Click "Open"</strong> on the file
          ({os === 'windows' ? 'install_windows.bat' : 'install_mac_linux.sh'}).
          {os === 'windows' && ' If Windows shows "Windows protected your PC", click "More info" then "Run anyway".'}
        </span>
      </li>
      <li className="flex gap-2.5">
        <span className="font-bold text-emerald-700 shrink-0">3.</span>
        <span>A black window will open and start setting things up. This can take a minute the first time.</span>
      </li>
      <li className="flex gap-2.5">
        <span className="font-bold text-emerald-700 shrink-0">4.</span>
        <span>When it asks for your code, type it in. Then type your first name. A small "RemoteHelp Active" window appears — leave it open.</span>
      </li>
    </ol>
  )
}

function FirefoxInstructions({ os }: { os: OS }) {
  return (
    <ol className="space-y-2.5 text-sm text-slate-700">
      <li className="flex gap-2.5">
        <span className="font-bold text-emerald-700 shrink-0">1.</span>
        <span>
          A download window may pop up asking what to do. Choose{' '}
          <strong>"Open with"</strong> and click <strong>OK</strong>.
        </span>
      </li>
      <li className="flex gap-2.5">
        <span className="font-bold text-emerald-700 shrink-0">2.</span>
        <span>
          If no popup appeared, look for the <strong>blue down-arrow icon</strong> at the top-right
          of this window (next to the address bar) and click it. Then click the file name.
        </span>
      </li>
      <li className="flex gap-2.5">
        <span className="font-bold text-emerald-700 shrink-0">3.</span>
        <span>
          A black window will open and start setting things up.
          {os === 'windows' && ' If Windows shows "Windows protected your PC", click "More info" then "Run anyway".'}
        </span>
      </li>
      <li className="flex gap-2.5">
        <span className="font-bold text-emerald-700 shrink-0">4.</span>
        <span>When it asks for your code, type it in. Then type your first name. A small "RemoteHelp Active" window appears — leave it open.</span>
      </li>
    </ol>
  )
}

function SafariInstructions() {
  return (
    <ol className="space-y-2.5 text-sm text-slate-700">
      <li className="flex gap-2.5">
        <span className="font-bold text-emerald-700 shrink-0">1.</span>
        <span>
          Safari&apos;s Downloads window may pop up automatically. If not, click{' '}
          <strong>View → Downloads</strong> in the menu bar at the top of the screen.
        </span>
      </li>
      <li className="flex gap-2.5">
        <span className="font-bold text-emerald-700 shrink-0">2.</span>
        <span>
          Find <strong>install_mac_linux.sh</strong> in the list and click the{' '}
          <strong>magnifying glass icon</strong> next to it. This opens the file in Finder.
        </span>
      </li>
      <li className="flex gap-2.5">
        <span className="font-bold text-emerald-700 shrink-0">3.</span>
        <span>
          In Finder, <strong>double-click</strong> the file. If Mac says it can&apos;t be opened
          because it&apos;s from an unidentified developer, <strong>right-click</strong> (or
          Control-click) the file and choose <strong>"Open"</strong>, then confirm.
        </span>
      </li>
      <li className="flex gap-2.5">
        <span className="font-bold text-emerald-700 shrink-0">4.</span>
        <span>A terminal window will open and start setting things up. When it asks for your code, type it in. Then type your first name.</span>
      </li>
    </ol>
  )
}

function GenericInstructions({ os }: { os: OS }) {
  return (
    <ol className="space-y-2.5 text-sm text-slate-700">
      <li className="flex gap-2.5">
        <span className="font-bold text-emerald-700 shrink-0">1.</span>
        <span>
          Check your browser for a download indicator (usually a small arrow in the top-right corner).
          Click it to open the file.
        </span>
      </li>
      <li className="flex gap-2.5">
        <span className="font-bold text-emerald-700 shrink-0">2.</span>
        <span>
          Or open your computer&apos;s Downloads folder and double-click the file
          ({os === 'windows' ? 'install_windows.bat' : 'install_mac_linux.sh'}).
        </span>
      </li>
      <li className="flex gap-2.5">
        <span className="font-bold text-emerald-700 shrink-0">3.</span>
        <span>
          A window will open and start setting things up.
          {os === 'windows' && ' If Windows shows "Windows protected your PC", click "More info" then "Run anyway".'}
          {(os === 'mac' || os === 'linux') && ' On Mac, you may need to right-click and choose "Open" the first time.'}
        </span>
      </li>
      <li className="flex gap-2.5">
        <span className="font-bold text-emerald-700 shrink-0">4.</span>
        <span>When it asks for your code, type it in. Then type your first name. A small "RemoteHelp Active" window appears — leave it open.</span>
      </li>
    </ol>
  )
}
