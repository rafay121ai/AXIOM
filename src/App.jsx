import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import Onboarding from './pages/Onboarding'
import Chat from './pages/Chat'
import Brain from './pages/Brain'
import AuthCallback from './pages/AuthCallback'
import { getStoredSessionToken, supabase } from './lib/supabase'
import { closeAppSession, pingAppSession, startAppSession } from './lib/appSessionTracker'

function useAuthUser() {
  const [state, setState] = useState({ loading: true, user: null })

  useEffect(() => {
    let mounted = true

    supabase.auth.getUser().then(({ data, error }) => {
      if (!mounted) return
      setState({ loading: false, user: error ? null : data.user })
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return
      setState({ loading: false, user: session?.user || null })
    })

    return () => {
      mounted = false
      listener.subscription.unsubscribe()
    }
  }, [])

  return state
}

function RequireSession({ children }) {
  const { loading, user } = useAuthUser()
  const token = getStoredSessionToken()

  if (loading) return <div className="onboarding"><div className="pulse-dot" /></div>
  if (!user || !token) return <Navigate to="/" replace />
  return children
}

function RequireChatEntry({ children }) {
  const { loading, user } = useAuthUser()
  const token = getStoredSessionToken()
  const location = useLocation()

  if (loading) return <div className="onboarding"><div className="pulse-dot" /></div>
  if (!user || !token) return <Navigate to="/" replace />
  if (!location.state?.fromBrain) return <Navigate to="/brain" replace />
  return children
}

function entryPointForLocation(location) {
  if (location.pathname === '/brain') return 'brain'
  if (location.state?.nodeContext || location.state?.pulseNodeEntry) return 'experiment'
  if (location.state?.fromBrain) return 'resume'
  return 'direct'
}

function AppSessionTracker() {
  const location = useLocation()
  const { loading, user } = useAuthUser()

  useEffect(() => {
    if (loading || !user || !getStoredSessionToken()) return

    let closed = false
    let appSession = null
    let lastActivityAt = Date.now()
    const idleLimitMs = 5 * 60 * 1000

    function markActivity() {
      lastActivityAt = Date.now()
    }

    async function begin() {
      appSession = await startAppSession({
        userId: user.id,
        entryPoint: entryPointForLocation(location),
      })
    }

    function closeCurrent() {
      if (closed || !appSession?.id) return
      closed = true
      closeAppSession(appSession.id, appSession.started_at)
    }

    begin()

    const pingId = window.setInterval(() => {
      if (!appSession?.id || closed) return
      if (Date.now() - lastActivityAt >= idleLimitMs) {
        closeCurrent()
        return
      }
      pingAppSession(appSession.id)
    }, 60 * 1000)

    const activityEvents = ['pointerdown', 'keydown', 'scroll', 'touchstart']
    activityEvents.forEach((eventName) => window.addEventListener(eventName, markActivity, { passive: true }))
    window.addEventListener('pagehide', closeCurrent)

    return () => {
      window.clearInterval(pingId)
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, markActivity))
      window.removeEventListener('pagehide', closeCurrent)
      closeCurrent()
    }
  }, [loading, user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  return null
}

export default function App() {
  return (
    <BrowserRouter>
      <AppSessionTracker />
      <Routes>
        <Route path="/" element={<Onboarding />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route
          path="/brain"
          element={
            <RequireSession>
              <Brain />
            </RequireSession>
          }
        />
        <Route
          path="/chat"
          element={
            <RequireChatEntry>
              <Chat />
            </RequireChatEntry>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
