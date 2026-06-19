'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ArrowRight, Lock, ShieldCheck, User } from 'lucide-react'

interface LandingViewProps {
  onCustomer: (code: string, name: string) => void
  onTechnicianLogin: () => void
}

export function LandingView({ onCustomer, onTechnicianLogin }: LandingViewProps) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')

  const handleContinue = () => {
    if (code.trim().length >= 4) {
      onCustomer(code.trim(), name.trim())
    }
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
          <Button
            variant="outline"
            size="sm"
            onClick={onTechnicianLogin}
            className="border-[#1B3A6B] text-[#1B3A6B] hover:bg-[#1B3A6B] hover:text-white"
          >
            <Lock className="w-3.5 h-3.5 mr-1.5" />
            Technician Login
          </Button>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-slate-900 mb-2">Enter your support code</h1>
            <p className="text-slate-600">Your technician gave you a 6-character code.</p>
          </div>

          <Card className="border-slate-200 shadow-sm">
            <CardContent className="p-6 space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="code" className="text-sm font-medium">
                  Support code <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleContinue()
                  }}
                  placeholder="ABC123"
                  className="text-2xl tracking-[0.4em] font-mono uppercase text-center h-16 border-2 focus:border-[#1B3A6B]"
                  maxLength={8}
                  autoFocus
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="name" className="text-sm font-medium flex items-center gap-1">
                  <User className="w-3.5 h-3.5 text-slate-400" />
                  Your name <span className="text-slate-400 font-normal">(optional)</span>
                </Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleContinue()
                  }}
                  placeholder="e.g. Margaret"
                  className="h-11 border-slate-200 focus:border-[#1B3A6B]"
                  maxLength={50}
                />
                <p className="text-xs text-slate-500">
                  Helps your technician know who they&apos;re helping. You can skip this.
                </p>
              </div>

              <Button
                className="w-full h-12 text-base bg-[#1B3A6B] hover:bg-[#0F2A52]"
                disabled={code.trim().length < 4}
                onClick={handleContinue}
              >
                Continue
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </CardContent>
          </Card>

          <p className="text-center text-xs text-slate-500 mt-6 flex items-center justify-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-[#1B3A6B]" />
            Secure connection
          </p>
        </div>
      </main>
    </div>
  )
}
