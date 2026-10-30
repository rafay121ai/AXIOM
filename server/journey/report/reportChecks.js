// The server's checks on Axiom's reply to a report. Pure: no model, no I/O.
// - the prediction check can only be right or wrong after Done, and only when
//   the reply does not claim the opposite;
// - every number in the reply, in digits or in words, is in what the model
//   was sent (the founder's words and their move);
// - Axiom's voice: no banned phrase, teaser, quotation marks, and no strike,
//   warning or penalty language, ever.
import { stripFiller } from '../filler.js'
import { BANNED_PHRASES, TEASER, norm, wordRx } from '../ownWords.js'

export const PREDICTION_CHECKS = Object.freeze(['right', 'wrong', 'unclear', 'not_tested'])
const REPLY_MAX = 600

const QUOTE_MARKS = /["“”„‟«»]/
const PENALTY = /\b(?:strikes?|warnings?|warned|penalt(?:y|ies)|penalis\w*|penaliz\w*|punish\w*)\b/
// "I said ... and it happened" is the prompt's own way of saying right.
const CLAIMS_RIGHT = /\bi was right\b|\bi called it\b|\bmy prediction (?:was right|held)\b|\bi said\b[^.!?]*\band (?:it|that|they) (?:happened|did)\b|\b(?:just )?as i (?:said|predicted)\b/
const CLAIMS_WRONG = /\bi was wrong\b|\bmy prediction was wrong\b|\bi said\b[^.!?]*\b(?:and|but) (?:it|that) (?:did not|didn't) happen\b/
// Number words count as numbers. "one" is left out: it is mostly a pronoun.
const NUMBER_WORDS = Object.freeze({
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000,
  million: 1000000, dozen: 12,
})
const NUMBER_WORD_RX = new RegExp(`(?<![a-z])(${Object.keys(NUMBER_WORDS).join('|')})(?![a-z])`, 'g')
const numbersIn = (text) => {
  const t = norm(text)
  return [
    ...[...t.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0].replace(/,/g, '').replace(/\.$/, '')),
    ...[...t.matchAll(NUMBER_WORD_RX)].map((m) => String(NUMBER_WORDS[m[1]])),
  ]
}

// The check stored with a report. Couldn't and Didn't never tested the
// prediction; a Done with nothing written cannot say whether it was right.
export function predictionCheckFor({ outcome, modelCheck = 'unclear', hasNote }) {
  if (outcome !== 'done') return 'not_tested'
  if (!hasNote) return 'unclear'
  return ['right', 'wrong'].includes(modelCheck) ? modelCheck : 'unclear'
}

// data: the model's output. knownTexts: exactly the texts the model was sent.
// Returns { reply, prediction_check, problems }; shown only when problems is empty.
export function checkReportReply({ data, outcome, knownTexts }) {
  const problems = []
  const reply = stripFiller(String(data?.reply ?? '').trim()).text
  const prediction_check = predictionCheckFor({ outcome, modelCheck: data?.prediction_check, hasNote: true })
  const text = norm(reply)

  if (!reply) problems.push('the reply is empty')
  if (reply.length > REPLY_MAX) problems.push(`the reply is longer than ${REPLY_MAX} characters`)
  if (BANNED_PHRASES.some((b) => wordRx(b).test(text))) problems.push('a banned phrase')
  if (TEASER.test(text)) problems.push('a teaser question')
  if (QUOTE_MARKS.test(reply)) problems.push('quotation marks')
  if (PENALTY.test(text)) problems.push('strike, warning or penalty language')

  const known = new Set(knownTexts.flatMap(numbersIn))
  const unknown = numbersIn(reply).find((n) => !known.has(n))
  if (unknown) problems.push(`a number the founder never gave: ${unknown}`)

  if (CLAIMS_RIGHT.test(text) && prediction_check !== 'right') problems.push('says the prediction was right, but the check does not')
  if (CLAIMS_WRONG.test(text) && prediction_check !== 'wrong') problems.push('says the prediction was wrong, but the check does not')

  return { reply, prediction_check, problems: [...new Set(problems)] }
}
