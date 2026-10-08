export const MODEL_PRICING_PER_MILLION = Object.freeze({
  // TODO: Fill these input/output USD prices per 1M tokens from OpenAI's pricing page.
  'gpt-5.2-2025-12-11': { input: null, output: null },
  'gpt-5.2': { input: null, output: null },
  'gpt-5.4-mini-2026-03-17': { input: null, output: null },
  'gpt-5.4-mini': { input: null, output: null },
  'gpt-4.1-mini': { input: null, output: null },
  'gpt-4.1-mini-2025-04-14': { input: null, output: null },
  'text-embedding-3-small': { input: null, output: null },
})

export const USAGE_CALL_TYPES = Object.freeze([
  'chat',
  'query_expansion',
  'onboarding',
  'memory_update',
  'concept_state_update',
  'embedding',
])

export function estimateModelCost(model, usage = {}, options = {}) {
  const pricingMap = options.pricingMap || MODEL_PRICING_PER_MILLION
  const warn = options.warn || console.warn

  if (!Object.hasOwn(pricingMap, model)) {
    warn(`[Usage Pricing] No pricing configured for model "${model}"; storing null cost`)
    return null
  }

  const pricing = pricingMap[model]
  if (!Number.isFinite(pricing?.input) || !Number.isFinite(pricing?.output)) {
    warn(`[Usage Pricing] TODO pricing is incomplete for model "${model}"; storing null cost`)
    return null
  }

  const promptTokens = Number(usage.prompt_tokens || 0)
  const completionTokens = Number(usage.completion_tokens || 0)
  return ((promptTokens * pricing.input) + (completionTokens * pricing.output)) / 1_000_000
}
