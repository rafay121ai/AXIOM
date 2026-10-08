import assert from 'node:assert/strict'
import test from 'node:test'
import { estimateModelCost } from './modelUsage.js'

const TEST_PRICING = {
  'gpt-5.4-mini-2026-03-17': { input: 2, output: 8 },
}

test('estimateModelCost calculates a configured model', () => {
  const cost = estimateModelCost(
    'gpt-5.4-mini-2026-03-17',
    { prompt_tokens: 1_000_000, completion_tokens: 500_000 },
    { pricingMap: TEST_PRICING }
  )

  assert.equal(cost, 6)
})

test('estimateModelCost returns null and warns for an unknown model', () => {
  const warnings = []
  const cost = estimateModelCost(
    'unknown-model',
    { prompt_tokens: 100, completion_tokens: 50 },
    { pricingMap: TEST_PRICING, warn: (message) => warnings.push(message) }
  )

  assert.equal(cost, null)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /unknown-model/)
})

test('estimateModelCost returns zero for zero tokens', () => {
  const cost = estimateModelCost(
    'gpt-5.4-mini-2026-03-17',
    { prompt_tokens: 0, completion_tokens: 0 },
    { pricingMap: TEST_PRICING }
  )

  assert.equal(cost, 0)
})
