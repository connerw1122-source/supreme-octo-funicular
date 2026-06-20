'use client'

import { useCallback, useEffect, useState } from 'react'
import { LandingView } from '@/components/landing-view'
import { LoginView } from '@/components/login-view'
import { TechnicianDashboard } from '@/components/technician-dashboard'
import { CustomerDownload } from '@/components/customer-download'
import { SessionView } from '@/components/session-view'
import { TechnicianConsole } from '@/components/technician-console'
import { Toaster } from 'sonner'
import { clearSession, getSession } from '@/lib/auth'

interface SessionTab {
  id: string
  sessionId: string
  code: string
  title: string
}

type View =
  | { name: 'landing' }
  | { name: 'login' }
  | { name: 'technician'; technicianName: string }
  | { name: 'customer-download'; code: string; customerName: string }
  | {
      name: 'technician-console'
      technicianName: string
      activeSession: SessionTab | null
      openSessions: SessionTab[]
    }

function getInitialView(): View {
  if (typeof window === 'undefined') return { name: 'landing' }
  const hash = window.location.hash
  const joinMatch = hash.match(/^#join\/([A-Za-z0-9]+)(?:\/([^/]+))?/)
  if (joinMatch) {
    const code = joinMatch[1].toUpperCase()
    const customerName = joinMatch[2] ? decodeURIComponent(joinMatch[2]) : ''
    return { name: 'customer-download', code, customerName }
  }
  const session = getSession()
  if (session) {
    return { name: 'technician', technicianName: session.username }
  }
  return { name: 'landing' }
}

export default function Home() {
  const [view, setView] = useState<View>(getInitialView)

  useEffect(() => {
    const applyHash = () => {
      const hash = window.location.hash
      const joinMatch = hash.match(/^#join\/([A-Za-z0-9]+)(?:\/([^/]+))?/)
      if (joinMatch) {
        const code = joinMatch[1].toUpperCase()
        const customerName = joinMatch[2] ? decodeURIComponent(joinMatch[2]) : ''
        setView({ name: 'customer-download', code, customerName })
        return
      }
    }
    window.addEventListener('hashchange', applyHash)
    return () => window.removeEventListener('hashchange', applyHash)
  }, [])

  useEffect(() => {
    if (view.name !== 'customer-download' && window.location.hash) {
      history.replaceState(null, '', window.location.pathname + window.location.search)
    }
  }, [view.name])

  const handleTechnicianLogin = useCallback(() => {
    setView({ name: 'login' })
  }, [])

  const handleLoginSuccess = useCallback((username: string) => {
    setView({
      name: 'technician-console',
      technicianName: username,
      activeSession: null,
      openSessions: [],
    })
  }, [])

  const handleLoginBack = useCallback(() => {
    setView({ name: 'landing' })
  }, [])

  const handleCustomer = useCallback((code: string, name: string) => {
    setView({ name: 'customer-download', code, customerName: name })
    const safeName = name ? '/' + encodeURIComponent(name) : ''
    history.replaceState(null, '', `#join/${code.toUpperCase()}${safeName}`)
  }, [])

  const handleBackToLanding = useCallback(() => {
    setView({ name: 'landing' })
  }, [])

  const handleLogout = useCallback(() => {
    clearSession()
    setView({ name: 'landing' })
  }, [])

  // --- Multi-session management ---
  const handleOpenSession = useCallback((sessionId: string, code: string, title: string) => {
    setView((current) => {
      if (current.name !== 'technician-console') return current
      // Check if this session is already open
      const existing = current.openSessions.find((s) => s.sessionId === sessionId)
      if (existing) {
        return { ...current, activeSession: existing }
      }
      // Open a new tab
      const newTab: SessionTab = { id: Math.random().toString(36).slice(2), sessionId, code, title }
      return {
        ...current,
        activeSession: newTab,
        openSessions: [...current.openSessions, newTab],
      }
    })
  }, [])

  const handleCloseSession = useCallback((tabId: string) => {
    setView((current) => {
      if (current.name !== 'technician-console') return current
      const remaining = current.openSessions.filter((s) => s.id !== tabId)
      const newActive = current.activeSession?.id === tabId
        ? remaining[remaining.length - 1] ?? null
        : current.activeSession
      return { ...current, openSessions: remaining, activeSession: newActive }
    })
  }, [])

  const handleSwitchSession = useCallback((tabId: string) => {
    setView((current) => {
      if (current.name !== 'technician-console') return current
      const tab = current.openSessions.find((s) => s.id === tabId)
      return tab ? { ...current, activeSession: tab } : current
    })
  }, [])

  const handleExitToLanding = useCallback(() => {
    setView((current) => {
      if (current.name === 'technician-console') {
        return { name: 'landing' }
      }
      if (current.name === 'session') {
        return { name: 'landing' }
      }
      return { name: 'landing' }
    })
  }, [])

  return (
    <>
      <Toaster position="bottom-left" richColors closeButton toastOptions={{ style: { marginBottom: '60px' } }} />
      {view.name === 'landing' && (
        <LandingView onCustomer={handleCustomer} onTechnicianLogin={handleTechnicianLogin} />
      )}
      {view.name === 'login' && (
        <LoginView onBack={handleLoginBack} onSuccess={handleLoginSuccess} />
      )}
      {view.name === 'technician' && (
        <TechnicianDashboard
          technicianName={view.technicianName}
          onBack={handleBackToLanding}
          onLogout={handleLogout}
          onJoinSession={handleOpenSession}
        />
      )}
      {view.name === 'customer-download' && (
        <CustomerDownload code={view.code} name={view.customerName} onBack={handleBackToLanding} />
      )}
      {view.name === 'technician-console' && (
        <TechnicianConsole
          technicianName={view.technicianName}
          openSessions={view.openSessions}
          activeSession={view.activeSession}
          onOpenSession={handleOpenSession}
          onCloseSession={handleCloseSession}
          onSwitchSession={handleSwitchSession}
          onLogout={handleLogout}
        />
      )}
    </>
  )
}
