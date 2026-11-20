// The pushes a founder could get today, built only from real rows: their open
// moves and their quiet open situation. Pure: no I/O. Whether each one is sent
// is decided by policy.js.
// - morning: 8 am local, for a move committed before then whose check-in is
//   still ahead (no morning nudge after the check-in push).
// - quiet_check: replaces the morning push after 3 days with no activity,
//   naming the newest open situation. Once per quiet stretch.
// - evening: at the move's report_due_at (the founder's check-in time).
// - reminder: one, a day after the check-in time, or an hour before the move
//   closes if that is sooner. Nothing after it.
// - nudge: only when nothing else wants the morning. The sign-up goal date
//   exactly NUDGE_GOAL_DAYS ahead (local day), then open threads untouched for
//   NUDGE_THREAD_QUIET_MS, freshest first. One per goal date, one per thread per
//   quiet stretch (the key holds updated_at); policy.js spaces them out.
import { DAY_MS, MORNING_TIME, MORNING_WINDOW_MS, QUIET_AFTER_MS, localDay, localTimeOn, zoneOf } from './policy.js'

export const REMINDER_LEAD_MS = 60 * 60 * 1000
export const NUDGE_GOAL_DAYS = 7
export const NUDGE_THREAD_QUIET_MS = 7 * DAY_MS
// Threads never close on their own; past this they are not offered again, which keeps every tick small.
export const NUDGE_THREAD_MAX_QUIET_MS = 21 * DAY_MS

const ms = (iso) => Date.parse(iso ?? '')

// moves: this founder's active moves { id, situation_id, title, subject,
// committed_at, report_due_at, closes_at }. quietSituation: { id, title } or null.
// goal: { text, date: 'YYYY-MM-DD' } or null. threads: open { id, title, updated_at }.
export function duePushes({ now, timeZone, moves = [], quietSituation = null, lastActivityAt = null, goal = null, threads = [] }) {
  const zone = zoneOf(timeZone)
  const morningAt = localTimeOn(now, zone, MORNING_TIME)
  const morning = { dueAt: morningAt, expiresAt: morningAt + MORNING_WINDOW_MS }
  const moveFields = (m) => ({ moveId: m.id, situationId: m.situation_id, title: m.title, subject: m.subject ?? null, reported: false })
  const pushes = []

  const last = ms(lastActivityAt)
  if (quietSituation && Number.isFinite(last) && now - last >= QUIET_AFTER_MS) {
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

  if (pushes.length === 0) {
    const daysLeft = (Date.parse(`${goal?.date}T00:00:00Z`) - Date.parse(`${localDay(now, zone)}T00:00:00Z`)) / DAY_MS
    if (daysLeft === NUDGE_GOAL_DAYS && goal.text) {
      pushes.push({ kind: 'nudge', item: { key: `nudge:goal:${goal.date}`, ...morning, nudge: 'goal', text: goal.text } })
    }
    threads
      .filter((t) => now - ms(t.updated_at) >= NUDGE_THREAD_QUIET_MS && now - ms(t.updated_at) < NUDGE_THREAD_MAX_QUIET_MS)
      .sort((a, b) => ms(b.updated_at) - ms(a.updated_at))
      .forEach((t) => pushes.push({ kind: 'nudge', item: { key: `nudge:thread:${t.id}:${t.updated_at}`, ...morning, nudge: 'thread', text: t.title } }))
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
