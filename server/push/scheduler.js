// The push scheduler. tick() finds the founders with something real due (an
// open move, or an open situation gone quiet), asks decidePush for each
// possible push, and sends the ones it allows. Everything is injected (clock,
// supabase, sender, isCareOpen), so tests run it with fakes. Started only from
// index.js, never from createApp.
//
// No double send and no third push, across ticks, restarts and processes:
// - a notification_log row (status 'sending', with its local_day and slot) is
//   written BEFORE anything is sent. The database keeps (user_id, dedupe_key)
//   unique, and (user_id, local_day, slot) unique while the row is sending or
//   sent, so a second tick or process that loses that insert (23505) sends
//   nothing; it reloads the log and decides again from what is really there;
// - a send whose fate is unknown (a timeout, a network error, a 5xx, a throw)
//   leaves the row 'sending': it counts for the day and is never sent again;
// - a send Expo clearly refused marks the row 'failed' (it does not count) and
//   is retried on the same row, at most MAX_ATTEMPTS times.
// Never sends while a care event is open or the care lookup fails, and never
// to a founder who asked for their account to be deleted.
import { ACTIVE_STATUSES } from '../journey/move/room.js'
import { founderFirstName } from '../journey/home/name.js'
import { loadStates, statusOf } from '../journey/home/state.js'
import { decidePush, PAUSE_AFTER_MS, QUIET_AFTER_MS } from './policy.js'
import { duePushes } from './due.js'
import { composePush } from './compose.js'
import { reminderSettingsOf } from './settings.js'
import { createPushTokens } from './tokens.js'

export const TICK_MS = 60 * 1000
// Rows per query page. Must stay at or below PostgREST's max rows (1000 on
// Supabase), so a full page always means there may be more.
export const PAGE_SIZE = 500
const LOG_LOOKBACK_MS = PAUSE_AFTER_MS + 24 * 60 * 60 * 1000

const defaultLog = (what, detail) => console.error(`[Push] ${what}`, detail?.message || detail || '')

// The founder's first name for the push text: the same rule as the greeting.
export const createNameLookup = (supabase) => (userId) => founderFirstName(supabase, userId)

export function createPushScheduler({ supabase, sender, clock, isCareOpen, nameOf = createNameLookup(supabase), log = defaultLog, pageSize = PAGE_SIZE }) {
  if (typeof isCareOpen !== 'function') throw new Error('isCareOpen is required: pushes pause while care is open')
  const tokens = createPushTokens({ supabase, clock })
  const iso = (ms) => new Date(ms).toISOString()
  const one = async (query) => {
    const { data, error } = await query
    if (error) throw error
    return data
  }

  // Every row of a query, a page at a time (keyset on id), so the row cap of
  // one response never drops a founder.
  async function everyRow(build) {
    const rows = []
    let after = null
    for (;;) {
      let query = build()
      if (after !== null) query = query.gt('id', after)
      const page = await one(query.order('id', { ascending: true }).limit(pageSize))
      rows.push(...page)
      if (page.length < pageSize) return rows
      after = page[page.length - 1].id
    }
  }

  async function careOpen(userId) {
    try {
      return (await isCareOpen(userId)) !== false
    } catch (err) {
      log('care check failed', err)
      return true
    }
  }

  const loadLog = (userId, now) => one(supabase.from('notification_log').select().eq('user_id', userId).gte('created_at', iso(now - LOG_LOOKBACK_MS)))

  // Writes the log row before sending. Returns the row, or null when the
  // database already holds this push or this slot of the day.
  async function claim({ userId, kind, item, decision, now }) {
    const fields = { status: 'sending', local_day: decision.localDay, slot: decision.slot, error: null, updated_at: iso(now) }
    const result = decision.retry
      ? await supabase.from('notification_log')
        .update({ ...fields, attempts: (decision.retry.attempts ?? 1) + 1 })
        .eq('id', decision.retry.id).eq('status', 'failed').select()
      : await supabase.from('notification_log').insert({
        user_id: userId,
        kind,
        dedupe_key: item.key,
        move_id: item.moveId ?? null,
        situation_id: item.situationId ?? null,
        attempts: 1,
        sent_at: null,
        created_at: iso(now),
        ...fields,
      }).select()
    if (result.error?.code === '23505') return null
    if (result.error) throw result.error
    return result.data[0] ?? null
  }

  // Sends to every device. A device Expo no longer knows is dropped. unknown:
  // no device took it and at least one send may still have reached a phone.
  async function deliver(userId, devices, message) {
    let delivered = 0
    let unknown = false
    let error = null
    for (const device of [...devices]) {
      let result
      try {
        result = await sender.send({ to: device.token, ...message })
      } catch {
        result = { ok: false, unknown: true, error: 'sender_threw' }
      }
      if (result?.ok) {
        delivered += 1
        continue
      }
      error = String(result?.error ?? 'unknown')
      if (result?.unknown !== false && !result?.invalidToken) unknown = true
      if (result?.invalidToken) {
        devices.splice(devices.indexOf(device), 1)
        try { await tokens.dropInvalid(userId, device.token) } catch (err) { log('token drop failed', err) }
      }
    }
    return { delivered, unknown, error }
  }

  async function forFounder({ userId, now, moves, quietSituations, summary }) {
    const [devices, profileRow, latest] = await Promise.all([
      tokens.forUser(userId),
      one(supabase.from('founder_profiles').select('timezone').eq('user_id', userId).maybeSingle()),
      one(supabase.from('situations').select('last_activity_at').eq('user_id', userId)
        .order('last_activity_at', { ascending: false }).limit(1)),
    ])
    if (devices.length === 0) return

    const timeZone = profileRow?.timezone || devices.find((d) => d.timezone)?.timezone || moves.find((m) => m.time_zone)?.time_zone || 'UTC'
    const activity = [latest[0]?.last_activity_at, ...moves.map((m) => m.committed_at)]
      .map((v) => Date.parse(v ?? '')).filter(Number.isFinite)
    const lastActivityAt = activity.length ? iso(Math.max(...activity)) : null
    // A stored "open" situation may already be reported or closed: ask the same
    // rule History uses, so a push never asks about something that is done.
    const named = quietSituations.filter((s) => typeof s.title === 'string' && s.title.trim())
    const states = await loadStates(supabase, userId, named)
    const quietSituation = named
      .filter((s) => statusOf(s, states.get(s.id), now) === 'open')
      .sort((a, b) => Date.parse(b.last_activity_at) - Date.parse(a.last_activity_at))[0] ?? null
    // Only what is due right now goes on; the morning push depends on the
    // founder's zone, so this cannot be filtered in the query.
    const pushes = duePushes({ now, timeZone, lastActivityAt, quietSituation, moves })
      .filter(({ item }) => now >= item.dueAt && now < item.expiresAt)
    if (pushes.length === 0) return

    if (await careOpen(userId)) {
      summary.paused_for_care += 1
      return
    }
    const learnOf = new Map(moves.map((m) => [m.id, m.learn_id]))
    const learnIds = [...new Set(moves.map((m) => m.learn_id).filter(Boolean))]
    const [settingsRow, logRows, conversations] = await Promise.all([
      one(supabase.from('user_settings').select('morning_on, evening_on, lock_screen, quiet_start, quiet_end').eq('user_id', userId).maybeSingle()),
      loadLog(userId, now),
      learnIds.length ? one(supabase.from('learn_conversations').select('id, move_subject').in('id', learnIds)) : [],
    ])
    const settings = reminderSettingsOf({ settingsRow })
    const subjectOf = new Map(conversations.map((c) => [c.id, c.move_subject]))
    for (const { item } of pushes) if (item.moveId) item.subject = subjectOf.get(learnOf.get(item.moveId)) ?? null

    const founder = { timeZone, hasDevice: true, lastActivityAt, settings }
    let logList = [...logRows]
    let name
    for (const { kind, item } of pushes) {
      if (devices.length === 0) return
      let row = null
      for (let tries = 0; tries < 2 && !row; tries += 1) {
        const decision = decidePush({ founder, now, log: logList, care: false, kind, item })
        if (!decision.send) break
        row = await claim({ userId, kind, item, decision, now })
        // Lost: the database holds a row this tick did not see. Decide again from it.
        if (!row) logList = await loadLog(userId, now)
      }
      if (!row) continue
      const at = logList.findIndex((r) => r.id === row.id)
      if (at >= 0) logList[at] = row
      else logList.push(row)

      if (name === undefined) {
        try { name = await nameOf(userId) } catch (err) { log('name lookup failed', err); name = null }
      }
      const message = composePush({ kind, item, name, lockScreen: settings.lock_screen })
      const { delivered, unknown, error } = await deliver(userId, devices, message)
      const outcome = delivered > 0 ? 'sent' : unknown ? 'unknown' : 'failed'
      // Unknown keeps status 'sending': it counts for the day and is never resent.
      const done = outcome === 'sent' ? { status: 'sent', sent_at: iso(clock.now()), error: null }
        : outcome === 'failed' ? { status: 'failed', error } : { error }
      Object.assign(row, done)
      summary[outcome] += 1
      try {
        await one(supabase.from('notification_log').update({ ...done, updated_at: iso(clock.now()) }).eq('id', row.id).select('id'))
      } catch (err) {
        // The row stays 'sending': it counts for today and is never resent.
        log('log update failed', err)
      }
    }
  }

  async function tick() {
    const now = clock.now()
    const summary = { sent: 0, failed: 0, unknown: 0, paused_for_care: 0, founders: 0 }
    const [moves, quiet, leaving] = await Promise.all([
      everyRow(() => supabase.from('moves').select('id, user_id, situation_id, learn_id, title, status, committed_at, report_due_at, closes_at, time_zone')
        .in('status', ACTIVE_STATUSES).gt('closes_at', iso(now))),
      everyRow(() => supabase.from('situations').select('id, user_id, title, status, last_activity_at')
        .eq('status', 'open').lte('last_activity_at', iso(now - QUIET_AFTER_MS)).gt('last_activity_at', iso(now - PAUSE_AFTER_MS))),
      // A founder who asked for deletion gets no more pushes.
      everyRow(() => supabase.from('account_requests').select('id, user_id').eq('kind', 'delete').eq('status', 'queued')),
    ])
    const deleting = new Set(leaving.map((r) => r.user_id))
    const byFounder = new Map()
    const of = (userId) => byFounder.get(userId) ?? byFounder.set(userId, { moves: [], quietSituations: [] }).get(userId)
    for (const m of moves) of(m.user_id).moves.push(m)
    for (const s of quiet) of(s.user_id).quietSituations.push(s)
    for (const [userId, rows] of byFounder) {
      if (deleting.has(userId)) continue
      summary.founders += 1
      try {
        await forFounder({ userId, now, ...rows, summary })
      } catch (err) {
        log('founder skipped', err)
      }
    }
    return summary
  }

  return { tick }
}

// Runs tick() every TICK_MS; a tick still running makes the next one wait.
export function startPushScheduler({ intervalMs = TICK_MS, log = defaultLog, ...deps }) {
  const scheduler = createPushScheduler({ ...deps, log })
  let running = false
  const run = async () => {
    if (running) return
    running = true
    try {
      await scheduler.tick()
    } catch (err) {
      log('tick failed', err)
    } finally {
      running = false
    }
  }
  const timer = setInterval(run, intervalMs)
  timer.unref?.()
  return { stop: () => clearInterval(timer), run }
}
