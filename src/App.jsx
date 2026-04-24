import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import Onboarding from './pages/Onboarding'
import Chat from './pages/Chat'
import Brain from './pages/Brain'
import AuthCallback from './pages/AuthCallback'
import { getStoredSessionToken, supabase } from './lib/supabase'

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

  if (loading) return null
  if (!user || !token) return <Navigate to="/" replace />
  return children
}

function RequireChatEntry({ children }) {
  const { loading, user } = useAuthUser()
  const token = getStoredSessionToken()
  const location = useLocation()

  if (loading) return null
  if (!user || !token) return <Navigate to="/" replace />
  if (!location.state?.fromBrain) return <Navigate to="/brain" replace />
  return children
}

export default function App() {
  return (
    <BrowserRouter>
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
