// The Read: the model writes it from the situation and the sign-up answers;
// ownWords.js and hooks.js check it; one retry names the problems; a plain
// read composed from the founder's own words replaces it if that fails.
import { buildEvidence } from './firstReading.js'
import { checkFirstReading } from './ownWords.js'
import { checkHook } from './hooks.js'
import { stripFiller } from './filler.js'
import { READ_SCHEMA, readMessages } from './prompts/read.js'

const SNIPPET_MAX = 120

// First sentence of what the founder wrote, cut at a word, with quote marks
// removed so it can sit inside quotes of ours.
function snippetOf(text) {
  const first = String(text).replace(/["“”„‟]/g, '').trim().split(/(?<=[.!?])\s+/)[0] ?? ''
  if (first.length <= SNIPPET_MAX) return first.replace(/[.!?]+$/, '')
  return first.slice(0, SNIPPET_MAX).replace(/\s+\S*$/, '')
}

// A safe read: exact quotes of the founder, nothing else of ours that could
// be wrong. The closing question quotes their first words so it is a real
// thread, and passes the same hook gate as a model-written one.
export function fallbackRead(founderTexts) {
  const snippet = snippetOf(founderTexts[0] ?? '')
  const opening = snippet.split(/\s+/).slice(0, 6).join(' ')
  return {
    headline: 'Here is what you told me today.',
    body: `You wrote: "${snippet}". That is where we start. Next I will bring in what authors have said about it, and give you one small step to take today.`,
    closing_question: `What have you already tried on "${opening}"?`,
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
export function checkRead({ read, answerTexts }) {
  const problems = []
  if (read.body.length < 40) problems.push('body is too short')
  if (read.underlines !== undefined) problems.push('the Read has no underlines')
  const own = checkFirstReading({
    reading: { headline: read.headline, body: `${read.body} ${read.closing_question}`, underlines: [] },
    answerTexts,
  })
  problems.push(...own.problems)
  problems.push(...checkHook({ text: read.closing_question, sources: answerTexts }).problems)
  return { ok: problems.length === 0, problems }
}

// deps: { callStructured, userId, log }. Never throws: any model failure ends
// in the fallback. Returns { read, source }.
export async function createRead({ signUpAnswers, conversation, deps, situationId, style }) {
  const { evidence, answerTexts: signUpTexts } = buildEvidence(signUpAnswers)
  const founderTexts = conversation.filter((t) => t.role === 'founder').map((t) => t.text)
  const answerTexts = [...signUpTexts, ...founderTexts]
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
      const read = clean(data)
      const verdict = checkRead({ read, answerTexts })
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
