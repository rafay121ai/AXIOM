// The Read: the model writes it from the situation and the sign-up answers;
// ownWords.js and hooks.js check it; one retry names the problems; a plain
// read composed from the founder's own words replaces it if that fails.
import { buildEvidence } from './firstReading.js'
import { checkFirstReading, unquoteUnknown } from './ownWords.js'
import { checkHook } from './hooks.js'
import { stripFiller } from './filler.js'
import { READ_SCHEMA, readMessages } from './prompts/read.js'

const SNIPPET_MAX = 120
// The closing question repeats the quote, so it carries a shorter one.
const QUESTION_SNIPPET_MAX = 60

// First sentence of three words or more of what the founder wrote (so "Hi!"
// is skipped), cut at a word, with quote marks removed so it can sit inside
// quotes of ours, and no trailing joiner word (and/but/so/or) or punctuation.
function snippetOf(text, max = SNIPPET_MAX) {
  const sentences = String(text).replace(/["“”„‟]/g, '').trim().split(/(?<=[.!?])\s+/)
  const first = sentences.find((s) => s.split(/\s+/).filter((w) => /\w/.test(w)).length >= 3) ?? ''
  const cut = first.length <= max ? first : first.slice(0, max).replace(/\s+\S*$/, '')
  return cut.replace(/(?:[\s,;:.!?\-–—]+|\s(?:and|but|so|or))+$/i, '')
}

// A safe read: exact quotes of the founder, nothing else of ours that could
// be wrong. The closing question quotes their opening so it is a real
// thread, and passes the same hook gate as a model-written one. Wording
// approved by Rafay, Nov 3 (S2). founderTexts: opening, then follow-up answers.
export function fallbackRead(founderTexts) {
  const quote = snippetOf(founderTexts[0] ?? '')
  const followup = founderTexts.length > 1 ? snippetOf(founderTexts.at(-1)) : ''
  const next = 'Next is what authors have said about it, then one move you can start today.'
  return {
    headline: 'I cannot give you a proper Read on this yet.',
    body: quote ? `Here is what I have, in your words: "${quote}"${followup ? `, and "${followup}"` : ''}.\n${next}` : next,
    closing_question: quote ? `On "${snippetOf(founderTexts[0], QUESTION_SNIPPET_MAX)}": what is the next step, as you see it?` : 'What is the next step, as you see it?',
  }
}

const clean = (data) => {
  const body = stripFiller(data.body).text
  const closing = stripFiller(data.closing_question).text
  // underlines is carried only so the checker can reject it; the Read has none.
  return { headline: data.headline.trim(), body, ...(data.underlines === undefined ? {} : { underlines: data.underlines }), closing_question: closing }
}

// Problems with a read. answerTexts: sign-up strings plus what the founder
// wrote in this situation. The closing question is held to the same
// own-words rules as the body, and must be a real hook.
export function checkRead({ read, answerTexts, quoteTexts = answerTexts }) {
  const problems = []
  if (read.body.length < 40) problems.push('body is too short')
  if (read.underlines !== undefined) problems.push('the Read has no underlines')
  const own = checkFirstReading({
    reading: { headline: read.headline, body: `${read.body} ${read.closing_question}`, underlines: [] },
    answerTexts,
    quoteTexts,
  })
  problems.push(...own.problems)
  problems.push(...checkHook({ text: read.closing_question, sources: answerTexts }).problems)
  return { ok: problems.length === 0, problems }
}

const unquoted = (read, quoteTexts, answerTexts) => ({
  ...read,
  headline: unquoteUnknown(read.headline, quoteTexts, answerTexts),
  body: unquoteUnknown(read.body, quoteTexts, answerTexts),
  closing_question: unquoteUnknown(read.closing_question, quoteTexts, answerTexts),
})

// deps: { callStructured, userId, log }. Never throws: any model failure ends
// in the fallback. Returns { read, source }.
export async function createRead({ signUpAnswers, conversation, deps, situationId, style }) {
  const { evidence, answerTexts: signUpTexts, typedTexts } = buildEvidence(signUpAnswers)
  const founderTexts = conversation.filter((t) => t.role === 'founder').map((t) => t.text)
  const answerTexts = [...signUpTexts, ...founderTexts]
  // Quotes only of what they typed; a picked option is said in plain words (Rafay, Nov 2).
  const quoteTexts = [...typedTexts, ...founderTexts]
  let problems = null
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const { data } = await deps.callStructured({
        step: 'read',
        schema: READ_SCHEMA,
        schemaName: 'read',
        maxCompletionTokens: 1200,
        userId: deps.userId,
        usageContext: { step: 'read', kind: 'read', situation_id: situationId },
        messages: readMessages({ signUp: evidence, conversation, style }, problems),
      })
      const read = unquoted(clean(data), quoteTexts, answerTexts)
      const verdict = checkRead({ read, answerTexts, quoteTexts })
      if (verdict.ok) return { read, source: 'model' }
      problems = verdict.problems
    } catch (err) {
      deps.log?.('model call failed', err)
      problems = null
    }
  }
  deps.log?.('read fell back', { problems })
  return { read: fallbackRead(founderTexts), source: 'fallback' }
}
