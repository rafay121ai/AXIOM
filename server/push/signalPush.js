// S4: signal pushes, run from the push scheduler's tick when SIGNAL_PUSH=on and CONNECTORS=on.
// Same guarantees as the scheduled pushes: the log row (kind 'signal', slot signal_1..4 or extreme_1..2) is written
// BEFORE the send, a 23505 means the slot or the push is taken, an unknown send is never resent, a refused send is
// retried at most MAX_ATTEMPTS times. A signal not sent before it goes stale stays a home item. No signal text is logged.
import { createMemoryStore } from '../journey/memory/memoryStore.js'
import { norm, wordRx } from '../journey/ownWords.js'
import { composeSignalPush } from './compose.js'
import { decideSignalPush, EXTREME_WINDOW_MS, PAUSE_AFTER_MS, SIGNAL_MAX_AGE_MS } from './policy.js'
import { reminderSettingsOf } from './settings.js'

const URGENCY_ORDER = (a, b) => b.urgency - a.urgency || Date.parse(a.created_at) - Date.parse(b.created_at)

// The four extreme conditions beyond "verified" (a signal row exists only after the verifier passed), all in code.
async function isExtreme({ supabase, memory, signal, now }) {
  if (signal.urgency !== 3) return false
  const f = signal.facts ?? {}
  const said = norm(`${f.what_happened ?? ''} ${f.source_name ?? ''}`)
  const names = (await memory.activeWorld(signal.user_id)).map((w) => w.name).filter(Boolean)
  const named = names.some((n) => wordRx(norm(n)).test(said))
  if (signal.toolkit === 'googlecalendar') {
    const start = Date.parse(f.meeting_start)
    if (!(start > now && start <= now + EXTREME_WINDOW_MS)) return false
    if (named) return true
    if (!signal.situation_id) return false
    const { data, error } = await supabase.from('situations').select('id').eq('user_id', signal.user_id).eq('id', signal.situation_id).eq('status', 'open')
    if (error) throw error
    return data.length > 0
  }
  // A reply from a known person: a known name in the line.
  return signal.toolkit === 'gmail' && named
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
      const [profile, latest, settingsRow, logRows] = await Promise.all([
        one(supabase.from('founder_profiles').select('timezone').eq('user_id', userId).maybeSingle()),
        one(supabase.from('situations').select('last_activity_at').eq('user_id', userId).order('last_activity_at', { ascending: false }).limit(1)),
        one(supabase.from('user_settings').select('lock_screen, quiet_start, quiet_end').eq('user_id', userId).maybeSingle()),
        loadLog(userId, now),
      ])
      const settings = reminderSettingsOf({ settingsRow })
      const lastMs = Date.parse(latest[0]?.last_activity_at ?? '')
      const founder = { timeZone: profile?.timezone || devices.find((d) => d.timezone)?.timezone || 'UTC', hasDevice: true, settings, lastActivityAt: Number.isFinite(lastMs) && now - lastMs < PAUSE_AFTER_MS ? iso(lastMs) : null }
      let logList = [...logRows]
      let name

      for (const signal of signals.sort(URGENCY_ORDER)) {
        if (devices.length === 0) break
        const extreme = await isExtreme({ supabase, memory, signal, now })
        const item = {
          key: `signal:${signal.id}`, signalId: signal.id, toolkit: signal.toolkit, situationId: signal.situation_id,
          createdAt: Date.parse(signal.created_at), expiresAt: Date.parse(signal.expires_at), extreme,
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
        // 'full' still gets the short line: email content on a lock screen is a leak.
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
