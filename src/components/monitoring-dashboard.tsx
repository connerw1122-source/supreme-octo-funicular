'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import {
  Activity, MousePointerClick, Keyboard, Clock, Globe, Image as ImageIcon,
  Settings, RefreshCw, TrendingUp, TrendingDown, Minus, X, ArrowLeft,
} from 'lucide-react'
import { toast } from 'sonner'

interface Machine {
  id: string
  machineCode: string
  customerName: string
  hostname: string | null
  os: string | null
  status: string
  lastSeenAt: string | null
}

interface ActivitySummary {
  score: number
  activeTime: number
  idleTime: number
  totalTime: number
  totalClicks: number
  totalKeystrokes: number
  apps: { productive: number; unproductive: number; neutral: number; total: number }
  websites: { productive: number; unproductive: number; neutral: number; total: number }
}

interface MachineActivity {
  machine: Machine
  summary: ActivitySummary | null
  lastApp: string | null
  lastScreenshot: string | null
  loading: boolean
}

interface MonitoringConfig {
  activityInterval: number
  screenshotInterval: number
  idleThreshold: number
  screenshotQuality: number
  screenshotWidth: number
  screenshotHeight: number
  maxScreenshots: number
  trackMouseClicks: boolean
  trackKeystrokes: boolean
  trackAppUsage: boolean
  trackWebsites: boolean
  captureScreenshots: boolean
  trackMouseMoves: boolean
  productiveApps: string[]
  unproductiveApps: string[]
  productiveWebsites: string[]
  unproductiveWebsites: string[]
  retentionDays: number
}

export function MonitoringDashboard({ technicianName, onBack }: { technicianName: string; onBack?: () => void }) {
  const [machines, setMachines] = useState<Machine[]>([])
  const [activities, setActivities] = useState<Record<string, MachineActivity>>({})
  const [loading, setLoading] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const [config, setConfig] = useState<MonitoringConfig | null>(null)
  const [selectedMachine, setSelectedMachine] = useState<string | null>(null)

  const fetchMachines = useCallback(async () => {
    try {
      const res = await fetch('/api/unattended')
      const data = await res.json()
      setMachines(data.machines ?? [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchActivities = useCallback(async () => {
    for (const m of machines) {
      try {
        const [scoreRes, logsRes, shotRes] = await Promise.all([
          fetch(`/api/activity/score?machineCode=${m.machineCode}&hours=1`),
          fetch(`/api/activity/logs?machineCode=${m.machineCode}&limit=1`),
          fetch(`/api/activity/screenshots?machineCode=${m.machineCode}&limit=1`),
        ])
        const score = await scoreRes.json()
        const logs = await logsRes.json()
        const shots = await shotRes.json()
        setActivities((prev) => ({
          ...prev,
          [m.machineCode]: {
            machine: m,
            summary: score,
            lastApp: logs.logs?.[0]?.activeAppName || null,
            lastScreenshot: shots.screenshots?.[0]?.imageData || null,
            loading: false,
          },
        }))
      } catch (err) {
        // Skip on error
      }
    }
  }, [machines])

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/activity/config')
      const data = await res.json()
      setConfig(data)
    } catch (err) {
      console.error(err)
    }
  }, [])

  useEffect(() => {
    fetchMachines()
    fetchConfig()
    const interval = setInterval(() => {
      fetchMachines()
    }, 10000)
    return () => clearInterval(interval)
  }, [fetchMachines, fetchConfig])

  useEffect(() => {
    if (machines.length > 0) {
      fetchActivities()
      const interval = setInterval(fetchActivities, 15000)
      return () => clearInterval(interval)
    }
  }, [machines, fetchActivities])

  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`
    const mins = Math.floor(seconds / 60)
    if (mins < 60) return `${mins}m`
    const hrs = Math.floor(mins / 60)
    return `${hrs}h ${mins % 60}m`
  }

  const getScoreColor = (score: number) => {
    if (score >= 75) return 'text-emerald-600'
    if (score >= 50) return 'text-amber-600'
    return 'text-red-500'
  }

  const getScoreIcon = (score: number) => {
    if (score >= 75) return <TrendingUp className="w-4 h-4 text-emerald-600" />
    if (score >= 50) return <Minus className="w-4 h-4 text-amber-600" />
    return <TrendingDown className="w-4 h-4 text-red-500" />
  }

  const isOnline = (m: Machine) => {
    if (!m.lastSeenAt) return false
    return Date.now() - new Date(m.lastSeenAt).getTime() < 2 * 60 * 1000
  }

  return (
    <div className="h-full flex flex-col bg-slate-50">
      {/* Header */}
      <header className="border-b bg-white shrink-0">
        <div className="px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-[#1B3A6B] text-[#FFC425] flex items-center justify-center font-black text-sm">M</div>
            <div>
              <h1 className="text-sm font-semibold text-slate-900">MarqueeIT Monitor</h1>
              <p className="text-xs text-slate-500">Workplace Productivity Monitoring · {technicianName}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {onBack && (
              <Button variant="ghost" size="sm" onClick={onBack}>
                <ArrowLeft className="w-4 h-4 mr-1" />
                Back
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => { setLoading(true); fetchMachines() }}>
              <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={() => { fetchConfig(); setShowSettings(true) }}>
              <Settings className="w-4 h-4 mr-1" />
              Settings
            </Button>
          </div>
        </div>
      </header>

      {/* Stats bar */}
      <div className="px-6 py-3 flex items-center gap-4 bg-white border-b">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500" />
          <span className="text-sm font-medium text-slate-700">
            {machines.filter(m => isOnline(m)).length} Online
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-slate-400" />
          <span className="text-sm font-medium text-slate-500">
            {machines.filter(m => !isOnline(m)).length} Offline
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-[#1B3A6B]" />
          <span className="text-sm font-medium text-slate-700">
            Avg Score: {
              machines.length > 
              Math.round(machines.reduce((acc, m) => {
                const a = activities[m.machineCode]
                return acc + (a?.summary?.score || 0)
              }, 0) / Math.max(machines.length, 1))
            }
          </span>
        </div>
      </div>

      {/* Live tiles grid */}
      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="text-center py-12 text-slate-500">
            <RefreshCw className="w-6 h-6 mx-auto mb-2 animate-spin" />
            Loading…
          </div>
        ) : machines.length === 0 ? (
          <div className="text-center py-12 text-slate-500">
            <Activity className="w-12 h-12 mx-auto mb-4 text-slate-300" />
            <p className="text-sm font-medium text-slate-700">No monitored machines yet</p>
            <p className="text-xs text-slate-500 mt-1">Set up unattended access on employee machines to start monitoring.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {machines.map((m) => {
              const act = activities[m.machineCode]
              const online = isOnline(m)
              const score = act?.summary?.score ?? 0
              const isActive = act?.summary?.totalTime ? (act.summary.activeTime / act.summary.totalTime) > 0.5 : false
              const isIdle = online && !isActive && (act?.summary?.idleTime ?? 0) > 0

              return (
                <Card
                  key={m.id}
                  className={`cursor-pointer hover:shadow-lg transition-shadow ${!online ? 'opacity-60' : ''}`}
                  onClick={() => setSelectedMachine(m.machineCode)}
                >
                  <CardContent className="p-4">
                    {/* Header row */}
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={`w-2 h-2 rounded-full shrink-0 ${
                          !online ? 'bg-slate-400' : isActive ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
                        }`} />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900 truncate">{m.customerName}</p>
                          <p className="text-[10px] text-slate-500 truncate">{m.hostname || m.machineCode}</p>
                        </div>
                      </div>
                      <Badge variant="outline" className={`shrink-0 text-[10px] ${
                        !online ? 'bg-slate-50 text-slate-400 border-slate-200' :
                        isActive ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                        'bg-amber-50 text-amber-700 border-amber-200'
                      }`}>
                        {!online ? 'Offline' : isActive ? 'Active' : 'Idle'}
                      </Badge>
                    </div>

                    {/* Screenshot thumbnail */}
                    {act?.lastScreenshot ? (
                      <div className="mb-3 rounded-md overflow-hidden border border-slate-200">
                        <img src={act.lastScreenshot} alt="Screenshot" className="w-full h-24 object-cover" />
                      </div>
                    ) : (
                      <div className="mb-3 rounded-md border border-slate-200 bg-slate-100 h-24 flex items-center justify-center">
                        <ImageIcon className="w-6 h-6 text-slate-300" />
                      </div>
                    )}

                    {/* Productivity score */}
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-slate-500">Productivity</span>
                      <div className="flex items-center gap-1">
                        {getScoreIcon(score)}
                        <span className={`text-lg font-bold ${getScoreColor(score)}`}>{score}</span>
                      </div>
                    </div>

                    {/* Activity metrics */}
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="flex items-center gap-1 text-slate-600">
                        <MousePointerClick className="w-3 h-3 text-slate-400" />
                        <span>{act?.summary?.totalClicks ?? 0} clicks</span>
                      </div>
                      <div className="flex items-center gap-1 text-slate-600">
                        <Keyboard className="w-3 h-3 text-slate-400" />
                        <span>{act?.summary?.totalKeystrokes ?? 0} keys</span>
                      </div>
                      <div className="flex items-center gap-1 text-slate-600">
                        <Clock className="w-3 h-3 text-emerald-500" />
                        <span>{formatDuration(act?.summary?.activeTime ?? 0)} active</span>
                      </div>
                      <div className="flex items-center gap-1 text-slate-600">
                        <Clock className="w-3 h-3 text-amber-500" />
                        <span>{formatDuration(act?.summary?.idleTime ?? 0)} idle</span>
                      </div>
                    </div>

                    {/* Current app */}
                    {act?.lastApp && (
                      <div className="mt-2 pt-2 border-t border-slate-100">
                        <p className="text-[10px] text-slate-400 uppercase tracking-wide">Current App</p>
                        <p className="text-xs font-medium text-slate-700 truncate">{act.lastApp}</p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </div>

      {/* Settings dialog */}
      {showSettings && config && (
        <MonitoringSettingsDialog
          config={config}
          onClose={() => setShowSettings(false)}
          onSave={(newConfig) => {
            setConfig(newConfig)
            setShowSettings(false)
            toast.success('Monitoring settings saved')
          }}
        />
      )}

      {/* Machine detail dialog */}
      {selectedMachine && (
        <MachineDetailDialog
          machineCode={selectedMachine}
          machine={machines.find(m => m.machineCode === selectedMachine)}
          onClose={() => setSelectedMachine(null)}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Monitoring Settings Dialog
// ---------------------------------------------------------------------------
function MonitoringSettingsDialog({
  config, onClose, onSave,
}: {
  config: MonitoringConfig
  onClose: () => void
  onSave: (config: MonitoringConfig) => void
}) {
  const [local, setLocal] = useState<MonitoringConfig>({ ...config })
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/activity/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(local),
      })
      if (!res.ok) throw new Error('Failed to save')
      const data = await res.json()
      onSave(data.config)
    } catch (err) {
      toast.error('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  const update = (field: keyof MonitoringConfig, value: any) => {
    setLocal((prev) => ({ ...prev, [field]: value }))
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Monitoring Settings</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Interval Settings */}
          <div>
            <h3 className="text-sm font-semibold text-slate-900 mb-3">Intervals & Timing</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs">Activity Report Interval (seconds)</Label>
                <Input
                  type="number" min={10} max={300}
                  value={local.activityInterval}
                  onChange={(e) => update('activityInterval', parseInt(e.target.value) || 30)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">Screenshot Interval (seconds)</Label>
                <Input
                  type="number" min={60} max={3600}
                  value={local.screenshotInterval}
                  onChange={(e) => update('screenshotInterval', parseInt(e.target.value) || 300)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">Idle Threshold (seconds)</Label>
                <Input
                  type="number" min={10} max={600}
                  value={local.idleThreshold}
                  onChange={(e) => update('idleThreshold', parseInt(e.target.value) || 60)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">Data Retention (days)</Label>
                <Input
                  type="number" min={1} max={365}
                  value={local.retentionDays}
                  onChange={(e) => update('retentionDays', parseInt(e.target.value) || 30)}
                  className="mt-1"
                />
              </div>
            </div>
          </div>

          {/* Screenshot Settings */}
          <div>
            <h3 className="text-sm font-semibold text-slate-900 mb-3">Screenshots</h3>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label className="text-xs">JPEG Quality ({local.screenshotQuality})</Label>
                <Slider
                  value={[local.screenshotQuality]} min={10} max={90} step={5}
                  onValueChange={(v) => update('screenshotQuality', v[0])}
                  className="mt-2"
                />
              </div>
              <div>
                <Label className="text-xs">Width (px)</Label>
                <Input
                  type="number" min={160} max={1920}
                  value={local.screenshotWidth}
                  onChange={(e) => update('screenshotWidth', parseInt(e.target.value) || 320)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">Height (px)</Label>
                <Input
                  type="number" min={90} max={1080}
                  value={local.screenshotHeight}
                  onChange={(e) => update('screenshotHeight', parseInt(e.target.value) || 180)}
                  className="mt-1"
                />
              </div>
            </div>
            <div className="mt-2">
              <Label className="text-xs">Max Screenshots Per Machine</Label>
              <Input
                type="number" min={10} max={1000}
                value={local.maxScreenshots}
                onChange={(e) => update('maxScreenshots', parseInt(e.target.value) || 100)}
                className="mt-1 w-48"
              />
            </div>
          </div>

          {/* Feature Toggles */}
          <div>
            <h3 className="text-sm font-semibold text-slate-900 mb-3">Tracking Features</h3>
            <div className="space-y-3">
              {[
                ['trackMouseClicks', 'Track Mouse Clicks'],
                ['trackKeystrokes', 'Track Keystrokes'],
                ['trackMouseMoves', 'Track Mouse Movements (high volume)'],
                ['trackAppUsage', 'Track Application Usage'],
                ['trackWebsites', 'Track Website Visits'],
                ['captureScreenshots', 'Capture Periodic Screenshots'],
              ].map(([key, label]) => (
                <div key={key} className="flex items-center justify-between">
                  <Label className="text-sm cursor-pointer">{label}</Label>
                  <Switch
                    checked={local[key as keyof MonitoringConfig] as boolean}
                    onCheckedChange={(v) => update(key as keyof MonitoringConfig, v)}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* App Categorization */}
          <div>
            <h3 className="text-sm font-semibold text-slate-900 mb-3">App & Website Categorization</h3>
            <p className="text-xs text-slate-500 mb-3">Comma-separated patterns. Apps/sites matching these patterns will be categorized accordingly.</p>
            <div className="space-y-3">
              <div>
                <Label className="text-xs text-emerald-700">Productive Apps</Label>
                <Input
                  value={local.productiveApps.join(', ')}
                  onChange={(e) => update('productiveApps', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                  className="mt-1"
                  placeholder="excel, word, outlook, teams"
                />
              </div>
              <div>
                <Label className="text-xs text-red-600">Unproductive Apps</Label>
                <Input
                  value={local.unproductiveApps.join(', ')}
                  onChange={(e) => update('unproductiveApps', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                  className="mt-1"
                  placeholder="solitaire, steam, netflix"
                />
              </div>
              <div>
                <Label className="text-xs text-emerald-700">Productive Websites</Label>
                <Input
                  value={local.productiveWebsites.join(', ')}
                  onChange={(e) => update('productiveWebsites', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                  className="mt-1"
                  placeholder="github.com, docs.google.com, office.com"
                />
              </div>
              <div>
                <Label className="text-xs text-red-600">Unproductive Websites</Label>
                <Input
                  value={local.unproductiveWebsites.join(', ')}
                  onChange={(e) => update('unproductiveWebsites', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                  className="mt-1"
                  placeholder="facebook.com, twitter.com, youtube.com"
                />
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving} className="bg-[#1B3A6B] hover:bg-[#0F2A52]">
            {saving ? <RefreshCw className="w-4 h-4 mr-1 animate-spin" /> : null}
            Save Settings
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Machine Detail Dialog
// ---------------------------------------------------------------------------
function MachineDetailDialog({
  machineCode, machine, onClose,
}: {
  machineCode: string
  machine: Machine | undefined
  onClose: () => void
}) {
  const [tab, setTab] = useState<'overview' | 'apps' | 'websites' | 'screenshots'>('overview')
  const [score, setScore] = useState<ActivitySummary | null>(null)
  const [apps, setApps] = useState<any[]>([])
  const [websites, setWebsites] = useState<any[]>([])
  const [screenshots, setScreenshots] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true)
      try {
        const [s, a, w, ss] = await Promise.all([
          fetch(`/api/activity/score?machineCode=${machineCode}&hours=24`).then(r => r.json()),
          fetch(`/api/activity/apps?machineCode=${machineCode}&hours=24`).then(r => r.json()),
          fetch(`/api/activity/websites?machineCode=${machineCode}&hours=24`).then(r => r.json()),
          fetch(`/api/activity/screenshots?machineCode=${machineCode}&limit=12`).then(r => r.json()),
        ])
        setScore(s)
        setApps(a.apps || [])
        setWebsites(w.websites || [])
        setScreenshots(ss.screenshots || [])
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    fetchAll()
  }, [machineCode])

  const fmtDur = (s: number) => {
    if (s < 60) return `${s}s`
    const m = Math.floor(s / 60)
    if (m < 60) return `${m}m`
    return `${Math.floor(m / 60)}h ${m % 60}m`
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {machine?.customerName || machineCode}
            <span className="text-xs font-mono text-slate-400">{machineCode}</span>
          </DialogTitle>
        </DialogHeader>

        {/* Tab buttons */}
        <div className="flex gap-1 border-b">
          {(['overview', 'apps', 'websites', 'screenshots'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-xs font-medium capitalize transition-colors ${
                tab === t ? 'text-[#1B3A6B] border-b-2 border-[#1B3A6B]' : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-center py-8">
            <RefreshCw className="w-6 h-6 mx-auto animate-spin text-slate-400" />
          </div>
        ) : (
          <div className="py-4">
            {tab === 'overview' && score && (
              <div className="space-y-4">
                <div className="grid grid-cols-4 gap-3">
                  <div className="bg-slate-50 rounded-lg p-3 text-center">
                    <p className="text-2xl font-bold text-slate-900">{score.score}</p>
                    <p className="text-[10px] text-slate-500 uppercase">Productivity Score</p>
                  </div>
                  <div className="bg-emerald-50 rounded-lg p-3 text-center">
                    <p className="text-2xl font-bold text-emerald-600">{fmtDur(score.activeTime)}</p>
                    <p className="text-[10px] text-slate-500 uppercase">Active Time</p>
                  </div>
                  <div className="bg-amber-50 rounded-lg p-3 text-center">
                    <p className="text-2xl font-bold text-amber-600">{fmtDur(score.idleTime)}</p>
                    <p className="text-[10px] text-slate-500 uppercase">Idle Time</p>
                  </div>
                  <div className="bg-blue-50 rounded-lg p-3 text-center">
                    <p className="text-2xl font-bold text-blue-600">{fmtDur(score.totalTime)}</p>
                    <p className="text-[10px] text-slate-500 uppercase">Total Tracked</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <h4 className="text-xs font-semibold text-slate-700 mb-2">Input Activity (24h)</h4>
                    <div className="space-y-1 text-xs">
                      <div className="flex justify-between"><span className="text-slate-500">Mouse Clicks</span><span className="font-medium">{score.totalClicks}</span></div>
                      <div className="flex justify-between"><span className="text-slate-500">Keystrokes</span><span className="font-medium">{score.totalKeystrokes}</span></div>
                    </div>
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-slate-700 mb-2">Activity Breakdown</h4>
                    <div className="space-y-1 text-xs">
                      <div className="flex justify-between"><span className="text-emerald-600">Productive Apps</span><span className="font-medium">{fmtDur(score.apps.productive)}</span></div>
                      <div className="flex justify-between"><span className="text-red-500">Unproductive Apps</span><span className="font-medium">{fmtDur(score.apps.unproductive)}</span></div>
                      <div className="flex justify-between"><span className="text-slate-500">Neutral Apps</span><span className="font-medium">{fmtDur(score.apps.neutral)}</span></div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {tab === 'apps' && (
              <div className="space-y-2">
                {apps.length === 0 ? (
                  <p className="text-center text-slate-400 py-4">No app usage data</p>
                ) : apps.map((app, i) => (
                  <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-slate-50">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full ${
                        app.category === 'productive' ? 'bg-emerald-500' :
                        app.category === 'unproductive' ? 'bg-red-500' : 'bg-slate-400'
                      }`} />
                      <span className="text-sm font-medium text-slate-700">{app.appName}</span>
                      {app.lastTitle && <span className="text-xs text-slate-400 truncate max-w-xs">{app.lastTitle}</span>}
                    </div>
                    <span className="text-xs font-medium text-slate-600">{fmtDur(app.totalDuration)}</span>
                  </div>
                ))}
              </div>
            )}

            {tab === 'websites' && (
              <div className="space-y-2">
                {websites.length === 0 ? (
                  <p className="text-center text-slate-400 py-4">No website data</p>
                ) : websites.map((site, i) => (
                  <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-slate-50">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={`w-2 h-2 rounded-full shrink-0 ${
                        site.category === 'productive' ? 'bg-emerald-500' :
                        site.category === 'unproductive' ? 'bg-red-500' : 'bg-slate-400'
                      }`} />
                      <div className="min-w-0">
                        <span className="text-sm font-medium text-slate-700">{site.domain}</span>
                        {site.lastTitle && <span className="text-xs text-slate-400 truncate block">{site.lastTitle}</span>}
                      </div>
                    </div>
                    <div className="text-right shrink-0 ml-2">
                      <span className="text-xs font-medium text-slate-600">{fmtDur(site.totalDuration)}</span>
                      <span className="text-xs text-slate-400 ml-2">{site.visitCount} visits</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {tab === 'screenshots' && (
              <div className="grid grid-cols-3 gap-2">
                {screenshots.length === 0 ? (
                  <p className="col-span-3 text-center text-slate-400 py-4">No screenshots</p>
                ) : screenshots.map((shot, i) => (
                  <div key={i} className="rounded-lg overflow-hidden border border-slate-200 group relative">
                    <img src={shot.imageData} alt="Screenshot" className="w-full h-24 object-cover" />
                    <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[9px] px-1 py-0.5">
                      {new Date(shot.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
