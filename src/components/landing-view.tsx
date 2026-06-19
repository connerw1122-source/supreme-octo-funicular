'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Monitor, Headset, ArrowRight, ShieldCheck, MousePointer2, Download } from 'lucide-react'

interface LandingViewProps {
  onTechnician: (name: string) => void
  onCustomer: (code: string) => void
}

export function LandingView({ onTechnician, onCustomer }: LandingViewProps) {
  const [techName, setTechName] = useState('')
  const [code, setCode] = useState('')

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-emerald-50">
      <header className="border-b bg-white/80 backdrop-blur sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-emerald-600 text-white flex items-center justify-center font-bold">
              R
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-slate-900">RemoteHelp</h1>
              <p className="text-xs text-slate-500 -mt-0.5">Friendly IT support, anywhere</p>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-1 text-xs text-slate-500">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>End-to-end encrypted WebRTC</span>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-12 md:py-20">
        <div className="max-w-4xl mx-auto text-center mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 text-xs font-medium mb-4">
            <MousePointer2 className="w-3.5 h-3.5" />
            Full remote control, like ScreenConnect
          </div>
          <h2 className="text-4xl md:text-5xl font-bold tracking-tight text-slate-900 mb-4">
            Get help with your computer, <span className="text-emerald-600">simply</span>
          </h2>
          <p className="text-lg text-slate-600 max-w-2xl mx-auto">
            A friendly remote support tool built for clarity. Your technician gives you a 6-character
            code — enter it below to download a small helper app, and you&apos;re connected in
            minutes. Your technician can see your screen, point things out, and even drive your
            mouse and keyboard with your permission.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-6 max-w-5xl mx-auto">
          {/* Technician card */}
          <Card className="border-slate-200 shadow-sm hover:shadow-md transition-shadow">
            <CardHeader>
              <div className="w-12 h-12 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center mb-2">
                <Headset className="w-6 h-6" />
              </div>
              <CardTitle className="text-xl">I&apos;m a Technician</CardTitle>
              <CardDescription>
                Start a new support session and give the customer a code to join.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="tech-name" className="text-sm">Your name</Label>
                <Input
                  id="tech-name"
                  placeholder="e.g. Alex from IT"
                  value={techName}
                  onChange={(e) => setTechName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && techName.trim()) onTechnician(techName.trim())
                  }}
                />
              </div>
              <Button
                className="w-full bg-emerald-600 hover:bg-emerald-700"
                disabled={!techName.trim()}
                onClick={() => onTechnician(techName.trim())}
              >
                Open Technician Dashboard
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </CardContent>
          </Card>

          {/* Customer card */}
          <Card className="border-slate-200 shadow-sm hover:shadow-md transition-shadow">
            <CardHeader>
              <div className="w-12 h-12 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center mb-2">
                <Monitor className="w-6 h-6" />
              </div>
              <CardTitle className="text-xl">I Have a Support Code</CardTitle>
              <CardDescription>
                Your technician gave you a 6-character code. Enter it below to download the helper app.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="code-input" className="text-sm">Support code</Label>
                <Input
                  id="code-input"
                  placeholder="e.g. ABC123"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && code.trim().length >= 4) onCustomer(code.trim())
                  }}
                  className="text-lg tracking-[0.3em] font-mono uppercase text-center"
                  maxLength={8}
                />
              </div>
              <Button
                variant="outline"
                className="w-full border-amber-500 text-amber-700 hover:bg-amber-50"
                disabled={code.trim().length < 4}
                onClick={() => onCustomer(code.trim())}
              >
                <Download className="w-4 h-4 mr-2" />
                Get the helper app
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Feature row */}
        <div className="grid sm:grid-cols-3 gap-4 max-w-5xl mx-auto mt-16">
          {[
            {
              icon: MousePointer2,
              title: 'Full remote control',
              desc: 'Your technician can move your mouse and type on your keyboard — just like sitting next to you.',
            },
            {
              icon: Download,
              title: 'Simple one-time setup',
              desc: 'Download a small helper app, run it with your code, and you\'re connected. Nothing is installed permanently.',
            },
            {
              icon: ShieldCheck,
              title: 'Safe & temporary',
              desc: 'The helper app runs only while your session is active. Close it and the technician is gone — nothing left behind.',
            },
          ].map((f, i) => (
            <div key={i} className="text-center p-4">
              <div className="w-10 h-10 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center mx-auto mb-3">
                <f.icon className="w-5 h-5" />
              </div>
              <h3 className="font-semibold text-slate-900 mb-1">{f.title}</h3>
              <p className="text-sm text-slate-600">{f.desc}</p>
            </div>
          ))}
        </div>

        {/* How it works */}
        <div className="max-w-4xl mx-auto mt-16">
          <h3 className="text-center text-xl font-semibold text-slate-900 mb-8">How it works</h3>
          <div className="grid sm:grid-cols-3 gap-6">
            <div className="text-center">
              <div className="w-10 h-10 rounded-full bg-emerald-600 text-white flex items-center justify-center mx-auto mb-3 font-bold">
                1
              </div>
              <h4 className="font-semibold text-slate-900 mb-1">Technician starts a session</h4>
              <p className="text-sm text-slate-600">They get a 6-character code and send it to you by phone, email, or text.</p>
            </div>
            <div className="text-center">
              <div className="w-10 h-10 rounded-full bg-emerald-600 text-white flex items-center justify-center mx-auto mb-3 font-bold">
                2
              </div>
              <h4 className="font-semibold text-slate-900 mb-1">You enter the code here</h4>
              <p className="text-sm text-slate-600">We&apos;ll show you the right download for your computer and exactly how to open it.</p>
            </div>
            <div className="text-center">
              <div className="w-10 h-10 rounded-full bg-emerald-600 text-white flex items-center justify-center mx-auto mb-3 font-bold">
                3
              </div>
              <h4 className="font-semibold text-slate-900 mb-1">Help starts instantly</h4>
              <p className="text-sm text-slate-600">Your technician sees your screen and can fix the problem for you. Close the app any time to end.</p>
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t mt-12 py-6 text-center text-xs text-slate-500">
        RemoteHelp · WebRTC + Socket.io + Python desktop client · Built with Next.js
      </footer>
    </div>
  )
}
