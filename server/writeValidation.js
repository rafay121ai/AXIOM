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
// 'brain' stays until the DB CHECK constraint on app_sessions.entry_point is migrated.
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

// Model output is untrusted and sloppy: sanitize instead of rejecting so
// founder memory is saved whenever anything usable is present.
function cleanConceptList(value) {
  if (!Array.isArray(value)) return []
  const out = []
  for (const item of value) {
    if (out.length >= CONCEPT_LIST_MAX) break
    if (typeof item !== 'string' || !item.trim()) continue
    out.push(item.slice(0, CONCEPT_TEXT_MAX))
  }
  return out
}

// Returns a cleaned array, or null when the value is not an array. Entries
// without a string topic are skipped; counts are capped by truncation.
export function cleanConceptProgress(value) {
  if (!Array.isArray(value)) return null
  const out = []
  for (const entry of value) {
    if (out.length >= CONCEPT_PROGRESS_MAX_ENTRIES) break
    if (!isPlainObject(entry) || typeof entry.topic !== 'string' || !entry.topic.trim()) continue
    out.push({
      topic: entry.topic.slice(0, CONCEPT_TEXT_MAX),
      concepts_completed: cleanConceptList(entry.concepts_completed),
      concepts_remaining: cleanConceptList(entry.concepts_remaining),
    })
  }
  return out
}

// Returns { updates } holding only the usable fields, or null when the body is
// not an object or nothing usable remains. Nothing outside session_notes /
// concept_progress is ever accepted.
export function cleanSessionMemoryPayload(body) {
  if (!isPlainObject(body)) return null
  const updates = {}
  if (typeof body.session_notes === 'string') {
    updates.session_notes = body.session_notes.slice(0, SESSION_NOTES_MAX)
  }
  if (Array.isArray(body.concept_progress)) {
    const cleaned = cleanConceptProgress(body.concept_progress)
    // An explicit empty array is kept; a non-empty array with no usable entry is dropped.
    if (cleaned.length > 0 || body.concept_progress.length === 0) updates.concept_progress = cleaned
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

// ─── Messages and conversation threads ───────────────────────────────────────

// Roles the app actually writes. messages.role has no DB CHECK in the baseline.
export const MESSAGE_ROLES = ['user', 'assistant']
// Assistant replies are capped by max_tokens 4000 (~16k chars); this leaves
// generous headroom and rejects only abuse.
export const MESSAGE_CONTENT_MAX = 100_000
export const THREAD_TITLE_MAX = 200
export const THREAD_PILLARS = [
  'human_mind', 'money_game', 'how_companies_win', 'whats_coming', 'think_sharper', 'move_people',
]

// Returns { id (or null), session_id, title, primary_pillar } or null.
export function cleanThreadPayload(body) {
  if (!isPlainObject(body)) return null
  if (!isUuid(body.session_id)) return null
  if (body.id !== undefined && body.id !== null && !isUuid(body.id)) return null
  let title = null
  if (body.title !== undefined && body.title !== null) {
    if (typeof body.title !== 'string') return null
    title = body.title.slice(0, THREAD_TITLE_MAX)
  }
  let pillar = null
  if (body.primary_pillar !== undefined && body.primary_pillar !== null) {
    if (!THREAD_PILLARS.includes(body.primary_pillar)) return null
    pillar = body.primary_pillar
  }
  return { id: body.id || null, session_id: body.session_id, title, primary_pillar: pillar }
}

// Returns { session_id, thread_id (or null), role, content } or null.
export function cleanMessageCreate(body) {
  if (!isPlainObject(body)) return null
  if (!isUuid(body.session_id)) return null
  if (body.thread_id !== undefined && body.thread_id !== null && !isUuid(body.thread_id)) return null
  if (!MESSAGE_ROLES.includes(body.role)) return null
  if (typeof body.content !== 'string' || body.content.length > MESSAGE_CONTENT_MAX) return null
  return {
    session_id: body.session_id,
    thread_id: body.thread_id || null,
    role: body.role,
    content: body.content,
  }
}

export function hasExperimentBlock(content) {
  return typeof content === 'string' && /<experiment>[\s\S]*<\/experiment>\s*$/.test(content)
}

// The browser edits only content. A user message may be edited freely (non
// empty); an assistant message only to attach the experiment block it already
// had. Returns { content } or null.
export function cleanMessageUpdate(body, role) {
  if (!isPlainObject(body)) return null
  if (typeof body.content !== 'string' || body.content.length > MESSAGE_CONTENT_MAX) return null
  if (role === 'user') return body.content.trim() ? { content: body.content } : null
  if (role === 'assistant') return hasExperimentBlock(body.content) ? { content: body.content } : null
  return null
}
