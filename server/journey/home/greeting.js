// The home greeting. Pure: no I/O, no model call. The line is picked from the
// approved set by the founder's local time of day and time zone, and is never
// the same as the last one shown. Which of the others is picked changes by day.
import { localParts, validTimeZone } from '../move/schedule.js'
import { GREETINGS } from './wording.js'

const DAY_MS = 24 * 60 * 60 * 1000

export function contextOf({ hour, weekday }) {
  const weekend = weekday === 'Saturday' || weekday === 'Sunday'
  if (weekend && hour >= 7 && hour < 22) return 'weekend'
  if (hour >= 4 && hour < 7) return 'early'
  if (hour >= 7 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 17) return 'midday'
  if (hour >= 17 && hour < 22) return 'evening'
  return 'late'
}

// "your first 10 customers" from "My first 10 customers". Null when the goal
// does not start with "My", because then it cannot be put in the sentence.
export function goalPhrase(goal) {
  const m = /^my\s+(.{3,80})$/i.exec(String(goal ?? '').trim().replace(/[.!\s]+$/, ''))
  return m ? `your ${m[1]}` : null
}

// Whole days from now to the deadline (a 'YYYY-MM-DD' date); null when past or unset.
export function daysTo(deadline, nowMs) {
  const end = Date.parse(`${deadline ?? ''}T23:59:59Z`)
  if (!Number.isFinite(end) || end <= nowMs) return null
  return Math.ceil((end - nowMs) / DAY_MS)
}

// Fills every {placeholder} in one pass, so text put in (a name, a goal) is
// never read as a placeholder itself. With no name, ", {name}" is dropped.
export const fillGreeting = (text, vars) => text.replace(/(, )?\{(\w+)\}/g, (_, comma = '', k) => {
  const value = vars[k]
  return value === null || value === undefined || value === '' ? (k === 'name' ? '' : comma) : `${comma}${value}`
})

// Returns { id, kind, text }. lastId: the id of the greeting shown last time.
export function pickGreeting({ nowMs, timeZone = null, name = null, goal = null, deadline = null, lastId = null }) {
  const zone = validTimeZone(timeZone) ? timeZone : 'UTC'
  const { h } = localParts(nowMs, zone)
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'long' }).format(new Date(nowMs))
  const kind = contextOf({ hour: h, weekday })
  const phrase = goalPhrase(goal)
  const days = daysTo(deadline, nowMs)
  const vars = { name, hour: h % 12 === 0 ? 12 : h % 12, day: weekday, goal: phrase, days }

  // The weekend line may be the only one; the time of day lines are its other choice.
  const hourKind = contextOf({ hour: h, weekday: 'Monday' })
  const pool = [...GREETINGS[kind], ...(kind === 'weekend' ? GREETINGS[hourKind] : [])]
    .filter((g) => g.needs !== 'goal' || (phrase && days > 1))
  const fresh = pool.filter((g) => g.id !== lastId)
  const options = fresh.length ? fresh : pool
  const chosen = options[Math.floor(nowMs / DAY_MS) % options.length]
  return { id: chosen.id, kind, text: fillGreeting(chosen.text, vars) }
}
