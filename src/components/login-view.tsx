'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ArrowLeft, Lock, AlertCircle } from 'lucide-react'
import { verifyCredentials, saveSession } from '@/lib/auth'
import { toast } from 'sonner'

interface LoginViewProps {
  onBack: () => void
  onSuccess: (username: string) => void
}

export function LoginView({ onBack, onSuccess }: LoginViewProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    // Small delay to feel like real auth
    setTimeout(() => {
      if (verifyCredentials(username, password)) {
        saveSession(username.trim())
        toast.success(`Welcome, ${username.trim()}`)
        onSuccess(username.trim())
      } else {
        setError('Invalid username or password.')
        setSubmitting(false)
      }
    }, 300)
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
            <ArrowLeft className="w-4 h-4 mr-1.5" />
            Back
          </Button>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="text-center mb-6">
            <div className="w-14 h-14 rounded-xl bg-[#1B3A6B] text-[#FFC425] flex items-center justify-center mx-auto mb-4">
              <Lock className="w-7 h-7" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900">Technician Login</h1>
          </div>

          <Card className="border-slate-200 shadow-sm">
            <CardContent className="p-6">
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="username">Username</Label>
                  <Input
                    id="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="username"
                    autoFocus
                    required
                    className="h-11"
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password">Password</Label>
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="text-xs text-slate-500 hover:text-[#1B3A6B]"
                    >
                      {showPassword ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                    className="h-11"
                  />
                </div>

                {error && (
                  <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    {error}
                  </div>
                )}

                <Button
                  type="submit"
                  className="w-full h-11 bg-[#1B3A6B] hover:bg-[#0F2A52]"
                  disabled={submitting || !username.trim() || !password}
                >
                  {submitting ? 'Signing in…' : 'Sign in'}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  )
}
