// S4: signal pushes, run from the push scheduler's tick when SIGNAL_PUSH=on and CONNECTORS=on.
// Same guarantees as the scheduled pushes: the log row (kind 'signal', slot signal_1..4 or extreme_1..2) is written
// BEFORE the send, a 23505 means the slot or the push is taken, an unknown send is never resent, a refused send is
// retried at most MAX_ATTEMPTS times. A signal not sent before it goes stale stays a home item. No signal text is logged.
import { createMemoryStore } from '../journey/memory/memoryStore.js'
import { norm, wordRx } from '../journey/ownWords.js'
import { composeSignalPush } from './compose.js'
import { ACTIVE_STATUSES } from '../journey/move/room.js'
import { decideSignalPush, EXTREME_WINDOW_MS, EXTREME_SLOTS, inQuietHours, localDay, PAUSE_AFTER_MS, SIGNAL_MAX_AGE_MS, SIGNAL_SLOTS, COUNTING_STATUSES } from './policy.js'
import { reminderSettingsOf } from './settings.js'

const URGENCY_ORDER = (a, b) => b.urgency - a.urgency || Date.parse(a.created_at) - Date.parse(b.created_at)

// Extreme, from stored facts only (never the model's words): urgency 3 (the verifier already passed, a row exists only then),
// and the founder's own part in it: an accepted or organized meeting within 3 hours, or an email in a thread they replied in,
// and it names something in their world (a founder_world name, or for a meeting an open linked situation).
export function isExtreme(signal, { names, openSituations }, now) {
  if (signal.urgency !== 3) return false
  const f = signal.facts ?? {}
  const said = norm(`${f.what_happened ?? ''} ${f.source_name ?? ''}`)
  const named = names.some((n) => wordRx(norm(n)).test(said))
  if (signal.toolkit === 'googlecalendar') {
    const start = Date.parse(f.meeting_start)
    return f.accepted === true && start > now && start <= now + EXTREME_WINDOW_MS && (named || (!!signal.situation_id && openSituations.has(signal.situation_id)))
  }
  return signal.toolkit === 'gmail' && f.replied_thread === true && named
}

export async function runSignalPushes({ supabase, tokens, now, iso, everyRow, one, deleting, careOpen, loadLog, claim, deliver, nameOf, clock, log, summary }) {
  const rows = await everyRow(() => supabase.from('signals').select('id, user_id, toolkit, facts, urgency, situation_id, created_at, expires_at')
    .eq('status', 'new').gte('urgency', 2).gt('expires_at', iso(now)).gte('created_at', iso(now - SIGNAL_MAX_AGE_MS)))
  const byUser = new Map()
  for (const r of rows) if (!deleting.has(r.user_id) && r.facts?.what_happened) (byUser.get(r.user_id) ?? byUser.set(r.user_id, []).get(r.user_id)).push(r)
  const memory = createMemoryStore({ supabase })

  for (const [userId, signals] of byUser) {
    try {
      const devices = await tokens.forUser(userId)
      if (devices.length === 0) continue
      if (await careOpen(userId)) { summary.paused_for_care += 1; continue }
      const [profile, latest, activeMoves, settingsRow, logRows] = await Promise.all([
        one(supabase.from('founder_profiles').select('timezone').eq('user_id', userId).maybeSingle()),
        one(supabase.from('situations').select('last_activity_at').eq('user_id', userId).order('last_activity_at', { ascending: false }).limit(1)),
        one(supabase.from('moves').select('committed_at, time_zone').eq('user_id', userId).in('status', ACTIVE_STATUSES).gt('closes_at', iso(now))),
        one(supabase.from('user_settings').select('lock_screen, quiet_start, quiet_end').eq('user_id', userId).maybeSingle()),
        loadLog(userId, now),
      ])
      const settings = reminderSettingsOf({ settingsRow })
      // Same activity and time zone rule as the scheduled pushes (scheduler.js forFounder).
      const timeZone = profile?.timezone || devices.find((d) => d.timezone)?.timezone || activeMoves.find((m) => m.time_zone)?.time_zone || 'UTC'
      const activity = [latest[0]?.last_activity_at, ...activeMoves.map((m) => m.committed_at)].map((v) => Date.parse(v ?? '')).filter(Number.isFinite)
      const founder = { timeZone, hasDevice: true, settings, lastActivityAt: activity.length ? iso(Math.max(...activity)) : null }
      let logList = [...logRows]
      let name

      // Skip early when nothing can go: all places taken, or quiet hours with no urgency 3 candidate.
      const free = (slots) => { const day = localDay(now, timeZone); return slots.some((x) => !logList.some((r) => r.local_day === day && COUNTING_STATUSES.includes(r.status) && r.slot === x)) }
      const quiet = inQuietHours(now, timeZone, settings.quiet_hours)
      const live = signals.filter((x) => (free(SIGNAL_SLOTS) && !quiet) || (x.urgency === 3 && free(EXTREME_SLOTS)))
      if (live.length === 0) continue
      // The founder's world and open situations, read once, and only if an urgency 3 signal needs them.
      let context = null
      const contextOf = async () => context ??= {
        names: (await memory.activeWorld(userId)).map((w) => w.name).filter(Boolean),
        openSituations: new Set((await one(supabase.from('situations').select('id').eq('user_id', userId).eq('status', 'open'))).map((x) => x.id)),
      }

      for (const signal of live.sort(URGENCY_ORDER)) {
        if (devices.length === 0) break
        const extreme = signal.urgency === 3 && isExtreme(signal, await contextOf(), now)
        const item = {
          key: `signal:${signal.id}`, signalId: signal.id, toolkit: signal.toolkit, situationId: signal.situation_id,
          createdAt: Date.parse(signal.created_at), expiresAt: Date.parse(signal.expires_at), extreme, pushLine: signal.facts.push_line ?? null,
          meetingStart: signal.toolkit === 'googlecalendar' ? Date.parse(signal.facts.meeting_start) : null,
        }
        let row = null
        let slot = null
        for (let tries = 0; tries < 6 && !row; tries += 1) {
          const decision = decideSignalPush({ founder, now, log: logList, care: false, item })
          if (!decision.send) break
          slot = decision.slots[0]
          row = await claim({ userId, kind: 'signal', item, decision: { ...decision, slot }, now })
          // 23505: the slot or the push is taken in the database. Decide again from what is really there.
          if (!row) logList = await loadLog(userId, now)
        }
        if (!row) continue
        const at = logList.findIndex((r) => r.id === row.id)
        if (at >= 0) logList[at] = row
        else logList.push(row)

        if (name === undefined) {
          try { name = await nameOf(userId) } catch (err) { log('name lookup failed', err); name = null }
        }
        const message = composeSignalPush({ item, name, lockScreen: settings.lock_screen, now })
        const { delivered, unknown, error } = await deliver(userId, devices, message)
        const outcome = delivered > 0 ? 'sent' : unknown ? 'unknown' : 'failed'
        const done = outcome === 'sent' ? { status: 'sent', sent_at: iso(clock.now()), error: null }
          : outcome === 'failed' ? { status: 'failed', error } : { error }
        Object.assign(row, done)
        summary[outcome] += 1
        try {
          await one(supabase.from('notification_log').update({ ...done, updated_at: iso(clock.now()) }).eq('id', row.id).select('id'))
          if (outcome === 'sent') await one(supabase.from('signals').update({ status: 'pushed', updated_at: iso(clock.now()) }).eq('id', signal.id).eq('status', 'new').select('id'))
        } catch (err) {
          log('log update failed', err) // the row stays 'sending': it counts and is never resent
        }
      }
    } catch (err) {
      log('signal founder skipped', err)
    }
  }
}
