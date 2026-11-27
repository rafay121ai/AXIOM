// Whether a push may go out now. Pure: no I/O, no clock of its own. Rules
// enforced here, not in any prompt:
// - at most 2 pushes per local day (LIMITS.MAX_PUSH_PER_DAY), counted from
//   notification_log; one morning slot (the move, or the quiet check that
//   replaces it) and one evening slot (the check-in, or its one reminder);
// - never while a care event is open, or when that is unknown;
// - quiet hours in the founder's time zone;
// - nothing after 14 days without activity (the situation is paused);
// - the founder's morning and evening switches;
// - only for something real: a move title, or a situation title, by id;
// - one reminder per move, only after its check-in push went out and while the
//   report is unanswered; after that, nothing (the move closes quietly);
// - a nudge (from the founder's own goal date or open thread) takes the
//   morning slot, and at most one every NUDGE_SPACING_MS;
// - never the same push twice (dedupe key), a send Expo clearly refused
//   retried at most MAX_ATTEMPTS times on the same log row.
import { LIMITS } from '../config.js'
import { localParts, localToUtc, validTimeZone } from '../journey/move/schedule.js'
import { normalizeReportTime } from '../writeValidation.js'

export const PUSH_KINDS = Object.freeze(['morning', 'quiet_check', 'evening', 'reminder', 'nudge'])
export const DAY_MS = 24 * 60 * 60 * 1000
export const PAUSE_AFTER_MS = 14 * DAY_MS
export const QUIET_AFTER_MS = 3 * DAY_MS
export const MORNING_TIME = '08:00'
export const MORNING_WINDOW_MS = 4 * 60 * 60 * 1000
export const MAX_ATTEMPTS = 3
export const NUDGE_SPACING_MS = 3 * DAY_MS
export const DEFAULT_QUIET_HOURS = Object.freeze({ start: '22:00', end: '06:00' })

// Log rows that hold a place in the day: a send in flight (it may have reached
// the phone) or a send that went out. A failed send does not count.
export const COUNTING_STATUSES = Object.freeze(['sending', 'sent'])

// The day's two places. notification_log keeps one counting row per founder,
// local day and slot (a partial unique index), so the cap holds in the database.
export const SLOT = Object.freeze({ morning: 'morning', quiet_check: 'morning', evening: 'evening', reminder: 'evening', nudge: 'morning' })
const SWITCH = Object.freeze({ morning: 'morning_on', quiet_check: 'morning_on', evening: 'evening_on', reminder: 'evening_on', nudge: 'morning_on' })
const MOVE_KINDS = new Set(['morning', 'evening', 'reminder'])

export const zoneOf = (zone) => (validTimeZone(zone) ? zone : 'UTC')
const pad = (n) => String(n).padStart(2, '0')

// 'YYYY-MM-DD' of `ms` in `zone`.
export function localDay(ms, zone) {
  const p = localParts(ms, zoneOf(zone))
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`
}

// The instant of 'HH:MM' on the local day of `ms` in `zone`.
export function localTimeOn(ms, zone, time) {
  const z = zoneOf(zone)
  const p = localParts(ms, z)
  const [h, mi] = time.split(':').map(Number)
  return localToUtc({ y: p.y, m: p.m, d: p.d, h, mi }, z)
}

// Whether the wall-clock time 'HH:MM' is inside quiet hours: start inclusive,
// end exclusive, may wrap past midnight.
export function isQuietTime(time, quiet = DEFAULT_QUIET_HOURS) {
  const start = normalizeReportTime(quiet?.start ?? '') ?? DEFAULT_QUIET_HOURS.start
  const end = normalizeReportTime(quiet?.end ?? '') ?? DEFAULT_QUIET_HOURS.end
  if (start === end) return false
  return start < end ? time >= start && time < end : time >= start || time < end
}

export function inQuietHours(ms, zone, quiet = DEFAULT_QUIET_HOURS) {
  const p = localParts(ms, zoneOf(zone))
  return isQuietTime(`${pad(p.h)}:${pad(p.mi)}`, quiet)
}

const text = (v) => typeof v === 'string' && v.trim().length > 0

// A push must name a real thing the founder has, by id.
function isReal(kind, item) {
  if (!item || !text(item.key)) return false
  if (MOVE_KINDS.has(kind)) return text(item.moveId) && text(item.title)
  if (kind === 'nudge') return ['goal', 'thread'].includes(item.nudge) && text(item.text)
  return text(item.situationId) && text(item.situationTitle)
}

// founder: { timeZone, hasDevice, lastActivityAt (ISO), settings: { morning_on,
//   evening_on, quiet_hours: { start, end } } }
// now: ms. log: this founder's notification_log rows (recent).
// care: false only when the care lookup answered "no open event".
// kind: one of PUSH_KINDS. item: { key, dueAt, expiresAt, moveId?, title?,
//   reported?, situationId?, situationTitle?, nudge? ('goal' | 'thread'), text? }
// Returns { send: true, localDay, slot, retry } (retry: the failed row to
// reuse, or null) or { send: false, reason }.
export function decidePush({ founder, now, log = [], care, kind, item }) {
  const no = (reason) => ({ send: false, reason })
  if (care !== false) return no('care')
  if (!PUSH_KINDS.includes(kind)) return no('unknown_kind')
  if (!founder?.hasDevice) return no('no_device')
  const zone = zoneOf(founder.timeZone)
  const settings = founder.settings ?? {}

  const last = Date.parse(founder.lastActivityAt ?? '')
  if (!Number.isFinite(last) || now - last >= PAUSE_AFTER_MS) return no('paused')
  if (settings[SWITCH[kind]] === false) return no('off')
  if (!isReal(kind, item)) return no('nothing_real')
  if (MOVE_KINDS.has(kind) && item.reported === true) return no('reported')
  if (!(now >= item.dueAt)) return no('not_due')
  if (!(now < item.expiresAt)) return no('expired')
  if (inQuietHours(now, zone, settings.quiet_hours)) return no('quiet_hours')

  const prior = log.find((r) => r.dedupe_key === item.key) ?? null
  if (prior && (prior.status !== 'failed' || (prior.attempts ?? 1) >= MAX_ATTEMPTS)) return no('already_sent')
  if (kind === 'nudge' && log.some((r) => r.kind === 'nudge' && COUNTING_STATUSES.includes(r.status) && now - Date.parse(r.created_at) < NUDGE_SPACING_MS)) {
    return no('nudge_spacing')
  }
  if (kind === 'reminder' && !log.some((r) => r.dedupe_key === `evening:${item.moveId}` && r.status === 'sent')) {
    return no('no_check_in_push')
  }

  const day = localDay(now, zone)
  // Signal rows (kind 'signal', their own slots) never hold back morning or evening.
  const today = log.filter((r) => r.local_day === day && COUNTING_STATUSES.includes(r.status) && SLOT[r.kind])
  if (today.length >= LIMITS.MAX_PUSH_PER_DAY) return no('cap')
  if (today.some((r) => SLOT[r.kind] === SLOT[kind])) return no('slot_used')
  return { send: true, localDay: day, slot: SLOT[kind], retry: prior }
}

// Signal pushes (S4). Their own places in the day, on top of morning and evening: signal_1..4, and
// extreme_1..2 for an extreme event. The database's (user_id, local_day, slot) index is the cap.
export const SIGNAL_SLOTS = Object.freeze(['signal_1', 'signal_2', 'signal_3', 'signal_4'])
export const EXTREME_SLOTS = Object.freeze(['extreme_1', 'extreme_2'])
export const SIGNAL_MAX_AGE_MS = 6 * 60 * 60 * 1000
export const EXTREME_WINDOW_MS = 3 * 60 * 60 * 1000

// item: { key, createdAt (ms), expiresAt (ms), extreme (bool, already proven), meetingStart (ms or null) }
// Returns { send: true, localDay, slots (free ones, in order), retry } or { send: false, reason }.
export function decideSignalPush({ founder, now, log = [], care, item }) {
  const no = (reason) => ({ send: false, reason })
  if (care !== false) return no('care')
  if (!founder?.hasDevice) return no('no_device')
  const last = Date.parse(founder.lastActivityAt ?? '')
  if (!Number.isFinite(last) || now - last >= PAUSE_AFTER_MS) return no('paused')
  if (!text(item?.key)) return no('nothing_real')
  // Stale: it stays a home item.
  if (!(now < item.expiresAt) || now - item.createdAt >= SIGNAL_MAX_AGE_MS) return no('expired')
  const zone = zoneOf(founder.timeZone)
  // Quiet hours hold, except an extreme event dated within the next 3 hours.
  const soon = item.extreme && item.meetingStart > now && item.meetingStart <= now + EXTREME_WINDOW_MS
  if (!soon && inQuietHours(now, zone, founder.settings?.quiet_hours)) return no('quiet_hours')

  const prior = log.find((r) => r.dedupe_key === item.key) ?? null
  if (prior && (prior.status !== 'failed' || (prior.attempts ?? 1) >= MAX_ATTEMPTS)) return no('already_sent')
  const day = localDay(now, zone)
  const taken = new Set(log.filter((r) => r.local_day === day && COUNTING_STATUSES.includes(r.status)).map((r) => r.slot))
  const slots = (item.extreme ? EXTREME_SLOTS : SIGNAL_SLOTS).filter((s) => !taken.has(s))
  if (slots.length === 0) return no('cap')
  return { send: true, localDay: day, slots, retry: prior }
}
