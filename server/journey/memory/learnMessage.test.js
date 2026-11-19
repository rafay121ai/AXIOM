import assert from 'node:assert/strict'
import test from 'node:test'
import { createFakeClock, createFakeSupabase } from '../../testing/fakes.js'
import { EMPTY_BELIEFS } from '../../e2e/harness.js'
import { memoryIdle, runMemoryPass } from './extractBeliefs.js'
import { createMessageLearner, learnFromMessage } from './learnMessage.js'
import { earlierLines, loadBrief } from './brief.js'
import { createMemoryStore } from './memoryStore.js'

const A = '11111111-1111-4111-8111-111111111111'
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const SIT = uuid(100)
const TURN = uuid(101)
const OLD = uuid(500)
const NOW = Date.parse('2026-11-19T12:00:00.000Z')
const DAY = 86400000
const at = (ms) => new Date(ms).toISOString()
const SIGNUP_FACT = 'Works evenings and weekends, under 15 hours a week.'
const MSG = 'Ordering the products from suppliers takes me 16 hours a week.'

const signup = (over = {}) => ({ id: OLD, user_id: A, belief: SIGNUP_FACT, kind: 'fact', confidence: 0.5, source: 'signup', status: 'active', created_at: at(NOW - 5 * DAY), updated_at: at(NOW - 5 * DAY), ...over })

function setup(over = {}) {
  const supabase = createFakeSupabase({
    tables: { situations: [{ id: SIT, user_id: A, title: 'Ordering', status: 'open', created_at: at(NOW - 2 * DAY) }], founder_beliefs: [signup()], ...over },
  })
  const clock = createFakeClock(NOW)
  const calls = []
  const model = (output) => async (args) => {
    calls.push(args)
    if (output instanceof Error) throw output
    return { data: { ...EMPTY_BELIEFS, ...output }, model: 'gpt-4.1-mini' }
  }
  const learn = (output, extra = {}) => learnFromMessage({
    supabase, clock, callStructured: model(output), userId: A, sourceKind: 'situation', sourceId: TURN, situationId: SIT, text: MSG, ...extra,
  })
  return { supabase, clock, calls, model, learn }
}
const shift = (extra = {}) => ({ new_beliefs: [{ belief: 'Said under 15 hours at sign-up, then 16 hours a week for ordering products.', kind: 'fact', snippet: '16 hours a week', shifts_from: OLD, ...extra }] })
const texts = (supabase) => supabase.rows('founder_beliefs').map((b) => b.belief)
// MSG changes the sign-up 15 to 16, so the server itself stores this shift, whatever the model proposes.
const CODE_SHIFT = 'Said works evenings and weekends, under 15 hours a week before, now says Ordering the products from suppliers takes them 16 hours a week.'

test('15 then 16: the shift is stored, the old fact stays, and the next brief names both', async () => {
  const { supabase, calls, learn } = setup()
  assert.equal((await learn(shift())).status, 'done')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].usageContext.mode, 'message')
  assert.equal(calls[0].usageContext.source_kind, 'situation')
  assert.equal(calls[0].step, 'beliefs')
  const old = supabase.rows('founder_beliefs').find((b) => b.id === OLD)
  assert.equal(old.status, 'active')
  const made = supabase.rows('founder_beliefs').find((b) => b.id !== OLD)
  assert.deepEqual([made.kind, made.source, made.status], ['fact', 'conversation', 'active'])
  assert.deepEqual(supabase.rows('memory_evidence').map((e) => [e.source_kind, e.source_id, e.snippet]), [['situation', TURN, 'Ordering the products from suppliers takes me 16 hours a week']])
  assert.equal(supabase.rows('memory_runs').length, 0)
  const brief = await loadBrief(supabase, A, 'Ordering takes 16 hours every week and I plan to delegate it.', NOW)
  assert.ok(earlierLines(brief).includes(made.belief), brief)
  assert.ok(earlierLines(brief).includes(SIGNUP_FACT), brief)
})

test('the old number is allowed for a shift only: not without shifts_from, not for a made-up id, not for a snippet', async () => {
  for (const out of [shift({ shifts_from: '' }), shift({ shifts_from: uuid(999) }), shift({ snippet: 'under 15 hours at sign-up' })]) {
    const { supabase, learn } = setup()
    await learn(out)
    assert.deepEqual(texts(supabase), [SIGNUP_FACT, CODE_SHIFT]) // only the code's own shift, never the model's
  }
})

test('an invented number is rejected, even when the shift names the old one', async () => {
  const { supabase, learn } = setup()
  await learn(shift({ belief: 'Said under 15 hours at sign-up, then 20 hours a week for ordering products.' }))
  await learn({ new_beliefs: [{ belief: 'Pays 40 dollars a month for ordering tools.', kind: 'fact', snippet: '16 hours a week', shifts_from: '' }] }, { sourceId: uuid(102) })
  assert.deepEqual(texts(supabase), [SIGNUP_FACT, CODE_SHIFT])
})

test('a snippet that is only in the earlier turns is rejected', async () => {
  const { supabase, learn } = setup()
  await learn({ new_beliefs: [{ belief: 'Sells candles to shops.', kind: 'fact', snippet: 'I sell candles to shops', shifts_from: '' }] },
    { context: async () => [{ role: 'founder', text: 'I sell candles to shops in the city.' }] })
  assert.deepEqual(texts(supabase), [SIGNUP_FACT, CODE_SHIFT])
})

test('the earlier turns reach the model as context, at most 6, next to the one message', async () => {
  const { calls, learn } = setup()
  await learn({}, { context: async () => Array.from({ length: 9 }, (_, i) => ({ role: 'founder', text: `turn ${i}` })) })
  const input = JSON.parse(calls[0].messages.at(-1).content)
  assert.equal(input.message, MSG)
  assert.deepEqual(input.context.map((t) => t.text), ['turn 3', 'turn 4', 'turn 5', 'turn 6', 'turn 7', 'turn 8'])
  assert.deepEqual(input.memory.beliefs.map((b) => b.id), [OLD])
})

test('filler, a short message, care and the daily cap each make no model call', async () => {
  for (const [name, text, extra, tables] of [
    ['filler', 'I understand, great question, certainly', {}, {}],
    ['short', 'Yes do that', {}, {}],
    ['cap', MSG, { isCapped: async () => true }, {}],
    ['care open', MSG, {}, { care_events: [{ id: uuid(7), user_id: A, level: 'clear', created_at: at(NOW - DAY), resolved_at: null }] }],
    ['care flag', MSG, {}, { situations: [{ id: SIT, user_id: A, title: 'x', status: 'open', care_flag: true, created_at: at(NOW - 2 * DAY) }] }],
  ]) {
    const { supabase, calls, learn } = setup(tables)
    const out = await learn(shift(), { text, ...extra })
    assert.notEqual(out.status, 'done', name)
    assert.equal(calls.length, 0, name)
    assert.equal(supabase.rows('founder_beliefs').length, 1, name)
  }
})

test('a failed model call writes nothing and does not throw', async () => {
  const { supabase, learn } = setup()
  assert.deepEqual(await learn(new Error('boom')), { status: 'failed' })
  assert.equal(supabase.rows('memory_evidence').length, 0)
})

test('the same message twice stores once: a client retry never counts a reinforcement twice', async () => {
  const { supabase, calls, learn } = setup()
  const again = { reinforce: [{ id: OLD, snippet: 'ordering the products from suppliers' }] }
  const text = 'I keep ordering the products from suppliers myself.' // no changed number: the server stores no shift of its own
  assert.equal((await learn(again, { text })).status, 'done')
  assert.equal((await learn(again, { text })).status, 'skipped')
  assert.equal(calls.length, 1)
  assert.equal(supabase.rows('founder_beliefs')[0].confidence, 0.5) // a sign-up fact stays at the self-report cap
  assert.equal(supabase.rows('memory_evidence').length, 1)
})

test('family, health and money trouble are never stored', async () => {
  for (const [text, belief] of [
    ['My mother is unwell so I only work 3 hours this week.', 'Works 3 hours this week because a parent is unwell.'],
    ['I was sick all week so the supplier order slipped.', 'Was sick all week so the supplier order slipped.'],
    ['I am behind on rent so the supplier order has to wait.', 'Is behind on rent so the supplier order waits.'],
  ]) {
    const { supabase, learn } = setup()
    await learn({ new_beliefs: [{ belief, kind: 'fact', snippet: text, shifts_from: '' }] }, { text })
    assert.deepEqual(texts(supabase), [SIGNUP_FACT], text)
  }
})

test('a per-message pass never decays old facts', async () => {
  const { supabase, learn } = setup({ founder_beliefs: [signup({ confidence: 0.6, updated_at: at(NOW - 120 * DAY) })] })
  await learn({})
  assert.equal(supabase.rows('founder_beliefs')[0].confidence, 0.6)
})

test('a later facts-only pass does not duplicate what the message pass stored', async () => {
  const { supabase, clock, learn } = setup({
    situation_turns: [{ id: TURN, seq: 1, situation_id: SIT, role: 'founder', text: 'I sell candles to shops and ordering takes 16 hours a week.', filler: false }],
    moves: [{ id: uuid(300), user_id: A, situation_id: SIT, status: 'closed_no_report', title: 'x', mission: 'y' }],
  })
  const fact = { new_beliefs: [{ belief: 'Sells candles to shops.', kind: 'fact', snippet: 'I sell candles to shops', shifts_from: '' }] }
  await learn(fact, { text: 'I sell candles to shops and ordering takes 16 hours a week.' })
  const { shifts_from: _drop, ...plain } = fact.new_beliefs[0]
  await runMemoryPass({
    supabase, clock, store: createMemoryStore({ supabase, clock }), userId: A, sourceKind: 'situation', sourceId: SIT, mode: 'facts_only',
    callStructured: async () => ({ data: (({ traits: _t, ...rest }) => ({ ...rest, new_beliefs: [plain] }))(EMPTY_BELIEFS), model: 'm' }),
  })
  assert.equal(texts(supabase).filter((t) => t === 'Sells candles to shops.').length, 1)
})

test('the scheduled pass never delays the reply: the caller gets control before the model answers', async () => {
  const { supabase, clock } = setup()
  let release
  const gate = new Promise((r) => { release = r })
  let called = false
  const callStructured = async () => { called = true; await gate; return { data: EMPTY_BELIEFS, model: 'm' } }
  const learn = createMessageLearner({ supabase, clock, callStructured })
  const pending = learn({ userId: A, sourceKind: 'learn', sourceId: TURN, situationId: SIT, text: MSG })
  assert.equal(called, false)
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(called, true)
  release()
  await pending
  await memoryIdle()
})
