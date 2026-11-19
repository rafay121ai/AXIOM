// Replay 4 fixes (anonymised fixtures): the what-changed question survives the Learn repair, an invented "You said" and a guessed
// unit fail, a bare answer borrows no unit, one thread per situation, the softer contrast, the conflict notice wording.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createFakeClock, createFakeSupabase } from '../testing/fakes.js'
import { EMPTY_BELIEFS } from '../e2e/harness.js'
import { composeReply } from './learn/reply.js'
import { learnMessages } from './learn/prompts/learn.js'
import { briefMessages } from './memory/brief.js'
import { changeQuestion, findConflict } from './memory/conflicts.js'
import { learnFromMessage } from './memory/learnMessage.js'
import { retireSituationMemory } from './memory/retireSituation.js'
import { ensureSituationThread } from './memory/situationThread.js'
import { contrastProblem, looseUnit, pairsOf, saidProblem } from './ownWords.js'
import { checkRead } from './theRead.js'

const A = '11111111-1111-4111-8111-111111111111'
const u = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const SIT = u(100)
const NOW = Date.parse('2026-11-19T12:00:00.000Z')
const at = (ms) => new Date(ms).toISOString()

// ── A: the what-changed question survives the repair ─────────────────────────
const EARLIER = ['Your time on it: evenings and weekends, under 15 hours.']
const ASKED = [{ role: 'axiom', text: 'How many hours a week does the ordering take?' }, { role: 'founder', text: '16' }]
const conflict = findConflict({ transcript: ASKED, earlier: EARLIER })

test('A: a lesson with the what-changed question and a generic closing keeps what changed, last, and drops the generic one', async () => {
  const text = 'You started with under 15 hours and now you are okay with 16 hours a week. What changed? Facts about the past beat opinions about the future, so keep the plan on what you have done, not what sounds workable. What are you trying to do here?'
  const callStructured = async () => ({ data: { reply: text, citations: [], picture_json: '', follow_ups: [], move_subject: '', move_fact: '' } })
  const logs = []
  const out = await composeReply({
    mode: 'lesson', step: 'learn', context: { learn: [] }, evidence: [], founderTexts: ['16', 'I order the products by myself'], earlierTexts: [conflict.earlierClause], conflict,
    usageContext: {}, deps: { callStructured, userId: A, log: (...a) => logs.push(a) },
  })
  assert.match(out.text, /What changed\?$/)
  assert.doesNotMatch(out.text, /trying to do here/)
  assert.equal((out.text.match(/\?/g) ?? []).length, 1)
  assert.match(out.text, /under 15 hours and now you are okay with 16 hours a week/)
})

test('A: changeQuestion is the first question from the sentence that completes both numbers', () => {
  assert.equal(changeQuestion('Why? You said under 15 hours, now 16. What changed? And then?', conflict), 'What changed?')
  assert.equal(changeQuestion('You said under 15 hours, now 16.', conflict), null)
})

test('A: the generic closing is replaced by the what-changed question in the lesson and reply prompts, only with a conflict', () => {
  const sys = (c, mode) => learnMessages({ mode, situation: [], read: {}, learn: [], evidence: [], conflict: c }).filter((m) => m.role === 'system').map((m) => m.content).join('\n')
  for (const mode of ['lesson', 'reply']) {
    assert.match(sys(conflict, mode), /replaces the closing question above: ask no other question/)
    assert.doesNotMatch(sys(null, mode), /replaces the closing question above/)
  }
})

// ── B: invented attribution and units ────────────────────────────────────────
const SAID = ['I want to order the products myself', 'home responsibilities and personal stuff', '16']

test('B: "You said <clause>" needs 80% of the clause in their words; a unit they never gave fails', () => {
  assert.match(saidProblem('You said the part that takes the most time is placing and tracking the orders, 16 units of time.', SAID), /not something they said/)
  assert.equal(saidProblem('You said you want to order the products yourself.', SAID), null)
  assert.equal(saidProblem('At sign-up you said under 15 hours a week. What changed?', ['16'].concat(EARLIER)), null)
  assert.equal(saidProblem('Ordering takes your time.', SAID), null)
  const pairs = pairsOf(SAID)
  assert.equal(looseUnit('That is 16 units of time.', pairs).unit, 'unit')
  assert.equal(looseUnit('What changed between under 15 hours and the 16 you gave?', pairsOf([...SAID, ...EARLIER])), null)
})

test('B: the Read fails on an invented "You said" or a guessed unit', () => {
  const read = { headline: 'Ordering by hand has no number on it yet.', body: 'You gave a reason but no count, and the ordering is still yours alone.', closing_question: 'How many hours does one ordering round take?' }
  const check = (over) => checkRead({ read: { ...read, ...over }, answerTexts: SAID }).problems.join()
  assert.doesNotMatch(check({}), /not something they said|never put after it/)
  assert.match(check({ body: 'You told me that tracking orders eats 16 units of time every day.' }), /not something they said/)
  assert.match(check({ closing_question: 'Is 16 units of time right?' }), /never put after it: 16 unit/)
})

// ── C: a bare answer borrows no unit from an earlier stored line ─────────────
test('C: a bare "16" answering a question with no unit is not stored as hours, even when an earlier line shares a topic word', async () => {
  const OLD = u(500)
  const old = { id: OLD, user_id: A, belief: 'Spends the time on it in evenings, under 15 hours a week.', kind: 'fact', confidence: 0.5, source: 'signup', status: 'active', created_at: at(NOW - 5 * 864e5), updated_at: at(NOW - 5 * 864e5) }
  const run = async (text) => {
    const supabase = createFakeSupabase({ tables: { situations: [{ id: SIT, user_id: A, title: 'Ordering', status: 'open', created_at: at(NOW - 2 * 864e5) }], founder_beliefs: [old] } })
    const model = async () => ({ data: { ...EMPTY_BELIEFS, new_beliefs: [{ belief: 'Can give 16 hours a week.', kind: 'fact', snippet: '16', shifts_from: OLD }] } })
    await learnFromMessage({
      supabase, clock: createFakeClock(NOW), callStructured: model, userId: A, sourceKind: 'read', sourceId: u(101), situationId: SIT, text, closing: true,
      context: async () => [{ role: 'axiom', text: 'Which part of the ordering takes the most time?' }],
    })
    return supabase.rows('founder_beliefs').map((b) => b.belief)
  }
  assert.ok(!(await run('16')).some((b) => /16 hours/.test(b)))
  // The same belief from a message that says hours itself is stored.
  assert.ok((await run('I can give 16 hours a week')).some((b) => /16 hours/.test(b)))
})

// ── D: one open thread per situation ─────────────────────────────────────────
const TITLE = 'Ordering the products by myself'
function threadSetup(over = {}) {
  const supabase = createFakeSupabase({ tables: {
    situations: [{ id: SIT, user_id: A, title: TITLE, status: 'open', created_at: at(NOW - 2 * 864e5) }],
    situation_turns: [{ id: u(101), situation_id: SIT, role: 'founder', text: 'I want to start ordering the products by myself.', filler: false }],
    ...over,
  } })
  const make = () => ensureSituationThread({ supabase, userId: A, situationId: SIT, clock: createFakeClock(NOW) })
  return { supabase, make }
}

test('D: one open question thread from the situation title, with a situation receipt, never twice', async () => {
  const { supabase, make } = threadSetup()
  assert.equal((await make()).status, 'done')
  assert.deepEqual(supabase.rows('founder_threads').map((t) => [t.title, t.kind, t.status]), [[TITLE, 'open_question', 'open']])
  assert.deepEqual(supabase.rows('memory_evidence').map((e) => [e.item_table, e.source_kind, e.source_id]), [['founder_threads', 'situation', SIT]])
  assert.equal((await make()).status, 'skipped')
  await Promise.all([make(), make()])
  assert.equal(supabase.rows('founder_threads').length, 1)
})

test('D: no thread for a care situation, a title the founder marked wrong, or a title with an invented number', async () => {
  const care = threadSetup({ care_events: [{ id: u(1), user_id: A, level: 'watch', scope_id: SIT, created_at: at(NOW - 864e5), resolved_at: at(NOW) }] })
  assert.equal((await care.make()).status, 'skipped_care')
  const wrong = threadSetup({ founder_corrections: [{ id: u(2), user_id: A, item_table: 'founder_threads', item_text: 'Ordering the products by myself', reason: 'wrong' }] })
  assert.equal((await wrong.make()).status, 'skipped')
  const similar = threadSetup({ founder_corrections: [{ id: u(3), user_id: A, item_table: 'founder_threads', item_text: 'Ordering the products by myself today', reason: 'wrong' }] })
  assert.equal((await similar.make()).status, 'skipped')
  const invented = threadSetup({ situations: [{ id: SIT, user_id: A, title: 'Ordering 40 products by myself', status: 'open', created_at: at(NOW - 2 * 864e5) }] })
  assert.equal((await invented.make()).status, 'skipped')
  for (const t of [care, wrong, similar, invented]) assert.equal(t.supabase.rows('founder_threads').length, 0)
})

test('D: retire-on-care drops the situation thread and keeps the receipt', async () => {
  const { supabase, make } = threadSetup()
  await make()
  assert.equal((await retireSituationMemory({ supabase, userId: A, situationId: SIT })).retired, 1)
  assert.equal(supabase.rows('founder_threads')[0].status, 'dropped')
  assert.equal(supabase.rows('memory_evidence').length, 1)
})

// ── E: the notice sentence ───────────────────────────────────────────────────
test('E: the notice holds the earlier clause and what they said now, not the sign-up label or the whole line', () => {
  const brief = 'Earlier they said:\n- Your time on it: evenings and weekends, under 15 hours.'
  const notice = briefMessages(brief, conflict)[1].content
  assert.match(notice, /^The founder said under 15 hours before, and now says 16 hours\./)
  assert.doesNotMatch(notice, /Your time on it|Evenings and weekends/)
})

// ── F: the softer contrast ───────────────────────────────────────────────────
test('F: ", not what/how/who/when/where/whether/that/the way ..." is a contrast; ordinary negation and "not just" are not', () => {
  for (const t of [
    'Keep this on what you have already done, not what sounds workable.',
    'Ask how they pay today, not how they say they would.',
    'Talk to who buys, not who might.',
    'Say it the way they said it, not the way you would.',
  ]) assert.ok(contrastProblem(t), t)
  for (const t of [
    'I am not sure what they pay.',
    'It matters, not just for price but for timing.',
    'Ask what they pay today. Not that it is simple.',
    'Two clinics have not replied, which matters.',
  ]) assert.equal(contrastProblem(t), null, t)
})
