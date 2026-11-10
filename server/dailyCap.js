// Per-founder daily AI cost cap. Pure helpers live here; the DB sum is read in app.js.

export const DAILY_COST_CAP_USD = 1.0
export const CAP_PAGE_SIZE = 1000

// The one place for the line a founder sees at the cap.
export const DAILY_CAP_LINE = "You've hit today's limit. Come back tomorrow to keep going." // (new)

export function utcDayStart(now = new Date()) {
  const d = new Date(now)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
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
    total += sumCosts(rows.map((row) => row?.estimated_cost_usd))
    if (total >= cap || rows.length < pageSize) return total
    const last = rows[rows.length - 1]
    if (last?.created_at == null || last?.id == null) throw new Error('cap page rows need created_at and id')
    if (cursor && cursor.created_at === last.created_at && cursor.id === last.id) throw new Error('cap paging did not advance')
    cursor = { created_at: last.created_at, id: last.id }
  }
}

// lookup(userId, sinceIso) -> total spent today. True when over the cap.
// Fails open if the lookup throws.
export async function resolveDailyCap(userId, lookup, now = new Date(), log = console.warn) {
  if (!userId) return false
  try {
    return isOverDailyCap([await lookup(userId, utcDayStart(now).toISOString())])
  } catch (err) {
    log('[DailyCap] lookup failed, failing open', { user_id: userId, error: err?.message || String(err) })
    return false
  }
}

// Route middleware for every journey route that makes a model call. Mount it
// AFTER the care checks: care is never capped. Admin accounts skip it.
// cap(stored) lets a request through when stored(req) says its answer is
// already stored: a replay costs no model call.
export function dailyCapGate({ isCapped, isAdmin = () => false }) {
  const gate = (stored = null) => async (req, res, next) => {
    if (isAdmin(req.user) || !(await isCapped(req.user.id)) || (stored && await stored(req))) return next()
    return res.status(429).json({ error: 'Daily cost cap reached', code: 'daily_cost_cap', line: DAILY_CAP_LINE })
  }
  // For background work with no request (memory): true when this founder is over the cap.
  gate.isCapped = isCapped
  // Never blocks: sets req.overCap, so a route that must save what the founder wrote can skip only its model call.
  gate.mark = async (req, _res, next) => {
    req.overCap = !isAdmin(req.user) && await isCapped(req.user.id)
    next()
  }
  return gate
}
