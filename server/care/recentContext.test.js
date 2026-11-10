// Care context: earlier founder messages reach the classifier only when the rules need the model.
import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import { createCare, bodyFields } from './middleware.js'
import { createRecentContext } from './recentContext.js'
import { classifyCare } from './classify.js'
import { createFakeClock, createFakeSupabase } from '../testing/fakes.js'

const A = '11111111-1111-4111-8111-111111111111'
const B = '33333333-3333-4333-8333-333333333333'
const SIT = '44444444-4444-4444-8444-444444444444'
const CONV = '55555555-5555-4555-8555-555555555555'
const MOVE = '66666666-6666-4666-8666-666666666666'
const at = (n) => `2026-11-09T10:00:${String(n).padStart(2, '0')}.000Z`
const turn = (n, text, extra = {}) => ({ situation_id: SIT, role: 'founder', text, filler: false, created_at: at(n), ...extra })

const seed = (extra = {}) => createFakeSupabase({
  tables: {
    situations: [{ id: SIT, user_id: A }],
    learn_conversations: [{ id: CONV, situation_id: SIT, user_id: A }],
    moves: [{ id: MOVE, situation_id: SIT, user_id: A }],
    situation_turns: [
      turn(1, 'first'), turn(2, 'axiom asks', { role: 'axiom' }), turn(3, 'filler', { filler: true }),
      turn(4, 'read talk', { result: { read_talk: true } }), turn(5, 'x'.repeat(700)),
    ],
    learn_turns: [
      { conversation_id: CONV, role: 'founder', text: 'learn reply', filler: false, created_at: at(6) },
      { conversation_id: CONV, role: 'axiom', text: 'lesson', filler: false, created_at: at(7) },
    ],
    ...extra,
  },
})

const reqOf = (user, id, body = {}) => ({ user: { id: user }, params: { id }, body })

test('context: last 4 founder messages, oldest first, no filler, no axiom rows', async () => {
  const ctx = createRecentContext({ supabase: seed() })
  const out = await ctx.forSituation(reqOf(A, SIT, { text: 'now' }))
  assert.deepEqual(out, ['first', 'read talk', 'x'.repeat(700), 'learn reply'])
})

test('learn and move routes resolve the same situation', async () => {
  const ctx = createRecentContext({ supabase: seed() })
  const want = await ctx.forSituation(reqOf(A, SIT))
  assert.deepEqual(await ctx.forLearn(reqOf(A, CONV)), want)
  assert.deepEqual(await ctx.forMove(reqOf(A, MOVE)), want)
})

test('fewer than 4 messages, and the message being screened is left out', async () => {
  const supabase = createFakeSupabase({ tables: { situations: [{ id: SIT, user_id: A }], situation_turns: [turn(1, 'one'), turn(2, 'two')] } })
  const ctx = createRecentContext({ supabase })
  assert.deepEqual(await ctx.forSituation(reqOf(A, SIT, { text: 'two' })), ['one'])
  assert.deepEqual(await ctx.forSituation(reqOf(A, SIT, { text: 'new' })), ['one', 'two'])
})

test('another founder never reads this situation; bad ids and no situation give []', async () => {
  const supabase = seed()
  const ctx = createRecentContext({ supabase })
  assert.deepEqual(await ctx.forSituation(reqOf(B, SIT)), [])
  assert.deepEqual(await ctx.forLearn(reqOf(B, CONV)), [])
  assert.deepEqual(await ctx.forMove(reqOf(B, MOVE)), [])
  assert.deepEqual(await ctx.forSituation(reqOf(A, 'nope')), [])
  assert.deepEqual(await ctx.forSituation({ user: { id: A }, body: {} }), [])
})

test('lookup failure gives [] and logs no message text', async () => {
  const logged = []
  const supabase = { from() { throw new Error('db down') } }
  const ctx = createRecentContext({ supabase, log: (...a) => logged.push(a.join(' ')) })
  assert.deepEqual(await ctx.forSituation(reqOf(A, SIT)), [])
  assert.equal(logged.length, 1)
})

test('classifier: only the last 4 are sent, each clipped to 500; rules-first never calls the model', async () => {
  let input
  const model = async (args) => { input = JSON.parse(args.messages[1].content); return { data: { level: 'none', reason: 'x' } } }
  await classifyCare({ text: 'i feel hopeless', context: ['a', 'b', 'c', 'd', 'e', 'y'.repeat(900)], deps: { callStructured: model } })
  assert.deepEqual(input.recent_context.map((c) => c.length), [1, 1, 1, 1, 500].slice(-4).length === 4 ? [1, 1, 1, 500] : [])
  assert.equal(input.recent_context.length, 4)
  assert.deepEqual(input.recent_context.slice(0, 3), ['c', 'd', 'e'])
  const never = () => { throw new Error('model must not be called') }
  assert.equal((await classifyCare({ text: 'I want to kill myself', context: ['a'], deps: { callStructured: never } })).level, 'clear')
  assert.equal((await classifyCare({ text: 'Plan my week', context: ['a'], deps: { callStructured: never } })).level, 'none')
})

async function gate({ supabase, context, text, model }) {
  const care = createCare({ supabase: createFakeSupabase(), callStructured: model, clock: createFakeClock() })
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { req.user = { id: A }; req.params = {}; next() })
  app.post('/x', (req, res, next) => { req.params = { id: SIT }; next() }, care.careGate(bodyFields('text'), context), (_req, res) => res.json({ ok: true }))
  const server = app.listen(0)
  try {
    await new Promise((r) => server.once('listening', r))
    const res = await fetch(`http://127.0.0.1:${server.address().port}/x`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) })
    return await res.json()
  } finally {
    await new Promise((r) => server.close(r))
  }
}

// Unclear only when the model sees earlier messages: the escalation across turns.
const escalating = async (args) => ({ data: { level: JSON.parse(args.messages[1].content).recent_context.length ? 'unclear' : 'none', reason: 'x' } })

test('escalation: a weak signal is unclear with context, not without', async () => {
  const supabase = createFakeSupabase({ tables: {
    situations: [{ id: SIT, user_id: A }],
    situation_turns: [turn(1, 'tired of everything'), turn(2, 'nothing matters lately'), turn(3, 'give up on the launch')],
  } })
  const context = createRecentContext({ supabase }).forSituation
  assert.equal((await gate({ supabase, context, text: 'i feel hopeless', model: escalating })).care, 'unclear')
  assert.deepEqual(await gate({ supabase, context: null, text: 'i feel hopeless', model: escalating }), { ok: true })
})

test('a failing or throwing context function still screens with the same verdict', async () => {
  const supabase = seed()
  const boom = async () => { throw new Error('x') }
  assert.deepEqual(await gate({ supabase, context: boom, text: 'i feel hopeless', model: escalating }), { ok: true })
  const clear = await gate({ supabase, context: boom, text: 'I want to kill myself', model: escalating })
  assert.equal(clear.care, 'clear')
})

test('context is lazy: rules-settled messages never call it, weak signals call it once', async () => {
  let calls = 0
  const context = () => { calls += 1; return ['earlier'] }
  const model = async () => ({ data: { level: 'none', reason: 'x' } })
  for (const text of ['I want to kill myself', 'Plan my week']) {
    await classifyCare({ text, context, deps: { callStructured: model } })
  }
  assert.equal(calls, 0)
  await classifyCare({ text: 'i feel hopeless', context, deps: { callStructured: model } })
  assert.equal(calls, 1)
  const seen = []
  await classifyCare({ text: 'i feel hopeless', context: async () => ['x'], deps: { callStructured: async (a) => { seen.push(JSON.parse(a.messages[1].content).recent_context); return { data: { level: 'none', reason: 'x' } } } } })
  assert.deepEqual(seen, [['x']])
  const thrown = await classifyCare({ text: 'i feel hopeless', context: () => { throw new Error('x') }, deps: { callStructured: model } })
  assert.equal(thrown.level, 'none')
})
