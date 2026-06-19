'use client'

import { useCallback, useEffect, useState } from 'react'
import { LandingView } from '@/components/landing-view'
import { TechnicianDashboard } from '@/components/technician-dashboard'
import { CustomerDownload } from '@/components/customer-download'
import { SessionView } from '@/components/session-view'
import { Toaster } from 'sonner'

type View =
  | { name: 'landing' }
  | { name: 'technician'; technicianName: string }
  | { name: 'customer-download'; code: string }
  | {
      name: 'session'
      role: 'technician'
      roomCode: string
      displayName: string
      sessionTitle: string
      sessionId: string
    }

export default function Home() {
  const [view, setView] = useState<View>({ name: 'landing' })

  // ---------------------------------------------------------------------------
  // Hash-based routing for the customer download link: #join/CODE
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const applyHash = () => {
      const hash = window.location.hash
      const match = hash.match(/^#join\/([A-Za-z0-9]+)/)
      if (match) {
        const code = match[1].toUpperCase()
        setView({ name: 'customer-download', code })
      }
    }
    applyHash()
    window.addEventListener('hashchange', applyHash)
    return () => window.removeEventListener('hashchange', applyHash)
  }, [])

  // Clear hash when we leave the customer-download view
  useEffect(() => {
    if (view.name !== 'customer-download' && window.location.hash) {
      history.replaceState(null, '', window.location.pathname + window.location.search)
    }
  }, [view.name])

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------
  const handleTechnician = useCallback((technicianName: string) => {
    setView({ name: 'technician', technicianName })
  }, [])

  const handleCustomer = useCallback((code: string) => {
    setView({ name: 'customer-download', code })
  }, [])

  const handleBackToLanding = useCallback(() => {
    setView({ name: 'landing' })
  }, [])

  const handleJoinSession = useCallback(
    (sessionId: string, code: string, title: string) => {
      if (view.name !== 'technician') return
      setView({
        name: 'session',
        role: 'technician',
        roomCode: code,
        displayName: view.technicianName,
        sessionTitle: title,
        sessionId,
      })
    },
    [view]
  )

  const handleExitSession = useCallback(() => {
    // For technician: go back to dashboard
    if (view.name === 'session' && view.role === 'technician') {
      setView({ name: 'technician', technicianName: view.displayName })
    } else {
      setView({ name: 'landing' })
    }
  }, [view])

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <>
      <Toaster position="top-right" richColors closeButton />
      {view.name === 'landing' && (
        <LandingView onTechnician={handleTechnician} onCustomer={handleCustomer} />
      )}
      {view.name === 'technician' && (
        <TechnicianDashboard
          technicianName={view.technicianName}
          onBack={handleBackToLanding}
          onJoinSession={handleJoinSession}
        />
      )}
      {view.name === 'customer-download' && (
        <CustomerDownload code={view.code} onBack={handleBackToLanding} />
      )}
      {view.name === 'session' && (
        <SessionView
          role="technician"
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
