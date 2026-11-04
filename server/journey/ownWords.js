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
// quoteTexts: what may be quoted. answerTexts: everything they typed or picked (for spotting a reworded answer).
export function unquoteUnknown(text, quoteTexts, answerTexts = quoteTexts) {
  const inAnswers = inAnswersOf(quoteTexts)
  const inAnyAnswer = inAnswersOf(answerTexts)
  const theirs = new Set(answerTexts.flatMap(stems))
  const reworded = (inner) => {
    const words = stems(inner)
    // A bare number they picked (not typed) is not theirs to quote: it loses its marks.
    if (words.length === 0) return /\d/.test(inner) && inAnyAnswer(inner)
    return words.every((w) => theirs.has(w))
  }
  return String(text ?? '').replace(/["\u201C]([^"\u201C\u201D]+)["\u201D]/g, (whole, inner) => (inAnswers(inner) || !reworded(inner) ? whole : inner))
}

// reading: { headline, body, underlines }. answerTexts: every string the
// founder typed or chose, one array item per answer. Returns { ok, problems }.
// quoteTexts: what may be quoted (default: every answer); the Read passes only what the founder typed.
export function checkFirstReading({ reading, answerTexts, quoteTexts = answerTexts }) {
  const problems = []
  const corpus = answerTexts.map(norm).filter(Boolean)
  const inAnswers = inAnswersOf(answerTexts)
  const quotable = inAnswersOf(quoteTexts)

  if (!reading || typeof reading.headline !== 'string' || typeof reading.body !== 'string' || !Array.isArray(reading.underlines)) {
    return { ok: false, problems: ['reading has the wrong shape'] }
  }
  const text = `${reading.headline}\n${reading.body}`
  const lower = norm(text)

  // Quotes
  const { phrases, unbalanced } = quotedPhrases(text)
  if (unbalanced) problems.push('unbalanced quote mark')
  for (const phrase of phrases) {
    if (!quotable(phrase)) problems.push(`quoted words are not in the answers: "${phrase}"`)
  }

  // Underlines
  if (reading.underlines.length > MAX_UNDERLINES) problems.push(`more than ${MAX_UNDERLINES} underlines`)
  const bodyLower = norm(reading.body)
  for (const u of reading.underlines) {
    if (typeof u !== 'string' || !trimEdges(norm(u))) problems.push('empty underline')
    else if (!inAnswers(u)) problems.push(`underlined words are not in the answers: "${u}"`)
    else if (!bodyLower.includes(trimEdges(norm(u)))) problems.push(`underlined words are not in the body: "${u}"`)
  }

  // Numbers and months
  const known = new Set(answerTexts.flatMap(numbersIn))
  for (const n of new Set(numbersIn(text))) {
    if (!known.has(n)) problems.push(`number is not in the answers: ${n}`)
  }
  const corpusJoined = corpus.join('\n')
  for (const month of MONTHS) {
    if (wordRx(month).test(lower) && !wordRx(month).test(corpusJoined)) problems.push(`date is not in the answers: ${month}`)
  }

  // Voice
  for (const banned of BANNED_PHRASES) {
    if (wordRx(banned).test(lower)) problems.push(`banned phrase: ${banned}`)
  }
  if (TEASER.test(lower)) problems.push('teaser question')

  return { ok: problems.length === 0, problems }
}
