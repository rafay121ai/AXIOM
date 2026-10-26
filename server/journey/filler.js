// Filler filter for Axiom's own lines, and the check for a founder reply that
// says nothing. Pure: no model, no I/O.
import { BANNED_PHRASES, norm, wordRx } from './ownWords.js'

// Empty acknowledgements: they answer nothing and add nothing.
const ACKNOWLEDGEMENTS = [
  'got it', 'i see', 'okay', 'ok', 'sure', 'right', 'understood', 'noted', 'makes sense', 'that makes sense',
  'i hear you', 'fair enough', 'good point', 'good', 'nice', 'cool', 'alright', 'all right', 'interesting',
  'thanks for sharing', 'thank you for sharing', 'thanks', 'thank you',
]

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const byLength = (a, b) => b.length - a.length
const alternatives = (list) => [...list].sort(byLength).map(escape).join('|')
// An acknowledgement is filler only when it stands alone ("Got it, ..."), so
// "Right now, ..." stays. A banned phrase goes wherever it starts a sentence.
const LEADING = new RegExp(
  `^(?:(?:${alternatives(ACKNOWLEDGEMENTS)})(?=[,.!:;\\-–—]|$)|(?:${alternatives(BANNED_PHRASES)})(?![a-z0-9]))[\\s,.!:;\\-–—]*`,
  'i',
)
const hasBanned = (sentence) => BANNED_PHRASES.some((b) => wordRx(b).test(norm(sentence)))
const capitalise = (s) => s.charAt(0).toUpperCase() + s.slice(1)

// Strips leading acknowledgements and banned phrases from each sentence, drops
// sentences that are only filler or still hold a banned phrase. Returns the
// cleaned text and whether anything changed.
export function stripFiller(text) {
  const original = String(text ?? '').normalize('NFKC').replace(/[‘’]/g, "'").trim()
  const kept = []
  for (const sentence of original.split(/(?<=[.!?])\s+/)) {
    let s = sentence.trim()
    for (let i = 0; i < 4 && LEADING.test(s); i += 1) s = s.replace(LEADING, '')
    if (!/[a-z0-9]/i.test(s) || hasBanned(s)) continue
    kept.push(capitalise(s))
  }
  const cleaned = kept.join(' ')
  return { text: cleaned, changed: cleaned !== original }
}

const FILLER_REPLIES = new Set([
  'ok', 'okay', 'k', 'kk', 'sure', 'yeah', 'yep', 'yup', 'fine', 'alright', 'all right', 'right', 'hmm', 'hm', 'mhm',
  'got it', 'makes sense', 'i see', 'thanks', 'thank you', 'cool', 'nice', 'good', 'great', 'lol', 'idk',
])

// A reply that is only an acknowledgement. `minWords` also rejects very short
// text where a real description is needed (the first words of a situation).
export function isFillerReply(text, { minWords = 1 } = {}) {
  const t = norm(text).replace(/[^\p{L}\p{N}' ]/gu, ' ').replace(/\s+/g, ' ').trim()
  if (!t) return true
  if (FILLER_REPLIES.has(t)) return true
  return t.split(' ').length < minWords
}
