// Care gate: runs after auth on every route that takes founder text. A clear
// signal ends the step with the care screen payload; an unclear one ends it
// with one fixed soft question; otherwise the route carries on. Nothing the
// founder wrote is stored: a care event holds only who, how serious, when.
import { classifyCare } from './classify.js'
import { escalateCare } from './escalation.js'
import { CARE_COPY } from './copy.js'
import { hasExperimentBlock, isUuid } from '../writeValidation.js'

const SCOPE_KEYS = ['thread_id', 'situation_id', 'session_id']

// ── Text extractors: (req) => string | string[] | null ───────────────────────

export const bodyFields = (...names) => (req) => names.map((n) => req.body?.[n])

// The last user message of a chat payload (string or text parts).
export const lastUserMessage = (req) => {
  const msgs = Array.isArray(req.body?.messages) ? req.body.messages : []
  const last = [...msgs].reverse().find((m) => m?.role === 'user')
  if (!last) return null
  if (typeof last.content === 'string') return last.content
  return Array.isArray(last.content) ? last.content.map((p) => p?.text) : null
}

// A message body written by the founder. Assistant edits carry the
// <experiment> block, which is Axiom's text, not the founder's.
export const founderMessageContent = (req) => {
  const c = req.body?.content
  if (typeof c !== 'string' || hasExperimentBlock(c)) return null
  return req.body?.role === 'assistant' ? null : c
}

export const onboardingAnswers = (req) =>
  (Array.isArray(req.body?.answers) ? req.body.answers : []).map((a) => a?.answer)

export const profileFreeText = (req) => [
  req.body?.goal,
  ...(Array.isArray(req.body?.open_answers) ? req.body.open_answers.map((a) => a?.answer) : []),
]

const flatText = (value) => [].concat(value ?? []).filter((v) => typeof v === 'string' && v.trim()).join('\n')

// onCare({ userId, level, scopeId }): runs whenever the gate stops a step, even
// when its event could not be recorded (the journey takes shares down there).
export function createCare({ supabase, callStructured, clock = { now: () => Date.now() }, onCare = null } = {}) {
  const log = (what, err) => console.error(`[Care] ${what}`, err?.message || '')

  async function priorUnclear(userId) {
    if (!supabase) return []
    const { data, error } = await supabase
      .from('care_events')
      .select('level, scope_id, created_at')
      .eq('user_id', userId)
      .eq('level', 'unclear')
    if (error) throw error
    return data || []
  }

  async function record(userId, level, scopeId) {
    if (!supabase) return
    const { error } = await supabase.from('care_events').insert({
      user_id: userId,
      level,
      scope_id: scopeId,
      created_at: new Date(clock.now()).toISOString(),
      resolved_at: null,
    })
    if (error) throw error
  }

  // True while a clear care event is unresolved. Throws when the lookup fails.
  async function clearIsOpen(userId) {
    if (!supabase) return false
    const { data, error } = await supabase
      .from('care_events').select('id').eq('user_id', userId).eq('level', 'clear').is('resolved_at', null).limit(1)
    if (error) throw error
    return (data || []).length > 0
  }

  // Pushes for this founder stay paused while care is open. If the lookup
  // fails we answer true: pausing is the safe side.
  async function isCareOpen(userId) {
    try {
      return await clearIsOpen(userId)
    } catch (err) {
      log('open check failed', err)
      return true
    }
  }

  // Closes open events once the founder has been checked in on. A failed write
  // throws, so no caller reports the check-in done when nothing was closed.
  async function resolveCare(userId) {
    if (!supabase) return
    const { error } = await supabase
      .from('care_events')
      .update({ resolved_at: new Date(clock.now()).toISOString() })
      .eq('user_id', userId)
      .is('resolved_at', null)
    if (error) throw error
  }

  // extract: (req) => string | string[] | null. Add context(req) => string[]
  // later when a route has the conversation to hand.
  function careGate(extract) {
    return async function careGateMiddleware(req, res, next) {
      const text = flatText(extract(req))
      if (!text) return next()
      const userId = req.user?.id

      const verdict = await classifyCare({
        text,
        deps: { callStructured, userId },
      })
      if (verdict.level === 'none') return next()

      const scopeId = SCOPE_KEYS.map((k) => req.body?.[k]).find(isUuid) ?? null
      let level = verdict.level
      try {
        level = escalateCare({
          level, scopeId, priorEvents: await priorUnclear(userId), now: clock.now(),
        }).level
      } catch (err) {
        log('history read failed', err)
      }
      try {
        await record(userId, level, scopeId)
      } catch (err) {
        log('record failed', err)
      }
      if (onCare) {
        try {
          await onCare({ userId, level, scopeId })
        } catch (err) {
          log('after-care step failed', err)
        }
      }

      if (level === 'clear') return sendClear(userId, res)
      return res.json({ care: 'unclear', reply: CARE_COPY.unclearReply })
    }
  }

  async function sendClear(userId, res) {
    return res.json({ care: 'clear', message: CARE_COPY.clearMessage, help: { line: CARE_COPY.fallbackLine, url: CARE_COPY.helpUrl } })
  }

  // Distress stops the journey until the founder is checked in on (home):
  // while a clear event is open, a step that would read, teach or give a move
  // shows the care screen again. No model call, nothing stored, no new event.
  // A failed lookup is an error, not a care screen for someone who is fine.
  function careHold(req, res, next) {
    clearIsOpen(req.user?.id).then((open) => (open ? sendClear(req.user.id, res) : next()), next)
  }

  return { careGate, careHold, isCareOpen, resolveCare }
}
