'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Copy, Check, Plus, ArrowLeft, RefreshCw, Clock, Circle, Radio, Download, Apple, Monitor as MonitorIcon, MousePointer2 } from 'lucide-react'
import { toast } from 'sonner'

interface Session {
  id: string
  code: string
  title: string
  customerName: string | null
  status: string
  createdAt: string
  startedAt: string | null
  endedAt: string | null
  messageCount: number
  technician: { id: string; name: string } | null
}

interface TechnicianDashboardProps {
  technicianName: string
  onBack: () => void
  onJoinSession: (sessionId: string, code: string, title: string) => void
}

export function TechnicianDashboard({
  technicianName,
  onBack,
  onJoinSession,
}: TechnicianDashboardProps) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [openCreate, setOpenCreate] = useState(false)
  const [copiedCode, setCopiedCode] = useState<string | null>(null)

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions')
      const data = await res.json()
      setSessions(data.sessions ?? [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSessions()
    // Poll for status changes
    const interval = setInterval(fetchSessions, 5000)
    return () => clearInterval(interval)
  }, [fetchSessions])

  const createSession = async () => {
    if (!newTitle.trim()) return
    setCreating(true)
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle.trim(), technicianName }),
      })
      if (!res.ok) throw new Error('Failed to create session')
      const session = await res.json()
      setNewTitle('')
      setOpenCreate(false)
      toast.success(`Session ${session.code} created`)
      onJoinSession(session.id, session.code, session.title)
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to create session')
    } finally {
      setCreating(false)
    }
  }

  const copyJoinLink = (code: string) => {
    const url = `${window.location.origin}/#join/${code}`
    navigator.clipboard.writeText(url)
    setCopiedCode(code)
    toast.success('Join link copied to clipboard')
    setTimeout(() => setCopiedCode(null), 2000)
  }

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code)
    toast.success('Code copied')
  }

  const statusBadge = (status: string) => {
    if (status === 'waiting') return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">Waiting</Badge>
    if (status === 'active') return <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">Active</Badge>
    return <Badge variant="outline" className="bg-slate-50 text-slate-500 border-slate-200">Ended</Badge>
  }

  const fmtTime = (iso: string | null) => {
    if (!iso) return '—'
    const d = new Date(iso)
    return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b bg-white">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={onBack}>
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back
            </Button>
            <div className="h-6 w-px bg-slate-200" />
            <div>
              <h1 className="text-lg font-semibold text-slate-900">Technician Dashboard</h1>
              <p className="text-xs text-slate-500">Signed in as {technicianName}</p>
            </div>
          </div>
          <Button onClick={() => setOpenCreate(true)} className="bg-emerald-600 hover:bg-emerald-700">
            <Plus className="w-4 h-4 mr-1" />
            New Session
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {/* Stats */}
        <div className="grid sm:grid-cols-3 gap-4 mb-8">
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wide">Total Sessions</p>
                  <p className="text-2xl font-bold text-slate-900 mt-1">{sessions.length}</p>
                </div>
                <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center">
                  <Radio className="w-5 h-5 text-slate-500" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wide">Active Now</p>
                  <p className="text-2xl font-bold text-emerald-700 mt-1">
                    {sessions.filter((s) => s.status === 'active').length}
                  </p>
                </div>
                <div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center">
                  <Circle className="w-5 h-5 text-emerald-600 fill-emerald-600" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wide">Waiting</p>
                  <p className="text-2xl font-bold text-amber-700 mt-1">
                    {sessions.filter((s) => s.status === 'waiting').length}
                  </p>
                </div>
                <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center">
                  <Clock className="w-5 h-5 text-amber-600" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Customer app download card */}
        <Card className="mb-8 border-emerald-200 bg-gradient-to-br from-emerald-50/60 to-white">
          <CardContent className="p-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex items-start gap-3 min-w-0 flex-1">
                <div className="w-10 h-10 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0">
                  <MousePointer2 className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-semibold text-slate-900">Customer app for full remote control</h3>
                  <p className="text-sm text-slate-600 mt-0.5">
                    For customers who need you to actually drive their mouse and keyboard, send them
                    one of these links along with their session code. The browser join path stays
                    available for view-only support.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <a
                  href="/downloads/install_windows.bat"
                  download
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-white border border-slate-200 hover:border-emerald-400 hover:bg-emerald-50 transition-colors text-sm font-medium text-slate-700"
                >
                  <MonitorIcon className="w-4 h-4" />
                  Windows
                </a>
                <a
                  href="/downloads/install_mac_linux.sh"
                  download
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-white border border-slate-200 hover:border-emerald-400 hover:bg-emerald-50 transition-colors text-sm font-medium text-slate-700"
                >
                  <Apple className="w-4 h-4" />
                  Mac / Linux
                </a>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-slate-200"
                  onClick={() => {
                    const url = `${window.location.origin}/downloads/`
                    navigator.clipboard.writeText(url)
                    toast.success('Downloads page URL copied')
                  }}
                >
                  <Copy className="w-3.5 h-3.5 mr-1.5" />
                  Copy page link
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Sessions table */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Support Sessions</CardTitle>
              <CardDescription>Create a session, then share the code or link with your customer.</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={fetchSessions}>
              <RefreshCw className="w-4 h-4 mr-1" />
              Refresh
            </Button>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-12 text-slate-500">
                <RefreshCw className="w-6 h-6 mx-auto mb-2 animate-spin" />
                Loading sessions…
              </div>
            ) : sessions.length === 0 ? (
              <div className="text-center py-12 text-slate-500">
                <p className="mb-3">No sessions yet.</p>
                <Button onClick={() => setOpenCreate(true)} className="bg-emerald-600 hover:bg-emerald-700">
                  <Plus className="w-4 h-4 mr-1" />
                  Create your first session
                </Button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Title</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Started</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sessions.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => copyCode(s.code)}
                              className="font-mono font-bold text-slate-900 tracking-wider hover:text-emerald-600 transition-colors"
                              title="Click to copy"
                            >
                              {s.code}
                            </button>
                          </div>
                        </TableCell>
                        <TableCell className="font-medium">{s.title}</TableCell>
                        <TableCell>{s.customerName ?? <span className="text-slate-400 italic">—</span>}</TableCell>
                        <TableCell>{statusBadge(s.status)}</TableCell>
                        <TableCell className="text-sm text-slate-600">{fmtTime(s.createdAt)}</TableCell>
                        <TableCell className="text-sm text-slate-600">{fmtTime(s.startedAt)}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center gap-2 justify-end">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => copyJoinLink(s.code)}
                              title="Copy join link"
                            >
                              {copiedCode === s.code ? (
                                <Check className="w-3.5 h-3.5 mr-1 text-emerald-600" />
                              ) : (
                                <Copy className="w-3.5 h-3.5 mr-1" />
                              )}
                              Link
                            </Button>
                            {s.status !== 'ended' && (
                              <Button
                                size="sm"
                                onClick={() => onJoinSession(s.id, s.code, s.title)}
                                className="bg-emerald-600 hover:bg-emerald-700"
                              >
                                Join
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      {/* Create session dialog */}
      <Dialog open={openCreate} onOpenChange={setOpenCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start a new support session</DialogTitle>
            <DialogDescription>
              Give it a short description so you can find it later. We&apos;ll generate a unique code your customer can enter.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="title">What do you need to help with?</Label>
              <Input
                id="title"
                placeholder="e.g. Printer setup for Mrs. Johnson"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newTitle.trim()) createSession()
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenCreate(false)}>Cancel</Button>
            <Button onClick={createSession} disabled={creating || !newTitle.trim()} className="bg-emerald-600 hover:bg-emerald-700">
              {creating ? 'Creating…' : 'Create session'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
