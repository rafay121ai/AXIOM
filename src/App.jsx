import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import Onboarding from './pages/Onboarding'
import Chat from './pages/Chat'
import Brain from './pages/Brain'

function RequireSession({ children }) {
  const token = localStorage.getItem('axiom_session_token')
  if (!token) return <Navigate to="/" replace />
  return children
}

function RedirectIfSession({ children }) {
  const token = localStorage.getItem('axiom_session_token')
  if (token) return <Navigate to="/brain" replace />
  return children
}

function RequireChatEntry({ children }) {
  const token = localStorage.getItem('axiom_session_token')
  const location = useLocation()

  if (!token) return <Navigate to="/" replace />
  if (!location.state?.fromBrain) return <Navigate to="/brain" replace />
  return children
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={
            <RedirectIfSession>
              <Onboarding />
            </RedirectIfSession>
          }
        />
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
        <Route path="*" element={<Navigate to={localStorage.getItem('axiom_session_token') ? '/brain' : '/'} replace />} />
      </Routes>
    </BrowserRouter>
  )
}
