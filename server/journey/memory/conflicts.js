// A founder who says a different number from one they said before gets a notice in the prompt, and the answer must
// name both (Rafay, Nov 19: a prompt rule alone was ignored, and the memory pass erased the old number). Pure: no
// model, no I/O. No guessing: with no shared unit, or an unclear unit, there is no conflict.
import { norm } from '../ownWords.js'
import { WORD_NUMBERS, numbersIn } from '../learn/pictures.js'

const WORDS = Object.keys(WORD_NUMBERS).filter((w) => WORD_NUMBERS[w] >= 1 && WORD_NUMBERS[w] <= 100 && Number.isInteger(WORD_NUMBERS[w]) && !['hundred', 'once', 'twice', 'dozen'].includes(w))
const NUMBER = new RegExp(`(\\$)?(\\d[\\d,]*(?:\\.\\d+)?)(?:\\s?(k|m)(?![A-Za-z]))?(%)?|\\b(${WORDS.join('|')})\\b`, 'gi')
const SKIP = new Set(['a', 'an', 'the', 'of', 'per', 'more', 'new', 'about', 'or', 'to', 'and'])
const UNITS = new Set(['hour', 'day', 'week', 'month', 'year', 'customer', 'client', 'order', 'user', 'people', 'employee', 'product', 'sale', 'lead', 'visit', 'call', 'minute'])
export const unitOf = (w) => (w ? w.toLowerCase().replace(/[^a-z]/g, '').replace(/^hrs?$/, 'hour').replace(/s$/, '') : null) || null

// A number inside a wish, a target or something that happened once is not a statement of how things are (Rafay, Nov 19: "3 hours
// yesterday" is not a change from "under 15 hours a week"). The whole clause is ignored.
const MONTH = 'jan\\w*|feb\\w*|mar\\w*|apr\\w*|may|jun\\w*|jul\\w*|aug\\w*|sep\\w*|oct\\w*|nov\\w*|dec\\w*'
const NOT_A_STATE = new RegExp(`\\b(?:need|needs|needed|want|wants|wanted|hope|hopes|hoping|aim|aims|aiming|target|targets|goal|goals|yesterday|spent|was|were|ago|last (?:week|month|year|night)|by (?:the |next |this |end of |tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|${MONTH}|\\d))`, 'i')
const PERIOD = /\b(?:a|per|each|every)\s+(day|week|month)\b|\/\s*(day|week|month)\b|\b(daily|weekly|monthly)\b/i
const BOUNDARY = /[,;!?\n]|\.(?!\d)|\s(?:and|but|so|because|which|while)\s/gi
const periodOf = (word) => (word ? ({ daily: 'day', weekly: 'week', monthly: 'month' }[word.toLowerCase()] ?? word.toLowerCase()) : null)

// The clause of `text` around `at`.
function clauseAround(text, at) {
  let start = 0
  let end = text.length
  for (const m of text.matchAll(BOUNDARY)) {
    if (m.index + m[0].length <= at) start = m.index + m[0].length
    else { end = m.index; break }
  }
  return text.slice(start, end)
}

// [{ value, unit, period, clause }] in the text. The unit is $ or %, or the next word (skipping "a", "of", "per"...); null when there is none.
// The period is "day", "week" or "month" when the number says "a week", "per month"..., else null.
function numbers(text) {
  const out = []
  for (const m of String(text).matchAll(NUMBER)) {
    const value = m[5] ? WORD_NUMBERS[m[5].toLowerCase()] : Number(m[2].replace(/,/g, '')) * ({ k: 1e3, m: 1e6 }[(m[3] ?? '').toLowerCase()] ?? 1)
    if (!Number.isFinite(value)) continue
    const clause = clauseAround(String(text), m.index).trim()
    if (NOT_A_STATE.test(clause)) continue
    const rest = String(text).slice(m.index + m[0].length)
    const next = rest.match(/^[\s]*([A-Za-z]+)(?:\s+([A-Za-z]+))?/)
    const word = next && (SKIP.has(next[1].toLowerCase()) ? null : next[1])
    const tail = rest.split(/[,;.!?\d]/)[0].slice(0, 25).match(PERIOD)
    // "evenings and weekends" is a weekly rhythm, so a sign-up line like "evenings and weekends, under 15 hours" counts as a week.
    const period = periodOf(tail?.[1] ?? tail?.[2] ?? tail?.[3]) ?? (/\bweekends?\b/i.test(text) ? 'week' : null)
    out.push({ value, unit: m[1] ? '$' : m[4] ? '%' : unitOf(word), period, clause })
  }
  return out
}

// What a bare answer measures: the word after "how many" or "how much", else the one unit word the question holds.
function questionUnit(question) {
  const t = norm(question)
  const asked = t.match(/how (?:many|much)\s+(?:(?:more|different|of the|of)\s+)?([a-z]+)/)?.[1]
  if (asked) return asked
  const named = [...new Set((t.match(/[a-z]+/g) ?? []).filter((w) => UNITS.has(unitOf(w))))]
  return named.length === 1 ? named[0] : null
}

// The clause around the number, at most 12 words, cut from the founder's own message so it stays a verbatim snippet.
const CLAUSE_WORDS = 12
const phraseOf = (message) => {
  const sentence = String(message).split(/(?<=[.!?\n])\s+/).find((s) => numbers(s).length > 0) ?? String(message)
  const clause = sentence.split(/[,;]|\s(?:and|but|so|because|which|while)\s/i).find((c) => numbers(c).length > 0) ?? sentence
  const words = clause.trim().replace(/[.!?]+$/, '').split(/\s+/)
  const at = Math.max(0, words.findIndex((w) => /\d/.test(w) || WORDS.includes(w.toLowerCase())))
  const start = Math.min(Math.max(0, at - 6), Math.max(0, words.length - CLAUSE_WORDS))
  return words.slice(start, start + CLAUSE_WORDS).join(' ')
}

// The stored record that the founder was told about a change (shiftText); it is not a statement to compare against.
const SHIFT = /\bbefore, now says\b/

// transcript: [{ role: 'founder' | 'axiom', text }] in order, the newest founder message being the new one.
// earlier: the "Earlier they said" lines. Returns { earlier, earlierClause, nowText, earlierNumber, nowNumber, strong } or null.
// The measure must match, not only the unit: two different periods ("a week" against "a month") never conflict.
// strong: a bare answer to a question that states the unit, or the same unit and the same period (or none on both sides); only a strong
// conflict is enforced in code. Weak (one side has a period, the other none) is a notice in the prompt only.
// Mentioned once: null when an earlier Axiom turn holds both numbers, or when a stored shift does (that record spans every situation).
export function findConflict({ transcript, earlier }) {
  const at = transcript.findLastIndex((t) => t.role === 'founder')
  if (at < 0 || earlier.length === 0) return null
  const message = String(transcript[at].text)
  const question = transcript.slice(0, at).findLast((t) => t.role === 'axiom')?.text ?? ''
  const bareWord = message.trim().split(/\s+/).length <= 3 ? questionUnit(question) : null // "16" after "how many hours"
  const now = numbers(message).map((n) => (n.unit ? n : { ...n, unit: unitOf(bareWord), bare: true })).filter((n) => n.unit)
  for (const line of earlier.filter((l) => !SHIFT.test(l))) {
    const before = numbers(line).filter((n) => n.unit)
    const same = (n) => before.some((b) => b.unit === n.unit && b.value === n.value)
    for (const n of now) {
      const b = !same(n) && before.find((x) => x.unit === n.unit && (n.bare || !x.period || !n.period || x.period === n.period))
      if (!b) continue
      const found = { earlier: line, earlierClause: b.clause, nowText: n.bare ? `${message.trim().replace(/[.!?]+$/, '')} ${bareWord}` : phraseOf(message), earlierNumber: b.value, nowNumber: n.value, strong: Boolean(n.bare || n.period === b.period) }
      const told = [...transcript.slice(0, at).filter((t) => t.role === 'axiom').map((t) => t.text), ...earlier.filter((l) => SHIFT.test(l))]
      return told.some((t) => namesBoth(t, found)) ? null : found
    }
  }
  return null
}

// True when the text holds both numbers of the conflict (digits or words).
export function namesBoth(text, conflict) {
  const found = numbersIn(text)
  return found.includes(conflict.earlierNumber) && found.includes(conflict.nowNumber)
}

// The question that asks what changed: the first one at or after the sentence that completes both numbers. Null when there is none.
export function changeQuestion(text, conflict) {
  const sentences = String(text).split(/(?<=[.!?])\s+/)
  for (let i = 0; i < sentences.length; i += 1) {
    if (namesBoth(sentences.slice(0, i + 1).join(' '), conflict)) return sentences.slice(i).find((s) => s.includes('?')) ?? null
  }
  return null
}

// The notice is met when both numbers are named and a question follows the second one (the question is what changed).
export const namesBothAndAsks = (text, conflict) => changeQuestion(text, conflict) !== null

export const conflictProblem = (conflict) => `name both numbers, ${conflict.earlierNumber} and ${conflict.nowNumber}, in one plain sentence, then ask what changed as a question after them`

// A side of the shift in plain third person: "I'm"/"I am"/"I" at the start goes, "my" becomes "their", "me" "them". Null when "I" is left.
const thirdPerson = (text) => {
  const t = text.replace(/^i(?:'m| am)?\s+/i, '').replace(/\bmy\b/gi, 'their').replace(/\bme\b/gi, 'them').replace(/\bmyself\b/gi, 'themselves')
  return /\b(?:i|i'm|i'll|i've|i'd)\b/i.test(t) ? null : t
}
const SIDE_MAX = 100 // two sides plus the fixed words stay inside the 240 characters a belief may hold

// The clause cut to `max` characters from the ends, never the number (and the word after it, its unit).
function fit(text, number, max) {
  const w = text.split(' ')
  const at = Math.max(0, w.findIndex((x) => numbersIn(x).includes(number)))
  let [l, r] = [0, w.length - 1]
  while (w.slice(l, r + 1).join(' ').length > max && (l < at || r > at + 1)) { if (r - at > at - l && r > at + 1) r -= 1; else if (l < at) l += 1; else r -= 1 }
  const out = w.slice(l, r + 1).join(' ').replace(/[,;:]+$/, '')
  return out.length <= max ? out : null
}

// The shift as one stored fact, from a fixed template: the earlier belief without its label ("Your time on it: ..."), then the founder's words.
// Null when it cannot be plain third person or cannot fit; the caller logs and stores nothing.
export const shiftText = (conflict) => {
  const earlier = thirdPerson(conflict.earlier.replace(/^[^:]{1,40}:\s*/, '').replace(/[.\s]+$/, ''))
  const now = thirdPerson(conflict.nowText)
  const before = earlier && fit(earlier, conflict.earlierNumber, SIDE_MAX)
  const after = now && fit(now, conflict.nowNumber, SIDE_MAX)
  if (!before || !after) return null
  return `Said ${/^[A-Z][a-z]/.test(before) ? before[0].toLowerCase() + before.slice(1) : before} before, now says ${after}.`
}

// The chronological conversation of one situation, from the prompt pieces Learn and Move hold.
export const transcriptOf = ({ situation = [], read = null, learn = [] }) => [
  ...situation,
  ...(read?.closing_question ? [{ role: 'axiom', text: read.closing_question }] : []),
  ...(read?.founder_answer ? [{ role: 'founder', text: read.founder_answer }] : []),
  ...(read?.talk_after ?? []),
  ...learn,
]
