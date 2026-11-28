// How often the founder meets the same person, from calendar receipts (memory_evidence, source_key 'googlecalendar').
// Pure code from dates: no model. A receipt's created_at is the meeting's start, its snippet the event title.
import { cleanStoredText, isBlocked, INJECTION } from './beliefRules.js'

export const CALENDAR_KEY = 'googlecalendar'
const DAY = 86400000
const WINDOW_DAYS = 30
const MIN_MEETINGS = 3
const MAX_LINES = 3
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const cadence = (gapDays) => (gapDays <= 1.5 ? 'about every day' : gapDays <= 2.5 ? 'about every other day' : gapDays <= 4 ? 'a few times a week'
  : gapDays <= 10 ? 'about once a week' : 'about every two weeks')

// The first title minus the person's own name ("Kroots onboarding - Rafay x Hannes" -> "Kroots onboarding"); '' when nothing is left.
function topic(title, name) {
  const first = name.split(' ')[0].toLowerCase()
  const t = cleanStoredText(title).split(/\s[-:|]\s/).filter((p) => !p.toLowerCase().includes(first) && !/\sx\s/i.test(p)).join(' - ')
  return t.length > 40 || !t || isBlocked(t) || INJECTION.test(t) ? '' : t
}

// world: active founder_world rows; evidence: rows { item_id, snippet, created_at } -> { [worldId]: line } for people met >= 3 times in 30 days.
export function rhythmLines(world, evidence, nowMs) {
  const out = []
  for (const w of world.filter((r) => r.status === 'active' && r.kind === 'person')) {
    const mine = evidence.filter((e) => e.item_id === w.id).map((e) => ({ at: Date.parse(e.created_at), title: e.snippet })).sort((a, b) => a.at - b.at)
    const recent = mine.filter((m) => m.at <= nowMs && m.at > nowMs - WINDOW_DAYS * DAY)
    if (recent.length < MIN_MEETINGS) continue
    const gap = (recent.at(-1).at - recent[0].at) / DAY / (recent.length - 1)
    const d = new Date(mine[0].at)
    const what = topic(mine[0].title, w.name)
    out.push({ id: w.id, last: recent.at(-1).at, count: recent.length, line: `Meets ${w.name} ${cadence(gap)} since ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${what ? ` (${what})` : ''}.` })
  }
  return out.sort((a, b) => b.count - a.count || b.last - a.last).slice(0, MAX_LINES)
    .reduce((by, r) => ({ ...by, [r.id]: r.line }), {})
}
