import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import { createCare } from '../../care/middleware.js'
import { createFakeClock, createFakeSupabase } from '../../testing/fakes.js'
import { memoryIdle } from './extractBeliefs.js'
import { loadBrief } from './brief.js'
import { createMemoryScreen } from './memoryScreen.js'
import { retireAfterCare, retireSituationMemory } from './retireSituation.js'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const u = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const SIT = u(100)
const OTHER = u(200)
const at = '2026-11-19T10:00:00.000Z'
const ev = (user, table, item, kind, id, key = null) => ({ id: u(9000 + Math.floor(Math.random() * 1e6)), user_id: user, item_table: table, item_id: item, source_kind: kind, source_id: id, source_key: key, snippet: 'x', created_at: at })
const belief = (id, text, over = {}) => ({ id, user_id: A, belief: text, kind: 'fact', confidence: 0.6, source: 'conversation', status: 'active', superseded_by: null, created_at: at, updated_at: at, ...over })

function setup() {
  const supabase = createFakeSupabase({ tables: {
    situations: [{ id: SIT, user_id: A, title: 'a', status: 'open', created_at: at }, { id: OTHER, user_id: A, title: 'b', status: 'open', created_at: at }, { id: u(300), user_id: B, title: 'c', status: 'open', created_at: at }],
    situation_turns: [101, 102, 103].map((n) => ({ id: u(n), situation_id: SIT, role: 'founder' })).concat([{ id: u(201), situation_id: OTHER, role: 'founder' }]),
    reads: [{ id: u(110), situation_id: SIT }],
    learn_conversations: [{ id: u(120), user_id: A, situation_id: SIT }],
    learn_turns: [{ id: u(121), conversation_id: u(120) }],
    moves: [{ id: u(130), user_id: A, situation_id: SIT }],
    founder_beliefs: [
      belief(u(1), 'Sells candles to shops.'), belief(u(2), 'Said under 15 hours, then 16 hours a week.'), belief(u(3), 'Works evenings.', { source: 'signup' }),
      belief(u(4), 'Mixed: sign-up and this chat.'), belief(u(5), 'From another situation.'), belief(u(6), 'Also from another situation and this one.'), belief(u(7), 'Another founder.', { user_id: B }),
    ],
    founder_traits: [{ id: u(10), user_id: A, dimension: 'decides', value: 'fast', confidence: 0.5, origin: 'observed', status: 'active', created_at: at, updated_at: at }],
    founder_world: [{ id: u(20), user_id: A, name: 'Dana', kind: 'person', role: null, mention_count: 1, last_mentioned_at: at, status: 'active', created_at: at, updated_at: at }],
    founder_vocabulary: [{ id: u(30), user_id: A, term: 'the grind', meaning: 'ordering', confidence: 0.5, mention_count: 1, status: 'active', created_at: at, updated_at: at }],
    founder_threads: [{ id: u(40), user_id: A, title: 'Hire a packer', kind: 'goal', status: 'open', created_at: at, updated_at: at }],
    memory_evidence: [
      ev(A, 'founder_beliefs', u(1), 'situation', u(101)), ev(A, 'founder_beliefs', u(2), 'situation', u(102)), ev(A, 'founder_beliefs', u(3), 'signup', null, 'k'),
      ev(A, 'founder_beliefs', u(4), 'signup', null, 'k'), ev(A, 'founder_beliefs', u(4), 'situation', u(103)),
      ev(A, 'founder_beliefs', u(5), 'situation', u(201)), ev(A, 'founder_beliefs', u(6), 'situation', u(201)), ev(A, 'founder_beliefs', u(6), 'read', u(110)),
      ev(B, 'founder_beliefs', u(7), 'situation', u(101)),
      ev(A, 'founder_traits', u(10), 'learn', u(121)), ev(A, 'founder_world', u(20), 'read', u(110)),
      ev(A, 'founder_vocabulary', u(30), 'move', u(130)), ev(A, 'founder_threads', u(40), 'swap', u(130)),
    ],
  } })
  return supabase
}
const status = (s, t, id) => s.rows(t).find((r) => r.id === id).status

test('retires what was learned only from this situation, keeps the rest and the receipts', async () => {
  const s = setup()
  const receipts = s.rows('memory_evidence').length
  const out = await retireSituationMemory({ supabase: s, userId: A, situationId: SIT })
  assert.equal(out.retired, 6)
  assert.equal(status(s, 'founder_beliefs', u(1)), 'superseded')
  assert.equal(status(s, 'founder_beliefs', u(2)), 'superseded') // the shift fact
  for (const [t, id, to] of [['founder_traits', u(10), 'superseded'], ['founder_world', u(20), 'superseded'], ['founder_vocabulary', u(30), 'superseded'], ['founder_threads', u(40), 'dropped']]) assert.equal(status(s, t, id), to)
  for (const id of [u(3), u(4), u(5), u(6), u(7)]) assert.equal(status(s, 'founder_beliefs', id), 'active', id) // sign-up, mixed, other situation, other founder
  assert.equal(s.rows('founder_beliefs').filter((b) => b.superseded_by).length, 0)
  assert.equal(s.rows('memory_evidence').length, receipts)
})

test('twice changes nothing more; a mismatched founder or no memory does nothing', async () => {
  const s = setup()
  await retireSituationMemory({ supabase: s, userId: A, situationId: SIT })
  const after = JSON.stringify(s.rows('founder_beliefs'))
  assert.equal((await retireSituationMemory({ supabase: s, userId: A, situationId: SIT })).retired, 0)
  assert.equal(JSON.stringify(s.rows('founder_beliefs')), after)
  const t = setup()
  assert.equal((await retireSituationMemory({ supabase: t, userId: B, situationId: SIT })).retired, 0) // not B's situation
  assert.equal((await retireSituationMemory({ supabase: t, userId: A, situationId: u(300) })).retired, 0)
  assert.equal(t.rows('founder_beliefs').filter((b) => b.status === 'superseded').length, 0)
  const empty = createFakeSupabase({ tables: { situations: [{ id: SIT, user_id: A }] } })
  assert.equal((await retireSituationMemory({ supabase: empty, userId: A, situationId: SIT })).retired, 0)
})

test('a database failure is logged, never thrown', async () => {
  const logs = []
  const broken = { from: () => { throw new Error('down') } }
  assert.deepEqual(await retireSituationMemory({ supabase: broken, userId: A, situationId: SIT, log: (w) => logs.push(w) }), { retired: 0 })
  assert.equal(logs.length, 1)
})

test('after retirement the brief no longer holds the retired items', async () => {
  const s = setup()
  const text = async () => JSON.stringify(await loadBrief(s, A, '', Date.parse(at)))
  assert.match(await text(), /Sells candles/)
  await retireSituationMemory({ supabase: s, userId: A, situationId: SIT })
  const after = await text()
  assert.doesNotMatch(after, /Sells candles|Dana|the grind|Hire a packer/)
  assert.match(after, /Works evenings/)
})

test('the care gate answers first and retirement runs in the background, by move id or situation id', async () => {
  for (const [path, ref] of [['situations', SIT], ['moves', u(130)]]) {
    const s = setup()
    const care = createCare({ supabase: s, callStructured: async () => ({}), clock: createFakeClock(), onCare: ({ userId, level, scopeId, req }) => { retireAfterCare({ supabase: s, userId, level, refs: [scopeId, req.params.id] }) } })
    const app = express()
    app.use(express.json())
    app.use((req, _res, next) => { req.user = { id: A }; next() })
    app.post(`/api/${path}/:id/x`, care.careGate((r) => r.body.text), (_q, r) => r.json({ ok: true }))
    const server = app.listen(0)
    await new Promise((r) => server.once('listening', r))
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/${path}/${ref}/x`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'I want to kill myself' }) })
    const body = await res.json()
    await new Promise((r) => server.close(r))
    assert.equal(body.care, 'clear')
    assert.deepEqual(Object.keys(body).sort(), ['care', 'help', 'message'])
    await memoryIdle()
    assert.equal(status(s, 'founder_beliefs', u(1)), 'superseded', path)
    assert.equal(status(s, 'founder_beliefs', u(3)), 'active', path)
  }
})

test('an unclear signal retires nothing', async () => {
  const s = setup()
  assert.equal(retireAfterCare({ supabase: s, userId: A, level: 'unclear', refs: [SIT] }), null)
})

test('the What Axiom thinks screen stops showing retired items', async () => {
  const s = setup()
  const screen = createMemoryScreen({ supabase: s, clock: createFakeClock(Date.parse(at)) })
  const shown = async () => JSON.stringify((await screen.list(A)).items)
  assert.match(await shown(), /sell candles/)
  await retireSituationMemory({ supabase: s, userId: A, situationId: SIT })
  assert.doesNotMatch(await shown(), /sell candles|Dana|the grind|Hire a packer/)
})
