import assert from 'node:assert/strict'
import test from 'node:test'
import { DAILY_COST_CAP_USD, DAILY_CAP_LINE, utcDayStart, sumCosts, isOverDailyCap, sumChargesPaged, resolveDailyCap, keysetOrFilter, dailyCapGate } from './dailyCap.js'

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `${a} vs ${b}`)

test('cap constant is one dollar', () => assert.equal(DAILY_COST_CAP_USD, 1.0))

test('utcDayStart just before and after midnight UTC', () => {
  assert.equal(utcDayStart(new Date('2026-10-13T23:59:59.999Z')).toISOString(), '2026-10-13T00:00:00.000Z')
  assert.equal(utcDayStart(new Date('2026-10-14T00:00:00.000Z')).toISOString(), '2026-10-14T00:00:00.000Z')
  assert.equal(utcDayStart(new Date('2026-10-14T00:00:00.001Z')).toISOString(), '2026-10-14T00:00:00.000Z')
})

test('utcDayStart ignores local offset', () => {
  assert.equal(utcDayStart(new Date('2026-10-13T23:30:00-05:00')).toISOString(), '2026-10-14T00:00:00.000Z')
})

test('cap decision at 0.99 / 1.00 / 1.01', () => {
  assert.equal(isOverDailyCap([0.99]), false)
  assert.equal(isOverDailyCap([1.0]), true)
  assert.equal(isOverDailyCap([1.01]), true)
  assert.equal(isOverDailyCap([0.5, 0.49]), false)
  assert.equal(isOverDailyCap([0.5, 0.5]), true)
})

test('null costs count as zero', () => {
  assert.equal(sumCosts([null, undefined, 0.25]), 0.25)
  assert.equal(isOverDailyCap([null, null]), false)
  assert.equal(isOverDailyCap([]), false)
  assert.equal(isOverDailyCap([null, '1.5']), true)
})


test('keysetOrFilter quotes the timestamp and ties on created_at break by id', () => {
  const f = keysetOrFilter({ created_at: '2026-10-13T10:00:00.123456+00:00', id: 'abc-1' })
  assert.equal(
    f,
    'created_at.gt."2026-10-13T10:00:00.123456+00:00",and(created_at.eq."2026-10-13T10:00:00.123456+00:00",id.gt."abc-1")',
  )
})

test('keyset paging walks 3 pages, passing the last (created_at, id) as cursor', async () => {
  const row = (id, created_at) => ({ id, created_at, estimated_cost_usd: 0.1 })
  const pages = [
    [row('a', 't1'), row('b', 't1')],
    [row('c', 't1'), row('d', 't2')],
    [row('e', 't3')],
  ]
  const cursors = []
  const total = await sumChargesPaged(async (cursor, size) => { cursors.push([cursor, size]); return pages[cursors.length - 1] }, 1, 2)
  near(total, 0.5)
  assert.deepEqual(cursors, [[null, 2], [{ created_at: 't1', id: 'b' }, 2], [{ created_at: 't2', id: 'd' }, 2]])
})

test('keyset paging with a tie across a page boundary loses and repeats nothing', async () => {
  // All rows share created_at; the id decides order, as the SQL filter does.
  const all = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, created_at: 't', estimated_cost_usd: 0.1 }))
  const seen = []
  const total = await sumChargesPaged(async (cursor, size) => {
    const rows = all.filter((r) => !cursor || r.created_at > cursor.created_at || (r.created_at === cursor.created_at && r.id > cursor.id)).slice(0, size)
    seen.push(...rows.map((r) => r.id))
    return rows
  }, 10, 2)
  assert.deepEqual(seen, ['a', 'b', 'c', 'd', 'e'])
  near(total, 0.5)
})

test('keyset paging exits early at the cap and handles empty', async () => {
  let calls = 0
  const total = await sumChargesPaged(async () => { calls++; return [{ id: 'a', created_at: 't', estimated_cost_usd: 0.6 }, { id: 'b', created_at: 't', estimated_cost_usd: 0.6 }] }, 1, 2)
  assert.equal(calls, 1)
  assert.ok(total >= 1)
  assert.equal(await sumChargesPaged(async () => [], 1, 2), 0)
})

test('sumChargesPaged throws when the cursor does not advance', async () => {
  const page = [{ id: 'a', created_at: 't', estimated_cost_usd: 0.001 }, { id: 'b', created_at: 't', estimated_cost_usd: 0.001 }]
  await assert.rejects(() => sumChargesPaged(async () => page, 100, 2), /cap paging did not advance/)
})

test('resolveDailyCap is true over the cap, false under it, false on lookup failure or no founder', async () => {
  const now = new Date('2026-10-13T10:00:00Z')
  let seenSince
  assert.equal(await resolveDailyCap('u1', async (id, since) => { seenSince = since; return 1.2 }, now), true)
  assert.equal(seenSince, '2026-10-13T00:00:00.000Z')
  assert.equal(await resolveDailyCap('u1', async () => 0.2, now), false)
  const calls = []
  assert.equal(await resolveDailyCap('founder-42', async () => { throw new Error('db down') }, now, (...a) => calls.push(a)), false)
  assert.deepEqual(calls, [['[DailyCap] lookup failed, failing open', { user_id: 'founder-42', error: 'db down' }]])
  assert.equal(await resolveDailyCap(null, async () => 5, now), false)
})

test('the cap line is the approved wording', () => {
  assert.equal(DAILY_CAP_LINE, "You've hit today's limit. Come back tomorrow to keep going.")
})

test('dailyCapGate answers 429 with the code and line, lets admins and under-cap founders through', async () => {
  const run = async (gate, user) => {
    let status = null; let body = null; let nexted = false
    const res = { status(s) { status = s; return this }, json(b) { body = b; return this } }
    await gate({ user }, res, () => { nexted = true })
    return { status, body, nexted }
  }
  const gate = dailyCapGate({ isCapped: async () => true, isAdmin: (u) => u.id === 'admin' })
  const over = gate()
  assert.deepEqual(await run(over, { id: 'u1' }), { status: 429, body: { error: 'Daily cost cap reached', code: 'daily_cost_cap', line: DAILY_CAP_LINE }, nexted: false })
  assert.equal((await run(over, { id: 'admin' })).nexted, true)
  assert.equal((await run(gate(async () => true), { id: 'u1' })).nexted, true) // a stored answer is replayed free
  assert.equal((await run(gate(async () => false), { id: 'u1' })).status, 429)
  assert.equal((await run(dailyCapGate({ isCapped: async () => false })(), { id: 'u1' })).nexted, true)
})
