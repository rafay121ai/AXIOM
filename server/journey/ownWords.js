// Pure checker for a first reading. A reading may only quote and underline
// what the founder actually wrote, may only use numbers and months that are in
// their answers, and must keep to Axiom's voice rules. No model, no I/O.

export const BANNED_PHRASES = Object.freeze([
  'great question', 'certainly', 'i understand', "that's interesting", 'absolutely',
  'of course', "i'd be happy to", 'great',
  "that's right", 'not quite',
  // Internal name for the passages the model is given; a founder hears the author's name instead.
  'the evidence',
])

// Teasers withhold something to create curiosity.
export const TEASER = /\b(want to (see|know|hear|find out)|would you like to (see|know|hear)|shall i|let me show|find out (why|what|how)|here'?s why|but first|more on that)\b/i

const MONTHS = ['january', 'february', 'march', 'april', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
export const MAX_UNDERLINES = 2

// Lowercase, straight quotes, single spaces, no accents.
export function norm(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .replace(/[“”„‟]/g, '"')
    .replace(/[‘’‚‛`´]/g, "'")
    .replace(/[‐-―]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

const trimEdges = (s) => s.replace(/^[\s.,;:!?…"'()-]+|[\s.,;:!?…"'()-]+$/g, '')
export const wordRx = (phrase) => new RegExp(`(?<![a-z0-9])${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9])`, 'i')

// Double-quoted passages in the text. `unbalanced` is true on an odd quote count.
export function quotedPhrases(text) {
  const t = norm(text).replace(/(\w)"(\w)/g, '$1$2')
  const count = (t.match(/"/g) || []).length
  return { phrases: [...t.matchAll(/"([^"]+)"/g)].map((m) => m[1]), unbalanced: count % 2 === 1 }
}

const numbersIn = (text) =>
  [...norm(text).matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0].replace(/,/g, '').replace(/\.$/, ''))

// A whole number: no digit, letter or decimal/thousands group on either side ("40" is not in "40.5" or "1,040").
const numberRx = (n) => new RegExp(`(?<![a-z0-9]|\\d[.,])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z0-9]|[.,]\\d)`, 'i')

// True when `phrase` appears in what the founder typed or chose.
function inAnswersOf(answerTexts) {
  const corpus = answerTexts.map(norm).filter(Boolean)
  return (phrase) => {
    const p = trimEdges(norm(phrase))
    if (!p) return false
    // A number must match whole ("40" is not inside "400" or "2040"); words keep the looser match.
    return /^[$€£]?\d[\d,.]*[a-z%]{0,2}$/.test(p) ? corpus.some((a) => numberRx(p).test(a)) : corpus.some((a) => a.includes(p))
  }
}

// A quote that rewords the founder's answers ("talking to customers" for "Talked to customers") loses its quotation
// marks and stays as plain words, so it no longer claims to be exact. Used before the check, so one reworded quote
// does not cost the whole Read. A quote of words they never used keeps its marks, and the check sends it back.
const stems = (text) => (norm(text).match(/[a-z]{4,}/g) ?? []).map((w) => w.slice(0, 4))
export function unquoteUnknown(text, answerTexts) {
  const inAnswers = inAnswersOf(answerTexts)
  const theirs = new Set(answerTexts.flatMap(stems))
  const reworded = (inner) => {
    const words = stems(inner)
    return words.length > 0 && words.every((w) => theirs.has(w))
  }
  return String(text ?? '').replace(/["\u201C]([^"\u201C\u201D]+)["\u201D]/g, (whole, inner) => (inAnswers(inner) || !reworded(inner) ? whole : inner))
}

const MAX_QUOTE_WORDS = 8
const RESTATE_RUN = 6
const HEADLINE_RUN = 4 // the headline and the closing question carry no quote and no run this long of the founder's words
const wordsOf = (text) => norm(text).match(/[\p{L}\p{N}']+/gu) ?? []
const runs = (words, n) => words.slice(0, Math.max(0, words.length - n + 1)).map((_, i) => words.slice(i, i + n).join(' '))

// A reading says what the founder has not said. The body may carry one short quote and no longer run of their words;
// the headline and the closing question (a Read only) carry none.
function restatingProblems(headline, body, closing, answerTexts) {
  const problems = []
  if ([headline, body].some((t) => /^you (wrote|said)\b/.test(norm(t)))) problems.push('it opens with "You wrote" or "You said": lead with what they have not said')
  const phrases = [...new Set(quotedPhrases(body).phrases)] // the same quote said twice is one quote
  if (phrases.length > 1) problems.push('more than one quote: use at most one')
  if (phrases.some((p) => wordsOf(p).length > MAX_QUOTE_WORDS)) problems.push(`a quote is longer than ${MAX_QUOTE_WORDS} words`)
  const theirs = (n) => new Set(answerTexts.flatMap((a) => runs(wordsOf(a), n)))
  const unquoted = (t) => wordsOf(norm(t).replace(/"[^"]*"/g, ' '))
  if (runs(unquoted(body), RESTATE_RUN).some((r) => theirs(RESTATE_RUN).has(r))) problems.push(`it repeats ${RESTATE_RUN} or more words in a row of what they wrote: say what they have not said`)
  // Only a Read has a closing question; a first reading's headline may echo the option the founder picked.
  for (const [name, t] of closing === null ? [] : [['headline', headline], ['closing question', closing]]) {
    if (quotedPhrases(t).phrases.length > 0) problems.push(`the ${name} quotes the founder: use your own words there`)
    else if (runs(wordsOf(t), HEADLINE_RUN).some((r) => theirs(HEADLINE_RUN).has(r))) problems.push(`the ${name} repeats ${HEADLINE_RUN} or more words in a row of what they wrote: use your own words there`)
  }
  return problems
}

// "Not X, it is Y" in any form, even across a sentence break ("You are not saying X. You are saying Y."). Rafay, Nov 19:
// the clever contrast reads as a trick. Low false positives first: "not just X but also Y", "not sure, but" and a
// condition ("if it is not working, you are stuck") pass.
const NEGATION = String.raw`(?:\b(?:is|are|was|were|am) not|(?:'s|'re|'m) not|\b(?:isn|aren|wasn|weren)'t)\b(?! (?:just|only|merely|simply|sure|yet|quite)\b)`
const CONTRAST = [
  new RegExp(`${NEGATION}[^.!?;]{1,40}?,? (?:but|rather|instead)\\b`, 'g'),
  new RegExp(`${NEGATION}[^.!?;]{1,50}?[.,;\u2014]\\s*(?:it|this|that|you|they|we|i)(?:'s|'re|'m| is| are| am)\\b`, 'g'),
]
export function contrastProblem(text) {
  const t = norm(text)
  for (const rx of CONTRAST) {
    for (const m of t.matchAll(rx)) {
      const sentence = t.slice(0, m.index).split(/[.!?;]/).pop()
      if (!/\b(if|when|unless|once|since|because|while|until|whether)\b/.test(sentence)) return 'a "not X, it is Y" contrast: say what is true once, plainly, without the contrast'
    }
  }
  return null
}

// [{ number: '16', unit: 'hour' }] for each digit number followed by a word ("16 hours a week"); function words after a number are no unit.
const UNIT_SKIP = new Set(['a', 'an', 'the', 'of', 'per', 'more', 'new', 'about', 'or', 'to', 'and', 'in', 'on', 'at', 'for', 'by', 'with', 'from', 'is', 'are', 'as', 'but', 'so', 'then', 'times', 'out'])
export const unitStem = (w) => w.replace(/^hrs?$/, 'hour').replace(/s$/, '')
export const numberUnits = (text) => [...norm(text).matchAll(/(\d[\d,]*(?:\.\d+)?)(?:k|m)?\s+([a-z]+)/g)]
  .filter((m) => !UNIT_SKIP.has(m[2])).map((m) => ({ number: m[1].replace(/,/g, ''), unit: unitStem(m[2]) }))

// reading: { headline, body, underlines, closing_question? } (a Read has the closing question). answerTexts: every string the
// founder typed or chose, one array item per answer. earlierTexts: what they said before (sign-up),
// the source of a number or a month but never of a quote. Returns { ok, problems }.
export function checkFirstReading({ reading, answerTexts, earlierTexts = [] }) {
  const problems = []
  const corpus = answerTexts.map(norm).filter(Boolean)
  const inAnswers = inAnswersOf(answerTexts)

  if (!reading || typeof reading.headline !== 'string' || typeof reading.body !== 'string' || !Array.isArray(reading.underlines)) {
    return { ok: false, problems: ['reading has the wrong shape'] }
  }
  const closing = typeof reading.closing_question === 'string' ? reading.closing_question : null
  const text = `${reading.headline}\n${reading.body}\n${closing ?? ''}`
  const lower = norm(text)

  // Quotes
  const { phrases, unbalanced } = quotedPhrases(text)
  if (unbalanced) problems.push('unbalanced quote mark')
  for (const phrase of phrases) {
    if (!inAnswers(phrase)) problems.push(`quoted words are not in the answers: "${phrase}"`)
  }

  if (/[_*#`]/.test(text)) problems.push('markup characters (_ * # `) in the reading: plain words only')
  if (/\bunderlines?\b/.test(lower)) problems.push('the word "underline" is in the text: it is not for the founder to read')
  // A sign-up option label ("wait-and-collect-more") glued into prose: only a hyphenated word the founder typed may stay.
  for (const label of new Set(lower.match(/\b[a-z]+(?:-[a-z]+){2,}\b/g) ?? [])) {
    if (!inAnswers(label)) problems.push(`a hyphenated label that is not theirs: ${label}. Use plain words`)
  }
  const contrast = contrastProblem(text)
  if (contrast) problems.push(contrast)

  // Underlines
  if (reading.underlines.length > MAX_UNDERLINES) problems.push(`more than ${MAX_UNDERLINES} underlines`)
  const bodyLower = norm(reading.body)
  for (const u of reading.underlines) {
    if (typeof u !== 'string' || !trimEdges(norm(u))) problems.push('empty underline')
    else if (!inAnswers(u)) problems.push(`underlined words are not in the answers: "${u}"`)
    else if (!bodyLower.includes(trimEdges(norm(u)))) problems.push(`underlined words are not in the body: "${u}"`)
  }

  // Numbers and months
  const known = new Set([...answerTexts, ...earlierTexts].flatMap(numbersIn))
  for (const n of new Set(numbersIn(text))) {
    if (!known.has(n)) problems.push(`number is not in the answers: ${n}`)
  }
  const corpusJoined = [...corpus, ...earlierTexts.map(norm)].join('\n')
  for (const month of MONTHS) {
    if (wordRx(month).test(lower) && !wordRx(month).test(corpusJoined)) problems.push(`date is not in the answers: ${month}`)
  }

  problems.push(...restatingProblems(reading.headline, reading.body, closing, answerTexts))

  // Voice
  for (const banned of BANNED_PHRASES) {
    if (wordRx(banned).test(lower)) problems.push(`banned phrase: ${banned}`)
  }
  if (TEASER.test(lower)) problems.push('teaser question')

  return { ok: problems.length === 0, problems }
}
