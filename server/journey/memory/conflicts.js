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

// [{ value, unit }] in the text. The unit is $ or %, or the next word (skipping "a", "of", "per"...); null when there is none.
function numbers(text) {
  const out = []
  for (const m of String(text).matchAll(NUMBER)) {
    const value = m[5] ? WORD_NUMBERS[m[5].toLowerCase()] : Number(m[2].replace(/,/g, '')) * ({ k: 1e3, m: 1e6 }[(m[3] ?? '').toLowerCase()] ?? 1)
    if (!Number.isFinite(value)) continue
    const next = String(text).slice(m.index + m[0].length).match(/^[\s]*([A-Za-z]+)(?:\s+([A-Za-z]+))?/)
    const word = next && (SKIP.has(next[1].toLowerCase()) ? null : next[1])
    out.push({ value, unit: m[1] ? '$' : m[4] ? '%' : unitOf(word) })
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

const phraseOf = (message) => {
  const sentence = String(message).split(/(?<=[.!?\n])\s+/).find((s) => numbers(s).length > 0) ?? String(message)
  const t = sentence.trim().replace(/[.!?]+$/, '')
  return t.length <= 80 ? t : t.slice(0, 80).replace(/\s+\S*$/, '')
}

// transcript: [{ role: 'founder' | 'axiom', text }] in order, the newest founder message being the new one.
// earlier: the "Earlier they said" lines. Returns { earlier, nowText, earlierNumber, nowNumber } or null.
// Mentioned once: null when an earlier Axiom turn already holds both numbers.
export function findConflict({ transcript, earlier }) {
  const at = transcript.findLastIndex((t) => t.role === 'founder')
  if (at < 0 || earlier.length === 0) return null
  const message = String(transcript[at].text)
  const question = transcript.slice(0, at).findLast((t) => t.role === 'axiom')?.text ?? ''
  const bareWord = message.trim().split(/\s+/).length <= 3 ? questionUnit(question) : null // "16" after "how many hours"
  const now = numbers(message).map((n) => (n.unit ? n : { ...n, unit: unitOf(bareWord), bare: true })).filter((n) => n.unit)
  for (const line of earlier) {
    const before = numbers(line).filter((n) => n.unit)
    const same = (n) => before.some((b) => b.unit === n.unit && b.value === n.value)
    for (const n of now) {
      const b = before.find((x) => x.unit === n.unit)
      if (!b || same(n)) continue
      const found = { earlier: line, nowText: n.bare ? `${message.trim().replace(/[.!?]+$/, '')} ${bareWord}` : phraseOf(message), earlierNumber: b.value, nowNumber: n.value }
      return transcript.slice(0, at).some((t) => t.role === 'axiom' && namesBoth(t.text, found)) ? null : found
    }
  }
  return null
}

// True when the text holds both numbers of the conflict (digits or words).
export function namesBoth(text, conflict) {
  const found = numbersIn(text)
  return found.includes(conflict.earlierNumber) && found.includes(conflict.nowNumber)
}

// The notice is met when both numbers are named and a question follows the second one (the question is what changed).
export function namesBothAndAsks(text, conflict) {
  const sentences = String(text).split(/(?<=[.!?])\s+/)
  for (let i = 0; i < sentences.length; i += 1) {
    if (namesBoth(sentences.slice(0, i + 1).join(' '), conflict)) return sentences.slice(i).some((s) => s.includes('?'))
  }
  return false
}

export const conflictProblem = (conflict) => `name both numbers, ${conflict.earlierNumber} and ${conflict.nowNumber}, in one plain sentence, then ask what changed as a question after them`

// The shift as one stored fact, from a fixed template: the earlier belief without its label ("Your time on it: ..."), then the founder's words.
export const shiftText = (conflict) => {
  const before = conflict.earlier.replace(/^[^:]{1,40}:\s*/, '').replace(/[.\s]+$/, '')
  return `Said ${/^[A-Z][a-z]/.test(before) ? before[0].toLowerCase() + before.slice(1) : before} before, now says ${conflict.nowText}.`
}

// The chronological conversation of one situation, from the prompt pieces Learn and Move hold.
export const transcriptOf = ({ situation = [], read = null, learn = [] }) => [
  ...situation,
  ...(read?.closing_question ? [{ role: 'axiom', text: read.closing_question }] : []),
  ...(read?.founder_answer ? [{ role: 'founder', text: read.founder_answer }] : []),
  ...(read?.talk_after ?? []),
  ...learn,
]
