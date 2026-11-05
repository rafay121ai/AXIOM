// Model IDs per step. Override with MODEL_<STEP> env vars; the server picks
// the model, never the request. Defaults are the models the app already uses.
const CHAT_MODEL = 'gpt-5.4-mini-2026-03-17'
const DEEP_MODEL = 'gpt-5.2-2025-12-11'
const UTILITY_MODEL = 'gpt-4.1-mini'

const STEP_DEFAULTS = Object.freeze({
  read: DEEP_MODEL,
  learn: CHAT_MODEL,
  followup: UTILITY_MODEL,
  move: CHAT_MODEL,
  care: CHAT_MODEL,
  report: CHAT_MODEL,
})

export const MODELS = Object.freeze({ embedding: 'text-embedding-3-small' })

export function modelForStep(step, env = process.env) {
  if (!Object.hasOwn(STEP_DEFAULTS, step)) throw new Error(`Unknown model step "${step}"`)
  return env[`MODEL_${step.toUpperCase()}`]?.trim() || STEP_DEFAULTS[step]
}

export const STEPS = Object.freeze(Object.keys(STEP_DEFAULTS))

// Exact model IDs the current web client may request on /api/openai/chat.
export const ALLOWED_CLIENT_MODELS = Object.freeze([
  'gpt-5.2-2025-12-11',
  'gpt-5.2',
  'gpt-5.4-mini-2026-03-17',
  'gpt-5.4-mini',
  'gpt-4.1-mini',
  'gpt-4.1-mini-2025-04-14',
])

export const LIMITS = Object.freeze({
  MAX_FOLLOW_UPS: 2,
  MAX_ACTIVE_MOVES: 2,
  MAX_PUSH_PER_DAY: 2,
})
