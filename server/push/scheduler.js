// The push scheduler. tick() finds the founders with something real due (an
// open move, or an open situation gone quiet), asks decidePush for each
// possible push, and sends the ones it allows. Everything is injected (clock,
// supabase, sender, isCareOpen), so tests run it with fakes. Started only from
// index.js, never from createApp.
//
// No double send, across ticks and restarts:
// - a notification_log row (status 'sending', unique per founder and dedupe
//   key) is written BEFORE anything is sent; a second tick or process that
//   loses that insert sends nothing;
// - a row left 'sending' (a crash mid-send) counts towards the day and is never
//   sent again: at most once, never twice;
// - a failed send marks the row 'failed' (it does not count towards the cap)
//   and is retried on the same row, at most MAX_ATTEMPTS times.
// Never sends while a care event is open or the care lookup fails.
import { ACTIVE_STATUSES } from '../journey/move/room.js'
import { firstNameOf } from '../journey/learn/learnRoutes.js'
import { decidePush, PAUSE_AFTER_MS, QUIET_AFTER_MS } from './policy.js'
import { duePushes } from './due.js'
import { composePush } from './compose.js'
import { reminderSettingsOf } from './settings.js'
import { createPushTokens } from './tokens.js'

export const TICK_MS = 60 * 1000
const LOG_LOOKBACK_MS = PAUSE_AFTER_MS + 24 * 60 * 60 * 1000

const defaultLog = (what, detail) => console.error(`[Push] ${what}`, detail?.message || detail || '')

// The founder's first name from their account, for the push text.
export function createNameLookup(supabase) {
  return async (userId) => {
    const { data, error } = await supabase.auth.admin.getUserById(userId)
    return error ? null : firstNameOf(data?.user)
  }
}

export function createPushScheduler({ supabase, sender, clock, isCareOpen, nameOf = async () => null, log = defaultLog }) {
  if (typeof isCareOpen !== 'function') throw new Error('isCareOpen is required: pushes pause while care is open')
  const tokens = createPushTokens({ supabase, clock })
  const iso = (ms) => new Date(ms).toISOString()
  const one = async (query) => {
    const { data, error } = await query
    if (error) throw error
    return data
  }

  async function careOpen(userId) {
    try {
      return (await isCareOpen(userId)) !== false
    } catch (err) {
      log('care check failed', err)
      return true
    }
  }

  // Writes the log row before sending. Returns the row, or null when another
  // tick already holds it.
  async function claim({ userId, kind, item, decision, now }) {
    const fields = { status: 'sending', local_day: decision.localDay, error: null, updated_at: iso(now) }
    if (decision.retry) {
      const rows = await one(supabase.from('notification_log')
        .update({ ...fields, attempts: (decision.retry.attempts ?? 1) + 1 })
        .eq('id', decision.retry.id).eq('status', 'failed').select())
      return rows[0] ?? null
    }
    const inserted = await supabase.from('notification_log').insert({
      user_id: userId,
      kind,
      dedupe_key: item.key,
      move_id: item.moveId ?? null,
      situation_id: item.situationId ?? null,
      attempts: 1,
      sent_at: null,
      created_at: iso(now),
      ...fields,
    }).select().single()
    if (inserted.error?.code === '23505') return null
    if (inserted.error) throw inserted.error
    return inserted.data
  }

  // Sends to every device. A device Expo no longer knows is dropped.
  async function deliver(userId, devices, message) {
    let delivered = 0
    let error = null
    for (const device of [...devices]) {
      let result
      try {
        result = await sender.send({ to: device.token, ...message })
      } catch (err) {
        result = { ok: false, error: err?.message || 'sender failed' }
      }
      if (result?.ok) {
        delivered += 1
        continue
      }
      error = String(result?.error ?? 'unknown')
      if (result?.invalidToken) {
        devices.splice(devices.indexOf(device), 1)
        try { await tokens.dropInvalid(userId, device.token) } catch (err) { log('token drop failed', err) }
      }
    }
    return { delivered, error }
  }

  async function forFounder({ userId, now, moves, quietSituations, summary }) {
    const devices = await tokens.forUser(userId)
    if (devices.length === 0) return
    const care = await careOpen(userId)
    if (care) {
      summary.paused_for_care += 1
      return
    }
    const learnIds = [...new Set(moves.map((m) => m.learn_id).filter(Boolean))]
    const [settingsRow, profileRow, latest, logRows, conversations] = await Promise.all([
      one(supabase.from('user_settings').select('morning_on, evening_on, lock_screen, quiet_start, quiet_end').eq('user_id', userId).maybeSingle()),
      one(supabase.from('founder_profiles').select('timezone').eq('user_id', userId).maybeSingle()),
      one(supabase.from('situations').select('last_activity_at').eq('user_id', userId)
        .order('last_activity_at', { ascending: false }).limit(1)),
      one(supabase.from('notification_log').select().eq('user_id', userId).gte('created_at', iso(now - LOG_LOOKBACK_MS))),
      learnIds.length ? one(supabase.from('learn_conversations').select('id, move_subject').in('id', learnIds)) : [],
    ])

    const settings = reminderSettingsOf({ settingsRow })
    const timeZone = profileRow?.timezone || devices.find((d) => d.timezone)?.timezone || moves.find((m) => m.time_zone)?.time_zone || 'UTC'
    const activity = [latest[0]?.last_activity_at, ...moves.map((m) => m.committed_at)]
      .map((v) => Date.parse(v ?? '')).filter(Number.isFinite)
    const lastActivityAt = activity.length ? iso(Math.max(...activity)) : null
    const subjectOf = new Map(conversations.map((c) => [c.id, c.move_subject]))
    const quietSituation = quietSituations
      .filter((s) => typeof s.title === 'string' && s.title.trim())
      .sort((a, b) => Date.parse(b.last_activity_at) - Date.parse(a.last_activity_at))[0] ?? null

    const founder = { timeZone, hasDevice: true, lastActivityAt, settings }
    const pushes = duePushes({
      now, timeZone, lastActivityAt, quietSituation,
      moves: moves.map((m) => ({ ...m, subject: subjectOf.get(m.learn_id) ?? null })),
    })
    const logList = [...logRows]
    let name
    for (const { kind, item } of pushes) {
      if (devices.length === 0) return
      const decision = decidePush({ founder, now, log: logList, care, kind, item })
      if (!decision.send) continue
      const row = await claim({ userId, kind, item, decision, now })
      if (!row) continue
      const at = logList.findIndex((r) => r.id === row.id)
      if (at >= 0) logList[at] = row
      else logList.push(row)

      if (name === undefined) {
        try { name = await nameOf(userId) } catch (err) { log('name lookup failed', err); name = null }
      }
      const message = composePush({ kind, item, name, lockScreen: settings.lock_screen })
      const { delivered, error } = await deliver(userId, devices, message)
      const done = delivered > 0
        ? { status: 'sent', sent_at: iso(clock.now()), error: null }
        : { status: 'failed', error }
      Object.assign(row, done)
      summary[done.status] += 1
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
    const summary = { sent: 0, failed: 0, paused_for_care: 0, founders: 0 }
    const [moves, quiet] = await Promise.all([
      one(supabase.from('moves').select('id, user_id, situation_id, learn_id, title, status, committed_at, report_due_at, closes_at, time_zone')
        .in('status', ACTIVE_STATUSES).gt('closes_at', iso(now))),
      one(supabase.from('situations').select('id, user_id, title, status, last_activity_at')
        .eq('status', 'open').lte('last_activity_at', iso(now - QUIET_AFTER_MS)).gt('last_activity_at', iso(now - PAUSE_AFTER_MS))),
    ])
    const userIds = [...new Set([...moves, ...quiet].map((r) => r.user_id))]
    for (const userId of userIds) {
      summary.founders += 1
      try {
        await forFounder({
          userId,
          now,
          moves: moves.filter((m) => m.user_id === userId),
          quietSituations: quiet.filter((s) => s.user_id === userId),
          summary,
        })
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
