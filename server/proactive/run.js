// Axiom speaks first. Once an hour, for each founder, at most one opener: a
// situation Axiom starts itself (started_by 'axiom') with its own question as
// the first turn. No model call. Everything is injected, so tests use fakes.
// Started only from index.js, behind PROACTIVE=on.
//
// A founder gets nothing while a care event is open, a deletion is waiting,
// pushes are paused for inactivity (policy.js), an earlier opener is still
// unanswered, or the last opener is under 3 days old. An opener nobody
// answered in 7 days closes quietly (status 'closed'): no warning, no mark.
// Concurrent runs are safe: (user_id, trigger_key) is unique, and a duplicate
// key means "already made".
import { validTimeZone } from '../journey/move/schedule.js'
import { DAY_MS, PAUSE_AFTER_MS, localTimeOn, zoneOf } from '../push/policy.js'
import { firedTriggers } from './triggers.js'
import { openerText } from './wording.js'

export const PROACTIVE_CHECK_MS = 60 * 60 * 1000
export const OPENER_GAP_MS = 3 * DAY_MS
export const OPENER_CLOSE_MS = 7 * DAY_MS
export const OPENER_FROM = '07:00'
const PAGE_SIZE = 500
const TITLE_MAX = 60

const one = async (query) => {
  const { data, error } = await query
  if (error) throw error
  return data
}

export function createProactive({ supabase, clock, isCareOpen, log = (what, err) => console.error(`[Proactive] ${what}`, err?.message || ''), pageSize = PAGE_SIZE }) {
  if (typeof isCareOpen !== 'function') throw new Error('isCareOpen is required: no opener while care is open')
  const iso = (ms = clock.now()) => new Date(ms).toISOString()

  async function everyProfile() {
    const rows = []
    for (let after = null; ;) {
      let query = supabase.from('founder_profiles').select('user_id, timezone, deadline, signup_answers')
      if (after !== null) query = query.gt('user_id', after)
      const page = await one(query.order('user_id', { ascending: true }).limit(pageSize))
      rows.push(...page)
      if (page.length < pageSize) return rows
      after = page[page.length - 1].user_id
    }
  }

  // Ids among `ids` that hold a founder turn.
  const answered = async (ids) => (ids.length === 0 ? new Set()
    : new Set((await one(supabase.from('situation_turns').select('situation_id').eq('role', 'founder').in('situation_id', ids))).map((t) => t.situation_id)))

  async function closeStale(now) {
    const old = await one(supabase.from('situations').select('id')
      .eq('started_by', 'axiom').eq('status', 'open').lte('created_at', iso(now - OPENER_CLOSE_MS)))
    const talked = await answered(old.map((s) => s.id))
    for (const { id } of old.filter((s) => !talked.has(s.id))) {
      await one(supabase.from('situations').update({ status: 'closed' }).eq('id', id).eq('status', 'open').select('id'))
    }
  }

  // Makes the opener. Returns the situation id, or null when this trigger was already made.
  async function create({ userId, trigger, now }) {
    const title = trigger.kind === 'two_misses' ? trigger.facts.moves[1] : trigger.facts.goalWords
    const made = await supabase.from('situations').insert({
      user_id: userId, title: title.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX), status: 'open', follow_up_count: 0,
      started_by: 'axiom', trigger_key: trigger.key, created_at: iso(now), last_activity_at: iso(now),
    }).select().single()
    if (made.error?.code === '23505') return null
    if (made.error) throw made.error
    const turn = await supabase.from('situation_turns').insert({
      situation_id: made.data.id, role: 'axiom', text: openerText(trigger.kind, trigger.facts), filler: false, result: null, created_at: iso(now),
    }).select('id')
    if (turn.error) {
      // No empty opener is left behind.
      await supabase.from('situations').delete().eq('id', made.data.id)
      throw turn.error
    }
    return made.data.id
  }

  async function forFounder(profile, now) {
    const userId = profile.user_id
    const zone = zoneOf(validTimeZone(profile.timezone) ? profile.timezone : null)
    if (now < localTimeOn(now, zone, OPENER_FROM)) return null

    const earlier = await one(supabase.from('situations').select('id, status, created_at, trigger_key').eq('user_id', userId).eq('started_by', 'axiom'))
    if (earlier.some((s) => now - Date.parse(s.created_at) < OPENER_GAP_MS)) return null
    const waiting = await answered(earlier.filter((s) => s.status === 'open').map((s) => s.id))
    if (earlier.some((s) => s.status === 'open' && !waiting.has(s.id) && now - Date.parse(s.created_at) < OPENER_CLOSE_MS)) return null

    const [latest, movesLatest, reports] = await Promise.all([
      one(supabase.from('situations').select('last_activity_at').eq('user_id', userId).order('last_activity_at', { ascending: false }).limit(1)),
      one(supabase.from('moves').select('committed_at').eq('user_id', userId).order('committed_at', { ascending: false }).limit(1)),
      one(supabase.from('reports').select('id, outcome, created_at, move_id').eq('user_id', userId).order('created_at', { ascending: false }).limit(2)),
    ])
    const last = Math.max(...[latest[0]?.last_activity_at, movesLatest[0]?.committed_at].map((v) => Date.parse(v ?? '')).filter(Number.isFinite))
    if (!Number.isFinite(last) || now - last >= PAUSE_AFTER_MS) return null // the same pause the push scheduler applies
    if ((await isCareOpen(userId)) !== false) return null

    const titles = reports.length ? await one(supabase.from('moves').select('id, title').in('id', reports.map((r) => r.move_id))) : []
    const trigger = firedTriggers({
      nowMs: now, timeZone: zone, deadline: profile.deadline, goal: profile.signup_answers?.goal?.goal,
      reports: reports.map((r) => ({ ...r, move_title: titles.find((m) => m.id === r.move_id)?.title ?? null })),
    }).find((t) => !earlier.some((s) => s.trigger_key === t.key))
    return trigger ? create({ userId, trigger, now }) : null
  }

  // Returns how many openers were made.
  async function run() {
    const now = clock.now()
    await closeStale(now)
    const leaving = new Set((await one(supabase.from('account_requests').select('user_id')
      .eq('kind', 'delete').in('status', ['queued', 'pending', 'deleting']))).map((r) => r.user_id))
    let made = 0
    for (const profile of await everyProfile()) {
      if (leaving.has(profile.user_id)) continue
      try {
        if (await forFounder(profile, now)) made += 1
      } catch (err) {
        log('founder skipped', err)
      }
    }
    return made
  }

  return { run }
}

// Hourly, and once now. Never overlaps itself.
export function startProactiveLoop({ proactive, intervalMs = PROACTIVE_CHECK_MS, log = (what, err) => console.error(`[Proactive] ${what}`, err?.message || '') }) {
  let running = false
  const run = async () => {
    if (running) return
    running = true
    try { await proactive.run() } catch (err) { log('run failed', err) } finally { running = false }
  }
  const timer = setInterval(run, intervalMs)
  timer.unref?.()
  return { stop: () => clearInterval(timer), run }
}
