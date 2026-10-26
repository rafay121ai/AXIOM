// Pure checker for a first reading. A reading may only quote and underline
// what the founder actually wrote, may only use numbers and months that are in
// their answers, and must keep to Axiom's voice rules. No model, no I/O.

export const BANNED_PHRASES = Object.freeze([
  'great question', 'certainly', 'i understand', "that's interesting", 'absolutely',
  'of course', "i'd be happy to", 'great',
  "that's right", 'not quite',
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

// reading: { headline, body, underlines }. answerTexts: every string the
// founder typed or chose, one array item per answer. Returns { ok, problems }.
export function checkFirstReading({ reading, answerTexts }) {
  const problems = []
  const corpus = answerTexts.map(norm).filter(Boolean)
  const inAnswers = (phrase) => {
    const p = trimEdges(norm(phrase))
    return p.length > 0 && corpus.some((a) => a.includes(p))
  }

  if (!reading || typeof reading.headline !== 'string' || typeof reading.body !== 'string' || !Array.isArray(reading.underlines)) {
    return { ok: false, problems: ['reading has the wrong shape'] }
  }
  const text = `${reading.headline}\n${reading.body}`
  const lower = norm(text)

  // Quotes
  const { phrases, unbalanced } = quotedPhrases(text)
  if (unbalanced) problems.push('unbalanced quote mark')
  for (const phrase of phrases) {
    if (!inAnswers(phrase)) problems.push(`quoted words are not in the answers: "${phrase}"`)
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
