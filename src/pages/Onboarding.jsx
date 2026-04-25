import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getStoredSessionToken, setStoredSessionToken, supabase } from '../lib/supabase'
import { generateAxiomProfile } from '../lib/openai'

// ─── Question Pool ───────────────────────────────────────────────────────────
const QUESTION_POOL = {
  human_mind: [
    {
      id: 'HM1',
      pillar: 'human_mind',
      question: "When something doesn't go your way —",
      answers: ['I push through it', 'I step back and think', 'I ask someone'],
    },
    {
      id: 'HM2',
      pillar: 'human_mind',
      question: 'Most of your problems trace back to —',
      answers: ['The same pattern repeating', 'Bad timing or bad luck', 'Other people'],
    },
    {
      id: 'HM3',
      pillar: 'human_mind',
      question: "When you know what you need to do but don't do it, it's usually because —",
      answers: ["You're lazy about it", 'You keep procrastinating', "You don't know where to start"],
    },
  ],
  money_game: [
    {
      id: 'MG1',
      pillar: 'money_game',
      question: 'Money right now feels like —',
      answers: ["A tool I'm figuring out", "Something I'm behind on", 'A conversation I avoid'],
    },
    {
      id: 'MG2',
      pillar: 'money_game',
      question: 'When you see someone your age doing well financially —',
      answers: ['You study what they did', 'You feel behind', 'You think they got lucky'],
    },
    {
      id: 'MG3',
      pillar: 'money_game',
      question: 'Your relationship with spending is —',
      answers: ['I think before I spend', 'I spend then regret', 'I avoid looking at my bank account'],
    },
  ],
  how_companies_win: [
    {
      id: 'CW1',
      pillar: 'how_companies_win',
      question: 'When you see someone who built something —',
      answers: ['You study how they think', 'You wonder what they know', 'You feel like you could do that too'],
    },
    {
      id: 'CW2',
      pillar: 'how_companies_win',
      question: "When something isn't working in what you're building or planning —",
      answers: ['You pivot fast', 'You push harder on the same thing', "You're not sure what to change"],
    },
    {
      id: 'CW3',
      pillar: 'how_companies_win',
      question: 'You back yourself more on —',
      answers: ['Ideas', 'People', 'Timing'],
    },
  ],
  whats_coming: [
    {
      id: 'WC1',
      pillar: 'whats_coming',
      question: 'The future feels like —',
      answers: ['Something to position for', 'Something hard to read', 'Something happening to you'],
    },
    {
      id: 'WC2',
      pillar: 'whats_coming',
      question: 'When you hear about a new technology or trend —',
      answers: ['You think about how to use it', 'You wait to see if it actually matters', 'You usually find out about it late'],
    },
    {
      id: 'WC3',
      pillar: 'whats_coming',
      question: 'In 3 years you see yourself —',
      answers: ['Exactly where you planned to be', 'Somewhere better than now but not sure where', 'Honestly not sure yet'],
    },
  ],
  think_sharper: [
    {
      id: 'TS1',
      pillar: 'think_sharper',
      question: 'Big decisions usually come from —',
      answers: ['My gut', 'Research and thinking', 'What people I trust say'],
    },
    {
      id: 'TS2',
      pillar: 'think_sharper',
      question: "When you're wrong about something —",
      answers: ['You admit it fast and move on', 'You take time to process it', "You double down until you're sure"],
    },
    {
      id: 'TS3',
      pillar: 'think_sharper',
      question: 'The gap between where you are and where you want to be is a —',
      answers: ['Time problem', 'Knowledge problem', 'Action problem'],
    },
  ],
  move_people: [
    {
      id: 'MP1',
      pillar: 'move_people',
      question: 'In a group, you usually —',
      answers: ['Drive the conversation', 'Listen and observe', 'Depends on the room'],
    },
    {
      id: 'MP2',
      pillar: 'move_people',
      question: 'When you need someone to see your point of view —',
      answers: ['You lay out the logic', 'You find the right moment and read the room', "You struggle to get them there"],
    },
    {
      id: 'MP3',
      pillar: 'move_people',
      question: 'People usually come to you for —',
      answers: ['Advice and direction', 'A honest opinion', "They don't really come to you yet"],
    },
  ],
  closers: [
    {
      id: 'CL1',
      pillar: 'closers',
      question: 'The most honest thing about where you are right now —',
      answers: [
        'I know what I want, I just need to move faster',
        "I'm moving but not sure it's the right direction",
        "I haven't started yet but I'm ready",
      ],
    },
    {
      id: 'CL2',
      pillar: 'closers',
      question: 'The thing holding you back most right now is —',
      answers: ['Yourself', 'Your circumstances', "You're not sure yet"],
    },
    {
      id: 'CL3',
      pillar: 'closers',
      question: "You're here because —",
      answers: [
        "You're tired of knowing and not doing",
        'You want to think better and move smarter',
        "You're looking for something but can't name it yet",
      ],
    },
  ],
}

const REGULAR_PILLARS = ['human_mind', 'money_game', 'how_companies_win', 'whats_coming', 'think_sharper', 'move_people']

// ─── Helpers ─────────────────────────────────────────────────────────────────
function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

function weightedRandom(pillars, weights) {
  const total = pillars.reduce((sum, p) => sum + (weights[p] || 1), 0)
  let rand = Math.random() * total
  for (const p of pillars) {
    rand -= weights[p] || 1
    if (rand <= 0) return p
  }
  return pillars[pillars.length - 1]
}

// Detect signal patterns in accumulated answers
function detectSignals(answers, currentWeights) {
  const w = { ...currentWeights }

  const internalStruggleAnswers = new Set([
    'I step back and think',
    'You keep procrastinating',
    "You don't know where to start",
    'The same pattern repeating',
    'Yourself',
  ])
  const financialFocusAnswers = new Set([
    "Something I'm behind on",
    'A conversation I avoid',
    'You feel behind',
    'You think they got lucky',
    'I avoid looking at my bank account',
  ])
  const buildingAnswers = new Set([
    'You study how they think',
    'You wonder what they know',
    'You feel like you could do that too',
    'You pivot fast',
    'You push harder on the same thing',
  ])

  for (const { answer } of answers) {
    if (internalStruggleAnswers.has(answer)) w.human_mind = (w.human_mind || 1) + 0.6
    if (financialFocusAnswers.has(answer))   w.money_game = (w.money_game || 1) + 0.6
    if (buildingAnswers.has(answer))         w.how_companies_win = (w.how_companies_win || 1) + 0.6
  }

  return w
}

// Derive pillar_weights for session from completed answers
function derivePillarWeights(answeredQuestions) {
  const weights = {}
  for (const { pillar } of answeredQuestions) {
    if (pillar && pillar !== 'closers') {
      weights[pillar] = (weights[pillar] || 0) + 1
    }
  }
  return weights
}

// Select the next question given current state
// answeredCount = number already answered (0-indexed next position)
// pillarUsed: { pillar: count }
// signalWeights: { pillar: weight }
// usedIds: Set of question IDs already used
function selectNextQuestion(answeredCount, pillarUsed, signalWeights, usedIds) {
  const TOTAL_REGULAR = 9 // questions 0-8, question 9 is closer

  if (answeredCount >= TOTAL_REGULAR) {
    const availableClosers = QUESTION_POOL.closers.filter((q) => !usedIds.has(q.id))
    return randomFrom(availableClosers)
  }

  const remaining = TOTAL_REGULAR - answeredCount
  const uncoveredPillars = REGULAR_PILLARS.filter((p) => !(pillarUsed[p] > 0))

  // Must cover all remaining uncovered pillars before taking bonus slots
  if (uncoveredPillars.length >= remaining) {
    // No slack — pick from uncovered only
    const targetPillar = weightedRandom(uncoveredPillars, signalWeights)
    const available = QUESTION_POOL[targetPillar].filter((q) => !usedIds.has(q.id))
    if (available.length > 0) return randomFrom(available)
  }

  // Have slack — can take a bonus from a high-signal covered pillar
  const eligible = REGULAR_PILLARS.filter((p) => (pillarUsed[p] || 0) < 2)
  const takeBonusFromCovered =
    uncoveredPillars.length < remaining - 1 &&
    eligible.some((p) => pillarUsed[p] > 0) &&
    Math.random() < 0.45

  let targetPillar
  if (takeBonusFromCovered) {
    const coveredEligible = eligible.filter((p) => pillarUsed[p] > 0)
    targetPillar = coveredEligible.length > 0
      ? weightedRandom(coveredEligible, signalWeights)
      : weightedRandom(uncoveredPillars, signalWeights)
  } else if (uncoveredPillars.length > 0) {
    targetPillar = weightedRandom(uncoveredPillars, signalWeights)
  } else {
    const stillEligible = eligible.length > 0 ? eligible : REGULAR_PILLARS
    targetPillar = weightedRandom(stillEligible, signalWeights)
  }

  const available = QUESTION_POOL[targetPillar].filter((q) => !usedIds.has(q.id))
  if (available.length > 0) return randomFrom(available)

  // Fallback: any unused question
  for (const p of shuffle(REGULAR_PILLARS)) {
    const fallback = QUESTION_POOL[p].filter((q) => !usedIds.has(q.id))
    if (fallback.length > 0) return randomFrom(fallback)
  }

  return null
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function Onboarding() {
  const navigate = useNavigate()

  const [authLoading, setAuthLoading] = useState(true)
  const [user, setUser] = useState(null)
  const [signingIn, setSigningIn] = useState(false)
  const [questions, setQuestions] = useState([])          // built incrementally
  const [currentIndex, setCurrentIndex] = useState(0)
  const [answered, setAnswered] = useState([])            // { question, answer, pillar }
  const [pillarUsed, setPillarUsed] = useState({})
  const [signalWeights, setSignalWeights] = useState(
    Object.fromEntries(REGULAR_PILLARS.map((p) => [p, 1]))
  )
  const [usedIds, setUsedIds] = useState(new Set())
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState(null)

  // Track animation key so re-mounting triggers fade
  const [slideKey, setSlideKey] = useState(0)

  // Init first question
  useEffect(() => {
    const first = selectNextQuestion(0, {}, signalWeights, new Set())
    setQuestions([first])
    setUsedIds(new Set([first.id]))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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

      if (error) {
        const message = error.message || ''
        if (!message.toLowerCase().includes('user_id')) {
          console.error('Session restore failed:', error)
        }
        return
      }

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
    const newAnswered = [
      ...answered,
      { question: currentQ.question, answer: answerText, pillar: currentQ.pillar, id: currentQ.id },
    ]
    const newPillarUsed = {
      ...pillarUsed,
      [currentQ.pillar]: (pillarUsed[currentQ.pillar] || 0) + 1,
    }
    const newWeights = detectSignals(newAnswered, signalWeights)
    const newUsedIds = new Set([...usedIds])

    setAnswered(newAnswered)
    setPillarUsed(newPillarUsed)
    setSignalWeights(newWeights)

    const nextIndex = currentIndex + 1

    if (nextIndex < 10) {
      const nextQ = selectNextQuestion(nextIndex, newPillarUsed, newWeights, newUsedIds)
      if (nextQ) {
        newUsedIds.add(nextQ.id)
        setUsedIds(newUsedIds)
        setQuestions((prev) => [...prev, nextQ])
      }
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
      if (userError || !activeUser) throw new Error('Sign in with Google before starting onboarding.')

      // Upsert user record so sessions can be queried by email
      const firstName =
        activeUser.user_metadata?.given_name ||
        activeUser.user_metadata?.name?.split(' ')[0] ||
        null

      await supabase.from('users').upsert(
        { id: activeUser.id, email: activeUser.email, first_name: firstName },
        { onConflict: 'id' }
      )

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
        warning_level: 0,
      }

      let insertError = null
      let insertResult = await supabase.from('sessions').insert(sessionPayload)
      insertError = insertResult.error

      if (insertError?.message?.toLowerCase().includes('user_id')) {
        const fallbackResult = await supabase.from('sessions').insert({
          ...sessionPayload,
          user_id: undefined,
        })
        insertError = fallbackResult.error
      }

      if (insertError) throw insertError

      setStoredSessionToken(sessionToken)
      navigate('/brain')
    } catch (err) {
      console.error('Onboarding error:', err)
      setError(err?.message || 'Something went wrong. Check your API keys and Supabase connection.')
      setIsProcessing(false)
    }
  }

  if (!questions.length || authLoading) {
    return (
      <div className="onboarding">
        <div className="onboarding__processing">
          <div className="pulse-dot" />
          <span className="onboarding__processing-text">Checking account</span>
        </div>
      </div>
    )
  }

  const currentQ = questions[currentIndex]
  const progress = Array.from({ length: 10 }, (_, i) => i < currentIndex)

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
