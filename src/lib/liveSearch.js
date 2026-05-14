import { supabase } from './supabase'
import {
  isCurrentFactualLiveQuestion,
  isForecastAsk,
  isLiveSearchDomain,
  wantsLiveSearchForText,
} from './liveSearchTriggers'

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
  return wantsLiveSearchForText(text)
}

export function wantsFreshFacts(text = '') {
  return isCurrentFactualLiveQuestion(text)
}

export function wantsFreshForecast(text = '') {
  return isForecastAsk(text) && isLiveSearchDomain(text)
}

export function shouldUseLiveSearch({ text, retrievalConfidence = 0, sourceCount = 0, requiredArtifactType = null }) {
  if (!wantsLiveSearch(text)) return false
  if (wantsFreshFacts(text)) return true
  if (sourceCount === 0) return true
  if (requiredArtifactType === 'signal_map' && retrievalConfidence < 0.36) return true
  return retrievalConfidence < 0.24
}

export async function liveSearch(query, options = {}) {
  const searchQuery = String(query || '').trim().slice(0, 500)
  const authHeaders = await getAuthHeaders()
  const response = await fetch(apiUrl('/api/live-search'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify({
      query: searchQuery,
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
    'When live web context is present, synthesize it into prose without visible section labels. Do not write headers like "Live evidence", "Current signals", or "Interpretation". The structure is internal. The answer should read as one coherent response.',
    ...lines,
  ].join('\n\n')
}
