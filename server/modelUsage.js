// USD per 1M tokens, from OpenAI model pages (2026-10-13).
const GPT_52 = { input: 1.75, cached_input: 0.175, output: 14.0 }
const GPT_54_MINI = { input: 0.75, cached_input: 0.075, output: 4.5 }
const GPT_41_MINI = { input: 0.4, cached_input: 0.1, output: 1.6 }

export const MODEL_PRICING_PER_MILLION = Object.freeze({
  'gpt-5.2-2025-12-11': GPT_52,
  'gpt-5.2': GPT_52,
  'gpt-5.4-mini-2026-03-17': GPT_54_MINI,
  'gpt-5.4-mini': GPT_54_MINI,
  'gpt-4.1-mini': GPT_41_MINI,
  'gpt-4.1-mini-2025-04-14': GPT_41_MINI,
  'text-embedding-3-small': { input: 0.02, output: 0 },
})

export const USAGE_CALL_TYPES = Object.freeze([
  'chat',
  'query_expansion',
  'onboarding',
  'memory_update',
  'concept_state_update',
  'embedding',
])

// Unpriced models are never costed at another model's rate: the cost is null
// and the row is counted as unpriced by usageSummary and dailyCap.
export function isModelPriced(model, pricingMap = MODEL_PRICING_PER_MILLION) {
  return Object.hasOwn(pricingMap, model)
}

export function estimateModelCost(model, usage = {}, options = {}) {
  const pricingMap = options.pricingMap || MODEL_PRICING_PER_MILLION
  const warn = options.warn || console.warn

  if (!Object.hasOwn(pricingMap, model)) {
    warn(`[Usage Pricing] No pricing configured for model "${model}"; storing null cost`)
    return null
  }

  const pricing = pricingMap[model]
  if (!Number.isFinite(pricing?.input) || !Number.isFinite(pricing?.output)) {
    warn(`[Usage Pricing] pricing is incomplete for model "${model}"; storing null cost`)
    return null
  }

  const promptTokens = Number(usage.prompt_tokens || 0)
  const completionTokens = Number(usage.completion_tokens || 0)
  const reportedCached = Number(usage.prompt_tokens_details?.cached_tokens || 0)
  const cachedTokens = Number.isFinite(pricing.cached_input)
    ? Math.min(Math.max(reportedCached, 0), promptTokens)
    : 0
  const uncachedTokens = promptTokens - cachedTokens
  const cachedRate = cachedTokens ? pricing.cached_input : 0
  return (
    (uncachedTokens * pricing.input) +
    (cachedTokens * cachedRate) +
    (completionTokens * pricing.output)
  ) / 1_000_000
}

const USAGE_CALL_TYPE_SET = new Set(USAGE_CALL_TYPES)

// Pure: the exact model_usage_logs row logModelUsage inserts. `ids` are the
// already-validated { session_id, thread_id, message_id }.
export function buildUsageRow({
  userId,
  usageContext = {},
  ids = { session_id: null, thread_id: null, message_id: null },
  model,
  usage = null,
  latencyMs = null,
  error = false,
  errorDetails = null,
  warn,
}) {
  const callType = USAGE_CALL_TYPE_SET.has(usageContext.call_type) ? usageContext.call_type : 'chat'
  // Missing usage (aborted or failed call) is unknown, not zero.
  const hasUsage = usage && typeof usage === 'object'
  const promptTokens = hasUsage ? Number(usage.prompt_tokens || 0) : null
  const completionTokens = hasUsage ? Number(usage.completion_tokens || 0) : null
  const totalTokens = hasUsage
    ? Number(usage.total_tokens || promptTokens + completionTokens || 0)
    : null
  return {
    user_id: userId,
    ...ids,
    model,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
    estimated_cost_usd: hasUsage ? estimateModelCost(model, usage, warn ? { warn } : {}) : null,
    call_type: callType,
    rag_chunks_used: Number(usageContext.rag_chunks_used || 0),
    latency_ms: latencyMs,
    error,
    error_details: errorDetails ? String(errorDetails).slice(0, 1000) : null,
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Writes model_usage_logs rows through the given service-role client.
export function createUsageLogger({ supabase, log = console }) {
  // Browser-supplied ids are untrusted: keep only those that belong to the
  // caller, drop the rest. Runs at log time, so it never delays the AI call.
  async function resolveUsageIds(userId, context = {}) {
    const none = { session_id: null, thread_id: null, message_id: null }
    const isId = (v) => typeof v === 'string' && UUID_PATTERN.test(v)
    if (!supabase || !isId(context.session_id)) return none
    const sessionId = context.session_id
    try {
      const { data: session, error } = await supabase
        .from('sessions')
        .select('user_id')
        .eq('id', sessionId)
        .maybeSingle()
      if (error) {
        log.error('[Usage Log] session lookup failed', { session_id: sessionId, message: error.message })
        return none
      }
      if (session?.user_id !== userId) return none

      const lookup = async (table, id) => {
        if (!isId(id)) return null
        const { data, error: lookupError } = await supabase
          .from(table)
          .select('id')
          .eq('id', id)
          .eq('session_id', sessionId)
          .maybeSingle()
        if (lookupError) {
          log.error('[Usage Log] id lookup failed', { table, id, session_id: sessionId, message: lookupError.message })
          return null
        }
        return data ? id : null
      }
      const [threadId, messageId] = await Promise.all([
        lookup('conversation_threads', context.thread_id),
        lookup('messages', context.message_id),
      ])
      return { session_id: sessionId, thread_id: threadId, message_id: messageId }
    } catch (err) {
      log.error('[Usage Log] id validation failed', err?.message || err)
      return none
    }
  }

  async function logModelUsage({
    userId,
    usageContext = {},
    model,
    usage = null,
    latencyMs = null,
    error = false,
    errorDetails = null,
  }) {
    if (!supabase || !userId || !model) return

    const ids = await resolveUsageIds(userId, usageContext)
    const row = buildUsageRow({ userId, usageContext, ids, model, usage, latencyMs, error, errorDetails })
    const insertRow = (values) => supabase
      .from('model_usage_logs')
      .insert(values)
      .select('id, user_id, session_id, thread_id, message_id, model, total_tokens, estimated_cost_usd, call_type, error, created_at')
      .single()

    let { data, error: insertError } = await insertRow(row)
    if (insertError?.code === '23503') {
      // A foreign key failed (id raced or vanished): keep the cost row without ids.
      ;({ data, error: insertError } = await insertRow({ ...row, session_id: null, thread_id: null, message_id: null }))
    }

    if (insertError) {
      log.log('[Usage Log] insert error:', insertError)
      return
    }

    log.log('[Usage Log] inserted row:', data)
  }

  return { logModelUsage }
}
