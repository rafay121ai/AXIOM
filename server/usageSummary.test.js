import assert from 'node:assert/strict'
import test from 'node:test'
import { summarizeUsage } from './usageSummary.js'

test('failed unpriced rows do not make the cost partial', () => {
  const s = summarizeUsage([
    { call_type: 'chat', estimated_cost_usd: 0.01, error: false, total_tokens: 10, latency_ms: 100 },
    { call_type: 'chat', estimated_cost_usd: null, error: true, total_tokens: 0, latency_ms: 50 },
  ])
  assert.equal(s.unpriced_calls, 0)
  assert.equal(s.failed_unpriced_calls, 1)
  assert.equal(s.cost_is_partial, false)
  assert.equal(s.total_cost_usd, 0.01)
  assert.equal(s.errors, 1)
})

test('successful unpriced rows make the cost partial', () => {
  const s = summarizeUsage([
    { call_type: 'chat', estimated_cost_usd: null, error: false },
    { call_type: 'chat', estimated_cost_usd: null, error: true },
  ])
  assert.equal(s.unpriced_calls, 1)
  assert.equal(s.failed_unpriced_calls, 1)
  assert.equal(s.cost_is_partial, true)
  assert.equal(s.by_call_type.chat.unpriced_calls, 1)
})
