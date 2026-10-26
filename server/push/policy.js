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
// - never the same push twice (dedupe key), a failed send retried at most
//   MAX_ATTEMPTS times on the same log row.
import { LIMITS } from '../config.js'
import { localParts, localToUtc, validTimeZone } from '../journey/move/schedule.js'
import { normalizeReportTime } from '../writeValidation.js'

export const PUSH_KINDS = Object.freeze(['morning', 'quiet_check', 'evening', 'reminder'])
export const DAY_MS = 24 * 60 * 60 * 1000
export const PAUSE_AFTER_MS = 14 * DAY_MS
export const QUIET_AFTER_MS = 3 * DAY_MS
export const MORNING_TIME = '08:00'
export const MORNING_WINDOW_MS = 4 * 60 * 60 * 1000
export const MAX_ATTEMPTS = 3
export const DEFAULT_QUIET_HOURS = Object.freeze({ start: '22:00', end: '06:00' })

// Log rows that hold a place in the day: a send in flight (it may have reached
// the phone) or a send that went out. A failed send does not count.
export const COUNTING_STATUSES = Object.freeze(['sending', 'sent'])

const SLOT = Object.freeze({ morning: 'morning', quiet_check: 'morning', evening: 'evening', reminder: 'evening' })
const SWITCH = Object.freeze({ morning: 'morning_on', quiet_check: 'morning_on', evening: 'evening_on', reminder: 'evening_on' })
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
  return text(item.situationId) && text(item.situationTitle)
}

// founder: { timeZone, hasDevice, lastActivityAt (ISO), settings: { morning_on,
//   evening_on, quiet_hours: { start, end } } }
// now: ms. log: this founder's notification_log rows (recent).
// care: false only when the care lookup answered "no open event".
// kind: one of PUSH_KINDS. item: { key, dueAt, expiresAt, moveId?, title?,
//   reported?, situationId?, situationTitle? }
// Returns { send: true, localDay, retry } (retry: the failed row to reuse, or
// null) or { send: false, reason }.
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
  if (kind === 'reminder' && !log.some((r) => r.dedupe_key === `evening:${item.moveId}` && r.status === 'sent')) {
    return no('no_check_in_push')
  }

  const day = localDay(now, zone)
  const today = log.filter((r) => r.local_day === day && COUNTING_STATUSES.includes(r.status))
  if (today.length >= LIMITS.MAX_PUSH_PER_DAY) return no('cap')
  if (today.some((r) => SLOT[r.kind] === SLOT[kind])) return no('slot_used')
  return { send: true, localDay: day, retry: prior }
}
