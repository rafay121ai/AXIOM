// What Axiom may believe about a founder, as pure rules: how confidence moves,
// what text may be stored, and what counts as a receipt. No I/O, no model
// (memory plan, Revision 2). The store and the extractor call these.
import { BANNED_PHRASES, TEASER, norm, wordRx } from '../ownWords.js'
import { numbersIn } from '../report/reportChecks.js'

const REINFORCE_STEP = 0.15
const CONFIDENCE_CAP = 0.95
const WEAKEN_STEP = 0.2
const SUPERSEDE_BELOW = 0.2
export const NEW_FACT_CONFIDENCE = 0.6
export const NEW_PATTERN_CONFIDENCE = 0.35
const PATTERN_MIN_EVIDENCE = 2
const PATTERN_FEW_EVIDENCE_CAP = 0.5
const FACT_DECAY_DAYS = 90
const FACT_DECAY_STEP = 0.1
export const USE_THRESHOLD = 0.4
export const TRAIT_MIN_OBSERVATIONS = 3
export const TRAIT_MIN_SITUATIONS = 2
export const SELF_REPORT_CAP = 0.5
export const MAX_ACTIVE_BELIEFS = 50
export const MAX_NEW_PER_RUN = 3
export const MAX_FAILED_RUNS = 2 // a source that failed this often is not tried again: a poison input must not cost a call on every visit

// The most characters each kind of stored text may have. Must match the CHECKs in
// supabase/migrations/20261109000001 (tested), so no write is ever refused by the database.
export const LIMITS = Object.freeze({
  belief: [3, 240], world: [1, 80], role: [1, 120], term: [1, 60], meaning: [1, 200], thread: [3, 160], snippet: [1, 200],
})

// The closed list. Must match the CHECK in supabase/migrations/20261109000001 (tested).
export const TRAIT_DIMENSIONS = Object.freeze({
  decision_speed: ['fast', 'deliberate', 'waits_until_forced'],
  evidence_basis: ['numbers_first', 'gut_first', 'asks_others'],
  after_setback: ['changes_approach', 'digs_into_why', 'pauses', 'pushes_harder'],
  move_size: ['small_steps', 'big_swings'],
  detail_level: ['big_picture', 'detail'],
  pace_of_follow_through: ['same_day', 'within_48h', 'drifts'],
})
export const isTraitValue = (dimension, value) => Object.hasOwn(TRAIT_DIMENSIONS, dimension) && TRAIT_DIMENSIONS[dimension].includes(value)

const round = (n) => Math.round(n * 100) / 100

// item: { kind?, origin?, confidence }. evidenceCount: rows that back it, counting the new one.
export function reinforce(item, evidenceCount) {
  let c = Math.min(CONFIDENCE_CAP, item.confidence + REINFORCE_STEP)
  if (item.kind === 'pattern' && evidenceCount < PATTERN_MIN_EVIDENCE) c = Math.min(c, PATTERN_FEW_EVIDENCE_CAP)
  if (item.origin === 'self_report') c = Math.min(c, SELF_REPORT_CAP)
  return round(c)
}

export function weaken(item) {
  const confidence = round(Math.max(0, item.confidence - WEAKEN_STEP))
  return { confidence, superseded: confidence < SUPERSEDE_BELOW }
}

// A fact nobody has touched for 90 days loses a little. The caller must not
// change updated_at when it saves this, or the fact would never keep decaying.
export function decayFact(item, nowMs) {
  const old = nowMs - Date.parse(item.updated_at) > FACT_DECAY_DAYS * 86400000
  return item.kind === 'fact' && old ? round(Math.max(0, item.confidence - FACT_DECAY_STEP)) : round(item.confidence)
}

// Every string that is stored or printed goes through this first: NFKC, whitespace
// (newlines too) to single spaces, and no control, zero-width, bidi or soft-hyphen
// characters, so stored text cannot break out of the framed brief.
const INVISIBLE = /[\u0000-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g
export const cleanStoredText = (text) => String(text ?? '').normalize('NFKC').replace(/\s+/g, ' ').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim()

// Common Cyrillic and Greek look-alikes to Latin, so "ignоre" (Cyrillic о) is still caught. Matching only.
const LOOKALIKES = Object.freeze({
  а: 'a', в: 'b', е: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't', у: 'y', х: 'x', і: 'i', ј: 'j', ѕ: 's', ԁ: 'd', һ: 'h', ӏ: 'l', ѵ: 'v', ԛ: 'q', ԝ: 'w',
  α: 'a', β: 'b', γ: 'y', ε: 'e', ι: 'i', κ: 'k', ν: 'v', ο: 'o', ρ: 'p', τ: 't', υ: 'u', χ: 'x',
})
const matchable = (text) => norm(cleanStoredText(text)).replace(/[\u0370-\u03FF\u0400-\u04FF]/g, (c) => LOOKALIKES[c] ?? c)

// Tunable. Anything here must never be stored as a belief.
export const PERSONALITY_LABELS = Object.freeze([
  'personality', 'introver\\w*', 'extrover\\w*', 'narciss\\w*', 'perfectionis\\w*', 'mbti', 'enneagram', 'lazy', 'procrastinat\\w*',
  'indecisive', 'impulsive', 'people.pleas\\w*', 'conflict.avoid\\w*', 'disorganis\\w*', 'disorganiz\\w*', 'risk.averse', 'stubborn', 'arrogant', 'insecure', 'shy',
])
export const SENSITIVE = Object.freeze([
  // health and illness, diagnoses
  /\b(health|healthy|sick|ill|illness|disease|cancer|diabet\w*|surgery|hospital\w*|medicat\w*|therap\w*|pregnan\w*|disabilit\w*|disabled|adhd|autis\w*|ocd|bipolar|diagnos\w*|injur\w*|chronic|burn ?out|burned out|burnt ?out)\b/,
  // mood
  /\b(depress\w*|anxi\w*|stress\w*|nervous|frustrat\w*|angry|overwhelm\w*|lonely|sad|panic\w*|mood\w*|hopeless|suicid\w*|self.harm\w*|grief|grieving|mental)\b/,
  // family and relationships
  /\b(family|partners?|wife|husband|spouse|fianc\w*|girlfriend|boyfriend|marriage|married|divorc\w*|mother\w*|father\w*|mum|mums|mom|moms|dad|dads|parents?|kids?|child|children|baby|sons?|daughters?|sister|brother|dating|relationship)\b/,
  // money trouble
  /\b(debts?|bankrupt\w*|broke|savings|running low|run low|in the red|behind on (rent|bills|payments)|can'?t (pay|afford)|cannot (pay|afford)|money (trouble|problems?|worries))\b/,
  // age
  /\b(\d+ years old|aged? \d+|\d+ ?y\/?o|too old|too young|my age|years of age|i'?m \d{2}(?!\d| ?(%|days?|weeks?|months?|hours?|minutes?))|i am \d{2}(?!\d| ?(%|days?|weeks?|months?|hours?|minutes?))|in my (teens|twenties|thirties|forties|fifties|sixties|\d0s))\b/,
  // religion, politics
  /\b(god|church|mosque|temple|synagogue|islam\w*|muslim|christian|jewish|hindu|buddhis\w*|sikh\w*|atheis\w*|religio\w*|pray\w*|faith)\b/,
  /\b(politic\w*|republican|democrat\w*|liberal|conservative|election|trump|biden|left.wing|right.wing)\b/,
  // sexuality, ethnicity, nationality as identity
  /\b(gay|lesbian|bisexual|trans|transgender|queer|lgbt\w*|sexual\w*|sexuality)\b/,
  /\b(ethnic\w*|racial\w*|race|skin colou?r|immigrant\w*|pakistani|indian|american|british|african|arab|asian|european|chinese|nigerian|kenyan|egyptian|bangladeshi|german|brazilian|latino|hispanic|caucasian)\b/,
  // labels
  new RegExp(`\\b(${PERSONALITY_LABELS.join('|')})\\b`),
])

// Mood in passing and money trouble in plain words. Applied to snippets too, so a receipt never stores them.
const ALSO_SENSITIVE = Object.freeze([
  /\b(bad day|rough day|tired|exhaust\w*|feeling|feel (low|down|bad)|crying|upset|worried|worry|scared|afraid|sleepless)\b/,
  /\b(afford|loan|mortgage|overdraft|evict\w*|no money|out of money|run out of money|short on cash)\b/,
])
// Founder text that tries to give the memory an order is never a memory. Tunable.
export const INJECTION = new RegExp([
  String.raw`\b(ignore|disregard|forget|override|skip|stop|always|never)\b[^.]{0,40}\b(instructions?|rules?|guidance|lessons?|system|prompt|above|previous)\b`,
  String.raw`\b(system prompt|you are now|you are|you must|act as|new rule|from now on|from this point|going forward)\b`,
  String.raw`\bremember that\b`,
].join('|'))
export const isBlocked = (text) => {
  const n = matchable(text)
  return SENSITIVE.some((rx) => rx.test(n)) || ALSO_SENSITIVE.some((rx) => rx.test(n)) || INJECTION.test(n)
}

// Axiom never assumes anyone's gender.
const GENDERED = /\b(he|she|him|her|his|hers|himself|herself)\b/

// Capitalised words that are not the first word of a sentence: names, places, products.
// "I" and "I'm" are not names. Sentences start at the text start and after . ! ? or a colon.
export function properNouns(text) {
  const t = cleanStoredText(text).replace(/[‘’]/g, "'")
  const out = []
  for (const m of t.matchAll(/\p{L}[\p{L}\p{N}'-]*/gu)) {
    const word = m[0].replace(/'s$/i, '')
    if (!/^\p{Lu}/u.test(word) || word.length < 2 || /^I'/.test(word)) continue
    const before = t.slice(0, m.index).trimEnd()
    if (before === '' || /[.!?:]$/.test(before)) continue
    out.push(word)
  }
  return out
}
const CALENDAR = new Set(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'])
export const isCalendarWord = (w) => CALENDAR.has(w.toLowerCase())

const QUOTES = /["“”„‟«»‹›]|(^|[\s(\[])'[^'\n]+'(?![\p{L}\p{N}])/u

// Text that may be stored as a belief, role, vocabulary term or meaning, or thread title.
// field: a key of LIMITS. sourceTexts: everything the item may be checked against (numbers).
// ownTexts: the founder's own words only (names must be theirs, never Axiom's); defaults to sourceTexts.
// Returns { ok, problems, text } where text is the cleaned text to store.
export function checkBeliefText({ text, sourceTexts = [], ownTexts = sourceTexts, field = 'belief' }) {
  const problems = []
  const t = cleanStoredText(text)
  const [min, max] = LIMITS[field]
  if (t.length < min || t.length > max) problems.push(`length must be ${min} to ${max}`)
  const n = matchable(t)
  for (const phrase of BANNED_PHRASES) if (wordRx(phrase).test(n)) problems.push(`banned phrase: ${phrase}`)
  if (TEASER.test(n)) problems.push('teaser')
  if (QUOTES.test(norm(t))) problems.push('quotation marks')
  if (GENDERED.test(n)) problems.push('gendered pronoun')
  const known = new Set(sourceTexts.flatMap(numbersIn))
  for (const num of numbersIn(t)) if (!known.has(num)) problems.push(`number not in the sources: ${num}`)
  const own = ownTexts.map((s) => matchable(s)).join(' | ')
  for (const name of properNouns(t)) if (!isCalendarWord(name) && !wordRx(matchable(name)).test(own)) problems.push(`name not in the founder's words: ${name}`)
  if (isBlocked(t)) problems.push('sensitive topic')
  return { ok: problems.length === 0, problems, text: t }
}

// The receipt check: the snippet must be words the founder really wrote.
export function snippetInSource(snippet, sourceTexts = []) {
  const s = norm(snippet)
  return s.length > 0 && sourceTexts.some((src) => norm(src).includes(s))
}
