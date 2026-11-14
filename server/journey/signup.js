// Sign-up answers: saved one at a time into founder_profiles.signup_answers
// (a jsonb object keyed by question key), and mirrored into the structured
// columns that already exist. See schema_needs.md for the missing column.
import { QUESTIONS, QUESTION_KEYS, questionByKey, validateAnswer, typedStrings } from './questions.js'
import { writeSettingsPlan } from '../push/settings.js'
import { firstNameOf } from './learn/learnRoutes.js'

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

// What "Straight" etc. set as the founder's Settings style, once, when hard_truth is saved.
const HARD_TRUTH_STYLE = { Gently: 'calm', Straight: 'direct', 'Blunt, no padding': 'hard' }

// The 13 questions asked before Nov 9 2026. A founder who answered all of them
// was finished then and must not be sent back into sign-up now.
const LEGACY_KEYS = ['stage', 'months_in', 'commitment', 'business_model', 'where', 'team', 'goal', 'background', 'why', 'strengths', 'tried', 'building', 'stuck']

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

function nextQuestionKey(answers) {
  return QUESTION_KEYS.find((k) => !Object.hasOwn(answers, k)) ?? null
}

// Complete: every current question answered (an optional one counts when skipped), or the
// founder finished the old 13 (all old keys stored, or a first_reading exists, which is
// only built after sign-up ends). Without this, every existing founder would be asked the new questions.
const isComplete = (answers, firstReading = null) =>
  Boolean(firstReading) || nextQuestionKey(answers) === null || LEGACY_KEYS.every((k) => Object.hasOwn(answers, k))

export function createSignupStore({ supabase, clock }) {
  async function load(userId) {
    const { data, error } = await supabase
      .from('founder_profiles').select('user_id, signup_answers, first_reading').eq('user_id', userId).maybeSingle()
    if (error) throw error
    return {
      exists: Boolean(data),
      answers: data?.signup_answers && typeof data.signup_answers === 'object' ? data.signup_answers : {},
      firstReading: data?.first_reading ?? null,
    }
  }

  // Writes columns to the founder's profile row, creating it on the first save.
  async function write(userId, exists, columns) {
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
  }

  // Replaces the answer for this key. Same answer twice leaves the same row.
  async function save(userId, key, answer) {
    const now = clock.now()
    const { exists, answers } = await load(userId)
    const next = { ...answers, [key]: answer }
    await write(userId, exists, { signup_answers: next, ...mirrorColumns(key, answer, now), updated_at: new Date(now).toISOString() })
    return next
  }

  // Month and day only, never a year.
  async function saveBirthday(userId, month, day) {
    const { exists } = await load(userId)
    await write(userId, exists, { birth_month: month, birth_day: day, updated_at: new Date(clock.now()).toISOString() })
  }

  // Sets the Settings style through the existing settings write path.
  const saveMentorStyle = (userId, style) =>
    writeSettingsPlan(supabase, userId, { profile: {}, settings: { mentor_style: style } }, new Date(clock.now()).toISOString())

  // users.first_name, which the greeting and pushes already read.
  async function saveName(user, name) {
    const { data, error } = await supabase.from('users').select('id').eq('id', user.id).maybeSingle()
    if (error) throw error
    const { error: writeError } = data
      ? await supabase.from('users').update({ first_name: name }).eq('id', user.id)
      : await supabase.from('users').insert({ id: user.id, email: user.email ?? null, first_name: name })
    if (writeError) throw writeError
  }

  return { load, save, saveBirthday, saveMentorStyle, saveName }
}

const view = (answers, firstReading = null) => {
  const complete = isComplete(answers, firstReading)
  return { answers, next: complete ? null : nextQuestionKey(answers), complete, total: QUESTIONS.length }
}

const daysIn = (month) => [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
const cleanBirthday = (body) => {
  const ok = body && typeof body === 'object' && Object.keys(body).every((k) => ['month', 'day'].includes(k))
    && Number.isInteger(body.month) && body.month >= 1 && body.month <= 12
    && Number.isInteger(body.day) && body.day >= 1 && body.day <= daysIn(body.month)
  return ok ? { month: body.month, day: body.day } : null
}

// What the care gate reads from a save request: only typed free text.
export const signupFreeText = (req) => {
  const question = questionByKey(req.params?.key)
  return question ? typedStrings(question, req.body?.answer) : null
}

export const nameFreeText = (req) => (typeof req.body?.name === 'string' ? [req.body.name] : [])

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
      const before = await store.load(req.user.id)
      const answers = await store.save(req.user.id, question.key, checked.value)
      // Set once, while sign-up is open: a later edit in Settings must not be overwritten by a re-save.
      if (question.key === 'hard_truth' && !isComplete(before.answers, before.firstReading)) await store.saveMentorStyle(req.user.id, HARD_TRUTH_STYLE[checked.value.value])
      return res.json(view(answers, (await store.load(req.user.id)).firstReading))
    } catch (error) {
      console.error('[Signup] save failed', error?.message || error)
      return res.status(500).json({ error: 'Failed to save answer' })
    }
  }

  // Stored answers plus where the founder is up to.
  async function viewFor(userId) {
    const { answers, firstReading } = await store.load(userId)
    return view(answers, firstReading)
  }

  async function putBirthday(req, res) {
    if (!supabase) return res.status(503).json({ error: 'Service not configured' })
    const birthday = cleanBirthday(req.body)
    if (!birthday) return res.status(400).json({ error: 'Send a month (1 to 12) and a day that exists in it' })
    try {
      await store.saveBirthday(req.user.id, birthday.month, birthday.day)
      return res.json(birthday)
    } catch (error) {
      console.error('[Signup] birthday failed', error?.message || error)
      return res.status(500).json({ error: 'Failed to save birthday' })
    }
  }

  // One word, the first name, the same rule the greeting uses.
  async function putName(req, res) {
    if (!supabase) return res.status(503).json({ error: 'Service not configured' })
    const name = typeof req.body?.name === 'string' ? firstNameOf({ user_metadata: { given_name: req.body.name } }) : null
    if (!name) return res.status(400).json({ error: 'Send a first name' })
    try {
      await store.saveName(req.user, name)
      return res.json({ name })
    } catch (error) {
      console.error('[Signup] name failed', error?.message || error)
      return res.status(500).json({ error: 'Failed to save name' })
    }
  }

  return { get, put, putBirthday, putName, view: viewFor }
}
