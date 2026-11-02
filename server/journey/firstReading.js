// First reading: built only from the founder's own sign-up answers. The model
// writes it; ownWords.js checks it; a plain reading composed from the answers
// replaces it if the model cannot get it right.
import { QUESTIONS, answerStrings, typedStrings } from './questions.js'
import { checkFirstReading } from './ownWords.js'
import { FIRST_READING_SCHEMA, firstReadingMessages } from './prompts/firstReading.js'

const readable = (question, answer) => {
  switch (question.type) {
    case 'single': return answer.other ? `${answer.value}: ${answer.other}` : answer.value
    case 'where': return `Based in ${answer.country}. Customers: ${answer.customers}`
    case 'goal': return `${answer.goal}, ${answer.date ?? answer.when}`
    case 'two': return `Better than most at: ${answer.a.join(', ') || 'nothing picked'}. Avoids most: ${answer.b.join(', ') || 'nothing picked'}`
    case 'multi': return answer.join(', ')
    default: return answer
  }
}

// Answer types whose shown form is only the founder's picks, joined; the others add our labels.
const JOINED = new Set(['goal', 'multi'])

// Evidence for the model, and the strings the checker compares against.
export function buildEvidence(answers) {
  const asked = QUESTIONS.filter((q) => Object.hasOwn(answers, q.key))
  return {
    evidence: asked.map((q) => ({ question: q.title, answer: readable(q, answers[q.key]) })),
    // Each answer alone, plus picked choices joined as the model sees them ("My first customer, This month"), so a
    // faithful quote is not rejected (Read fell back on this, Nov 2). Never our own labels ("Avoids most:").
    answerTexts: asked.flatMap((q) => [...answerStrings(q, answers[q.key]), ...(JOINED.has(q.type) ? [readable(q, answers[q.key])] : [])]),
    // Only what the founder typed: the Read may quote these and nothing else.
    typedTexts: asked.flatMap((q) => typedStrings(q, answers[q.key])),
  }
}

// Only what the founder picked. Never infer anything they did not say.
const STAGE_FACT = {
  'Just an idea': 'You have an idea.',
  "I'm talking to people about it": 'You are talking to people about it.',
  "I'm building it and nobody pays yet": 'You are building it, and nobody pays yet.',
  'Someone is paying me': 'Someone is paying you.',
  "It's growing": 'It is growing.',
}
const TIME_FACT = {
  'Under 3 months': 'for under 3 months', '3 to 6 months': 'for 3 to 6 months', '6 to 12 months': 'for 6 to 12 months',
  '1 to 2 years': 'for 1 to 2 years', 'More than 2 years': 'for more than 2 years',
}
const WEEK_FACT = {
  'Full time': 'full time', 'Part time, 15 hours or more': 'part time, 15 hours or more',
  'Evenings and weekends, under 15 hours': 'evenings and weekends, under 15 hours', 'On and off': 'on and off',
}
const TRIED_FACT = {
  'Talked to customers': 'talked to customers', 'Built a prototype': 'built a prototype',
  'Launched it': 'launched it', 'Tried to sell or raise': 'tried to sell or raise',
}
const AIM_FACT = {
  'My first customer': 'You are aiming for your first customer',
  'My first 10 customers': 'You are aiming for your first 10 customers',
  'A revenue number': 'You are aiming for a revenue number',
  'Raise money': 'You are aiming to raise money',
  'Ship it': 'You are aiming to ship it',
}

const joinList = (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`)

// Safe reading from the answers alone. Contains no quote and no underline,
// and only numbers that are already in the option labels the founder picked.
export function fallbackReading(answers) {
  const headline = STAGE_FACT[answers.stage?.value]
  if (!headline) throw new Error('fallbackReading: stage answer missing or unknown')
  const time = TIME_FACT[answers.months_in?.value]
  const week = WEEK_FACT[answers.commitment?.value]
  const tried = (answers.tried ?? []).filter((t) => TRIED_FACT[t]).map((t) => TRIED_FACT[t])
  const aim = AIM_FACT[answers.goal?.goal]
  const whenPhrase = answers.goal?.date ? 'by the date you picked' : answers.goal?.when?.toLowerCase()

  const sentences = [
    time || week ? `You have been on it${time ? ` ${time}` : ''}${week ? `, ${week}` : ''}.` : null,
    tried.length
      ? `So far you have ${joinList(tried)}.`
      : 'So far you have not talked to customers, built a prototype, launched, or tried to sell.',
    aim && whenPhrase ? `${aim}, ${whenPhrase}.` : null,
    'Next we work on the thing you said you are most stuck on.',
  ].filter(Boolean)
  return { headline, body: sentences.join(' '), underlines: [] }
}

// deps: { callStructured, userId, log }. Never throws: any model failure
// ends in the fallback reading.
export async function createFirstReading({ answers, deps }) {
  const { evidence, answerTexts } = buildEvidence(answers)
  let problems = null
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const { data } = await deps.callStructured({
        step: 'read',
        schema: FIRST_READING_SCHEMA,
        schemaName: 'first_reading',
        maxCompletionTokens: 1200,
        userId: deps.userId,
        usageContext: { step: 'read', kind: 'first_reading' },
        messages: firstReadingMessages(evidence, problems),
      })
      const reading = { headline: data.headline.trim(), body: data.body.trim(), underlines: data.underlines.map((u) => u.trim()) }
      const verdict = checkFirstReading({ reading, answerTexts })
      if (verdict.ok) return { reading, source: 'model' }
      problems = verdict.problems
    } catch (err) {
      deps.log?.('model call failed', err)
      problems = null
    }
  }
  deps.log?.('first reading fell back', { problems, stage: answers.stage?.value ?? null })
  return { reading: fallbackReading(answers), source: 'fallback' }
}
