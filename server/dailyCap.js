// Per-founder daily AI cost cap. Pure helpers live here; the DB sum is in index.js.
import { MODEL_PRICING_PER_MILLION, estimateModelCost } from './modelUsage.js'

export const DAILY_COST_CAP_USD = 1.0

// Chat max_completion_tokens ceiling (server/index.js clamps to this).
export const CHAT_MAX_COMPLETION_TOKENS = 4000
// Conservative charge for a client-aborted call that logged no cost.
export const ABORT_ASSUMED_PROMPT_TOKENS = 20000
export const ABORT_ASSUMED_OUTPUT_TOKENS = CHAT_MAX_COMPLETION_TOKENS
export const CLIENT_ABORTED_MARKER = 'client_aborted'
export const CAP_PAGE_SIZE = 1000

// Single place to change the copy shown to a founder who hit the cap.
export const DAILY_CAP_MESSAGE =
  "Today's limit is reached. Your thread is saved. Come back after midnight UTC and we pick up from here."

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
  if (row?.error !== CLIENT_ABORTED_MARKER) return 0
  const priced = Object.hasOwn(MODEL_PRICING_PER_MILLION, row.model)
    ? estimateModelCost(row.model, ABORT_USAGE, { warn: quiet })
    : null
  return priced ?? maxChatAbortCharge()
}

// fetchPage(from, to) -> array of rows (inclusive range). Stops at the cap.
export async function sumChargesPaged(fetchPage, cap = DAILY_COST_CAP_USD, pageSize = CAP_PAGE_SIZE) {
  let total = 0
  for (let from = 0; ; from += pageSize) {
    const rows = (await fetchPage(from, from + pageSize - 1)) || []
    for (const row of rows) total += capChargeForRow(row)
    if (total >= cap || rows.length < pageSize) return total
  }
}

// lookup(userId, sinceIso) -> total charge. Returns the capped body or null.
// Fails open if the lookup throws (pending owner confirmation).
export async function resolveDailyCap(userId, lookup, now = new Date(), log = console.error) {
  if (!userId) return null
  try {
    const total = await lookup(userId, utcDayStart(now).toISOString())
    return isOverDailyCap([total]) ? buildCappedResponse(now) : null
  } catch (err) {
    log('[Daily Cap] lookup failed', err?.message || err)
    return null
  }
}
