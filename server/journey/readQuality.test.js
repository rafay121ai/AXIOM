// Slice 1, Read quality: the Read and the first reading stop restating the founder, and a changed
// number is named. Fixture from a real session, anonymised.
import assert from 'node:assert/strict'
import test from 'node:test'
import { buildBriefText, briefMessages, earlierLines } from './memory/brief.js'
import { checkFirstReading } from './ownWords.js'
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
  assert.match(checkRead({ read: unquoted, answerTexts: SAID, earlierTexts }).problems.join(), /repeats 6 or more words/)
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
