// Sign-up answers: saved one at a time into founder_profiles.signup_answers
// (a jsonb object keyed by question key), and mirrored into the structured
// columns that already exist. See schema_needs.md for the missing column.
import { QUESTIONS, QUESTION_KEYS, questionByKey, validateAnswer, typedStrings } from './questions.js'

const STAGE = {
  'Just an idea': 'idea',
  "I'm talking to people about it": 'validating',
  "I'm building it and nobody pays yet": 'validating',
  'Someone is paying me': 'first_paying_customer',
  "It's growing": 'scaling',
}
const BUSINESS_MODEL = {
  Businesses: 'b2b',
  Consumers: 'b2c',
  'Both sides of a marketplace': 'marketplace',
  'Clients, for services': 'services',
  'No one yet': null,
}

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10)

// The date a goal answer points at, or null when it names none.
export function deadlineFor(goalAnswer, now) {
  if (goalAnswer.date) return goalAnswer.date
  const d = new Date(now)
  if (goalAnswer.when === 'This month') return isoDay(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))
  const months = { 'In 3 months': 3, 'In 6 months': 6 }[goalAnswer.when]
  return months ? isoDay(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate())) : null
}

// Existing structured columns that a single answer also fills.
function mirrorColumns(key, answer, now) {
  switch (key) {
    case 'stage': return { stage: STAGE[answer.value] ?? null }
    case 'business_model': return { business_model: BUSINESS_MODEL[answer.value] ?? null }
    case 'where': return { country: answer.country }
    case 'goal': return { goal: `${answer.goal}, ${answer.when.toLowerCase()}`, deadline: deadlineFor(answer, now) }
    default: return {}
  }
}

export function nextQuestionKey(answers) {
  return QUESTION_KEYS.find((k) => !Object.hasOwn(answers, k)) ?? null
}

export function createSignupStore({ supabase, clock }) {
  async function load(userId) {
    const { data, error } = await supabase
      .from('founder_profiles').select('user_id, signup_answers').eq('user_id', userId).maybeSingle()
    if (error) throw error
    return { exists: Boolean(data), answers: data?.signup_answers && typeof data.signup_answers === 'object' ? data.signup_answers : {} }
  }

  // Replaces the answer for this key. Same answer twice leaves the same row.
  async function save(userId, key, answer) {
    const now = clock.now()
    const { exists, answers } = await load(userId)
    const next = { ...answers, [key]: answer }
    const columns = { signup_answers: next, ...mirrorColumns(key, answer, now), updated_at: new Date(now).toISOString() }
    if (exists) {
      const { error } = await supabase.from('founder_profiles').update(columns).eq('user_id', userId)
      if (error) throw error
    } else {
      const { error } = await supabase.from('founder_profiles').insert({ user_id: userId, ...columns })
      if (error?.code === '23505') {
        // Two first saves raced: the row exists now, so update it.
        const { error: retryError } = await supabase.from('founder_profiles').update(columns).eq('user_id', userId)
        if (retryError) throw retryError
      } else if (error) throw error
    }
    return next
  }

  return { load, save }
}

const view = (answers) => {
  const next = nextQuestionKey(answers)
  return { answers, next, complete: next === null, total: QUESTIONS.length }
}

// What the care gate reads from a save request: only typed free text.
export const signupFreeText = (req) => {
  const question = questionByKey(req.params?.key)
  return question ? typedStrings(question, req.body?.answer) : null
}

export function createSignupHandlers({ supabase, clock }) {
  const store = createSignupStore({ supabase, clock })

  async function get(req, res) {
    if (!supabase) return res.status(503).json({ error: 'Service not configured' })
    try {
      return res.json({ questions: QUESTIONS, ...(await viewFor(req.user.id)) })
    } catch (error) {
      console.error('[Signup] read failed', error?.message || error)
      return res.status(500).json({ error: 'Failed to load sign-up' })
    }
  }

  async function put(req, res) {
    if (!supabase) return res.status(503).json({ error: 'Service not configured' })
    const question = questionByKey(req.params.key)
    if (!question) return res.status(404).json({ error: 'Unknown question' })
    const checked = validateAnswer(question, req.body?.answer, { now: clock.now() })
    if (!checked.ok) return res.status(400).json({ error: checked.error })
    try {
      return res.json(view(await store.save(req.user.id, question.key, checked.value)))
    } catch (error) {
      console.error('[Signup] save failed', error?.message || error)
      return res.status(500).json({ error: 'Failed to save answer' })
    }
  }

  // Stored answers plus where the founder is up to.
  async function viewFor(userId) {
    const { answers } = await store.load(userId)
    return view(answers)
  }

  return { get, put, view: viewFor }
}
