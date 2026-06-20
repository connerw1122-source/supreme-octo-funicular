'use client'

import { useCallback, useEffect, useState } from 'react'
import { LandingView } from '@/components/landing-view'
import { LoginView } from '@/components/login-view'
import { TechnicianDashboard } from '@/components/technician-dashboard'
import { CustomerDownload } from '@/components/customer-download'
import { SessionView } from '@/components/session-view'
import { Toaster } from 'sonner'
import { clearSession, getSession } from '@/lib/auth'

type View =
  | { name: 'landing' }
  | { name: 'login' }
  | { name: 'technician'; technicianName: string }
  | { name: 'customer-download'; code: string; customerName: string }
  | {
      name: 'session'
      roomCode: string
      displayName: string
      sessionTitle: string
      sessionId: string
    }

// Compute the initial view once: if a session is already saved in localStorage
// (from a previous login), boot straight into the technician dashboard.
function getInitialView(): View {
  if (typeof window === 'undefined') return { name: 'landing' }
  const hash = window.location.hash
  if (browserShareMatch) {
    const code = browserShareMatch[1].toUpperCase()
    const customerName = browserShareMatch[2] ? decodeURIComponent(browserShareMatch[2]) : ''
  }
  // Customer download: #join/CODE or #join/CODE/NAME
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

  // ---------------------------------------------------------------------------
  // Hash-based routing for the customer download link: #join/CODE/NAME
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const applyHash = () => {
      const hash = window.location.hash
      // Browser share
      if (browserShareMatch) {
        const code = browserShareMatch[1].toUpperCase()
        const customerName = browserShareMatch[2] ? decodeURIComponent(browserShareMatch[2]) : ''
        return
      }
      // Customer download
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

  // Clear hash when we leave customer views
  useEffect(() => {
    if (view.name !== 'customer-download' && window.location.hash) {
      history.replaceState(null, '', window.location.pathname + window.location.search)
    }
  }, [view.name])

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------
  const handleTechnicianLogin = useCallback(() => {
    setView({ name: 'login' })
  }, [])

  const handleLoginSuccess = useCallback((username: string) => {
    setView({ name: 'technician', technicianName: username })
  }, [])

  const handleLoginBack = useCallback(() => {
    setView({ name: 'landing' })
  }, [])

  const handleCustomer = useCallback((code: string, name: string) => {
    setView({ name: 'customer-download', code, customerName: name })
    // Update hash so the link is shareable
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

  const handleJoinSession = useCallback(
    (sessionId: string, code: string, title: string) => {
      setView((current) => {
        if (current.name !== 'technician') return current
        return {
          name: 'session',
          roomCode: code,
          displayName: current.technicianName,
          sessionTitle: title,
          sessionId,
        }
      })
    },
    []
  )

  const handleExitSession = useCallback(() => {
    setView((current) => {
      if (current.name === 'session') {
        return { name: 'technician', technicianName: current.displayName }
      }
      return { name: 'landing' }
    })
  }, [])

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
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
          onJoinSession={handleJoinSession}
        />
      )}
      {view.name === 'customer-download' && (
        <CustomerDownload code={view.code} name={view.customerName} onBack={handleBackToLanding} />
      )}
      {view.name === 'session' && (
        <SessionView
          roomCode={view.roomCode}
          displayName={view.displayName}
          sessionTitle={view.sessionTitle}
          sessionId={view.sessionId}
          onExit={handleExitSession}
          onEnded={handleExitSession}
        />
      )}
    </>
  )
}

