// Slice 1, Read quality: the Read and the first reading stop restating the founder, and a changed
// number is named. Fixture from a real session, anonymised.
import assert from 'node:assert/strict'
import test from 'node:test'
import { buildBriefText, briefMessages, earlierLines } from './memory/brief.js'
import { checkFirstReading, looseUnit, pairsOf } from './ownWords.js'
import { checkFact } from './learn/reply.js'
import { checkRead, createRead } from './theRead.js'
import { readMessages } from './prompts/read.js'
import { readTalkMessages } from './prompts/readTalk.js'

const SIGNUP = 'Evenings and weekends, under 15 hours'
const SAID = [
  'I would like to manage it manually even if it take my time',
  'I order the products by myself to know the cost',
  'home responsibilities and personal stuff',
  '16',
]
const belief = { id: 'b1', kind: 'fact', belief: `Your time on it: ${SIGNUP.toLowerCase()}.`, confidence: 0.5, status: 'active', created_at: '2026-11-01T00:00:00Z' }
const brief = (text) => buildBriefText({ beliefs: [belief], currentText: text })

const CONFLICT = {
  headline: 'Ordering alone takes more hours than you set aside.',
  body: 'At sign-up you said under 15 hours a week. Now ordering alone is 16. Doing everything by hand costs you the time for the rest of the business.',
  closing_question: 'What changed between under 15 hours and the 16 you gave?',
}
const earlierTexts = earlierLines(brief(SAID.join('\n')))

test('a Read that restates the founder fails; one that leads with the 15 vs 16 conflict passes', () => {
  const wholeSentence = { ...CONFLICT, body: `You wrote "${SAID[0]}". Ordering alone takes 16 hours, so the rest waits.` }
  const v1 = checkRead({ read: wholeSentence, answerTexts: SAID, earlierTexts })
  assert.equal(v1.ok, false)
  assert.match(v1.problems.join(), /opens with "You wrote"/)
  assert.match(v1.problems.join(), /longer than 8 words/)
  const unquoted = { ...CONFLICT, body: `${SAID[0]}, and that is the plan. Ordering alone takes 16 hours.` }
  assert.match(checkRead({ read: unquoted, answerTexts: SAID, earlierTexts }).problems.join(), /repeats 8 or more words/)
  const twoQuotes = { ...CONFLICT, body: `${CONFLICT.body} You said "manage it manually" and "to know the cost".` }
  assert.match(checkRead({ read: twoQuotes, answerTexts: SAID, earlierTexts }).problems.join(), /more than one quote/)
  assert.deepEqual(checkRead({ read: CONFLICT, answerTexts: SAID, earlierTexts }), { ok: true, problems: [] })
  // Without the earlier line the 15 is an invented number.
  assert.match(checkRead({ read: CONFLICT, answerTexts: SAID }).problems.join(), /number is not in the answers: 15/)
})

test('the brief holds the earlier under-15-hours fact for this conversation and not for an unrelated one', () => {
  const text = brief(SAID.join('\n'))
  assert.match(text, /^Earlier they said:\n- Your time on it: evenings and weekends, under 15 hours\.$/)
  assert.deepEqual(earlierLines(text), [belief.belief])
  assert.equal(brief('Dr Hamid wants a paid pilot from the first clinic.'), '')
  assert.deepEqual(earlierLines(''), [])
  assert.match(briefMessages(text)[0].content, /differs from something under "Earlier they said:"/)
})

test('an own-words check accepts 15 from the earlier line, rejects an invented 22, and never takes a quote from it', () => {
  const reading = (body) => ({ headline: 'Ordering alone takes more hours than you set aside.', body, underlines: [] })
  const check = (body) => checkFirstReading({ reading: reading(body), answerTexts: SAID, earlierTexts })
  assert.equal(check('Under 15 hours was the plan, and now it is 16.').ok, true)
  assert.match(check('Under 15 hours was the plan, and now it is 22.').problems.join(), /number is not in the answers: 22/)
  assert.match(check('The plan was "under 15 hours" a week.').problems.join(), /quoted words are not in the answers/)
})

test('the first reading headline and body reach the Read and the Read talk prompts', async () => {
  const firstReading = { headline: 'Nobody pays yet, and you are building it.', body: 'Your week is short and your goal is big.', underlines: [] }
  const line = `Already said on the first reading, do not repeat it: ${firstReading.headline} ${firstReading.body}`
  const conversation = SAID.map((text) => ({ role: 'founder', text }))
  const asked = [{ role: 'axiom', text: 'How many hours a week does the ordering take?' }, ...conversation]
  assert.ok(readMessages({ conversation, firstReading }).some((m) => m.role === 'system' && m.content === line))
  assert.ok(readTalkMessages({ talk: [], questionsLeft: 2, firstReading }).some((m) => m.role === 'system' && m.content === line))
  assert.equal(readMessages({ conversation }).some((m) => m.content.startsWith('Already said')), false)
  const sent = []
  const callStructured = async ({ messages }) => { sent.push(messages); return { data: CONFLICT } }
  const out = await createRead({ conversation: asked, deps: { callStructured, userId: 'u' }, situationId: 's', style: 'direct', brief: brief(SAID.join('\n')), firstReading })
  assert.equal(out.source, 'model')
  assert.ok(sent[0].some((m) => m.content === line))
})

// Live, Nov 22: every Read fell back. A plain Read of a pricing situation was turned down for restating a short fact
// ("train three or more times a week"), for "18 who" (a pronoun taken for a unit) and for "2 weeks" when the founder
// typed "two weeks". Sample founder text from the demo run.
const BOXING = [
  "I built a boxing coaching app that watches you through your phone camera and corrects your guard, stance and punch angles. 60 people used the free beta last month, and 18 of them train with it three or more times a week. I'm turning on payments in two weeks and I can't decide: weekly, monthly or yearly, or weekly plus yearly, or monthly plus yearly. I keep changing my mind.",
  'While you shadowbox or hit a bag, it tracks your guard, stance and punch angles and tells you when your guard drops or an angle is off. Most users are amateur boxers training at home or before the gym, and many are training for a fight or a goal 8 to 12 weeks away.',
]

test('a plain Read of the boxing pricing situation passes: short facts, "18 who" and "2 weeks"', () => {
  const read = {
    headline: 'You are choosing a price plan before asking anyone who uses it.',
    body: 'Payments go on in 2 weeks and you keep changing your mind between plans. None of the 18 who train three or more times a week has told you what they would pay, so every option is a guess.',
    closing_question: 'Which of the 18 could you ask about price this week?',
  }
  assert.deepEqual(checkRead({ read, answerTexts: BOXING }), { ok: true, problems: [] })
})

test('the Read still turns down a long restated run, an invented unit and a number the founder never gave', () => {
  const base = { headline: 'You are choosing a price plan before asking anyone who uses it.', closing_question: 'Which of the 18 could you ask about price this week?' }
  const restated = checkRead({ read: { ...base, body: '60 people used the free beta last month, so the 18 matter most. Ask them before payments go on.' }, answerTexts: BOXING })
  assert.match(restated.problems.join(), /repeats 8 or more words/)
  const unit = checkRead({ read: { ...base, body: 'Payments go on in 2 weeks. Your 18 customers have never been asked what they would pay, so each plan is a guess.' }, answerTexts: BOXING })
  assert.match(unit.problems.join(), /18 customer/)
  const invented = checkRead({ read: { ...base, body: 'Payments go on in 5 weeks. None of the 18 has been asked what they would pay, so each plan is a guess.' }, answerTexts: BOXING })
  assert.match(invented.problems.join(), /number is not in the answers: 5/)
})

test('spelled numbers: "twenty-five" is 25, "no one" and "zero" give no number, and "18 left" is a unit', () => {
  const base = { headline: 'You are choosing a price plan before asking anyone who uses it.', closing_question: 'Which of the 18 could you ask about price this week?' }
  assert.match(checkRead({ read: { ...base, body: 'Only 5 customers signed up, and none of the 18 has been asked what they would pay.' }, answerTexts: ['Twenty-five customers signed up.', ...BOXING] }).problems.join(), /number is not in the answers: 5|5 customer/)
  assert.equal(looseUnit('25 customers signed up', pairsOf(['Twenty-five customers signed up.'])), null)
  const first = checkFirstReading({ reading: { headline: 'Nobody pays yet.', body: 'Only 1 person has tried the paid plan and 0 have converted, so the price is untested.', underlines: [] }, answerTexts: ['No one has paid yet. I have zero data on price and launch soon.'] })
  assert.match(first.problems.join(), /number is not in the answers: 1/)
  assert.ok(looseUnit('18 left last month.', pairsOf(BOXING)))
})

test('a Learn fact accepts "2 weeks" when the founder typed "two weeks", like the Read', () => {
  assert.equal(checkFact('Payments go on in 2 weeks.', ["I'm turning on payments in two weeks."]), 'Payments go on in 2 weeks.')
})
