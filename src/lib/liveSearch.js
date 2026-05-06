import { supabase } from './supabase'

const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

function apiUrl(path) {
  return `${API_BASE}${path}`
}

async function getAuthHeaders() {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function readError(response) {
  try {
    const data = await response.json()
    return data?.error || response.statusText
  } catch {
    return response.statusText
  }
}

export function wantsLiveSearch(text = '') {
  return wantsFreshFacts(text) || wantsFreshForecast(text)
}

export function wantsFreshFacts(text = '') {
  const lower = String(text || '').toLowerCase()
  const freshnessAsk =
    /\b(now|today|current|currently|latest|recent|recently|this week|this month|this year|live|news|update|updates|what happened|what are .* doing)\b/.test(lower)
  const unstableDomain =
    /\b(geopolitics|war|election|regulation|policy|tariff|sanction|market|markets|stock|rates|company|earnings|ceo|funding|china|us[- ]china|united states|beijing|washington|ai demand|grid|energy|semiconductor|export controls?)\b/.test(lower)

  return freshnessAsk && unstableDomain
}

export function wantsFreshForecast(text = '') {
  const lower = String(text || '').toLowerCase()
  const unstableDomain =
    /\b(geopolitics|war|election|regulation|policy|tariff|sanction|market|markets|stock|rates|company|earnings|ceo|funding|china|us[- ]china|united states|beijing|washington|ai demand|grid|energy|semiconductor|export controls?)\b/.test(lower)
  const forecastAsk =
    /\b(signal|signals|forecast|prediction|predict|next \d+|next \d+-\d+ years?|next decade|202[7-9]|2030|2035|future effects?|what'?s coming)\b/.test(lower)

  return forecastAsk && unstableDomain
}

export function shouldUseLiveSearch({ text, retrievalConfidence = 0, sourceCount = 0, requiredArtifactType = null }) {
  if (!wantsLiveSearch(text)) return false
  if (wantsFreshFacts(text)) return true
  if (sourceCount === 0) return true
  if (requiredArtifactType === 'signal_map' && retrievalConfidence < 0.36) return true
  return retrievalConfidence < 0.24
}

export async function liveSearch(query, options = {}) {
  const authHeaders = await getAuthHeaders()
  const response = await fetch(apiUrl('/api/live-search'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify({
      query,
      numResults: options.numResults || 5,
      includeDomains: options.includeDomains || options.allowedDomains || undefined,
      excludeDomains: options.excludeDomains || undefined,
      maxAgeHours: options.maxAgeHours,
    }),
    signal: options.signal,
  })

  if (!response.ok) {
    throw new Error(await readError(response))
  }

  return response.json()
}

export function formatLiveSearchContext(payload) {
  const results = Array.isArray(payload?.results) ? payload.results : []
  if (results.length === 0) return ''

  const lines = results.slice(0, 6).map((result, index) => {
    const date = result.publishedDate ? ` | published: ${result.publishedDate}` : ''
    const highlight = result.highlight ? `\nExcerpt: ${result.highlight}` : ''
    return `${index + 1}. ${result.title || 'Untitled'}${date}\nURL: ${result.url}${highlight}`
  })

  return [
    'Live web context from Exa. Use this only as current/fresh grounding; do not name Exa.',
    'Because live web context is present, do not say you lack reliable live recency for this turn. If sources are weak, say the evidence is thin instead.',
    'When answering, mention source titles only when the user asks for sources or dates. Otherwise synthesize quietly.',
    ...lines,
  ].join('\n\n')
}
