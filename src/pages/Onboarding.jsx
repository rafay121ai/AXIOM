import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getStoredSessionToken, setStoredSessionToken, supabase } from '../lib/supabase'
import { generateAxiomProfile } from '../lib/openai'
import { AXIOM_WELCOME_SEEN_KEY, markAxiomWelcomePending } from './Welcome'

// ─── Question Pool ───────────────────────────────────────────────────────────
const QUESTIONS = [
  {
    id: 'T1',
    pillar: 'how_companies_win',
    type: 'tap',
    question: "Right now I'm mainly focused on —",
    answers: ['Building something', 'Figuring out my next move', 'Growing what already exists'],
  },
  {
    id: 'T2',
    pillar: 'how_companies_win',
    type: 'tap',
    question: "The stage I'm at is —",
    answers: ['Just starting', 'Have something early', 'Already have traction'],
  },
  {
    id: 'T3',
    pillar: 'think_sharper',
    type: 'tap',
    question: 'The resource I feel most short on —',
    answers: ['Time', 'Money', 'Knowledge', 'The right people'],
  },
  {
    id: 'TB1',
    pillar: 'how_companies_win',
    type: 'text',
    question: 'What are you working on right now?',
    placeholder: 'building a startup, figuring out a career move, learning to invest...',
    hint: 'Take your time with this one. The more specific you are, the better Axiom knows you.',
  },
  {
    id: 'T4',
    pillar: 'think_sharper',
    type: 'tap',
    question: "When I get advice I don't want —",
    answers: ['Generic frameworks', 'Motivational talk', 'Someone to just agree with me'],
  },
  {
    id: 'T5',
    pillar: 'whats_coming',
    type: 'tap',
    question: 'When I hear about a new technology or trend —',
    answers: ['I think about how to use it', 'I wait to see if it actually matters', 'I usually find out about it late'],
  },
  {
    id: 'TB2',
    pillar: 'think_sharper',
    type: 'text',
    question: "What's the decision or problem you're most stuck on right now?",
    placeholder: 'could be about your product, your direction, your team, your money...',
    hint: 'Take your time. This is the most important question in this onboarding.',
  },
  {
    id: 'T6',
    pillar: 'think_sharper',
    type: 'tap',
    question: 'The gap between where I am and where I want to be is a —',
    answers: ['Time problem', 'Knowledge problem', 'Action problem'],
  },
  {
    id: 'T7',
    pillar: 'move_people',
    type: 'tap',
    question: 'I want Axiom to be —',
    answers: ['Someone who challenges me', 'Someone who guides me', 'Someone who thinks with me'],
  },
  {
    id: 'TB3',
    pillar: 'how_companies_win',
    type: 'text',
    question: 'What have you already tried?',
    placeholder: "what you've done, what worked, what didn't...",
    hint: 'This helps Axiom skip what you already know and go straight to what actually helps.',
  },
]

// ─── Helpers ─────────────────────────────────────────────────────────────────
// Derive pillar_weights for session from completed answers
function derivePillarWeights(answeredQuestions) {
  const weights = {}
  for (const { pillar } of answeredQuestions) {
    if (pillar) {
      weights[pillar] = (weights[pillar] || 0) + 1
    }
  }
  return weights
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function Onboarding() {
  const navigate = useNavigate()

  const [authLoading, setAuthLoading] = useState(true)
  const [user, setUser] = useState(null)
  const [signingIn, setSigningIn] = useState(false)
  const [questions] = useState(QUESTIONS)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [answered, setAnswered] = useState([])            // { question, answer, pillar }
  const [textAnswer, setTextAnswer] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState(null)

  // Track animation key so re-mounting triggers fade
  const [slideKey, setSlideKey] = useState(0)

  useEffect(() => {
    let mounted = true

    async function loadUser() {
      const { data, error } = await supabase.auth.getUser()
      if (!mounted) return
      setUser(error ? null : data.user)
      setAuthLoading(false)
    }

    loadUser()

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return
      // INITIAL_SESSION fires from the cached JWT before server validation completes.
      // Letting it set user here causes a race where a deleted account's stale token
      // skips the sign-in modal. Let getUser() above handle the initial state instead.
      if (event === 'INITIAL_SESSION') return
      setUser(session?.user || null)
      setAuthLoading(false)
    })

    return () => {
      mounted = false
      listener.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (authLoading || !user) return

    const currentToken = getStoredSessionToken()
    if (currentToken) {
      navigate('/brain', { replace: true })
      return
    }

    let cancelled = false

    async function restoreLatestSession() {
      const { data, error } = await supabase
        .from('sessions')
        .select('session_token')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (cancelled) return

      if (error) return

      if (data?.session_token) {
        setStoredSessionToken(data.session_token)
        navigate('/brain', { replace: true })
      }
    }

    restoreLatestSession()
    return () => {
      cancelled = true
    }
  }, [authLoading, navigate, user])

  async function handleGoogleSignIn() {
    setError(null)
    setSigningIn(true)

    const { error: signInError } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    if (signInError) {
      setSigningIn(false)
      setError(signInError.message || 'Google sign-in failed.')
    }
  }

  async function handleAnswer(answerText) {
    const currentQ = questions[currentIndex]
    const normalizedAnswer = typeof answerText === 'string' ? answerText.trim() : answerText
    const newAnswered = [
      ...answered,
      { question: currentQ.question, answer: normalizedAnswer, pillar: currentQ.pillar, id: currentQ.id },
    ]
    setAnswered(newAnswered)
    setTextAnswer('')

    const nextIndex = currentIndex + 1

    if (nextIndex < questions.length) {
      setCurrentIndex(nextIndex)
      setSlideKey((k) => k + 1)
    } else {
      // All 10 answered
      await processOnboardingComplete(newAnswered)
    }
  }

  async function processOnboardingComplete(finalAnswered) {
    setIsProcessing(true)
    setError(null)
    try {
      const { data: userData, error: userError } = await supabase.auth.getUser()
      const activeUser = userData.user
      if (userError || !activeUser) {
        // Auth expired mid-onboarding — show sign-in with answers preserved in state
        setIsProcessing(false)
        return
      }

      // Upsert user record so sessions can be queried by email
      const firstName =
        activeUser.user_metadata?.given_name ||
        activeUser.user_metadata?.name?.split(' ')[0] ||
        null

      await supabase.from('users').upsert(
        { id: activeUser.id, email: activeUser.email, first_name: firstName },
        { onConflict: 'id' }
      )

      const { data: existingSession, error: existingError } = await supabase
        .from('sessions')
        .select('id, session_token')
        .eq('user_id', activeUser.id)
        .maybeSingle()
      if (existingError) throw existingError
      if (existingSession?.session_token) {
        setStoredSessionToken(existingSession.session_token)
        navigate('/brain')
        return
      }

      const pillarWeights = derivePillarWeights(finalAnswered)
      const qaPairs = finalAnswered.map(({ question, answer }) => ({ question, answer }))
      const axiomProfile = await generateAxiomProfile(qaPairs)

      const sessionToken = crypto.randomUUID()
      const sessionPayload = {
        session_token: sessionToken,
        user_id: activeUser.id,
        onboarding_answers: qaPairs,
        pillar_weights: pillarWeights,
        axiom_profile: axiomProfile,
        active_experiments: [],
        ghost_count: 0,
        consecutive_miss_count: 0,
        warning_level: 0,
      }

      const { error: insertError } = await supabase
        .from('sessions')
        .insert(sessionPayload)
      if (insertError) throw insertError

      setStoredSessionToken(sessionToken)
      const welcomeSeen = (() => {
        try { return localStorage.getItem(AXIOM_WELCOME_SEEN_KEY) === '1' }
        catch { return false }
      })()
      if (!welcomeSeen) markAxiomWelcomePending()
      navigate(welcomeSeen ? '/brain' : '/welcome')
    } catch {
      setError('Something went wrong. Try again.')
      setIsProcessing(false)
    }
  }

  // Questions only render after auth is confirmed.
  // During loading or when unauthenticated, show sign-in (or spinner while determining).
  if (!questions.length || authLoading || !user) {
    if (authLoading || !questions.length) {
      return (
        <div className="onboarding">
          <div className="onboarding__processing">
            <div className="pulse-dot" />
            <span className="onboarding__processing-text">Checking account</span>
          </div>
        </div>
      )
    }

    // !user — fall through to sign-in UI below
  }

  if (!user) {
    return (
      <div className="onboarding">
        <span className="onboarding__wordmark">Axiom</span>
        <div className="onboarding__auth">
          <h1 className="onboarding__auth-title">Sign in to start your private founder session.</h1>
          <p className="onboarding__auth-copy">
            Google sign-in is now required so every account owns its own sessions, memory, and brain graph.
          </p>
          <button
            className="onboarding__google"
            onClick={handleGoogleSignIn}
            disabled={signingIn}
          >
            {signingIn ? 'Redirecting…' : 'Continue with Google'}
          </button>
          {error && (
            <p className="onboarding__auth-error">{error}</p>
          )}
        </div>
      </div>
    )
  }

  const currentQ = questions[currentIndex]
  const progress = Array.from({ length: 10 }, (_, i) => i < currentIndex)

  if (isProcessing) {
    return (
      <div className="onboarding">
        <div className="onboarding__processing">
          <div className="pulse-dot" />
          <span className="onboarding__processing-text">Building your profile</span>
        </div>
      </div>
    )
  }

  return (
    <div className="onboarding">
      {/* Progress dots */}
      <div className="onboarding__progress">
        {progress.map((filled, i) => (
          <div
            key={i}
            className={`onboarding__dot${filled ? ' onboarding__dot--filled' : ''}`}
          />
        ))}
      </div>

      {/* Question — re-keyed on each advance to trigger fade animation */}
      {currentQ && (
        <div key={slideKey} className="onboarding__slide">
          <p className="onboarding__question">{currentQ.question}</p>
          {currentQ.type === 'text' ? (
            <>
              <p className="onboarding__hint">{currentQ.hint}</p>
              <textarea
                className="onboarding__textarea"
                placeholder={currentQ.placeholder}
                value={textAnswer}
                onChange={(event) => setTextAnswer(event.target.value)}
              />
              <button
                className="onboarding__continue"
                disabled={textAnswer.trim().length < 10}
                onClick={() => handleAnswer(textAnswer)}
              >
                Continue
              </button>
            </>
          ) : (
            <div className="onboarding__answers">
              {currentQ.answers.map((answer) => (
                <button
                  key={answer}
                  className="onboarding__answer"
                  onClick={() => handleAnswer(answer)}
                >
                  {answer}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {error && (
        <p style={{ color: 'var(--red)', marginTop: 32, fontSize: 13, textAlign: 'center' }}>
          {error}
        </p>
      )}
    </div>
  )
}
