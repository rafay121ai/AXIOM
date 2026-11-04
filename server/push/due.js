// The pushes a founder could get today, built only from real rows: their open
// moves and their quiet open situation. Pure: no I/O. Whether each one is sent
// is decided by policy.js.
// - morning: 8 am local, for a move committed before then whose check-in is
//   still ahead (no morning nudge after the check-in push).
// - quiet_check: replaces the morning push after 3 days with no activity,
//   naming the newest open situation. Once per quiet stretch.
// - proactive: Axiom's opener of today (founder-local), in the morning slot.
//   It replaces the morning and quiet_check pushes; if the slot has passed
//   there is no push at all.
// - evening: at the move's report_due_at (the founder's check-in time).
// - reminder: one, a day after the check-in time, or an hour before the move
//   closes if that is sooner. Nothing after it.
import { DAY_MS, MORNING_TIME, MORNING_WINDOW_MS, QUIET_AFTER_MS, localDay, localTimeOn, zoneOf } from './policy.js'

export const REMINDER_LEAD_MS = 60 * 60 * 1000

const ms = (iso) => Date.parse(iso ?? '')

// moves: this founder's active moves { id, situation_id, title, subject,
// committed_at, report_due_at, closes_at }. quietSituation: { id, title } or null.
// opener: { id, title, text, trigger } for an unanswered opener made today, or null.
export function duePushes({ now, timeZone, moves = [], quietSituation = null, lastActivityAt = null, opener = null }) {
  const zone = zoneOf(timeZone)
  const morningAt = localTimeOn(now, zone, MORNING_TIME)
  const morning = { dueAt: morningAt, expiresAt: morningAt + MORNING_WINDOW_MS }
  const moveFields = (m) => ({ moveId: m.id, situationId: m.situation_id, title: m.title, subject: m.subject ?? null, reported: false })
  const pushes = []

  const last = ms(lastActivityAt)
  if (opener) {
    pushes.push({
      kind: 'proactive',
      item: { key: `proactive:${opener.id}`, ...morning, situationId: opener.id, situationTitle: opener.title, opener: opener.text, trigger: opener.trigger },
    })
  } else if (quietSituation && Number.isFinite(last) && now - last >= QUIET_AFTER_MS) {
    pushes.push({
      kind: 'quiet_check',
      item: { key: `quiet:${quietSituation.id}:${lastActivityAt}`, ...morning, situationId: quietSituation.id, situationTitle: quietSituation.title },
    })
  } else {
    const today = moves
      .filter((m) => ms(m.committed_at) < morningAt && ms(m.report_due_at) > now)
      .sort((a, b) => ms(a.report_due_at) - ms(b.report_due_at))[0]
    if (today) pushes.push({ kind: 'morning', item: { key: `morning:${localDay(now, zone)}`, ...morning, ...moveFields(today) } })
  }

  for (const m of moves) {
    const due = ms(m.report_due_at)
    const closes = ms(m.closes_at)
    if (!Number.isFinite(due) || !Number.isFinite(closes)) continue
    pushes.push({ kind: 'evening', item: { key: `evening:${m.id}`, dueAt: due, expiresAt: closes, ...moveFields(m) } })
    const remindAt = Math.min(due + DAY_MS, closes - REMINDER_LEAD_MS)
    if (remindAt > due) {
      pushes.push({ kind: 'reminder', item: { key: `reminder:${m.id}`, dueAt: remindAt, expiresAt: closes, ...moveFields(m) } })
    }
  }
  return pushes.sort((a, b) => a.item.dueAt - b.item.dueAt)
}
