import assert from 'node:assert/strict'
import test from 'node:test'
import { createFakeClock, createFakeSupabase } from '../../testing/fakes.js'
import { MAX_ACTIVE_BELIEFS } from './beliefRules.js'
import { createMemoryStore } from './memoryStore.js'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const RUN = '33333333-3333-4333-8333-333333333333'
const UNIQUE = { memory_runs: [{ cols: ['source_kind', 'source_id', 'mode'], where: (r) => r.status !== 'failed' }] }
const make = (tables = {}) => {
  const supabase = createFakeSupabase({ tables, unique: UNIQUE })
  const clock = createFakeClock()
  return { supabase, clock, store: createMemoryStore({ supabase, clock }) }
}
const belief = (userId, extra = {}) => ({ userId, belief: 'Sells candles', kind: 'fact', confidence: 0.6, source: 'conversation', ...extra })

test('empty founder: nothing active, no run', async () => {
  const { store } = make()
  assert.deepEqual(await store.activeBeliefs(A), [])
  assert.deepEqual(await store.activeTraits(A), [])
  assert.equal(await store.hasRun(A, 'report', RUN, 'full'), false)
})

test('a contradiction supersedes the fact and keeps the old row', async () => {
  const { store, supabase } = make()
  const old = await store.insertBelief(belief(A, { belief: 'Sells to shops' }))
  const next = await store.insertBelief(belief(A, { belief: 'Sells online only' }))
  assert.equal(await store.supersedeBelief(A, old.id, next.id), true)
  const rows = supabase.rows('founder_beliefs')
  assert.equal(rows.length, 2)
  assert.equal(rows.find((r) => r.id === old.id).status, 'superseded')
  assert.equal(rows.find((r) => r.id === old.id).superseded_by, next.id)
  assert.deepEqual((await store.activeBeliefs(A)).map((r) => r.id), [next.id])
})

test('supersede across founders, or of a pattern, or twice, is ignored', async () => {
  const { store, supabase } = make()
  const mine = await store.insertBelief(belief(A))
  const theirs = await store.insertBelief(belief(B))
  const pattern = await store.insertBelief(belief(A, { kind: 'pattern', belief: 'Ships late' }))
  assert.equal(await store.supersedeBelief(A, mine.id, theirs.id), false)
  assert.equal(await store.supersedeBelief(A, theirs.id, mine.id), false)
  assert.equal(await store.supersedeBelief(A, pattern.id, mine.id), false)
  assert.equal(supabase.rows('founder_beliefs').filter((r) => r.superseded_by).length, 0)
})

test('updateBelief: change from the current row; a stale write retries, then skips after 3', async () => {
  const { store, supabase } = make()
  const b = await store.insertBelief(belief(A))
  const up = await store.updateBelief(A, b.id, (row) => ({ confidence: row.confidence + 0.1 }))
  assert.equal(up.confidence, 0.7)
  // A competing writer changes updated_at between every read and write.
  const tries = []
  const skipped = await store.updateBelief(A, b.id, () => { tries.push(1); supabase.from('founder_beliefs').update({ updated_at: `x${tries.length}` }).eq('id', b.id).then(() => {}); return { confidence: 0.1 } })
  assert.equal(skipped, null)
  assert.equal(tries.length, 3)
  assert.equal(supabase.rows('founder_beliefs')[0].confidence, 0.7)
})

test('updateBelief with touch: false keeps updated_at', async () => {
  const { store, clock } = make()
  const b = await store.insertBelief(belief(A))
  clock.advance(100 * 86400000)
  const up = await store.updateBelief(A, b.id, { confidence: 0.5 }, { touch: false })
  assert.equal(up.confidence, 0.5)
  assert.equal(up.updated_at, b.updated_at)
})

test('the 50-active cap supersedes the weakest belief', async () => {
  const { store } = make()
  for (let i = 0; i < MAX_ACTIVE_BELIEFS; i += 1) await store.insertBelief(belief(A, { belief: `Fact ${i}`, confidence: i === 7 ? 0.3 : 0.6 }))
  const added = await store.insertBelief(belief(A, { belief: 'Newest' }))
  const active = await store.activeBeliefs(A)
  assert.equal(active.length, MAX_ACTIVE_BELIEFS)
  assert.ok(!active.some((r) => r.belief === 'Fact 7'))
  assert.ok(active.some((r) => r.id === added.id))
})

test('upsertTrait: one active per dimension, the old row superseded and linked; invalid values refused', async () => {
  const { store, supabase } = make()
  const first = await store.upsertTrait({ userId: A, dimension: 'decision_speed', value: 'fast', confidence: 0.5, origin: 'observed' })
  assert.equal(await store.upsertTrait({ userId: A, dimension: 'decision_speed', value: 'moody', confidence: 0.5, origin: 'observed' }), null)
  const same = await store.upsertTrait({ userId: A, dimension: 'decision_speed', value: 'fast', confidence: 0.65, origin: 'observed' })
  assert.equal(same.id, first.id)
  const next = await store.upsertTrait({ userId: A, dimension: 'decision_speed', value: 'deliberate', confidence: 0.5, origin: 'observed' })
  const rows = supabase.rows('founder_traits')
  assert.equal(rows.length, 2)
  assert.equal(rows.find((r) => r.id === first.id).superseded_by, next.id)
  assert.deepEqual((await store.activeTraits(A)).map((r) => r.value), ['deliberate'])
})

test('world and vocabulary: a trimmed, differently cased name is the same row and counts a mention', async () => {
  const { store, supabase, clock } = make()
  await store.upsertWorld({ userId: A, name: '  Acme ', kind: 'company' })
  clock.advance(1000)
  const again = await store.upsertWorld({ userId: A, name: 'ACME', kind: 'company', role: 'first customer' })
  assert.equal(supabase.rows('founder_world').length, 1)
  assert.equal(again.mention_count, 2)
  assert.equal(again.role, 'first customer')
  assert.equal(supabase.rows('founder_world')[0].name, 'Acme')
  assert.equal(await store.upsertWorld({ userId: A, name: '   ', kind: 'person' }), null)
  await store.upsertWorld({ userId: B, name: 'Acme', kind: 'company' })
  assert.equal(supabase.rows('founder_world').length, 2)
  await store.upsertVocabulary({ userId: A, term: ' the wall ', meaning: 'the shelf of unsold stock', confidence: 0.6 })
  const v = await store.upsertVocabulary({ userId: A, term: 'The Wall', meaning: 'x', confidence: 0.6 })
  assert.equal(supabase.rows('founder_vocabulary').length, 1)
  assert.equal(v.mention_count, 2)
})

test('threads: insert and list open, per founder', async () => {
  const { store } = make()
  await store.insertThread({ userId: A, title: 'Land the first wholesale order', kind: 'goal' })
  assert.equal((await store.openThreads(A)).length, 1)
  assert.equal((await store.openThreads(B)).length, 0)
})

test('evidence: snippet cut to 200, counted per item by rows and distinct sources', async () => {
  const { store, supabase } = make()
  const item = '44444444-4444-4444-8444-444444444444'
  const row = (sourceId) => ({ userId: A, itemTable: 'founder_traits', itemId: item, sourceKind: 'report', sourceId, snippet: 'x'.repeat(300) })
  await store.addEvidence([row(RUN), row(RUN), row(B)])
  assert.equal(supabase.rows('memory_evidence')[0].snippet.length, 200)
  assert.deepEqual((await store.evidenceCounts(A, 'founder_traits'))[item], { rows: 3, sources: 2 })
  assert.deepEqual(await store.evidenceCounts(A, 'founder_beliefs'), {}, 'only the asked table is read')
  assert.deepEqual(await store.evidenceCounts(B, 'founder_traits'), {}, 'only this founder')
  assert.deepEqual(await store.addEvidence([]), [])
})

test('runs: a failed run can be retried; a done or skipped_care run blocks a repeat', async () => {
  const { store } = make()
  const run = (status) => store.recordRun({ userId: A, sourceKind: 'report', sourceId: RUN, mode: 'full', status, model: 'm' })
  await run('failed')
  assert.equal(await store.hasRun(A, 'report', RUN, 'full'), false)
  assert.ok(await run('done'))
  assert.equal(await store.hasRun(A, 'report', RUN, 'full'), true)
  assert.equal(await run('done'), null)
  assert.equal(await store.hasRun(A, 'report', RUN, 'facts_only'), false)
  assert.equal(await store.hasRun(B, 'report', RUN, 'full'), false)
  await store.recordRun({ userId: A, sourceKind: 'move', sourceId: RUN, mode: 'full', status: 'skipped_care' })
  assert.equal(await store.hasRun(A, 'move', RUN, 'full'), true)
})

test('corrections are per founder', async () => {
  const { store } = make({ founder_corrections: [{ id: 'c1', user_id: A, item_table: 'founder_beliefs', item_text: 'x', reason: 'wrong' }] })
  assert.equal((await store.corrections(A)).length, 1)
  assert.equal((await store.corrections(B)).length, 0)
})

test('a database error is thrown, not swallowed', async () => {
  const { supabase } = make()
  const broken = { ...supabase, from: () => { throw new Error('db down') } }
  await assert.rejects(createMemoryStore({ supabase: broken }).activeBeliefs(A), /db down/)
})

test('a source that failed twice is blocked, so a poison input cannot cost a call on every visit', async () => {
  const { store } = make()
  const fail = () => store.recordRun({ userId: A, sourceKind: 'move', sourceId: RUN, mode: 'facts_only', status: 'failed' })
  await fail()
  assert.equal(await store.hasRun(A, 'move', RUN, 'facts_only'), false)
  await fail()
  assert.equal(await store.hasRun(A, 'move', RUN, 'facts_only'), true)
  assert.equal(await store.hasRun(A, 'move', RUN, 'full'), false, 'another mode is its own source')
})

test('upsertTrait: a lost race on the unique index re-reads and updates instead of failing', async () => {
  const unique = { ...UNIQUE, founder_traits: [{ cols: ['user_id', 'dimension'], where: (r) => r.status === 'active' }] }
  const base = createFakeSupabase({ tables: { founder_traits: [{ id: 't1', user_id: A, dimension: 'decision_speed', value: 'fast', confidence: 0.35, origin: 'observed', status: 'active', created_at: 'x', updated_at: 'x' }] }, unique })
  let stale = 1 // the first read of the active traits misses the row another writer just stored
  const racy = { ...base, from: (t) => (t === 'founder_traits' && stale-- > 0
    ? { select: () => ({ eq: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }) }) }
    : base.from(t)) }
  const store = createMemoryStore({ supabase: racy })
  const row = await store.upsertTrait({ userId: A, dimension: 'decision_speed', value: 'fast', confidence: 0.5, origin: 'observed' })
  assert.equal(row.id, 't1')
  assert.deepEqual(base.rows('founder_traits').map((t) => [t.confidence, t.status]), [[0.5, 'active']])
})

test('upsertTrait: if the new row cannot be stored, the old trait stays active', async () => {
  const base = createFakeSupabase({ tables: { founder_traits: [{ id: 't1', user_id: A, dimension: 'decision_speed', value: 'fast', confidence: 0.35, origin: 'observed', status: 'active', created_at: 'x', updated_at: 'x' }] } })
  const broken = { ...base, from: (t) => (t === 'founder_traits' ? { ...base.from(t), insert: () => { throw new Error('db down') } } : base.from(t)) }
  await assert.rejects(createMemoryStore({ supabase: broken }).upsertTrait({ userId: A, dimension: 'decision_speed', value: 'deliberate', confidence: 0.35, origin: 'observed' }), /db down/)
  assert.deepEqual(base.rows('founder_traits').map((t) => [t.value, t.status]), [['fast', 'active']])
})
