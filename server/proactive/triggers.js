// What makes Axiom speak first. Pure: no I/O. Each trigger returns
// { source, key, kind, facts } or null. `source` names where the facts came
// from ('signup', 'reports'; later connectors). `key` is unique per fact, so
// each trigger fires once per founder (the database keeps it unique).
import { goalPhrase } from '../journey/home/greeting.js'
import { day } from '../journey/home/accountService.js'
import { localDay, zoneOf } from '../push/policy.js'

const DAY_MS = 24 * 60 * 60 * 1000

// goal: the founder's goal words (signup_answers.goal.goal). deadline: 'YYYY-MM-DD'.
// Days are counted on the founder's local calendar day; nothing once it has passed.
export function goalNear({ nowMs, timeZone, deadline, goal }) {
  const words = String(goal ?? '').trim().replace(/[.!\s]+$/, '')
  const end = Date.parse(`${deadline ?? ''}T00:00:00Z`)
  if (!words || !Number.isFinite(end)) return null
  const days = Math.round((end - Date.parse(`${localDay(nowMs, zoneOf(timeZone))}T00:00:00Z`)) / DAY_MS)
  const window = days >= 1 && days <= 3 ? 3 : days > 3 && days <= 14 ? 14 : null
  if (!window) return null
  return {
    source: 'signup',
    key: `goal:${deadline}:${window}`,
    kind: 'goal_near',
    facts: { goalWords: words, goal: goalPhrase(words) ?? words, date: day(`${deadline}T00:00:00Z`), days, window },
  }
}

// Misses older than this are not raised: a stale pair is history, not today's problem.
export const MISSES_FRESH_MS = 7 * DAY_MS

// reports: [{ id, outcome, created_at, move_title }]. The last two by created_at; the last within a week.
export function twoMisses({ nowMs, reports = [] }) {
  const [last, before] = [...reports].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
  const missed = (r) => r && (r.outcome === 'couldnt' || r.outcome === 'didnt') && String(r.move_title ?? '').trim()
  if (!missed(last) || !missed(before)) return null
  if (!(nowMs - Date.parse(last.created_at) <= MISSES_FRESH_MS)) return null
  return { source: 'reports', key: `misses:${last.id}`, kind: 'two_misses', facts: { moves: [before.move_title, last.move_title] } }
}

// Every trigger that fires now, most important first: goal in 3 days, two
// misses, goal in 14 days.
export function firedTriggers(input) {
  const goal = goalNear(input)
  const misses = twoMisses(input)
  return [goal?.facts.window === 3 ? goal : null, misses, goal?.facts.window === 14 ? goal : null].filter(Boolean)
}
