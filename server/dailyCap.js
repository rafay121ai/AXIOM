// Per-founder daily AI cost cap. Pure helpers live here; the DB sum is in index.js.
import { MODEL_PRICING_PER_MILLION, estimateModelCost } from './modelUsage.js'

export const DAILY_COST_CAP_USD = 1.0

// Chat max_completion_tokens ceiling (server/index.js clamps to this).
export const CHAT_MAX_COMPLETION_TOKENS = 4000
// Conservative charge for a client-aborted call that logged no cost.
export const ABORT_ASSUMED_PROMPT_TOKENS = 20000
export const ABORT_ASSUMED_OUTPUT_TOKENS = CHAT_MAX_COMPLETION_TOKENS
export const CLIENT_ABORTED_MARKER = 'client_aborted'
export const STREAM_INTERRUPTED_MARKER = 'stream_interrupted'
// error_details values that are charged the abort estimate when cost is unknown.
export const CHARGED_ERROR_MARKERS = Object.freeze([CLIENT_ABORTED_MARKER, STREAM_INTERRUPTED_MARKER])
export const CAP_PAGE_SIZE = 1000

// Single place to change the copy shown to a founder who hit the cap.
// The client swaps "midnight UTC" for the founder's local reset time.
export const DAILY_CAP_MESSAGE =
  "You've hit today's limit. Come back after midnight UTC to keep going."

export function utcDayStart(now = new Date()) {
  const d = new Date(now)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

export function nextUtcMidnight(now = new Date()) {
  const start = utcDayStart(now)
  return new Date(start.getTime() + 24 * 60 * 60 * 1000)
}

// costs: array of numbers/null/strings, or a single number. Null and junk count as 0.
export function sumCosts(costs) {
  const list = Array.isArray(costs) ? costs : [costs]
  return list.reduce((total, value) => {
    const n = Number(value)
    return value == null || !Number.isFinite(n) ? total : total + n
  }, 0)
}

export function isOverDailyCap(costs, cap = DAILY_COST_CAP_USD) {
  return sumCosts(costs) >= cap
}

export function buildCappedResponse(now = new Date()) {
  return {
    capped: true,
    message: DAILY_CAP_MESSAGE,
    resets_at: nextUtcMidnight(now).toISOString(),
  }
}

// Returns the 200 body to send instead of calling OpenAI, or null to proceed.
export function dailyCapDecision(costs, now = new Date()) {
  return isOverDailyCap(costs) ? buildCappedResponse(now) : null
}

const ABORT_USAGE = Object.freeze({
  prompt_tokens: ABORT_ASSUMED_PROMPT_TOKENS,
  completion_tokens: ABORT_ASSUMED_OUTPUT_TOKENS,
})
const quiet = () => {}

function maxChatAbortCharge() {
  let max = 0
  for (const model of Object.keys(MODEL_PRICING_PER_MILLION)) {
    if (model.startsWith('text-embedding')) continue
    max = Math.max(max, estimateModelCost(model, ABORT_USAGE, { warn: quiet }) ?? 0)
  }
  return max
}

// What one logged row counts for toward the cap. Stored logs are not changed.
export function capChargeForRow(row) {
  const stored = row?.estimated_cost_usd
  if (stored != null && Number.isFinite(Number(stored))) return Number(stored)
  if (!CHARGED_ERROR_MARKERS.includes(row?.error_details)) return 0
  const priced = Object.hasOwn(MODEL_PRICING_PER_MILLION, row.model)
    ? estimateModelCost(row.model, ABORT_USAGE, { warn: quiet })
    : null
  return priced ?? maxChatAbortCharge()
}

// PostgREST or-filter for "strictly after (created_at, id)". Values are
// double-quoted so timestamps with ':' '.' '+' parse as one value.
export function keysetOrFilter(cursor) {
  const q = (v) => `"${String(v).replace(/(["\\])/g, '\\$1')}"`
  return `created_at.gt.${q(cursor.created_at)},and(created_at.eq.${q(cursor.created_at)},id.gt.${q(cursor.id)})`
}

// fetchPage(cursor, pageSize) -> rows ordered by (created_at, id) strictly after
// cursor ({created_at, id} of the last row seen, null for the first page).
// Stops at the cap.
export async function sumChargesPaged(fetchPage, cap = DAILY_COST_CAP_USD, pageSize = CAP_PAGE_SIZE) {
  let total = 0
  let cursor = null
  for (;;) {
    const rows = (await fetchPage(cursor, pageSize)) || []
    for (const row of rows) total += capChargeForRow(row)
    if (total >= cap || rows.length < pageSize) return total
    const last = rows[rows.length - 1]
    if (last?.created_at == null || last?.id == null) throw new Error('cap page rows need created_at and id')
    if (cursor && cursor.created_at === last.created_at && cursor.id === last.id) throw new Error('cap paging did not advance')
    cursor = { created_at: last.created_at, id: last.id }
  }
}

// lookup(userId, sinceIso) -> total charge. Returns the capped body or null.
// Fails open if the lookup throws (pending owner confirmation).
export async function resolveDailyCap(userId, lookup, now = new Date(), log = console.warn) {
  if (!userId) return null
  try {
    const total = await lookup(userId, utcDayStart(now).toISOString())
    return isOverDailyCap([total]) ? buildCappedResponse(now) : null
  } catch (err) {
    log('[DailyCap] lookup failed, failing open', { user_id: userId, error: err?.message || String(err) })
    return null
  }
}
