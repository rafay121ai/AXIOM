// Per-founder daily AI cost cap. Pure helpers live here; the DB sum is in index.js.
export const DAILY_COST_CAP_USD = 1.0

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
