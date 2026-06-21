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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import {
  Copy,
  Check,
  Plus,
  ArrowLeft,
  RefreshCw,
  Clock,
  Circle,
  Monitor as MonitorIcon,
  Apple,
  MousePointer2,
  LogOut,
  Server,
  MonitorSmartphone,
  Trash2,
} from 'lucide-react'
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
  unattendedMachineCode?: string | null
}

interface UnattendedMachine {
  id: string
  machineCode: string
  customerName: string
  hostname: string | null
  os: string | null
  status: string
  lastSeenAt: string | null
  installedAt: string
  sessionCount: number
}

interface TechnicianDashboardProps {
  technicianName: string
  onBack: () => void
  onLogout: () => void
  onJoinSession: (sessionId: string, code: string, title: string) => void
}

export function TechnicianDashboard({
  technicianName,
  onBack,
  onLogout,
  onJoinSession,
}: TechnicianDashboardProps) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [machines, setMachines] = useState<UnattendedMachine[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [openCreate, setOpenCreate] = useState(false)
  const [copiedCode, setCopiedCode] = useState<string | null>(null)

  // Unattended setup dialog state
  const [openSetup, setOpenSetup] = useState(false)
  const [setupCustomerName, setSetupCustomerName] = useState('')
  const [setupMachine, setSetupMachine] = useState<UnattendedMachine | null>(null)
  const [creatingSetup, setCreatingSetup] = useState(false)

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

  const fetchMachines = useCallback(async () => {
    try {
      const res = await fetch('/api/unattended')
      const data = await res.json()
      setMachines(data.machines ?? [])
    } catch (err) {
      console.error(err)
    }
  }, [])

  useEffect(() => {
    fetchSessions()
    fetchMachines()
    const interval = setInterval(() => {
      fetchSessions()
      fetchMachines()
    }, 5000)
    return () => clearInterval(interval)
  }, [fetchSessions, fetchMachines])

  const createSession = async (unattendedMachineCode?: string) => {
    if (!newTitle.trim()) return
    setCreating(true)
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTitle.trim(),
          technicianName,
          ...(unattendedMachineCode ? { unattendedMachineCode } : {}),
        }),
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

  const createUnattendedSetup = async () => {
    if (!setupCustomerName.trim()) return
    setCreatingSetup(true)
    try {
      const res = await fetch('/api/unattended', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerName: setupCustomerName.trim() }),
      })
      if (!res.ok) throw new Error('Failed to create setup code')
      const machine = await res.json()
      setSetupMachine(machine)
      toast.success(`Setup code ${machine.machineCode} generated`)
      fetchMachines()
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to create setup code')
    } finally {
      setCreatingSetup(false)
    }
  }

  const connectToMachine = async (machine: UnattendedMachine) => {
    setCreating(true)
    try {
      // Create a session targeting this machine
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `Unattended: ${machine.customerName}`,
          technicianName,
          unattendedMachineCode: machine.machineCode,
        }),
      })
      if (!res.ok) throw new Error('Failed to start session')
      const session = await res.json()
      toast.success(`Connecting to ${machine.customerName}…`)
      onJoinSession(session.id, session.code, session.title)
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to start session')
    } finally {
      setCreating(false)
    }
  }

  // reconnectToMachine creates a new session for an unattended machine by code.
  // Used when an old session has become invalid (e.g., after a reboot) and the
  // technician wants to start fresh without going back to the Unattended tab.
  const reconnectToMachine = async (machineCode: string, title: string) => {
    setCreating(true)
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `Unattended: ${title.replace(/^Unattended:\s*/, '')}`,
          technicianName,
          unattendedMachineCode: machineCode,
        }),
      })
      if (!res.ok) throw new Error('Failed to start session')
      const session = await res.json()
      toast.success(`Reconnecting to ${machineCode}…`)
      onJoinSession(session.id, session.code, session.title)
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to reconnect')
    } finally {
      setCreating(false)
    }
  }

  const copyJoinLink = (code: string) => {
    const url = `${window.location.origin}/#join/${code}`
    navigator.clipboard.writeText(url)
    setCopiedCode(code)
    toast.success('Join link copied')
    setTimeout(() => setCopiedCode(null), 2000)
  }

  const deleteSession = async (id: string, title: string) => {
    if (!confirm(`Delete session "${title}"? This cannot be undone.`)) return
    try {
      const res = await fetch(`/api/sessions/${id}/delete`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete')
      toast.success('Session deleted')
      fetchSessions()
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to delete session')
    }
  }

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code)
    toast.success('Code copied')
  }

  const copySetupInstallerLink = (machineCode: string) => {
    // Customer runs the installer with --unattended MACHINE_CODE
    const url = `${window.location.origin}/#unattended/${machineCode}`
    navigator.clipboard.writeText(url)
    toast.success('Unattended installer link copied')
  }

  const deleteMachine = async (machineCode: string, name: string) => {
    if (!confirm(`Remove "${name}" from the dashboard?\n\nThis only removes the server-side registration. To fully uninstall the MarqueeIT service from this machine, connect to it and use the Remove Unattended button in the session toolbar.`)) return
    try {
      const res = await fetch(`/api/unattended/${machineCode}/delete`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete')
      toast.success('Machine removed from dashboard')
      fetchMachines()
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to remove machine')
    }
  }

  const statusBadge = (status: string) => {
    if (status === 'waiting') return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">Waiting</Badge>
    if (status === 'active') return <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">Active</Badge>
    return <Badge variant="outline" className="bg-slate-50 text-slate-500 border-slate-200">Ended</Badge>
  }

  const machineStatusBadge = (status: string, lastSeen: string | null) => {
    // A machine is only "online" if it has heartbeated within the last 2 minutes,
    // regardless of what the status field says. The DB status field is only
    // updated on heartbeat, so it stays "online" forever after the machine
    // goes offline.
    const stale = !lastSeen || Date.now() - new Date(lastSeen).getTime() > 2 * 60 * 1000
    if (status === 'online' && !stale) {
      return <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">Online</Badge>
    }
    return (
      <Badge variant="outline" className="bg-slate-50 text-slate-500 border-slate-200">
        {stale ? 'Offline' : 'Idle'}
      </Badge>
    )
  }

  const fmtTime = (iso: string | null) => {
    if (!iso) return '—'
    const d = new Date(iso)
    return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="h-full bg-slate-50">
      <header className="border-b bg-white">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-sm font-semibold text-slate-900">Dashboard</h1>
              <p className="text-xs text-slate-500">Signed in as {technicianName}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => setOpenCreate(true)}
              size="sm"
              className="bg-[#1B3A6B] hover:bg-[#0F2A52]"
            >
              <Plus className="w-4 h-4 mr-1" />
              New Session
            </Button>
            <Button
              onClick={() => setOpenSetup(true)}
              size="sm"
              variant="outline"
              className="border-[#1B3A6B] text-[#1B3A6B] hover:bg-[#1B3A6B] hover:text-white"
            >
              <MonitorSmartphone className="w-4 h-4 mr-1" />
              Setup Unattended
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        {/* Stats */}
        <div className="grid sm:grid-cols-3 gap-3 mb-6">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wide">Total Sessions</p>
                  <p className="text-2xl font-bold text-slate-900 mt-0.5">{sessions.length}</p>
                </div>
                <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center">
                  <Circle className="w-4 h-4 text-slate-500" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wide">Active Now</p>
                  <p className="text-2xl font-bold text-[#1B3A6B] mt-0.5">
                    {sessions.filter((s) => s.status === 'active').length}
                  </p>
                </div>
                <div className="w-9 h-9 rounded-lg bg-[#1B3A6B]/10 flex items-center justify-center">
                  <Circle className="w-4 h-4 text-[#1B3A6B] fill-[#1B3A6B]" />
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wide">Unattended Machines</p>
                  <p className="text-2xl font-bold text-[#1B3A6B] mt-0.5">
                    {machines.filter((m) => m.status === 'online').length}/{machines.length}
                  </p>
                </div>
                <div className="w-9 h-9 rounded-lg bg-[#FFC425]/20 flex items-center justify-center">
                  <Server className="w-4 h-4 text-[#B8860B]" />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="sessions" className="w-full">
          <TabsList className="bg-white border border-slate-200">
            <TabsTrigger value="sessions">Sessions</TabsTrigger>
            <TabsTrigger value="unattended">
              Unattended Machines
              {machines.length > 0 && (
                <span className="ml-1.5 text-xs text-slate-500">({machines.length})</span>
              )}
            </TabsTrigger>
          </TabsList>

          {/* Sessions tab */}
          <TabsContent value="sessions" className="mt-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Support Sessions</CardTitle>
                  <CardDescription>Create a session and share the code with your customer.</CardDescription>
                </div>
                <Button variant="ghost" size="sm" onClick={() => { setLoading(true); fetchSessions() }}>
                  <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="text-center py-12 text-slate-500">
                    <RefreshCw className="w-6 h-6 mx-auto mb-2 animate-spin" />
                    Loading…
                  </div>
                ) : sessions.length === 0 ? (
                  <div className="text-center py-12 text-slate-500">
                    <p className="mb-3">No sessions yet.</p>
                    <Button onClick={() => setOpenCreate(true)} className="bg-[#1B3A6B] hover:bg-[#0F2A52]">
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
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sessions.map((s) => (
                          <TableRow key={s.id}>
                            <TableCell>
                              <button
                                onClick={() => copyCode(s.code)}
                                className="font-mono font-bold text-slate-900 tracking-wider hover:text-[#1B3A6B]"
                                title="Click to copy"
                              >
                                {s.code}
                              </button>
                            </TableCell>
                            <TableCell className="font-medium">{s.title}</TableCell>
                            <TableCell>{s.customerName ?? <span className="text-slate-400 italic">—</span>}</TableCell>
                            <TableCell>{statusBadge(s.status)}</TableCell>
                            <TableCell className="text-sm text-slate-600">{fmtTime(s.createdAt)}</TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center gap-2 justify-end">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => copyJoinLink(s.code)}
                                  title="Copy join link"
                                >
                                  {copiedCode === s.code ? (
                                    <Check className="w-3.5 h-3.5 mr-1 text-[#1B3A6B]" />
                                  ) : (
                                    <Copy className="w-3.5 h-3.5 mr-1" />
                                  )}
                                  Link
                                </Button>
                                {s.status !== 'ended' && (
                                  <Button
                                    size="sm"
                                    onClick={() => onJoinSession(s.id, s.code, s.title)}
                                    className="bg-[#1B3A6B] hover:bg-[#0F2A52]"
                                  >
                                    Join
                                  </Button>
                                )}
                                {/* Reconnect button for ended/waiting unattended sessions only */}
                                {s.unattendedMachineCode && (s.status === 'ended' || s.status === 'waiting') && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => reconnectToMachine(s.unattendedMachineCode!, s.title)}
                                    className="border-[#1B3A6B] text-[#1B3A6B] hover:bg-[#1B3A6B] hover:text-white"
                                    title="Create a new session for this unattended machine"
                                  >
                                    <RefreshCw className="w-3.5 h-3.5 mr-1" />
                                    Reconnect
                                  </Button>
                                )}
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => deleteSession(s.id, s.title)}
                                  className="text-red-500 hover:text-red-700 hover:bg-red-50"
                                  title="Delete session"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
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
          </TabsContent>

          {/* Unattended machines tab */}
          <TabsContent value="unattended" className="mt-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Server className="w-5 h-5 text-[#1B3A6B]" />
                    Unattended Machines
                  </CardTitle>
                  <CardDescription>
                    Customer machines set up for unattended access. Connect to them any time — no customer action needed.
                  </CardDescription>
                </div>
                <Button
                  onClick={() => setOpenSetup(true)}
                  size="sm"
                  variant="outline"
                  className="border-[#1B3A6B] text-[#1B3A6B] hover:bg-[#1B3A6B] hover:text-white"
                >
                  <Plus className="w-4 h-4 mr-1" />
                  New Setup
                </Button>
              </CardHeader>
              <CardContent>
                {machines.length === 0 ? (
                  <div className="text-center py-12 text-slate-500">
                    <MonitorSmartphone className="w-10 h-10 mx-auto mb-3 text-slate-300" />
                    <p className="mb-1 font-medium text-slate-700">No unattended machines yet</p>
                    <p className="text-sm mb-4">Click "New Setup" to generate a one-time installer code for a customer machine.</p>
                    <Button
                      onClick={() => setOpenSetup(true)}
                      className="bg-[#1B3A6B] hover:bg-[#0F2A52]"
                    >
                      <Plus className="w-4 h-4 mr-1" />
                      New Setup
                    </Button>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Label</TableHead>
                          <TableHead>Hostname</TableHead>
                          <TableHead>OS</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Last Seen</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {machines.map((m) => (
                          <TableRow key={m.id}>
                            <TableCell>
                              <div>
                                <p className="font-medium text-slate-900">{m.customerName}</p>
                                <p className="text-xs text-slate-500 font-mono">{m.machineCode}</p>
                              </div>
                            </TableCell>
                            <TableCell className="text-sm text-slate-600">{m.hostname ?? '—'}</TableCell>
                            <TableCell className="text-sm text-slate-600">{m.os ?? '—'}</TableCell>
                            <TableCell>{machineStatusBadge(m.status, m.lastSeenAt)}</TableCell>
                            <TableCell className="text-sm text-slate-600">{fmtTime(m.lastSeenAt)}</TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center gap-2 justify-end">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => copySetupInstallerLink(m.machineCode)}
                                  title="Copy installer link"
                                >
                                  <Copy className="w-3.5 h-3.5 mr-1" />
                                  Link
                                </Button>
                                <Button
                                  size="sm"
                                  onClick={() => connectToMachine(m)}
                                  className="bg-[#1B3A6B] hover:bg-[#0F2A52]"
                                  disabled={creating}
                                >
                                  <MousePointer2 className="w-3.5 h-3.5 mr-1" />
                                  Connect
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => deleteMachine(m.machineCode, m.customerName)}
                                  className="text-red-500 hover:text-red-700 hover:bg-red-50"
                                  title="Remove machine"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </Button>
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
          </TabsContent>
        </Tabs>
      </main>

      {/* Create session dialog */}
      <Dialog open={openCreate} onOpenChange={setOpenCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New support session</DialogTitle>
            <DialogDescription>
              The customer will need to enter this code on the landing page to download the helper app.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="title">Description</Label>
              <Input
                id="title"
                placeholder="e.g. Printer setup for Mrs. Johnson"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newTitle.trim()) createSession()
                }}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenCreate(false)}>Cancel</Button>
            <Button
              onClick={() => createSession()}
              disabled={creating || !newTitle.trim()}
              className="bg-[#1B3A6B] hover:bg-[#0F2A52]"
            >
              {creating ? 'Creating…' : 'Create session'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unattended setup dialog */}
      <Dialog open={openSetup} onOpenChange={(open) => {
        setOpenSetup(open)
        if (!open) {
          setSetupMachine(null)
          setSetupCustomerName('')
        }
      }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Set up unattended access</DialogTitle>
            <DialogDescription>
              Generate a one-time setup code. Run the installer with this code on the customer&apos;s
              machine — it will register itself and start automatically on boot. You can then connect
              any time without the customer being present.
            </DialogDescription>
          </DialogHeader>

          {!setupMachine ? (
            <>
              <div className="space-y-3 py-2">
                <div className="space-y-1.5">
                  <Label htmlFor="setup-name">Friendly label for this machine</Label>
                  <Input
                    id="setup-name"
                    placeholder="e.g. Front desk PC, Margaret's laptop"
                    value={setupCustomerName}
                    onChange={(e) => setSetupCustomerName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && setupCustomerName.trim()) createUnattendedSetup()
                    }}
                    autoFocus
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpenSetup(false)}>Cancel</Button>
                <Button
                  onClick={createUnattendedSetup}
                  disabled={creatingSetup || !setupCustomerName.trim()}
                  className="bg-[#1B3A6B] hover:bg-[#0F2A52]"
                >
                  {creatingSetup ? 'Generating…' : 'Generate setup code'}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <div className="py-2 space-y-4">
              <div className="bg-[#FFC425]/15 border border-[#FFC425] rounded-lg p-4 text-center">
                <p className="text-xs text-[#B8860B] uppercase tracking-wide font-semibold mb-1">Setup code</p>
                <p className="font-mono text-3xl font-bold text-[#1B3A6B] tracking-wider">{setupMachine.machineCode}</p>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                <p className="text-sm font-semibold text-slate-900 mb-2">On the customer&apos;s machine:</p>
                <ol className="space-y-2 text-sm text-slate-700">
                  <li className="flex gap-2">
                    <span className="font-bold text-[#1B3A6B]">1.</span>
                    <span>Download the MarqueeIT client binary (Windows, Mac, or Linux) from the customer download page or via the links below.</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-bold text-[#1B3A6B]">2.</span>
                    <span>Open a terminal / command prompt and run the client with the <code className="bg-slate-200 px-1 rounded text-xs">--unattended</code> flag and this code:</span>
                  </li>
                </ol>
                <div className="mt-2 bg-slate-900 text-slate-100 rounded p-2 font-mono text-xs overflow-x-auto">
                  <div className="text-slate-400"># Windows (run in Command Prompt)</div>
                  <div>marqueeit-client-windows.exe --unattended {setupMachine.machineCode}</div>
                  <div className="text-slate-400 mt-2"># Mac (in Terminal)</div>
                  <div>./marqueeit-client-mac --unattended {setupMachine.machineCode}</div>
                  <div className="text-slate-400 mt-2"># Linux (in Terminal)</div>
                  <div>./marqueeit-client-linux --unattended {setupMachine.machineCode}</div>
                </div>
                <ol className="space-y-2 text-sm text-slate-700 mt-3">
                  <li className="flex gap-2">
                    <span className="font-bold text-[#1B3A6B]">3.</span>
                    <span>The installer sets up auto-start on boot, registers with the server, and starts listening.</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-bold text-[#1B3A6B]">4.</span>
                    <span>You can now click <strong>Connect</strong> on the Unattended Machines tab any time to start a session.</span>
                  </li>
                </ol>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => copySetupInstallerLink(setupMachine.machineCode)}
                >
                  <Copy className="w-4 h-4 mr-1.5" />
                  Copy installer page link
                </Button>
                <Button
                  className="flex-1 bg-[#1B3A6B] hover:bg-[#0F2A52]"
                  onClick={() => setOpenSetup(false)}
                >
                  Done
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
