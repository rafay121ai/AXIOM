// A separate daily budget for connector (signal) model spend, per founder, so it never eats the founder's own $1 cap
// (app.js leaves call_type 'signal' out of that cap). Counted from model_usage_logs since the founder's local midnight.
import { sumCosts } from '../dailyCap.js'
import { localParts, localToUtc, validTimeZone } from '../journey/move/schedule.js'

export const CONNECTOR_DAILY_USD = 0.3

// Returns overBudget(userId): null when there is budget left, else { retryAt } (ms: the founder's next local midnight).
export function createBudget({ supabase, clock, limitUsd = CONNECTOR_DAILY_USD }) {
  return async function overBudget(userId) {
    const { data: profile } = await supabase.from('founder_profiles').select('timezone').eq('user_id', userId).maybeSingle()
    const zone = validTimeZone(profile?.timezone) ? profile.timezone : 'UTC'
    const now = clock.now()
    const p = localParts(now, zone)
    const since = localToUtc({ y: p.y, m: p.m, d: p.d, h: 0, mi: 0 }, zone)
    const { data, error } = await supabase.from('model_usage_logs').select('estimated_cost_usd')
      .eq('user_id', userId).eq('call_type', 'signal').gte('created_at', new Date(since).toISOString()).limit(1000)
    if (error) throw error
    if (sumCosts((data ?? []).map((r) => r.estimated_cost_usd)) < limitUsd) return null
    return { retryAt: localToUtc({ y: p.y, m: p.m, d: p.d + 1, h: 0, mi: 0 }, zone) }
  }
}
