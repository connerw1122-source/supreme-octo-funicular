'use client'

import { useCallback, useEffect, useState } from 'react'
import { LandingView } from '@/components/landing-view'
import { TechnicianDashboard } from '@/components/technician-dashboard'
import { CustomerJoin } from '@/components/customer-join'
import { SessionView } from '@/components/session-view'
import { Toaster } from 'sonner'

type View =
  | { name: 'landing' }
  | { name: 'technician'; technicianName: string }
  | { name: 'customer-join'; code: string }
  | {
      name: 'session'
      role: 'technician' | 'customer'
      roomCode: string
      displayName: string
      sessionTitle: string
      sessionId: string
      localStream?: MediaStream | null
    }

export default function Home() {
  const [view, setView] = useState<View>({ name: 'landing' })

  // ---------------------------------------------------------------------------
  // Hash-based routing for the customer join link: #join/CODE
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const applyHash = () => {
      const hash = window.location.hash
      const match = hash.match(/^#join\/([A-Za-z0-9]+)/)
      if (match) {
        const code = match[1].toUpperCase()
        setView({ name: 'customer-join', code })
      }
    }
    applyHash()
    window.addEventListener('hashchange', applyHash)
    return () => window.removeEventListener('hashchange', applyHash)
  }, [])

  // Clear hash when we leave the customer-join view
  useEffect(() => {
    if (view.name !== 'customer-join' && window.location.hash) {
      // Use history.replaceState to avoid triggering another hashchange event
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
    setView({ name: 'customer-join', code })
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
        localStream: null,
      })
    },
    [view]
  )

  const handleCustomerConnected = useCallback(
    (sessionId: string, customerName: string, localStream: MediaStream) => {
      if (view.name !== 'customer-join') return
      setView({
        name: 'session',
        role: 'customer',
        roomCode: view.code,
        displayName: customerName,
        sessionTitle: 'Your support session',
        sessionId,
        localStream,
      })
    },
    [view]
  )

  const handleExitSession = useCallback(() => {
    // For technician: go back to dashboard. For customer: go back to landing.
    if (view.name === 'session' && view.role === 'technician') {
      // Recreate the technician dashboard view
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
      {view.name === 'customer-join' && (
        <CustomerJoin
          code={view.code}
          onBack={handleBackToLanding}
          onConnected={handleCustomerConnected}
        />
      )}
      {view.name === 'session' && (
        <SessionView
          role={view.role}
          roomCode={view.roomCode}
          displayName={view.displayName}
          sessionTitle={view.sessionTitle}
          sessionId={view.sessionId}
          localStream={view.localStream}
          onExit={handleExitSession}
          onEnded={handleExitSession}
        />
      )}
    </>
  )
}
