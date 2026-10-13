import assert from 'node:assert/strict'
import test from 'node:test'
import { estimateModelCost, MODEL_PRICING_PER_MILLION } from './modelUsage.js'

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

test('every allowed model has finite input and output prices', () => {
  const allowed = [
    'gpt-5.2-2025-12-11',
    'gpt-5.2',
    'gpt-5.4-mini-2026-03-17',
    'gpt-5.4-mini',
    'gpt-4.1-mini',
    'gpt-4.1-mini-2025-04-14',
    'text-embedding-3-small',
  ]
  for (const model of allowed) {
    assert.ok(Object.hasOwn(MODEL_PRICING_PER_MILLION, model), `${model} missing`)
  }
  for (const [model, price] of Object.entries(MODEL_PRICING_PER_MILLION)) {
    assert.ok(Number.isFinite(price.input), `${model} input price`)
    assert.ok(Number.isFinite(price.output), `${model} output price`)
  }
})

test('estimateModelCost bills cached prompt tokens at the cached rate', () => {
  const pricing = { m: { input: 2, cached_input: 0.5, output: 8 } }
  const cost = estimateModelCost(
    'm',
    {
      prompt_tokens: 1_000_000,
      completion_tokens: 1_000_000,
      prompt_tokens_details: { cached_tokens: 400_000 },
    },
    { pricingMap: pricing }
  )
  // 600k * 2 + 400k * 0.5 + 1M * 8 = 1.2 + 0.2 + 8
  assert.ok(Math.abs(cost - 9.4) < 1e-9)
})

test('estimateModelCost bills all prompt tokens at input when no cached rate', () => {
  const cost = estimateModelCost(
    'm',
    { prompt_tokens: 1_000_000, prompt_tokens_details: { cached_tokens: 400_000 } },
    { pricingMap: { m: { input: 2, output: 8 } } }
  )
  assert.equal(cost, 2)
})
