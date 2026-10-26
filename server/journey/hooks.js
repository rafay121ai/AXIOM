// Hook gate. Every screen leaves one open thread, and the thread must come from
// this founder: their own words, a real number, a date, or a contradiction
// between what they said and what they did. Teasers, forbidden phrases and
// restating the founder as filler are rejected. Pure: no model, no I/O.
import { BANNED_PHRASES, TEASER, norm, wordRx, quotedPhrases } from './ownWords.js'

const STOP = new Set((
  'a an and are as at be been but by can could did do does for from had has have he her his how i if in into is it its me my no not of on or our she so ' +
  'that the their them then there they this to too us was we were what when where which who why will with would you your about just than very also ' +
  'any some more most other out up over only still yet'
).split(' '))

// Long words every founder uses; sharing one of them proves nothing.
const GENERIC = new Set(['business', 'customer', 'customers', 'product', 'company', 'startup', 'people', 'working', 'building', 'founder', 'problem', 'because', 'really', 'something', 'anything', 'everything', 'someone', 'thinking', 'feeling', 'trying', 'doing', 'getting', 'should', 'before', 'already'])

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const NUMBER_WORDS = 'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|a couple of|a few|several|last|next|this'
const DATE_TERMS = [
  new RegExp(`\\b(?:${MONTHS.join('|')})(?: \\d{1,2})?\\b`, 'g'),
  new RegExp(`\\b(?:\\d+|${NUMBER_WORDS}) (?:day|days|week|weeks|month|months|year|years)\\b`, 'g'),
  /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|yesterday|tonight)\b/g,
]
const RESTATING = /^(?:so )?(?:you(?:'re| are) saying|it sounds like|what i(?:'m| am) hearing|if i understand|in other words)\b/

const tokens = (text) => norm(text).match(/[\p{L}\p{N}']+/gu) ?? []
const contentWords = (text) => tokens(text).filter((w) => w.length >= 3 && !STOP.has(w))
const pairs = (words) => words.slice(1).map((w, i) => `${words[i]} ${w}`)
const numbersIn = (text) => [...norm(text).matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0].replace(/,/g, '').replace(/\.$/, ''))
const datesIn = (text) => DATE_TERMS.flatMap((rx) => [...norm(text).matchAll(rx)].map((m) => m[0]))

// "you said ... but ..." and similar: what they said set against what they did.
const CONTRADICTION = /\byou (?:said|wrote|told me|picked)\b[^.?!]*\b(?:but|yet|and still|and have not|and haven't|and has not)\b/

// Which kinds of real thread `text` carries from `sources` (the founder's own
// strings). Empty when it holds nothing of theirs.
export function threadKinds(text, sources) {
  const kinds = []
  const corpus = sources.map(norm).filter(Boolean)
  const joined = corpus.join('\n')

  const { phrases } = quotedPhrases(text)
  const ownPairs = new Set(corpus.flatMap((s) => pairs(contentWords(s))))
  const ownWords = new Set(corpus.flatMap(contentWords))
  const distinctive = contentWords(text).some((w) => w.length >= 6 && !GENERIC.has(w) && ownWords.has(w))
  const quoted = phrases.some((p) => p.length >= 3 && joined.includes(p))
  if (quoted || distinctive || pairs(contentWords(text)).some((p) => ownPairs.has(p))) kinds.push('own_words')

  const ownNumbers = new Set(sources.flatMap(numbersIn))
  if (numbersIn(text).some((n) => ownNumbers.has(n))) kinds.push('number')

  if (datesIn(text).some((d) => wordRx(d).test(joined))) kinds.push('date')

  if (kinds.length && CONTRADICTION.test(norm(text))) kinds.push('contradiction')
  return kinds
}

// text: Axiom's closing line for a step. sources: strings the founder wrote or
// chose. requireQuestion: the thread must be one clear question.
// Returns { ok, kinds, problems }.
export function checkHook({ text, sources, requireQuestion = true }) {
  const problems = []
  const lower = norm(text)
  if (!lower) return { ok: false, kinds: [], problems: ['the line is empty'] }

  for (const banned of BANNED_PHRASES) {
    if (wordRx(banned).test(lower)) problems.push(`banned phrase: ${banned}`)
  }
  if (TEASER.test(lower)) problems.push('teaser question')
  if (RESTATING.test(lower)) problems.push('restates the founder as filler')

  const questions = (text.match(/\?/g) || []).length
  if (requireQuestion && questions !== 1) problems.push(questions === 0 ? 'it is not a question' : 'more than one question')
  if (!requireQuestion && questions > 1) problems.push('more than one question')

  const kinds = threadKinds(text, sources)
  if (kinds.length === 0) problems.push("no thread from the founder: use their own words, a number, a date or a contradiction from what they wrote")

  return { ok: problems.length === 0, kinds, problems }
}
