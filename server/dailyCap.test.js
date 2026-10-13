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
  capChargeForRow, sumChargesPaged, resolveDailyCap,
  ABORT_ASSUMED_PROMPT_TOKENS, ABORT_ASSUMED_OUTPUT_TOKENS,
} from './dailyCap.js'

const abortCost = (inP, outP) => (20000 * inP + 4000 * outP) / 1_000_000

test('abort assumptions are 20000 in / 4000 out', () => {
  assert.equal(ABORT_ASSUMED_PROMPT_TOKENS, 20000)
  assert.equal(ABORT_ASSUMED_OUTPUT_TOKENS, 4000)
})

test('aborted null-cost row is charged at gpt-5.4-mini and gpt-5.2 prices', () => {
  const mini = capChargeForRow({ estimated_cost_usd: null, model: 'gpt-5.4-mini', error: 'client_aborted' })
  const big = capChargeForRow({ estimated_cost_usd: null, model: 'gpt-5.2', error: 'client_aborted' })
  assert.ok(Math.abs(mini - abortCost(0.75, 4.5)) < 1e-12)
  assert.ok(Math.abs(big - abortCost(1.75, 14)) < 1e-12)
  assert.ok(mini > 0 && big > mini)
})

test('priced row uses its stored cost, even if aborted', () => {
  assert.equal(capChargeForRow({ estimated_cost_usd: 0.07, model: 'gpt-5.2', error: null }), 0.07)
  assert.equal(capChargeForRow({ estimated_cost_usd: '0.02', model: 'gpt-5.2', error: 'client_aborted' }), 0.02)
})

test('unknown model abort uses the max priced chat model', () => {
  const v = capChargeForRow({ estimated_cost_usd: null, model: 'mystery', error: 'client_aborted' })
  assert.ok(Math.abs(v - abortCost(1.75, 14)) < 1e-12)
})

test('non-abort null row is 0', () => {
  assert.equal(capChargeForRow({ estimated_cost_usd: null, model: 'gpt-5.2', error: 'boom' }), 0)
  assert.equal(capChargeForRow({ estimated_cost_usd: null, model: 'gpt-5.2', error: null }), 0)
})

test('paging sums across 3 pages', async () => {
  const pages = [[{ estimated_cost_usd: 0.1 }, { estimated_cost_usd: 0.1 }], [{ estimated_cost_usd: 0.1 }, { estimated_cost_usd: 0.1 }], [{ estimated_cost_usd: 0.1 }]]
  const calls = []
  const total = await sumChargesPaged(async (from, to) => { calls.push([from, to]); return pages[calls.length - 1] }, 1, 2)
  assert.ok(Math.abs(total - 0.5) < 1e-12)
  assert.deepEqual(calls, [[0, 1], [2, 3], [4, 5]])
})

test('paging exits early at the cap and handles empty', async () => {
  let calls = 0
  const total = await sumChargesPaged(async () => { calls++; return [{ estimated_cost_usd: 0.6 }, { estimated_cost_usd: 0.6 }] }, 1, 2)
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
