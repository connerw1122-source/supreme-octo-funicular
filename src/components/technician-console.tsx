'use client'

import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { TechnicianDashboard } from '@/components/technician-dashboard'
import { SessionView } from '@/components/session-view'
import {
  LogOut,
  X,
  Monitor,
  LayoutGrid,
} from 'lucide-react'
import { toast } from 'sonner'

export interface SessionTab {
  id: string
  sessionId: string
  code: string
  title: string
}

interface TechnicianConsoleProps {
  technicianName: string
  openSessions: SessionTab[]
  activeSession: SessionTab | null
  onOpenSession: (sessionId: string, code: string, title: string) => void
  onCloseSession: (tabId: string) => void
  onSwitchSession: (tabId: string) => void
  onLogout: () => void
}

export function TechnicianConsole({
  technicianName,
  openSessions,
  activeSession,
  onOpenSession,
  onCloseSession,
  onSwitchSession,
  onLogout,
}: TechnicianConsoleProps) {
  const [showDashboard, setShowDashboard] = useState(!activeSession)

  const handleJoinSession = useCallback((sessionId: string, code: string, title: string) => {
    onOpenSession(sessionId, code, title)
    setShowDashboard(false)
  }, [onOpenSession])

  const handleExitSession = useCallback(() => {
    // When exiting a session, go back to dashboard view (don't close the tab)
    setShowDashboard(true)
  }, [])

  const handleCloseTab = useCallback((tabId: string) => {
    onCloseSession(tabId)
    // If we closed the active tab, show dashboard
    if (activeSession?.id === tabId) {
      setShowDashboard(true)
    }
  }, [onCloseSession, activeSession])

  return (
    <div className="h-screen flex flex-col bg-slate-900">
      {/* Top bar: logo + session tabs + logout */}
      <header className="border-b border-slate-800 bg-slate-950 shrink-0">
        <div className="flex items-center justify-between px-4 py-2">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded bg-[#1B3A6B] text-[#FFC425] flex items-center justify-center font-black text-sm">
                M
              </div>
              <span className="text-sm font-bold tracking-tight text-white hidden sm:inline">MarqueeIT</span>
            </div>
            <span className="text-xs text-slate-500 hidden md:inline">| {technicianName}</span>
          </div>

          {/* Session tabs */}
          <div className="flex items-center gap-1 flex-1 justify-center overflow-x-auto max-w-2xl">
            {/* Dashboard button */}
            <button
              onClick={() => setShowDashboard(true)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-t-lg text-xs font-medium transition-colors whitespace-nowrap ${
                showDashboard
                  ? 'bg-slate-800 text-[#FFC425] border-t-2 border-l-2 border-r-2 border-slate-700'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              Dashboard
            </button>

            {/* Session tabs */}
            {openSessions.map((tab) => (
              <div
                key={tab.id}
                className={`group flex items-center gap-1.5 px-3 py-1.5 rounded-t-lg text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  !showDashboard && activeSession?.id === tab.id
                    ? 'bg-slate-800 text-[#FFC425] border-t-2 border-l-2 border-r-2 border-slate-700'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
                onClick={() => {
                  onSwitchSession(tab.id)
                  setShowDashboard(false)
                }}
              >
                <Monitor className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate max-w-32">{tab.title}</span>
                <span className="font-mono text-[10px] text-slate-500">{tab.code}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleCloseTab(tab.id)
                  }}
                  className="ml-1 text-slate-500 hover:text-red-400 transition-colors"
                  title="Close session"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>

          {/* Logout */}
          <Button variant="ghost" size="sm" onClick={onLogout} className="text-slate-400 hover:text-white">
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </header>

      {/* Content area */}
      <div className="flex-1 overflow-hidden">
        {showDashboard || !activeSession ? (
          <div className="h-full overflow-y-auto bg-slate-50">
            <TechnicianDashboard
              technicianName={technicianName}
              onBack={() => setShowDashboard(false)}
              onLogout={onLogout}
              onJoinSession={handleJoinSession}
            />
          </div>
        ) : (
          <SessionView
            key={activeSession.id}
            roomCode={activeSession.code}
            displayName={technicianName}
            sessionTitle={activeSession.title}
            sessionId={activeSession.sessionId}
            onExit={handleExitSession}
            onEnded={handleExitSession}
          />
        )}
      </div>
    </div>
  )
}
