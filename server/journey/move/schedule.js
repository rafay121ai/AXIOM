// When the evening report is due. Pure: no I/O. The founder's chosen check-in
// time (default 8 pm) in their time zone, the next one that leaves at least an
// hour to do the move, and never later than 48 hours after the commit.
import { normalizeReportTime } from '../../writeValidation.js'

export const DEFAULT_REPORT_TIME = '20:00'
export const MIN_LEAD_MS = 60 * 60 * 1000
export const REPORT_WINDOW_MS = 48 * 60 * 60 * 1000
const ZONE_MAX = 64

export function validTimeZone(zone) {
  if (typeof zone !== 'string' || !zone || zone.length > ZONE_MAX) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

// The wall-clock fields of `ms` in `zone`.
function localParts(ms, zone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(new Date(ms))
  const get = (type) => Number(parts.find((p) => p.type === type).value)
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour'), mi: get('minute'), s: get('second') }
}

// How far `zone` is ahead of UTC at the instant `ms`.
function offsetMs(zone, ms) {
  const p = localParts(ms, zone)
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000
}

// The UTC instant of a local wall-clock time. Checked twice so a daylight
// saving change between the guess and the answer is taken into account.
function localToUtc({ y, m, d, h, mi }, zone) {
  const wall = Date.UTC(y, m - 1, d, h, mi)
  let utc = wall - offsetMs(zone, wall)
  const second = offsetMs(zone, utc)
  if (wall - second !== utc) utc = wall - second
  return utc
}

// Returns { at (ms), local_time 'HH:MM', time_zone }.
export function reportDueAt({ nowMs, timeLocal = null, timeZone = null }) {
  const zone = validTimeZone(timeZone) ? timeZone : 'UTC'
  const time = normalizeReportTime(timeLocal ?? '') ?? DEFAULT_REPORT_TIME
  const [h, mi] = time.split(':').map(Number)
  const today = localParts(nowMs, zone)
  const latest = nowMs + REPORT_WINDOW_MS
  for (let day = 0; day <= 2; day += 1) {
    const at = localToUtc({ y: today.y, m: today.m, d: today.d + day, h, mi }, zone)
    if (at - nowMs >= MIN_LEAD_MS) return { at: Math.min(at, latest), local_time: time, time_zone: zone }
  }
  return { at: latest, local_time: time, time_zone: zone }
}
