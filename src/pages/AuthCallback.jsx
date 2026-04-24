import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { clearStoredSessionToken, setStoredSessionToken, supabase } from '../lib/supabase'

export default function AuthCallback() {
  const navigate = useNavigate()
  const [error, setError] = useState('')

  useEffect(() => {
    let mounted = true

    async function finishOAuth() {
      try {
        const params = new URLSearchParams(window.location.search)
        const code = params.get('code')

        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
          if (exchangeError) throw exchangeError
        }

        const { data: userData, error: userError } = await supabase.auth.getUser()
        if (userError) throw userError

        const user = userData.user
        if (!user) {
          clearStoredSessionToken()
          navigate('/', { replace: true })
          return
        }

        const { data: sessionRow, error: sessionError } = await supabase
          .from('sessions')
          .select('session_token')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (sessionError) {
          const message = sessionError.message || ''
          if (!message.toLowerCase().includes('user_id')) throw sessionError
        }

        if (sessionRow?.session_token) {
          setStoredSessionToken(sessionRow.session_token)
          navigate('/brain', { replace: true })
          return
        }

        clearStoredSessionToken()
        navigate('/', { replace: true })
      } catch (err) {
        if (!mounted) return
        console.error('Auth callback failed:', err)
        setError(err?.message || 'Google sign-in failed.')
      }
    }

    finishOAuth()
    return () => {
      mounted = false
    }
  }, [navigate])

  return (
    <div className="onboarding">
      <div className="onboarding__processing">
        <div className="pulse-dot" />
        <span className="onboarding__processing-text">
          {error || 'Finishing sign in'}
        </span>
      </div>
    </div>
  )
}
