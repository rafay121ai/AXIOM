// Pure validators for browser-initiated writes that now go through the API.
// Each returns a cleaned value, or null when the input is unusable.

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const SESSION_NOTES_MAX = 20_000
export const AXIOM_PROFILE_MAX = 20_000
export const ONBOARDING_MAX_ANSWERS = 20
export const ONBOARDING_QUESTION_MAX = 1_000
export const ONBOARDING_ANSWER_MAX = 5_000
export const FIRST_NAME_MAX = 100
export const CONCEPT_PROGRESS_MAX_ENTRIES = 50
export const CONCEPT_LIST_MAX = 100
export const CONCEPT_TEXT_MAX = 300
export const APP_SESSION_ENTRY_POINTS = ['direct', 'resume', 'experiment', 'brain']
export const APP_SESSION_DEVICE_MAX = 200
export const MESSAGES_SENT_MAX_INCREMENT = 20

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

export function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value)
}

export function cleanFirstName(value) {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim().slice(0, FIRST_NAME_MAX)
  return trimmed || null
}

export function cleanOnboardingPayload(body) {
  if (!isPlainObject(body)) return null

  if (!isUuid(body.session_token)) return null

  const firstName = cleanFirstName(body.first_name)
  if (firstName === undefined) return null

  if (!Array.isArray(body.answers) || body.answers.length === 0 || body.answers.length > ONBOARDING_MAX_ANSWERS) {
    return null
  }
  const answers = []
  for (const item of body.answers) {
    if (!isPlainObject(item)) return null
    if (typeof item.question !== 'string' || typeof item.answer !== 'string') return null
    if (item.question.length > ONBOARDING_QUESTION_MAX || item.answer.length > ONBOARDING_ANSWER_MAX) return null
    answers.push({ question: item.question, answer: item.answer })
  }

  if (!isPlainObject(body.pillar_weights)) return null
  const keys = Object.keys(body.pillar_weights)
  if (keys.length > 20) return null
  const pillarWeights = {}
  for (const key of keys) {
    const value = body.pillar_weights[key]
    if (key.length > 60 || typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1000) return null
    pillarWeights[key] = value
  }

  if (typeof body.axiom_profile !== 'string' || body.axiom_profile.length > AXIOM_PROFILE_MAX) return null

  return {
    session_token: body.session_token,
    first_name: firstName,
    onboarding_answers: answers,
    pillar_weights: pillarWeights,
    axiom_profile: body.axiom_profile,
  }
}

function cleanConceptList(value) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > CONCEPT_LIST_MAX) return null
  const out = []
  for (const item of value) {
    if (typeof item !== 'string') return null
    out.push(item.slice(0, CONCEPT_TEXT_MAX))
  }
  return out
}

export function cleanConceptProgress(value) {
  if (!Array.isArray(value) || value.length > CONCEPT_PROGRESS_MAX_ENTRIES) return null
  const out = []
  for (const entry of value) {
    if (!isPlainObject(entry) || typeof entry.topic !== 'string') return null
    const completed = cleanConceptList(entry.concepts_completed)
    const remaining = cleanConceptList(entry.concepts_remaining)
    if (!completed || !remaining) return null
    out.push({
      topic: entry.topic.slice(0, CONCEPT_TEXT_MAX),
      concepts_completed: completed,
      concepts_remaining: remaining,
    })
  }
  return out
}

// Returns { updates } holding only the fields present, or null when invalid
// or empty. Nothing outside session_notes / concept_progress is ever accepted.
export function cleanSessionMemoryPayload(body) {
  if (!isPlainObject(body)) return null
  const updates = {}
  if (body.session_notes !== undefined) {
    if (typeof body.session_notes !== 'string' || body.session_notes.length > SESSION_NOTES_MAX) return null
    updates.session_notes = body.session_notes
  }
  if (body.concept_progress !== undefined) {
    const cleaned = cleanConceptProgress(body.concept_progress)
    if (!cleaned) return null
    updates.concept_progress = cleaned
  }
  return Object.keys(updates).length > 0 ? updates : null
}

export function cleanAppSessionStart(body) {
  const source = isPlainObject(body) ? body : {}
  const entryPoint = source.entry_point === undefined ? 'direct' : source.entry_point
  if (!APP_SESSION_ENTRY_POINTS.includes(entryPoint)) return null
  let device = null
  if (source.device !== undefined && source.device !== null) {
    if (typeof source.device !== 'string') return null
    device = source.device.slice(0, APP_SESSION_DEVICE_MAX)
  }
  return { entry_point: entryPoint, device }
}

export function cleanMessagesSentAmount(body) {
  const amount = isPlainObject(body) && body.amount !== undefined ? body.amount : 1
  if (!Number.isInteger(amount) || amount < 1 || amount > MESSAGES_SENT_MAX_INCREMENT) return null
  return amount
}

// Same rule the browser used: due_at when set, else assigned_at + window_hours.
export function isExperimentExpired(experiment, nowMs) {
  if (!experiment || experiment.status !== 'active') return false
  const dueAt = experiment.due_at
    ? new Date(experiment.due_at).getTime()
    : new Date(experiment.assigned_at).getTime() + experiment.window_hours * 3600 * 1000
  return nowMs > dueAt
}
