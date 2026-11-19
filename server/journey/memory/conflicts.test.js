// Rafay, Nov 19: a changed number is named by Axiom, enforced in code, and never erased by memory. Fakes only.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createFakeClock, createFakeSupabase } from '../../testing/fakes.js'
import { EMPTY_MESSAGE } from '../../e2e/harness.js'
import { checkFirstReading } from '../ownWords.js'
import { checkReply, composeReply } from '../learn/reply.js'
import { learnMessages } from '../learn/prompts/learn.js'
import { moveMessages } from '../move/prompts/move.js'
import { readMessages } from '../prompts/read.js'
import { readTalkMessages } from '../prompts/readTalk.js'
import { situationMessages } from '../prompts/situation.js'
import { checkRead } from '../theRead.js'
import { briefMessages, buildBriefText } from './brief.js'
import { conflictProblem, findConflict, namesBoth, transcriptOf } from './conflicts.js'
import { applyExtraction } from './extractBeliefs.js'
import { learnFromMessage } from './learnMessage.js'
import { createMemoryStore } from './memoryStore.js'
import { MESSAGE_SCHEMA } from './prompts/beliefs.js'

const A = '11111111-1111-4111-8111-111111111111'
const SIT = '00000000-0000-4000-8000-000000000100'
const OLD = '00000000-0000-4000-8000-000000000500'
const NOW = Date.parse('2026-11-19T12:00:00.000Z')
const EARLIER = ['Evenings and weekends, under 15 hours']
const ASK = 'In a normal week, how many hours can you reliably spend on ordering?'
const turns = (...pairs) => pairs.map(([role, text]) => ({ role, text }))
const hours = findConflict({ transcript: turns(['axiom', ASK], ['founder', '16']), earlier: EARLIER })

test('a bare 16 after "how many hours" against "under 15 hours" is a conflict in hours', () => {
  assert.deepEqual(hours, { earlier: EARLIER[0], nowText: '16 hours', earlierNumber: 15, nowNumber: 16 })
})

test('a number word and a number with its own unit are found too', () => {
  const found = (text, question = ASK) => findConflict({ transcript: turns(['axiom', question], ['founder', text]), earlier: EARLIER })
  assert.equal(found('sixteen').nowNumber, 16)
  assert.deepEqual(found('Im okay with working on it 16 hours a week', 'What is the plan?'), { earlier: EARLIER[0], nowText: 'Im okay with working on it 16 hours a week', earlierNumber: 15, nowNumber: 16 })
  assert.equal(found('Ordering takes 16 hours a week for me.', 'What changed?').nowNumber, 16)
})

test('no conflict: same number, different unit, no earlier line, no unit to resolve, a bare number after an unrelated question', () => {
  const none = (transcript, earlier = EARLIER) => assert.equal(findConflict({ transcript, earlier }), null)
  none(turns(['axiom', ASK], ['founder', '15']))
  none(turns(['axiom', ASK], ['founder', 'Under 15 hours, yes.']))
  none(turns(['founder', 'I have 16 customers.']))
  none(turns(['axiom', 'How many customers do you have?'], ['founder', '16']))
  none(turns(['axiom', ASK], ['founder', '16']), [])
  none(turns(['axiom', 'What is stopping you?'], ['founder', '16']))
  none([], EARLIER)
  none(turns(['axiom', ASK], ['founder', 'I would rather not say']))
})

test('a conflict is mentioned once: not again after an Axiom turn named both numbers', () => {
  const t = turns(['axiom', ASK], ['founder', '16'])
  assert.notEqual(findConflict({ transcript: t, earlier: EARLIER }), null)
  const named = [...t, { role: 'axiom', text: 'You said under 15 hours, and now 16. What changed?' }, { role: 'founder', text: '16 hours a week' }]
  assert.equal(findConflict({ transcript: named, earlier: EARLIER }), null)
  const oneOnly = [...t, { role: 'axiom', text: 'That is 16 hours.' }, { role: 'founder', text: '16 hours a week' }]
  assert.notEqual(findConflict({ transcript: oneOnly, earlier: EARLIER }), null)
})

test('namesBoth reads digits and words', () => {
  assert.equal(namesBoth('Under 15 hours before, sixteen now.', hours), true)
  assert.equal(namesBoth('Now it is 16 hours.', hours), false)
})

const brief = 'Earlier they said:\n- Evenings and weekends, under 15 hours'
const noticeIn = (messages) => messages.filter((m) => m.role === 'system' && m.content.startsWith('The founder said'))
const sample = { situation: [], conversation: [], evidence: [], read: null, learn: [], subject: 's', fact: 'f', talk: [], questionsLeft: 1, followUpsLeft: 1, mode: 'offer', brief }

test('the notice reaches the Situation, Read, Read talk, Learn and Move prompts, and only when there is a conflict', () => {
  const builders = {
    situation: (conflict) => situationMessages({ ...sample, conflict }),
    read: (conflict) => readMessages({ ...sample, conflict }),
    readTalk: (conflict) => readTalkMessages({ ...sample, conflict }),
    learn: (conflict) => learnMessages({ ...sample, conflict }),
    move: (conflict) => moveMessages({ ...sample, conflict }),
  }
  for (const [name, build] of Object.entries(builders)) {
    const [one] = noticeIn(build(hours))
    assert.equal(one.content, 'The founder said Evenings and weekends, under 15 hours before, and now says 16 hours. Open by naming both in one plain sentence using only those words, without blame, then ask what changed. Do not interpret or explain the new number.', name)
    assert.equal(noticeIn(build(null)).length, 0, name)
  }
  assert.deepEqual(briefMessages('', hours), [])
  assert.equal(briefMessages(brief).length, 1)
})

test('transcriptOf puts the Read question and answer between the situation and the later turns', () => {
  const t = transcriptOf({ situation: turns(['founder', 'a']), read: { closing_question: 'q', founder_answer: 'b', talk_after: turns(['axiom', 'c']) }, learn: turns(['founder', 'd']) })
  assert.deepEqual(t.map((x) => `${x.role}:${x.text}`), ['founder:a', 'axiom:q', 'founder:b', 'axiom:c', 'founder:d'])
})

const read = { headline: 'Ordering alone takes hours you have not counted yet.', body: 'You order everything by hand, so every other job waits for the ordering to be done.', closing_question: 'How many hours does the ordering take in a normal week?' }
test('a Read that does not name both numbers is rejected with the reason; one that names both passes', () => {
  const answers = ['I order everything by hand and ordering takes my hours', '16']
  const miss = checkRead({ read, answerTexts: answers, earlierTexts: EARLIER, conflict: hours })
  assert.ok(miss.problems.includes(conflictProblem(hours)), miss.problems.join('; '))
  const both = { ...read, body: 'Under 15 hours before and now 16. Every other job waits for the ordering by hand.', closing_question: 'What changed between the 15 and the 16 hours of ordering?' }
  assert.deepEqual(checkRead({ read: both, answerTexts: answers, earlierTexts: EARLIER, conflict: hours }), { ok: true, problems: [] })
  assert.equal(checkRead({ read, answerTexts: answers, earlierTexts: EARLIER }).ok, true)
})

const evidence = [{ handle: 'E1', chunk_id: 'c1', author: 'Rob Fitzpatrick', source_title: 'The Mom Test', text: 'Ask about their life, not your idea.', similarity: 0.4 }]
const said = ['I order everything by hand and ordering takes my hours', '16 hours a week']
const lesson = (reply) => ({ reply, citations: [{ handle: 'E1' }], follow_ups: [], picture_json: '', move_subject: '', move_fact: '' })
const MISS = 'Rob Fitzpatrick says ask about their life. Ordering takes 16 hours a week of your life. What will you ask first?'
const BOTH = 'You said under 15 hours before, and now 16 hours a week. Rob Fitzpatrick says ask about their life. What changed?'
test('a Learn reply lacking both numbers is rejected; one with both passes', () => {
  const check = (reply, conflict) => checkReply({ data: lesson(reply), mode: 'lesson', evidence, founderTexts: said, earlierTexts: EARLIER, conflict })
  assert.ok(check(MISS, hours).problems.includes(conflictProblem(hours)))
  assert.deepEqual(check(BOTH, hours).problems, [])
  assert.deepEqual(check(MISS, null).problems, [])
})

test('composeReply retries with the problem, and gives the notice to the model', async () => {
  const sent = []
  const outputs = [lesson(MISS), lesson(BOTH)]
  const callStructured = async ({ messages }) => { sent.push(messages); return { data: outputs.shift() } }
  const reply = await composeReply({ mode: 'lesson', step: 'learn', evidence, founderTexts: said, earlierTexts: EARLIER, conflict: hours, context: { brief, situation: [], read: null, learn: [] }, deps: { callStructured } })
  assert.equal(sent.length, 2)
  assert.equal(noticeIn(sent[0]).length, 1)
  assert.match(sent[1].at(-1).content, /name both numbers, 15 and 16/)
  assert.match(reply.text, /under 15 hours/)
})

test('the first reading rejects markup characters, and the prompts say so', () => {
  const reading = (body) => ({ headline: 'Nobody pays yet, and you are building it.', body, underlines: [] })
  const check = (body) => checkFirstReading({ reading: reading(body), answerTexts: ['nobody pays yet'] })
  assert.match(check('Your week is *short* and your goal is big.').problems.join(), /markup/)
  assert.match(check('Your week is_short and your goal is big.').problems.join(), /markup/)
  assert.ok(!check('Your week is short and your goal is big.').problems.join().includes('markup'))
})

// ── Memory ────────────────────────────────────────────────────────────────────

function memory(over = {}) {
  const supabase = createFakeSupabase({ tables: {
    situations: [{ id: SIT, user_id: A, title: 'Ordering', status: 'open', created_at: '2026-11-17T00:00:00Z' }],
    founder_beliefs: [{ id: OLD, user_id: A, belief: 'Works evenings and weekends, under 15 hours a week.', kind: 'fact', confidence: 0.5, source: 'signup', status: 'active', created_at: '2026-11-14T00:00:00Z', updated_at: '2026-11-14T00:00:00Z' }],
    ...over,
  } })
  const clock = createFakeClock(NOW)
  const calls = []
  const learn = (output, args = {}) => learnFromMessage({
    supabase, clock, userId: A, sourceKind: 'read', sourceId: '00000000-0000-4000-8000-000000000101', situationId: SIT, text: '16',
    callStructured: async (call) => { calls.push(call); return { data: { ...EMPTY_MESSAGE, ...output }, model: 'm' } }, ...args,
  })
  return { supabase, calls, learn }
}
const shift = { new_beliefs: [{ belief: 'Said under 15 hours at sign-up, then 16 hours a week now.', kind: 'fact', snippet: '16', shifts_from: OLD }] }

test('the message schema has no supersede, and a supersede in the output is ignored: the old fact stays active', async () => {
  assert.equal('supersede' in MESSAGE_SCHEMA.properties, false)
  const { supabase, learn } = memory()
  const out = await learn({ ...shift, supersede: [{ id: OLD, replacement: { belief: 'Works 16 hours a week.', snippet: '16' } }] })
  assert.equal(out.status, 'done')
  const rows = supabase.rows('founder_beliefs')
  assert.deepEqual(rows.map((b) => b.status), ['active', 'active'])
  const brief = buildBriefText({ beliefs: rows, currentText: 'Ordering takes 16 hours every week.', nowMs: NOW })
  assert.match(brief, /under 15 hours/)
  assert.match(brief, /then 16 hours/)
})

test('a report pass still supersedes (mode full is unchanged)', async () => {
  const supabase = createFakeSupabase({ tables: { founder_beliefs: [{ id: OLD, user_id: A, belief: 'Works under 15 hours a week.', kind: 'fact', confidence: 0.5, source: 'signup', status: 'active', created_at: '2026-11-14T00:00:00Z', updated_at: '2026-11-14T00:00:00Z' }] } })
  const store = createMemoryStore({ supabase, clock: createFakeClock(NOW) })
  const data = { ...EMPTY_MESSAGE, traits: [], supersede: [{ id: OLD, replacement: { belief: 'Works 16 hours a week.', snippet: 'I work 16 hours a week' } }] }
  await applyExtraction({ store, userId: A, data, mode: 'full', founderTexts: ['I work 16 hours a week'], receipt: () => ({ sourceKind: 'report', sourceId: OLD }), beliefSource: 'report', nowMs: NOW })
  assert.equal(supabase.rows('founder_beliefs').find((b) => b.id === OLD).status, 'superseded')
})

test('a bare number or the Read closing answer is learned; filler and short text without a number are not', async () => {
  const bare = memory()
  assert.equal((await bare.learn(shift, { context: async () => turns(['axiom', ASK]) })).status, 'done')
  assert.equal(bare.calls.length, 1)
  assert.deepEqual(JSON.parse(bare.calls[0].messages.at(-1).content).context, turns(['axiom', ASK]))
  const words = memory()
  assert.equal((await words.learn({}, { text: 'sixteen' })).status, 'done')
  const closing = memory()
  assert.equal((await closing.learn({}, { text: 'Mostly weekends', closing: true })).status, 'done')
  for (const [text, extra] of [['ok thanks', {}], ['Mostly weekends', {}], ['ok', { closing: true }]]) {
    const none = memory()
    assert.equal((await none.learn({}, { text, ...extra })).status, 'skipped', text)
    assert.equal(none.calls.length, 0)
  }
})

test('a plan stated for later is stored as a fact and an open decision as a thread, in their words', async () => {
  const text = 'I will hand some work to employees in future, for now I order everything myself.'
  const { supabase, learn } = memory()
  const out = await learn({
    new_beliefs: [{ belief: 'Plans to hand work to employees later.', kind: 'fact', snippet: 'hand some work to employees in future', shifts_from: '' }],
    threads: [{ title: 'Order everything myself or hand off the work', kind: 'open_question' }],
  }, { text })
  assert.equal(out.status, 'done')
  assert.ok(supabase.rows('founder_beliefs').some((b) => b.belief === 'Plans to hand work to employees later.'))
  assert.equal(supabase.rows('founder_threads').length, 1)
})
