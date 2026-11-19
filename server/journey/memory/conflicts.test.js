// Rafay, Nov 19: a changed number is named by Axiom, enforced in code, and never erased by memory. Fakes only.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createFakeClock, createFakeSupabase } from '../../testing/fakes.js'
import { EMPTY_MESSAGE } from '../../e2e/harness.js'
import { checkFirstReading, contrastProblem } from '../ownWords.js'
import { checkReply, composeReply } from '../learn/reply.js'
import { learnMessages } from '../learn/prompts/learn.js'
import { moveMessages } from '../move/prompts/move.js'
import { readMessages } from '../prompts/read.js'
import { readTalkMessages } from '../prompts/readTalk.js'
import { situationMessages } from '../prompts/situation.js'
import { checkRead } from '../theRead.js'
import { briefMessages, buildBriefText } from './brief.js'
import { conflictProblem, findConflict, namesBoth, namesBothAndAsks, transcriptOf } from './conflicts.js'
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

test('the notice reaches the Situation, Read, Read talk and Learn prompts, and only when there is a conflict', () => {
  const builders = {
    situation: (conflict) => situationMessages({ ...sample, conflict }),
    read: (conflict) => readMessages({ ...sample, conflict }),
    readTalk: (conflict) => readTalkMessages({ ...sample, conflict }),
    learn: (conflict) => learnMessages({ ...sample, conflict }),
  }
  for (const [name, build] of Object.entries(builders)) {
    const [one] = noticeIn(build(hours))
    assert.equal(one.content, 'The founder said Evenings and weekends, under 15 hours before, and now says 16 hours. Open by naming both in one plain sentence using only those words, without blame, then ask what changed. Do not interpret or explain the new number.', name)
    assert.equal(noticeIn(build(null)).length, 0, name)
  }
  assert.equal(noticeIn(moveMessages({ ...sample, conflict: hours })).length, 0) // the Move has no free sentence to hold it
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
  assert.match(check('[Asking for money] is the gap, and your goal is big.').problems.join(), /markup/)
  assert.match(check('Your week is {short} and your goal is big.').problems.join(), /markup/)
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
  const out = await learn({ ...shift, supersede: [{ id: OLD, replacement: { belief: 'Works 16 hours a week.', snippet: '16' } }] }, { context: async () => turns(['axiom', ASK]) })
  assert.equal(out.status, 'done')
  const rows = supabase.rows('founder_beliefs')
  assert.deepEqual(rows.map((b) => b.status), ['active', 'active'])
  const brief = buildBriefText({ beliefs: rows, currentText: 'Ordering takes 16 hours every week.', nowMs: NOW })
  assert.match(brief, /under 15 hours/)
  assert.match(brief, /now says 16 hours/)
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

// ── Nov 19, run 2: the question, the shift, the invented unit ────────────────

test('the notice is met only when a question follows the second number', () => {
  assert.equal(namesBothAndAsks('You said under 15 hours before, and now 16. What changed?', hours), true)
  assert.equal(namesBothAndAsks('Under 15 hours before and now 16, so why 16?', hours), true)
  assert.equal(namesBothAndAsks('You said under 15 hours before, and now 16.', hours), false)
  assert.equal(namesBothAndAsks('What about 15 hours? You now say 16.', hours), false) // the question came before the second number
  assert.equal(namesBothAndAsks('What changed? Only 16 hours.', hours), false)
})

test('an offer or tapped answer may hold the one question that asks what changed; without a conflict it still may not', () => {
  const reply = (text) => ({ reply: text, citations: [], follow_ups: [], picture_json: '', move_subject: '', move_fact: '' })
  const check = (text, mode, conflict) => checkReply({ data: reply(text), mode, evidence: [], founderTexts: said, earlierTexts: EARLIER, conflict })
  const asks = 'You said under 15 hours before, and now 16 hours a week. What changed?'
  for (const mode of ['offer', 'followup']) {
    assert.deepEqual(check(asks, mode, hours).problems, [], mode)
    assert.ok(check('You said under 15 hours before, and now 16 hours a week. Your move is ready.', mode, hours).problems.includes(conflictProblem(hours)), mode)
    assert.match(check(`${asks} Why? Really?`, mode, hours).problems.join(), /at most one question/, mode)
    assert.deepEqual(check(asks, mode, null).problems, ['no question in this reply'], mode)
  }
})

const contextOf = () => turns(['axiom', ASK])
const shiftLine = 'Said under 15 hours at sign-up, then 16 hours a week now.'

test('a changed number is stored as a shift by code, from a template, with the founder words as the receipt, once per source', async () => {
  const { supabase, learn, calls } = memory({ founder_beliefs: [{ id: OLD, user_id: A, belief: 'Your time on it: evenings and weekends, under 15 hours.', kind: 'fact', confidence: 0.5, source: 'signup', status: 'active', created_at: '2026-11-14T00:00:00Z', updated_at: '2026-11-14T00:00:00Z' }] })
  assert.equal((await learn({}, { context: async () => contextOf() })).status, 'done') // the model proposed nothing
  const rows = supabase.rows('founder_beliefs')
  const stored = rows.find((b) => b.id !== OLD)
  assert.equal(stored.belief, 'Said evenings and weekends, under 15 hours before, now says 16 hours.')
  assert.equal(stored.kind, 'fact')
  assert.equal(stored.source, 'conversation')
  assert.equal(rows.find((b) => b.id === OLD).status, 'active')
  assert.deepEqual(supabase.rows('memory_evidence').map((e) => e.snippet), ['16'])
  assert.equal((await learn({}, { context: async () => contextOf() })).status, 'skipped') // the same source again: nothing more
  assert.equal(supabase.rows('founder_beliefs').length, 2)
  assert.equal(calls.length, 1)
  // the next brief shows the shift under "Earlier they said"
  const brief = buildBriefText({ beliefs: supabase.rows('founder_beliefs'), currentText: 'I can spend 16 hours on ordering.', nowMs: NOW })
  assert.match(brief, /Earlier they said:[\s\S]*now says 16 hours/)
})

test('the model proposing the same shift too stores one shift only', async () => {
  const { supabase, learn } = memory()
  await learn(shift, { context: async () => contextOf() })
  assert.equal(supabase.rows('founder_beliefs').filter((b) => /16/.test(b.belief)).length, 1)
})

test('no shift is stored when a care event is open or the topic is blocked or the founder marked it wrong', async () => {
  const care = memory({ care_events: [{ id: 'c1', user_id: A, level: 'clear', resolved_at: null, created_at: '2026-11-19T00:00:00Z' }] })
  assert.equal((await care.learn({}, { context: async () => contextOf() })).status, 'skipped_care')
  assert.equal(care.supabase.rows('founder_beliefs').length, 1)
  const blocked = memory({ founder_beliefs: [{ id: OLD, user_id: A, belief: 'Your time on it: evenings, after the kids, under 15 hours.', kind: 'fact', confidence: 0.5, source: 'signup', status: 'active', created_at: '2026-11-14T00:00:00Z', updated_at: '2026-11-14T00:00:00Z' }] })
  await blocked.learn({}, { context: async () => contextOf() })
  assert.equal(blocked.supabase.rows('founder_beliefs').length, 1) // family: blocked, like any other write
  const wrong = memory({ founder_beliefs: [{ id: OLD, user_id: A, belief: 'Your time on it: evenings and weekends, under 15 hours.', kind: 'fact', confidence: 0.5, source: 'signup', status: 'active', created_at: '2026-11-14T00:00:00Z', updated_at: '2026-11-14T00:00:00Z' }], founder_corrections: [{ id: 'k1', user_id: A, item_table: 'founder_beliefs', item_text: 'Said evenings and weekends, under 15 hours before, now says 16 hours.', reason: 'wrong', created_at: '2026-11-18T00:00:00Z' }] })
  await wrong.learn({}, { context: async () => contextOf() })
  assert.equal(wrong.supabase.rows('founder_beliefs').length, 1)
})

test('a bare number never gets a unit that neither the message nor its question holds', async () => {
  const q = 'When you order products yourself, how long does one ordering session take?'
  const ctx = async () => turns(['axiom', q])
  const invented = memory({ founder_beliefs: [] })
  await invented.learn({ new_beliefs: [{ belief: 'Ordering products takes 16 minutes per session.', kind: 'fact', snippet: '16', shifts_from: '' }] }, { context: ctx })
  assert.equal(invented.supabase.rows('founder_beliefs').length, 0)
  const fine = memory({ founder_beliefs: [] })
  await fine.learn({ new_beliefs: [{ belief: 'Ordering takes 16 per session.', kind: 'fact', snippet: '16', shifts_from: '' }] }, { context: ctx })
  assert.equal(fine.supabase.rows('founder_beliefs').length, 1)
  const stated = memory({ founder_beliefs: [] })
  await stated.learn({ new_beliefs: [{ belief: 'Can give 16 hours a week.', kind: 'fact', snippet: 'I can give 16 hours a week', shifts_from: '' }] }, { text: 'I can give 16 hours a week', context: ctx })
  assert.equal(stated.supabase.rows('founder_beliefs').length, 1)
  const asked = memory({ founder_beliefs: [] })
  await asked.learn({ new_beliefs: [{ belief: 'Spends 16 minutes per session.', kind: 'fact', snippet: '16', shifts_from: '' }] }, { context: async () => turns(['axiom', 'How many minutes does one session take?']) })
  assert.equal(asked.supabase.rows('founder_beliefs').length, 1) // the question said minutes
})

test('a stated plan for later is stored even when the founder types "Ill" for "I\'ll"; one decision becomes one thread, once', async () => {
  const text = 'Ill give other work to employees further in the future to save time'
  const { supabase, learn } = memory({ founder_beliefs: [] })
  const out = {
    new_beliefs: [{ belief: 'Plans to give other work to employees in the future to save time.', kind: 'fact', snippet: text, shifts_from: '' }],
    threads: [{ title: 'Order manually or hand off the work', kind: 'open_question' }, { title: 'Hand off the ordering work or order manually', kind: 'open_question' }],
  }
  assert.equal((await learn(out, { text })).status, 'done')
  assert.equal(supabase.rows('founder_beliefs').length, 1)
  assert.equal(supabase.rows('founder_threads').length, 1) // two titles in one message: one thread
  await learn(out, { text, sourceId: '00000000-0000-4000-8000-000000000102' })
  assert.equal(supabase.rows('founder_threads').length, 1) // the reworded decision is the same open thread
})

test('a bare answer takes its unit from the question, not from an earlier stored line (the model shift is dropped without one)', async () => {
  const noQuestion = memory()
  await noQuestion.learn(shift) // bare "16", no question: "hours" would come only from the old fact
  assert.ok(!noQuestion.supabase.rows('founder_beliefs').some((b) => /16 hours/.test(b.belief)))
  const withQuestion = memory()
  await withQuestion.learn(shift, { context: async () => turns(['axiom', ASK]) })
  assert.ok(withQuestion.supabase.rows('founder_beliefs').some((b) => /16 hours/.test(b.belief)))
})

test('the shift quotes only the clause around the number, at most 12 words', () => {
  const found = (text) => findConflict({ transcript: turns(['axiom', 'What changed?'], ['founder', text]), earlier: EARLIER })
  assert.equal(found('I looked at the whole thing last night and honestly I can do 16 hours a week, and then I will hire help').nowText, 'honestly I can do 16 hours a week')
  assert.equal(found('Im okay with working on it 16 hours a week').nowText, 'Im okay with working on it 16 hours a week')
  const long = found('so basically over the next few months with everything that is going on at home and work it is 16 hours a week at most').nowText
  assert.ok(long.split(' ').length <= 12 && long.includes('16 hours'))
})

test('a conflict the Read talk named in a discarded reply is still named by the lesson (only seen Axiom turns count)', () => {
  const transcript = turns(['axiom', ASK], ['founder', 'Im okay with working on it 16 hours a week'])
  assert.ok(findConflict({ transcript, earlier: EARLIER }))
  assert.equal(findConflict({ transcript: [...transcript, ...turns(['axiom', 'You said under 15 hours before, and now 16. What changed?'], ['founder', 'more time']) ], earlier: EARLIER }), null)
})

test('a follow-up chip that asks what changed is dropped when the reply already asked it', () => {
  const data = { ...lesson(BOTH), follow_ups: ['What changed with the 16 hours?', 'How do I protect the time?'] }
  const out = checkReply({ data, mode: 'lesson', evidence, founderTexts: said, earlierTexts: EARLIER, conflict: hours })
  assert.deepEqual(out.reply.follow_ups, ['How do I protect the time?'])
  assert.deepEqual(checkReply({ data, mode: 'lesson', evidence, founderTexts: said, earlierTexts: EARLIER }).reply.follow_ups, data.follow_ups)
})

test('a Learn reply that still has a contrast or no closing question after the retry never ships as is', async () => {
  const bad = lesson('Rob Fitzpatrick says ask about their life. Ordering is not the problem, it is the 16 hours a week of your life. What will you ask first?')
  const run = async (outputs, extra = {}) => composeReply({ mode: 'lesson', step: 'learn', evidence, founderTexts: said, earlierTexts: EARLIER, context: { brief, situation: [], read: null, learn: [] }, deps: { callStructured: async () => ({ data: outputs.shift() }) }, ...extra })
  // repaired: the contrast sentence goes, the citation sentence and the question stay
  const fixed = await run([bad, bad])
  assert.equal(contrastProblem(fixed.text), null)
  assert.match(fixed.text, /^Rob Fitzpatrick says ask about their life\. What will you ask first\?$/)
  assert.equal(fixed.sources.length, 1)
  // no closing question: the plain reply, no source, no contrast, one question
  const noQ = lesson('Rob Fitzpatrick says ask about their life. Ordering takes 16 hours a week of your life.')
  const plain = await run([noQ, noQ])
  assert.deepEqual(plain.sources, [])
  assert.match(plain.text, /^I could not find a lesson on this that I trust, so I will not guess\. On .*: what is the next step, as you see it\?$/)
  assert.equal(plain.text.match(/\?/g).length, 1)
  // a failed second call after a hard failure also gets the repair
  const calls = [bad]
  const afterError = await composeReply({ mode: 'lesson', step: 'learn', evidence, founderTexts: said, earlierTexts: EARLIER, context: { brief, situation: [], read: null, learn: [] }, deps: { callStructured: async () => { if (calls.length) return { data: calls.shift() }; throw new Error('down') } } })
  assert.equal(contrastProblem(afterError.text), null)
})
