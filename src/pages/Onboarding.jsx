import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import OnboardingQuestion from '../components/OnboardingQuestion'
import { supabase } from '../lib/supabase'
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
      const pillarWeights = derivePillarWeights(finalAnswered)
      const qaPairs = finalAnswered.map(({ question, answer }) => ({ question, answer }))
      const axiomProfile = await generateAxiomProfile(qaPairs)

      const sessionToken = crypto.randomUUID()
      const { error: insertError } = await supabase.from('sessions').insert({
        session_token: sessionToken,
        onboarding_answers: qaPairs,
        pillar_weights: pillarWeights,
        axiom_profile: axiomProfile,
        active_experiments: [],
        ghost_count: 0,
        warning_level: 0,
      })

      if (insertError) throw insertError

      localStorage.setItem('axiom_session_token', sessionToken)
      navigate('/brain')
    } catch (err) {
      console.error('Onboarding error:', err)
      setError(err?.message || 'Something went wrong. Check your API keys and Supabase connection.')
      setIsProcessing(false)
    }
  }

  if (!questions.length) return null

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
