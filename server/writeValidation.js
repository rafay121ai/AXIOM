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

// Ownership rule for message update/delete. `message` and `session` are plain
// rows (or null). Not found and not owned look the same (404). Only assistant
// replies can be deleted (403 otherwise).
export function decideMessageAccess({ message, session, userId, action }) {
  if (!message || !session || !userId || session.user_id !== userId) {
    return { allowed: false, status: 404 }
  }
  if (action === 'delete' && message.role !== 'assistant') return { allowed: false, status: 403 }
  return { allowed: true }
}

// True when the thread row belongs to the caller and the given session.
export function isThreadOwnedBy(thread, userId, sessionId) {
  return Boolean(thread) && thread.user_id === userId && thread.session_id === sessionId
}

const EXPERIMENT_METADATA_MAX_BYTES = 16 * 1024

// The app reads only metadata.hypothesis. If the echoed original is oversized,
// drop it and keep the essential fields; the move itself is never rejected.
export function capExperimentMetadata(original, essentials) {
  const full = { ...(original && typeof original === 'object' ? original : {}), ...essentials }
  try {
    if (Buffer.byteLength(JSON.stringify(full), 'utf8') <= EXPERIMENT_METADATA_MAX_BYTES) return full
  } catch {
    // fall through to the essentials
  }
  return { ...essentials, original_dropped: true }
}

// ─── Founder profile ──────────────────────────────────────────────────────────

export const FOUNDER_STAGES = ['idea', 'validating', 'first_paying_customer', 'first_10_customers', 'repeatable_sales', 'scaling']
export const BUSINESS_MODELS = ['b2b', 'b2c', 'marketplace', 'services', 'other']
export const CUSTOMER_MARKETS_MAX = 10
export const CUSTOMER_MARKET_MAX_LEN = 60
export const PROFILE_COUNTRY_MAX = 80
export const PROFILE_GOAL_MAX = 1_000
export const PROFILE_TIMEZONE_MAX = 64
export const PROFILE_OPEN_ANSWERS_MAX = 3
export const PROFILE_OPEN_QUESTION_MAX = 500
export const PROFILE_OPEN_ANSWER_MAX = 5_000
export const PROFILE_INPUT_MODES = ['voice', 'text']

// Returns the canonical IANA name, or null. Offsets like '+01:00' are rejected.
function canonicalTimeZone(value) {
  if (value !== 'UTC' && value.toUpperCase() !== 'UTC' && !value.includes('/')) return null
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone
  } catch {
    return null
  }
}

// Accepts HH:MM or HH:MM:SS, returns HH:MM or null.
export function normalizeReportTime(value) {
  if (typeof value !== 'string') return null
  const m = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(value)
  return m ? `${m[1]}:${m[2]}` : null
}

function isValidIsoDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return false
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.toISOString().slice(0, 10) === value
}

// Partial update: absent keys are left out of the result, unknown keys are
// ignored, null clears a nullable column. customer_markets and open_answers
// are NOT NULL in the database, so null is rejected for them.
// Returns { ok: true, value } or { ok: false, error }.
export function cleanFounderProfilePayload(body) {
  if (!isPlainObject(body)) return { ok: false, error: 'Invalid profile data' }
  const value = {}
  const fail = (field) => ({ ok: false, error: `Invalid ${field}` })
  const has = (key) => Object.prototype.hasOwnProperty.call(body, key)

  for (const [key, allowed] of [['stage', FOUNDER_STAGES], ['business_model', BUSINESS_MODELS]]) {
    if (!has(key)) continue
    const v = body[key]
    if (v === null) value[key] = null
    else if (typeof v === 'string' && allowed.includes(v)) value[key] = v
    else return fail(key)
  }

  if (has('customer_markets')) {
    // Product decision pending: PRODUCT.md says "a list of regions plus
    // Global" but defines no region list. Until it does, any short label is
    // accepted (lowercased); 'global' is just one such label.
    const v = body.customer_markets
    if (!Array.isArray(v) || v.length > CUSTOMER_MARKETS_MAX) return fail('customer_markets')
    const seen = new Set()
    for (const item of v) {
      if (typeof item !== 'string') return fail('customer_markets')
      const t = item.trim().toLowerCase()
      if (!t || t.length > CUSTOMER_MARKET_MAX_LEN) return fail('customer_markets')
      seen.add(t)
    }
    value.customer_markets = [...seen]
  }

  for (const [key, max] of [['country', PROFILE_COUNTRY_MAX], ['goal', PROFILE_GOAL_MAX]]) {
    if (!has(key)) continue
    const v = body[key]
    if (v === null) value[key] = null
    else if (typeof v === 'string' && v.trim().length <= max) value[key] = v.trim() || null
    else return fail(key)
  }

  if (has('timezone')) {
    const v = body.timezone
    if (v === null) value.timezone = null
    else {
      const tz = typeof v === 'string' && v.trim() && v.trim().length <= PROFILE_TIMEZONE_MAX ? canonicalTimeZone(v.trim()) : null
      if (!tz) return fail('timezone')
      value.timezone = tz
    }
  }

  if (has('deadline')) {
    const v = body.deadline
    if (v === null) value.deadline = null
    else if (typeof v === 'string' && isValidIsoDate(v)) value.deadline = v
    else return fail('deadline')
  }

  if (has('report_time_local')) {
    const v = body.report_time_local
    if (v === null) value.report_time_local = null
    else if (normalizeReportTime(v)) value.report_time_local = normalizeReportTime(v)
    else return fail('report_time_local')
  }

  if (has('open_answers')) {
    const v = body.open_answers
    if (!Array.isArray(v) || v.length > PROFILE_OPEN_ANSWERS_MAX) return fail('open_answers')
    const out = []
    for (const item of v) {
      if (!isPlainObject(item)) return fail('open_answers')
      if (typeof item.question !== 'string' || item.question.trim().length > PROFILE_OPEN_QUESTION_MAX) return fail('open_answers')
      if (typeof item.answer !== 'string' || !item.answer.trim() || item.answer.trim().length > PROFILE_OPEN_ANSWER_MAX) return fail('open_answers')
      if (!PROFILE_INPUT_MODES.includes(item.input_mode)) return fail('open_answers')
      out.push({ question: item.question.trim(), answer: item.answer.trim(), input_mode: item.input_mode })
    }
    value.open_answers = out
  }

  return { ok: true, value }
}
