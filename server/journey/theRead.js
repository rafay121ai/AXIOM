// The Read: the model writes it from this situation; the brief and track record are background and the conversation wins (only the first reading uses the sign-up answers directly);
// ownWords.js and hooks.js check it; one retry names the problems; a plain
// read composed from the founder's own words replaces it if that fails.
import { checkFirstReading, looseUnit, pairsOf, saidProblem, unquoteUnknown } from './ownWords.js'
import { checkHook, threadKinds } from './hooks.js'
import { stripFiller } from './filler.js'
import { earlierLines } from './memory/brief.js'
import { conflictProblem, earlierSources, findConflict, namesBothAndAsks } from './memory/conflicts.js'
import { overCap } from './memory/extractBeliefs.js'
import { READ_SCHEMA, readMessages } from './prompts/read.js'
import { GROUNDING_SCHEMA, groundingMessages } from './prompts/readGrounding.js'

// First sentence of three words or more of what the founder wrote (so "Hi!"
// is skipped), cut at a word, with quote marks removed so it can sit inside
// quotes of ours, and no trailing joiner word (and/but/so/or) or punctuation.
function snippetOf(text, max) {
  const sentences = String(text).replace(/["“”„‟]/g, '').trim().split(/(?<=[.!?])\s+/)
  const first = sentences.find((s) => s.split(/\s+/).filter((w) => /\w/.test(w)).length >= 3) ?? ''
  const cut = first.length <= max ? first : first.slice(0, max).replace(/\s+\S*$/, '')
  return cut.replace(/(?:[\s,;:.!?\-–—]+|\s(?:and|but|so|or))+$/i, '')
}

// A safe read: one exact quote of the founder (8 words at most), said in the body and again in the
// closing question so it is a real thread, and nothing else of ours that could be wrong. It passes the same hook gate as a model-written one. Wording
// approved by Rafay, Nov 3 (S2). founderTexts: opening, then follow-up answers.
export function fallbackRead(founderTexts) {
  const quote = snippetOf(founderTexts[0] ?? '', 60).split(/\s+/).slice(0, 8).join(' ').replace(/[\s,;:.!?\-–—]+$/, '')
  const next = 'Next is what authors have said about it, then one move you can start today.'
  return {
    headline: 'I cannot give you a proper Read on this yet.',
    body: quote ? `Here is what I have, in your words: "${quote}".\n${next}` : next,
    closing_question: quote ? `On "${quote}": what is the next step, as you see it?` : 'What is the next step, as you see it?',
  }
}

const clean = (data) => {
  const body = stripFiller(data.body).text
  const closing = stripFiller(data.closing_question).text
  // underlines is carried only so the checker can reject it; the Read has none.
  return { headline: data.headline.trim(), body, ...(data.underlines === undefined ? {} : { underlines: data.underlines }), closing_question: closing }
}

// Problems with a read. answerTexts: what the founder wrote in this
// situation. The closing question is held to the same own-words rules as the
// body, and must be a real hook. A Read with nothing of theirs from this
// situation read as an old chat for a new idea (live, Nov 9).
// fallback: our own plain Read, whose approved wording quotes the founder in the closing question (Rafay, Nov 3); a model Read may not.
export function checkRead({ read, answerTexts, earlierTexts = [], conflict = null, fallback = false }) {
  const problems = []
  if (read.body.length < 40) problems.push('body is too short')
  if (threadKinds(`${read.headline} ${read.body}`, answerTexts).length === 0) {
    problems.push('the Read is not about this situation: build it on what they wrote here, in their words')
  }
  if (conflict?.strong && !namesBothAndAsks(`${read.headline} ${read.body} ${read.closing_question}`, conflict)) problems.push(conflictProblem(conflict))
  if (read.underlines !== undefined) problems.push('the Read has no underlines')
  const own = checkFirstReading({
    reading: { headline: read.headline, ...(fallback ? { body: `${read.body} ${read.closing_question}` } : { body: read.body, closing_question: read.closing_question }), underlines: [] },
    answerTexts,
    earlierTexts,
  })
  problems.push(...own.problems)
  // Only what they said: no "You said ..." they did not say, no number with a word they never put after it.
  const all = `${read.headline} ${read.body} ${read.closing_question}`
  const said = saidProblem(all, [...answerTexts, ...earlierTexts])
  if (said) problems.push(said)
  const loose = looseUnit(all, pairsOf([...answerTexts, ...earlierTexts, ...(conflict ? [conflict.nowText] : [])]))
  if (loose) problems.push(`a number with a word they never put after it: ${loose.number} ${loose.unit}. Say the number the way they said it`)
  problems.push(...checkHook({ text: read.closing_question, sources: answerTexts }).problems)
  return { ok: problems.length === 0, problems }
}

const unquoted = (read, answerTexts) => ({
  ...read,
  headline: unquoteUnknown(read.headline, answerTexts),
  body: unquoteUnknown(read.body, answerTexts),
  closing_question: unquoteUnknown(read.closing_question, answerTexts),
})

// One cheap model call on a Read (or first reading) that passed the code checks: the claims in it that the founder's words, numbers and the brief do not
// support (Rafay, Nov 19: invented motives got through every code check). Fail-open: no check at the daily cap, and any error or
// unusable output passes the Read, so this can never stop a founder from getting one.
export const GROUNDING_TIMEOUT_MS = 8000
// Each retry names the exact problems; a third try costs under half a cent and keeps a fixable slip from becoming the fallback (live, Nov 23).
export const READ_ATTEMPTS = 3

// Hard problems mean something false or invented: they never ship. Every other problem is style: it is retried, and if only
// style is left after the last attempt the draft with the fewest problems ships (Rafay, Nov 23: fail only on real evidence).
const HARD = /quoted words are not in the answers|unbalanced quote|number is not in the answers|date is not in the answers|is not something they said|banned phrase|teaser|markup characters|wrong shape|the word "underline"|body is too short/
export const hardProblems = (problems) => problems.filter((p) => HARD.test(p))
export async function unsupportedClaims({ read, conversation, brief, situationId, grounding, deps }) {
  try {
    if (await overCap(grounding.isCapped, deps.userId)) return []
    const { data } = await deps.callStructured({
      step: 'beliefs',
      schema: GROUNDING_SCHEMA,
      schemaName: 'read_grounding',
      maxCompletionTokens: 300,
      timeoutMs: GROUNDING_TIMEOUT_MS,
      userId: deps.userId,
      usageContext: { step: 'beliefs', kind: 'read_grounding', situation_id: situationId },
      messages: groundingMessages({ conversation, brief, read: { headline: read.headline, body: read.body, closing_question: read.closing_question ?? '' } }),
    })
    return (Array.isArray(data?.unsupported) ? data.unsupported : []).filter((c) => typeof c === 'string' && c.trim()).map((c) => c.trim().slice(0, 120))
  } catch (err) {
    deps.log?.('read grounding check failed', err)
    return []
  }
}

// deps: { callStructured, userId, log }. grounding: { isCapped } turns the grounding check on (READ_GROUNDING=off passes null). Never throws: any model failure ends
// in the fallback. Returns { read, source }.
// Built from this situation; the brief and track record feed it as background, the conversation wins, and only the first
// reading uses the sign-up answers directly (Rafay, Nov 9). trackRecord: how their recent moves went.
export async function createRead({ conversation, deps, situationId, style, trackRecord = '', brief = '', firstReading = null, grounding = null }) {
  const founderTexts = conversation.filter((t) => t.role === 'founder').map((t) => t.text)
  const earlier = earlierLines(brief)
  const conflict = findConflict({ transcript: conversation, earlier })
  const earlierTexts = earlierSources({ transcript: conversation, earlier })
  let problems = null
  let grounded = false // the check runs once: a rewrite that only fixes its objection ships unchecked, and the last attempt is never turned down by it
  let claims = []
  let best = null // the style-only draft with the fewest problems
  for (let attempt = 1; attempt <= READ_ATTEMPTS; attempt += 1) {
    try {
      const { data } = await deps.callStructured({
        step: 'read',
        schema: READ_SCHEMA,
        schemaName: 'read',
        maxCompletionTokens: 1200,
        userId: deps.userId,
        usageContext: { step: 'read', kind: 'read', situation_id: situationId },
        messages: readMessages({ conversation, style, trackRecord, brief, firstReading, conflict }, problems),
      })
      const read = unquoted(clean(data), founderTexts)
      const verdict = checkRead({ read, answerTexts: founderTexts, earlierTexts, conflict })
      if (verdict.ok) {
        if (grounding && !grounded) {
          grounded = true
          claims = await unsupportedClaims({ read, conversation, brief, situationId, grounding, deps })
          if (claims.length > 0 && attempt < READ_ATTEMPTS) {
            problems = claims.map((c) => `it claims something they did not say (${c}): say only what they said or what follows from their numbers`)
            continue
          }
        }
        if (claims.length > 0) deps.log?.('grounding objected, shipped', { claims })
        return { read, source: 'model' }
      }
      problems = verdict.problems
      if (hardProblems(problems).length === 0 && (!best || problems.length < best.problems.length)) best = { read, problems }
    } catch (err) {
      deps.log?.('model call failed', err)
      problems = null
    }
  }
  if (best) {
    deps.log?.('read shipped with style problems', { problems: best.problems })
    return { read: best.read, source: 'model' }
  }
  deps.log?.('read fell back', { problems })
  return { read: fallbackRead(founderTexts), source: 'fallback' }
}
