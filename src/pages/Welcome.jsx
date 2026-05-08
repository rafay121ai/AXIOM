import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { clearStoredSessionToken, getStoredSessionToken, supabase } from '../lib/supabase'
import { generateWelcomeRead } from '../lib/openai'

export const AXIOM_WELCOME_SEEN_KEY = 'axiom_welcome_seen'
export const AXIOM_WELCOME_PENDING_KEY = 'axiom_welcome_pending'
const welcomeGenerationCache = new Map()

function markWelcomeSeen() {
  try {
    localStorage.setItem(AXIOM_WELCOME_SEEN_KEY, '1')
    localStorage.removeItem(AXIOM_WELCOME_PENDING_KEY)
  }
  catch { /* ignore storage failures */ }
}

export function markAxiomWelcomePending() {
  try { localStorage.setItem(AXIOM_WELCOME_PENDING_KEY, '1') }
  catch { /* ignore storage failures */ }
}

function hasPendingAxiomWelcome() {
  try { return localStorage.getItem(AXIOM_WELCOME_PENDING_KEY) === '1' }
  catch { return false }
}

export function hasSeenAxiomWelcome() {
  try { return localStorage.getItem(AXIOM_WELCOME_SEEN_KEY) === '1' }
  catch { return false }
}

function compactWelcomeRead(value) {
  const cleaned = String(value || '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!cleaned) {
    return 'You already know the move you are circling.'
  }

  const firstSentence = cleaned.match(/^.*?[.!?](?=\s|$)/)?.[0]?.trim() || cleaned
  return firstSentence.length > 150 ? `${firstSentence.slice(0, 147).trim()}...` : firstSentence
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
      if (hasSeenAxiomWelcome() || !hasPendingAxiomWelcome()) {
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
        setRead(compactWelcomeRead(generated.read))
        setSuggestedQuestion(generated.suggested_question || 'What is the first move I am avoiding right now?')
      } catch {
        if (cancelled) return
        setRead('You already know the move you are circling.')
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
            <div className="welcome__read-label">Axiom read</div>
            <p>{read}</p>
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
