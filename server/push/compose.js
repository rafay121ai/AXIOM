// Push text. Plain templates filled only with real stored data (the founder's
// first name, the move title, the subject in their own words, the situation
// title). No model call. Lines marked (mock) are approved words; (new) lines
// wait for Rafay's approval.
//
// Lock-screen modes (Settings > Reminders, default Short):
// - full: names the move or the subject;
// - short: the founder's name and a generic line, nothing about the move;
// - hidden: just "Axiom".
// A full line that would break a voice rule (a banned phrase or a teaser in
// stored text, or too long for a lock screen) falls back to the short line.
import { BANNED_PHRASES, TEASER, norm, wordRx } from '../journey/ownWords.js'

export const LOCK_SCREEN_MODES = Object.freeze(['full', 'short', 'hidden'])
export const DEFAULT_LOCK_SCREEN = 'short'
export const HIDDEN_BODY = 'Axiom'
export const MAX_BODY = 160

const OPENS = Object.freeze({ morning: 'move', evening: 'report', reminder: 'report', quiet_check: 'situation', proactive: 'situation' })

const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()
const sentence = (s) => clean(s).replace(/[.!?\s]+$/, '')
const lowerFirst = (s) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s)
const upperFirst = (s) => s.charAt(0).toUpperCase() + s.slice(1)
// "Rafay, how did it go?" or, with no name, "How did it go?"
const lead = (name, rest) => (name ? `${name}, ${rest}` : upperFirst(rest))
// "How did it go, Rafay?" or "How did it go?"
const ask = (question, name) => (name ? `${question}, ${name}?` : `${question}?`)
const morning = (name) => (name ? `Morning, ${name}.` : 'Morning.')

export const PUSH_WORDING = Object.freeze({
  evening: {
    full: ({ name, subject, title }) => (subject
      ? lead(name, `how did ${subject} go?`) // (mock) "Rafay, how did the two clinics go?"
      : `${sentence(title)}. ${ask('How did it go', name)}`), // (new)
    short: ({ name }) => lead(name, 'how did it go?'), // (new)
  },
  reminder: {
    full: ({ name, subject, title }) => (subject
      ? lead(name, `did you get to ${subject}?`) // (new)
      : `${sentence(title)}. ${ask('Did you get to it', name)}`), // (new)
    short: ({ name }) => lead(name, 'did you get to it?'), // (new)
  },
  morning: {
    full: ({ name, title }) => `${morning(name)} Today: ${lowerFirst(sentence(title))}.`, // (new)
    short: ({ name }) => `${morning(name)} Your move for today is waiting.`, // (new)
  },
  quiet_check: {
    full: ({ name, situationTitle }) => lead(name, `where are you with ${lowerFirst(sentence(situationTitle))}?`), // (new)
    short: ({ name }) => lead(name, 'where are you with what we talked about?'), // (new)
  },
  proactive: {
    full: ({ opener }) => opener, // (approved Nov 4)
    short: ({ name, trigger }) => lead(name, trigger === 'two_misses' ? 'what got in the way of your last two moves?' : 'where are you with your goal?'), // (approved Nov 4)
  },
})

// Problems that keep a line off a lock screen.
export function voiceProblems(text) {
  const t = norm(text)
  const problems = BANNED_PHRASES.filter((p) => wordRx(p).test(t)).map((p) => `banned phrase: ${p}`)
  if (TEASER.test(t)) problems.push('teaser')
  if (text.length > MAX_BODY) problems.push('too long')
  return problems
}

// kind: a push kind. item: from due.js. name: first name or null.
// Returns the Expo message without `to`: { body, data, sound }.
export function composePush({ kind, item, name = null, lockScreen = DEFAULT_LOCK_SCREEN }) {
  const wording = PUSH_WORDING[kind]
  if (!wording) throw new Error(`Unknown push kind "${kind}"`)
  const mode = LOCK_SCREEN_MODES.includes(lockScreen) ? lockScreen : DEFAULT_LOCK_SCREEN
  const fields = {
    name: name ? clean(name) : null,
    title: clean(item.title),
    subject: item.subject ? sentence(item.subject) : null,
    situationTitle: clean(item.situationTitle),
    opener: clean(item.opener),
    trigger: item.trigger,
  }
  let body = HIDDEN_BODY
  if (mode !== 'hidden') {
    const short = wording.short(fields)
    const full = mode === 'full' ? wording.full(fields) : null
    body = full && voiceProblems(full).length === 0 ? full : short
    if (voiceProblems(body).length > 0) body = wording.short({ ...fields, name: null })
  }
  const data = { kind, open: OPENS[kind] }
  if (item.moveId) data.move_id = item.moveId
  if (item.situationId) data.situation_id = item.situationId
  return { body, data, sound: 'default' }
}
