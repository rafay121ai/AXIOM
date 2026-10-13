import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DAILY_COST_CAP_USD, DAILY_CAP_MESSAGE, utcDayStart, nextUtcMidnight,
  sumCosts, isOverDailyCap, buildCappedResponse, dailyCapDecision,
} from './dailyCap.js'

test('cap constant is one dollar', () => assert.equal(DAILY_COST_CAP_USD, 1.0))

test('utcDayStart just before and after midnight UTC', () => {
  assert.equal(utcDayStart(new Date('2026-10-13T23:59:59.999Z')).toISOString(), '2026-10-13T00:00:00.000Z')
  assert.equal(utcDayStart(new Date('2026-10-14T00:00:00.000Z')).toISOString(), '2026-10-14T00:00:00.000Z')
  assert.equal(utcDayStart(new Date('2026-10-14T00:00:00.001Z')).toISOString(), '2026-10-14T00:00:00.000Z')
})

test('utcDayStart ignores local offset', () => {
  assert.equal(utcDayStart(new Date('2026-10-13T23:30:00-05:00')).toISOString(), '2026-10-14T00:00:00.000Z')
})

test('nextUtcMidnight is the next UTC midnight', () => {
  assert.equal(nextUtcMidnight(new Date('2026-10-13T23:59:59.999Z')).toISOString(), '2026-10-14T00:00:00.000Z')
  assert.equal(nextUtcMidnight(new Date('2026-10-14T00:00:00.000Z')).toISOString(), '2026-10-15T00:00:00.000Z')
  assert.equal(nextUtcMidnight(new Date('2026-12-31T12:00:00Z')).toISOString(), '2027-01-01T00:00:00.000Z')
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

test('capped response shape and decision', () => {
  const now = new Date('2026-10-13T10:00:00Z')
  const body = buildCappedResponse(now)
  assert.deepEqual(body, { capped: true, message: DAILY_CAP_MESSAGE, resets_at: '2026-10-14T00:00:00.000Z' })
  assert.deepEqual(dailyCapDecision([1.2], now), body)
  assert.equal(dailyCapDecision([0.2], now), null)
})

import {
  capChargeForRow, sumChargesPaged, resolveDailyCap, keysetOrFilter,
  ABORT_ASSUMED_PROMPT_TOKENS, ABORT_ASSUMED_OUTPUT_TOKENS,
  CHARGED_ERROR_MARKERS, CLIENT_ABORTED_MARKER, STREAM_INTERRUPTED_MARKER,
} from './dailyCap.js'
import { buildUsageRow } from './modelUsage.js'

const abortCost = (inP, outP) => (20000 * inP + 4000 * outP) / 1_000_000
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `${a} vs ${b}`)
// Real logger row shape: error is boolean, marker is in error_details.
const aborted = (model) => ({ estimated_cost_usd: null, model, error: true, error_details: CLIENT_ABORTED_MARKER })

test('abort assumptions are 20000 in / 4000 out', () => {
  assert.equal(ABORT_ASSUMED_PROMPT_TOKENS, 20000)
  assert.equal(ABORT_ASSUMED_OUTPUT_TOKENS, 4000)
})

test('markers list holds client_aborted and stream_interrupted', () => {
  assert.deepEqual([...CHARGED_ERROR_MARKERS], ['client_aborted', 'stream_interrupted'])
})

test('aborted null-cost row is charged at gpt-5.4-mini and gpt-5.2 prices', () => {
  const mini = capChargeForRow(aborted('gpt-5.4-mini'))
  const big = capChargeForRow(aborted('gpt-5.2'))
  near(mini, abortCost(0.75, 4.5))
  near(big, abortCost(1.75, 14))
  assert.ok(mini > 0 && big > mini)
})

test('priced row uses its stored cost, even if aborted', () => {
  assert.equal(capChargeForRow({ estimated_cost_usd: 0.07, model: 'gpt-5.2', error: false, error_details: null }), 0.07)
  assert.equal(capChargeForRow({ estimated_cost_usd: '0.02', model: 'gpt-5.2', error: true, error_details: CLIENT_ABORTED_MARKER }), 0.02)
})

test('unknown model abort uses the max priced chat model', () => {
  near(capChargeForRow(aborted('mystery')), abortCost(1.75, 14))
})

test('non-abort null row is 0', () => {
  assert.equal(capChargeForRow({ estimated_cost_usd: null, model: 'gpt-5.2', error: true, error_details: 'boom' }), 0)
  assert.equal(capChargeForRow({ estimated_cost_usd: null, model: 'gpt-5.2', error: false, error_details: null }), 0)
  // The old fake shape (marker in `error`) is not what the logger writes.
  assert.equal(capChargeForRow({ estimated_cost_usd: null, model: 'gpt-5.2', error: 'client_aborted' }), 0)
})

test('round trip: rows built by the real logger function are charged correctly', async () => {
  const build = (args) => buildUsageRow({ userId: 'u1', warn: () => {}, ...args })
  const project = (r) => ({ estimated_cost_usd: r.estimated_cost_usd, model: r.model, error: r.error, error_details: r.error_details })
  const usage = { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 }

  const priced = build({ model: 'gpt-5.2', usage, error: false })
  const clientAbort = build({ model: 'gpt-5.2', error: true, errorDetails: CLIENT_ABORTED_MARKER })
  const interrupted = build({ model: 'gpt-5.4-mini', error: true, errorDetails: STREAM_INTERRUPTED_MARKER })
  const preStream = build({ model: 'gpt-5.2', error: true, errorDetails: '503 upstream unavailable' })
  const embedding = build({ model: 'text-embedding-3-small', usage: { prompt_tokens: 2000, total_tokens: 2000 }, usageContext: { call_type: 'embedding' } })

  assert.ok(priced.estimated_cost_usd > 0)
  assert.equal(clientAbort.estimated_cost_usd, null)
  assert.equal(clientAbort.error, true)
  assert.equal(clientAbort.error_details, 'client_aborted')
  assert.ok(embedding.estimated_cost_usd > 0)

  near(capChargeForRow(project(priced)), priced.estimated_cost_usd)
  near(capChargeForRow(project(clientAbort)), abortCost(1.75, 14))
  near(capChargeForRow(project(interrupted)), abortCost(0.75, 4.5))
  assert.equal(capChargeForRow(project(preStream)), 0)
  near(capChargeForRow(project(embedding)), embedding.estimated_cost_usd)

  const rows = [priced, clientAbort, interrupted, preStream, embedding]
    .map((r, i) => ({ id: `id-${i}`, created_at: `2026-10-13T10:00:0${i}Z`, ...project(r) }))
  const total = await sumChargesPaged(async () => rows, 100, 1000)
  near(total, priced.estimated_cost_usd + abortCost(1.75, 14) + abortCost(0.75, 4.5) + embedding.estimated_cost_usd)
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

test('resolveDailyCap returns capped body before any OpenAI call, null under cap, null on lookup failure', async () => {
  const now = new Date('2026-10-13T10:00:00Z')
  let openaiCalled = false
  const handler = async (lookup) => {
    const capped = await resolveDailyCap('u1', lookup, now, () => {})
    if (capped) return capped
    openaiCalled = true
    return null
  }
  let seenSince
  const body = await handler(async (id, since) => { seenSince = since; return 1.2 })
  assert.equal(body.capped, true)
  assert.equal(openaiCalled, false)
  assert.equal(seenSince, '2026-10-13T00:00:00.000Z')
  assert.equal(await resolveDailyCap('u1', async () => 0.2, now), null)
  assert.equal(await resolveDailyCap('u1', async () => { throw new Error('db') }, now, () => {}), null)
  assert.equal(await resolveDailyCap(null, async () => 5, now), null)
})
