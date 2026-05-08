import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { clearStoredSessionToken, getStoredSessionToken, supabase } from '../lib/supabase'
import { generateWelcomeRead } from '../lib/openai'

export const AXIOM_WELCOME_SEEN_KEY = 'axiom_welcome_seen'
const welcomeGenerationCache = new Map()

function markWelcomeSeen() {
  try { localStorage.setItem(AXIOM_WELCOME_SEEN_KEY, '1') }
  catch { /* ignore storage failures */ }
}

export function hasSeenAxiomWelcome() {
  try { return localStorage.getItem(AXIOM_WELCOME_SEEN_KEY) === '1' }
  catch { return false }
}

function firstNameForUser(user, row) {
  return (
    row?.first_name ||
    user?.user_metadata?.given_name ||
    user?.user_metadata?.name?.split(' ')?.[0] ||
    user?.email?.split('@')?.[0] ||
    'You'
  )
}

export default function Welcome() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [firstName, setFirstName] = useState('You')
  const [read, setRead] = useState('')
  const [suggestedQuestion, setSuggestedQuestion] = useState('')

  useEffect(() => {
    let cancelled = false

    async function loadWelcome() {
      if (hasSeenAxiomWelcome()) {
        navigate('/brain', { replace: true })
        return
      }

      const sessionToken = getStoredSessionToken()
      if (!sessionToken) { navigate('/', { replace: true }); return }

      const { data: userData, error: userError } = await supabase.auth.getUser()
      const user = userData.user
      if (userError || !user) {
        clearStoredSessionToken()
        navigate('/', { replace: true })
        return
      }

      const { data: session, error: sessionError } = await supabase
        .from('sessions')
        .select('*')
        .eq('session_token', sessionToken)
        .single()

      if (sessionError || !session) { navigate('/', { replace: true }); return }
      if (session.user_id && session.user_id !== user.id) {
        clearStoredSessionToken()
        navigate('/', { replace: true })
        return
      }

      const { data: userRow } = await supabase
        .from('users')
        .select('first_name')
        .eq('id', user.id)
        .maybeSingle()

      if (cancelled) return
      setFirstName(firstNameForUser(user, userRow))

      try {
        const cacheKey = session.session_token || session.id
        const generation = welcomeGenerationCache.get(cacheKey) || generateWelcomeRead(session)
        welcomeGenerationCache.set(cacheKey, generation)
        const generated = await generation
        if (cancelled) return
        setRead(generated.read || 'You are not here because you need more information. You are here because the next move has been waiting for you to stop negotiating with it.')
        setSuggestedQuestion(generated.suggested_question || 'What is the first move I am avoiding right now?')
      } catch {
        if (cancelled) return
        setRead('You are not here because you need more information. You are here because the next move has been waiting for you to stop negotiating with it.')
        setSuggestedQuestion('What is the first move I am avoiding right now?')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadWelcome()

    return () => {
      cancelled = true
    }
  }, [navigate])

  function startWithQuestion() {
    markWelcomeSeen()
    navigate('/chat', {
      replace: true,
      state: {
        fromBrain: true,
        freshThread: true,
        threadId: crypto.randomUUID(),
        initialInput: suggestedQuestion,
        skipOpening: true,
      },
    })
  }

  function startFresh() {
    markWelcomeSeen()
    navigate('/brain', { replace: true })
  }

  if (loading) {
    return (
      <main className="welcome">
        <div className="welcome__grain" />
        <div className="welcome__loading">
          <div className="pulse-dot" />
        </div>
      </main>
    )
  }

  return (
    <main className="welcome">
      <div className="welcome__grain" />
      <section className="welcome__shell" aria-label="Welcome to Axiom">
        <header className="welcome__header">
          <h1 className="welcome__name">{firstName}</h1>
          <div className="welcome__read">
            {read.split('\n').filter(Boolean).map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        </header>

        <div className="welcome__copy">
          <p>Ask what Bezos got right that everyone else missed. Ask what's actually happening in the market right now. Ask why your last pitch didn't land.</p>
          <p>Axiom will have an answer. And it'll remember you asked.</p>
          <p>Every session ends with one move. Small, real, time-bound. You don't get to skip it — but if it doesn't fit, make your case. Axiom listens. Just don't come with a weak excuse.</p>
          <p>Every week Axiom gives you a read on where you are.</p>
        </div>

        <div className="welcome__prompt-wrap">
          <div className="welcome__prompt-label">Start here:</div>
          <button type="button" className="welcome__prompt" onClick={startWithQuestion}>
            {suggestedQuestion}
          </button>
        </div>

        <div className="welcome__actions">
          <button type="button" className="welcome__primary" onClick={startWithQuestion}>
            Ask this first
          </button>
          <button type="button" className="welcome__secondary" onClick={startFresh}>
            Start fresh
          </button>
        </div>
      </section>
    </main>
  )
}
