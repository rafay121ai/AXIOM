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
