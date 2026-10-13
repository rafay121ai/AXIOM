export function summarizeUsage(usage) {
  const summary = usage.reduce((acc, row) => {
    const key = row.call_type || 'unknown'
    acc.by_call_type[key] = acc.by_call_type[key] || {
      count: 0,
      total_tokens: 0,
      estimated_cost_usd: 0,
      errors: 0,
      unpriced_calls: 0,
      failed_unpriced_calls: 0,
      avg_latency_ms: 0,
    }
    const bucket = acc.by_call_type[key]
    bucket.count += 1
    bucket.total_tokens += Number(row.total_tokens || 0)
    if (row.estimated_cost_usd != null) bucket.estimated_cost_usd += Number(row.estimated_cost_usd)
    bucket.errors += row.error ? 1 : 0
    bucket.avg_latency_ms += Number(row.latency_ms || 0)
    if (row.estimated_cost_usd == null) {
      // Failed calls with no cost are expected; only successful ones make the total partial.
      const field = row.error ? 'failed_unpriced_calls' : 'unpriced_calls'
      acc[field] += 1
      bucket[field] += 1
    } else {
      acc.total_cost_usd += Number(row.estimated_cost_usd)
    }
    acc.total_tokens += Number(row.total_tokens || 0)
    acc.errors += row.error ? 1 : 0
    return acc
  }, {
    total_calls: usage.length,
    total_tokens: 0,
    total_cost_usd: 0,
    unpriced_calls: 0,
    failed_unpriced_calls: 0,
    cost_is_partial: false,
    errors: 0,
    by_call_type: {},
  })

  for (const bucket of Object.values(summary.by_call_type)) {
    bucket.avg_latency_ms = bucket.count ? Math.round(bucket.avg_latency_ms / bucket.count) : 0
    bucket.estimated_cost_usd = Number(bucket.estimated_cost_usd.toFixed(6))
  }
  summary.total_cost_usd = Number(summary.total_cost_usd.toFixed(6))
  summary.cost_is_partial = summary.unpriced_calls > 0
  return summary
}
