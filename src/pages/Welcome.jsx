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
    .replace(/[\u2014\u2013]/g, ',')
    .replace(/\s+/g, ' ')
    .trim()

  if (!cleaned) {
    return 'You already know the move you are circling.'
  }

  const firstSentence = cleaned.match(/^.*?[.!?](?=\s|$)/)?.[0]?.trim() || cleaned
  return firstSentence.length > 150 ? `${firstSentence.slice(0, 147).trim()}...` : firstSentence
}

function cleanSuggestedQuestion(value) {
  const cleaned = String(value || '')
    .replace(/[\u2014\u2013]/g, ',')
    .replace(/\s+/g, ' ')
    .trim()

  if (
    !cleaned ||
    /^how can i\b/i.test(cleaned) ||
    /\b(feels?|certain|regret|journey|clarity|aligned|authentic|unlock)\b/i.test(cleaned)
  ) {
    return 'What move am I delaying because I want certainty first?'
  }

  return cleaned.endsWith('?') ? cleaned : `${cleaned}?`
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
        setSuggestedQuestion(cleanSuggestedQuestion(generated.suggested_question))
      } catch {
        if (cancelled) return
        setRead('You already know the move you are circling.')
        setSuggestedQuestion('What move am I delaying because I want certainty first?')
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
        autoSend: true,
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
          <p>Bring the question you keep circling: what the market is doing, why the pitch missed, what Bezos saw before everyone else.</p>
          <p>Axiom answers, then remembers the thread.</p>
          <p>Every session ends with one move. You can challenge it. You cannot hand-wave it.</p>
          <p>Every week, Axiom will give you a read on where you are.</p>
        </div>

        <div className="welcome__prompt-wrap">
          <div className="welcome__prompt-label">Start here:</div>
          <button type="button" className="welcome__prompt" onClick={startWithQuestion}>
            <span className="welcome__prompt-text">{suggestedQuestion}</span>
            <span className="welcome__prompt-arrow" aria-hidden="true" />
          </button>
        </div>

        <div className="welcome__actions">
          <button type="button" className="welcome__secondary" onClick={startFresh}>
            Start fresh
          </button>
        </div>
      </section>
    </main>
  )
}
