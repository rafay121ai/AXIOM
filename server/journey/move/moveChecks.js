// The server's checks on a Move. Pure: no model, no I/O. The model writes the
// words; these rules decide whether they may be shown:
// - the deterministic experiment validator (server/experimentQuality.js, used
//   as is): a "whether" hypothesis, a specific action, a real target, a yes or
//   no success condition tied to the hypothesis;
// - the founder is the only variable: the first step needs nobody else;
// - startable within 10 minutes (start_minutes, and no waiting step);
// - own facts only: every number the founder gave (plan sizes in minutes
//   allowed), no deadline they did not give, something from this founder;
// - Axiom's voice: no banned phrase, teaser, filler or quotation marks.
import { validateExperimentQuality } from '../../experimentQuality.js'
import { isFillerReply, stripFiller } from '../filler.js'
import { threadKinds } from '../hooks.js'
import { BANNED_PHRASES, TEASER, norm, wordRx } from '../ownWords.js'

export const MAX_START_MINUTES = 10
export const NEED_REASON = '"I\'m busy" isn\'t a reason I can work with. What makes this the wrong move?'

const QUOTE_MARKS = /["“”„‟«»]/
const digitsIn = (text) => [...norm(text).matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0].replace(/,/g, '').replace(/\.$/, ''))
// A size for the founder's own plan ("a 20-minute call") is not a fact about them.
const PLAN_MINUTES = /\b\d+\s?-?\s?(?:minutes?|mins?)\b/g
const hasBanned = (text) => BANNED_PHRASES.some((b) => wordRx(b).test(norm(text)))

// Deadlines and dates the model may not add on its own.
const DEADLINE_TERMS = /\b(?:tomorrow|next (?:week|month|year)|this (?:week|weekend|month)|by (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|the end of)|end of (?:the )?(?:week|month))\b/g

// Steps that hand the start of the move to someone else, or make it wait.
const DEPENDS_ON_OTHERS = /\b(?:wait (?:for|until)|once (?:they|he|she|someone|the \w+) (?:reply|replies|respond|responds|answer|answers|get back)|after (?:they|he|she|someone) (?:reply|replies|respond|responds|answer|answers)|(?:get|have|ask) (?:your|a|an|someone|somebody) (?:co-?founder|team|partner|developer|designer|assistant|friend|colleague|employee|contractor|freelancer|agency)?\s?to\b|hire|outsource|delegate)/

// Reasons that are not reasons ("I'm busy"). What is left after removing them
// must still say something.
const NON_REASONS = [
  /\b(?:i'?m|im|i am|too|so|very|really|just)\s+(?:busy|tired|lazy|bored|exhausted)\b/g,
  /\bno time\b|\bnot in the mood\b|\bdon'?t (?:feel like it|want to|like it)\b|\bcan'?t be bothered\b|\bmaybe later\b|\bnot now\b|\bnah\b/g,
]
const REASON_MIN_WORDS = 3

// The founder's reason for changing a move. Returns true when it says what
// makes this move wrong for them.
export function isRealSwapReason(text) {
  if (isFillerReply(text, { minWords: REASON_MIN_WORDS })) return false
  let rest = norm(text).replace(/['’]/g, "'")
  for (const rx of NON_REASONS) rest = rest.replace(rx, ' ')
  const words = rest.replace(/[^\p{L}\p{N}' ]/gu, ' ').split(/\s+/).filter((w) => w.length > 1 && !['and', 'but', 'so', 'the', 'it', 'is', 'am', 'im', "i'm", 'right'].includes(w))
  return words.length >= REASON_MIN_WORDS
}

// What the validator is given, from a move.
export const experimentOf = (move) => ({
  hypothesis: move.hypothesis,
  how_to_do_it: [move.mission, ...(move.checklist ?? [])].join(' '),
  real_world_example: move.words || move.mission,
  success_condition: move.success,
})

// data: the model's output. founderTexts: every string the founder wrote or
// chose. Returns { move, problems }; `move` is shown only when problems is empty.
export function checkMove({ data, founderTexts }) {
  const problems = []
  const clean = (s) => stripFiller(String(s ?? '').trim()).text
  const move = {
    title: clean(data.title),
    mission: clean(data.mission),
    success: clean(data.success),
    words: String(data.words ?? '').trim().replace(/^["“”']+|["“”']+$/g, '').trim(),
    checklist: (Array.isArray(data.checklist) ? data.checklist : []).map(clean).filter(Boolean),
    prediction: clean(data.prediction),
    hypothesis: String(data.hypothesis ?? '').trim(),
    start_minutes: data.start_minutes,
  }
  const shown = { title: move.title, mission: move.mission, success: move.success, prediction: move.prediction, checklist: move.checklist.join(' ') }

  for (const [field, text] of Object.entries(shown)) {
    if (!text) { problems.push(`${field} is empty`); continue }
    if (hasBanned(text)) problems.push(`a banned phrase in ${field}`)
    if (TEASER.test(norm(text))) problems.push(`a teaser in ${field}`)
    if (QUOTE_MARKS.test(text)) problems.push(`quotation marks in ${field}: put the exact wording only in words`)
    if (text.includes('?')) problems.push(`a question in ${field}: the move says what to do`)
  }
  if (move.checklist.length < 2) problems.push('the checklist needs 2 to 4 steps')
  if (!Number.isInteger(move.start_minutes) || move.start_minutes < 1 || move.start_minutes > MAX_START_MINUTES) {
    problems.push(`it must be startable within ${MAX_START_MINUTES} minutes`)
  }

  // Own facts: numbers, deadlines, something from this founder.
  const all = [...Object.values(shown), move.words].join('\n')
  const ownNumbers = new Set(founderTexts.flatMap(digitsIn))
  const unknown = digitsIn(all.replace(PLAN_MINUTES, ' ')).find((n) => !ownNumbers.has(n))
  if (unknown) problems.push(`a number the founder never gave: ${unknown}`)
  const corpus = founderTexts.map(norm).join('\n')
  const deadline = [...norm(all).matchAll(DEADLINE_TERMS)].map((m) => m[0]).find((d) => !corpus.includes(d))
  if (deadline) problems.push(`a deadline the founder never gave: ${deadline}`)
  if (threadKinds(`${move.title} ${move.mission}`, founderTexts).length === 0) {
    problems.push("nothing from this founder in the title or mission: use their own words, a number or a date they gave")
  }

  // The founder is the only variable.
  if (DEPENDS_ON_OTHERS.test(norm(`${move.mission} ${move.checklist[0] ?? ''}`))) {
    problems.push('the founder must be able to start it alone, now: no waiting and no handing it to someone else')
  }

  // The deterministic validator, unchanged.
  const verdict = validateExperimentQuality(experimentOf(move))
  if (!verdict.ok) problems.push(verdict.hint)

  return { move, validation: verdict, problems: [...new Set(problems)] }
}
