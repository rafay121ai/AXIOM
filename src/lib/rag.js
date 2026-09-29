import { knowledgeSupabase } from './knowledgeSupabase'
import { generateEmbedding, openai, CHAT_MODEL, requestJsonObject } from './openai'
import { isCurrentFactualQuestion as asksForCurrentFacts } from './currentFacts'
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

// ─── Similarity Search ───────────────────────────────────────────────────────
// Requires the match_wiki_chunks function in Supabase:
//
// create or replace function match_wiki_chunks(
//   query_embedding vector(1536),
//   match_count int,
//   filter_pillar text default null
// )
// returns table (id uuid, pillar text, title text, author text, key_frameworks text, similarity float)
// language sql stable
// as $$
//   select id, pillar, title, author, key_frameworks,
//     1 - (embedding <=> query_embedding) as similarity
//   from wiki_chunks
//   where filter_pillar is null or pillar = filter_pillar
//   order by embedding <=> query_embedding
//   limit match_count;
// $$;

// pgvector cosine similarity for OpenAI embeddings is useful at lower absolute
// values than a classifier-style confidence score. Empirical source-specific
// tests in this corpus put strong hits around 0.35-0.45.
const CONFIDENCE_THRESHOLD = 0.30
const QUERY_EXPANSION_CONFIDENCE_FLOOR = 0.28
const EXPANDED_QUERY_SEARCH_LIMIT = 1
const ROUTER_MODES = new Set([
  'single_pillar',
  'two_pillar',
  'four_pillar_synthesis',
  'all_pillar_synthesis',
])
const ALL_PILLARS = [
  'human_mind',
  'money_game',
  'how_companies_win',
  'whats_coming',
  'think_sharper',
  'move_people',
]
const FOUR_PILLAR_STACK = [
  'whats_coming',
  'how_companies_win',
  'money_game',
  'think_sharper',
]
const CACHE_TTL_MS = 5 * 60 * 1000
const MAX_CACHE_ENTRIES = 120
const embeddingCache = new Map()
const queryExpansionCache = new Map()
const searchCache = new Map()
const routerCache = new Map()
const CONCEPT_STATES = ['encountered', 'partial', 'absorbed']
const CONCEPT_STATE_RANK = {
  encountered: 1,
  partial: 2,
  absorbed: 3,
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
}

function trimCache(cache) {
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value
    cache.delete(oldestKey)
  }
}

async function cachedAsync(cache, key, loader) {
  const now = Date.now()
  const cached = cache.get(key)
  if (cached && now - cached.time < CACHE_TTL_MS) {
    return cached.value
  }

  const promise = Promise.resolve()
    .then(loader)
    .catch((error) => {
      cache.delete(key)
      throw error
    })

  cache.set(key, { time: now, value: promise })
  trimCache(cache)
  return promise
}

function wantsSignalMap(lower = '') {
  return /\b(signal map|map the signals|map this terrain|forecast|prediction|predict|where is .* moving|where are .* moving|what'?s coming|future effects?|future shift|future shifts|next \d+ (months?|years?)|next \d+-\d+ years?|next decade|10-15 years|2030|2035|202[7-9]|where will .* accrue|where does .* accrue|what happens if)\b/.test(lower)
}

function isCurrentFactualQuestion(lower = '') {
  return asksForCurrentFacts(lower) || (
    /\b(what should i watch next|watch next)\b/.test(lower) &&
    /\b(geopolitics|geopolitical|war|military|escalation|market|markets|company|china|us[- ]china|u\.s\.[- ]china|iran|israel|semiconductor|chip|energy|grid)\b/.test(lower)
  )
}

const QUESTION_SHAPE_RULES = [
  {
    matches: (lower) =>
      /\b(cold outreach|outreach|sales pipeline|pipeline|sell|selling|sales|lead follow[- ]?up|leads?|buyers?|buyer|paid pilot|pilot|close clients?|client acquisition|make \$?\d+|make money|revenue goal|revenue deadline|by august|by \w+ \d{1,2})\b/.test(lower),
    build: () => ({
      mode: 'two_pillar',
      pillars: ['move_people', 'money_game'],
      rationale: 'Revenue/outreach action turn. Combine buyer persuasion with money pressure; keep it concrete and prose-first.',
    }),
  },
  {
    matches: (lower) =>
      isCurrentFactualQuestion(lower),
    build: () => ({
      mode: 'two_pillar',
      pillars: ['whats_coming', 'how_companies_win'],
      rationale: 'Current factual query. Answer in prose only.',
    }),
  },
  {
    matches: (lower) =>
      /\b(what is changing|what'?s changing|how is .* changing|what changes)\b/.test(lower) &&
      /\b(bottleneck|constraint|less obvious|people are missing|hidden constraint|hidden bottleneck)\b/.test(lower) &&
      !/\b(show me|map|visuali[sz]e|signal map|landscape|terrain)\b/.test(lower),
    build: () => ({
      mode: 'single_pillar',
      pillars: ['whats_coming'],
      rationale: 'Focused future-mechanism question. Explain the specific bottleneck in prose.',
    }),
  },
  {
    matches: (lower) =>
      /\b(value stack|stack of value|capture stack|value ladder|layer cake|stack in)\b/.test(lower) ||
      (/\b(show me|map|visuali[sz]e)\b/.test(lower) && /\b(stack|layers|ladder)\b/.test(lower)),
    build: () => ({
      mode: 'two_pillar',
      pillars: ['how_companies_win', 'money_game'],
      rationale: 'Focused structural layer question.',
    }),
  },
  {
    matches: (lower) =>
      /\b(compounding loop|compounding cycle|what does .*compounding.*look like|how does .*compound|loop in a career)\b/.test(lower),
    build: ({ defaultSingle }) => ({
      mode: 'single_pillar',
      pillars: [defaultSingle === 'human_mind' ? 'money_game' : defaultSingle],
      rationale: 'Compounding is a recurring mechanism. Show the reinforcing loop directly.',
    }),
  },
  {
    matches: (lower) =>
      /\b(stay stuck|stuck even when|self-justification|identity protection|avoidance loop|loop keeps me stuck|why do people repeat)\b/.test(lower),
    build: () => ({
      mode: 'two_pillar',
      pillars: ['human_mind', 'think_sharper'],
      rationale: 'Psychological stuckness is a defensive loop.',
    }),
  },
  {
    matches: (lower) =>
      /\b(motion|commitment|commit|bet on|willing to bet|judged|started? .*did not finish|started? .*didn'?t finish|did not finish|didn'?t finish|slipping away|avoid commitment|avoidance|drifting back|keep drifting|finish what|unfinished)\b/.test(lower),
    build: () => ({
      mode: 'two_pillar',
      pillars: ['human_mind', 'think_sharper'],
      rationale: 'Commitment and unfinished-motion accountability question. Use human pattern plus decision quality, no router call needed.',
    }),
  },
  {
    matches: (lower) =>
      /\b(hype cycle|rise[, ]+peak[, ]+and decline|rise and decline|adoption curve|s-curve|compounding curve|show me the curve)\b/.test(lower),
    build: () => ({
      mode: 'single_pillar',
      pillars: ['think_sharper'],
      rationale: 'Phase-change question.',
    }),
  },
  {
    matches: (lower) =>
      /\b(pyramid|hierarchy|depends on what|built on what|foundation of|layers of dependency)\b/.test(lower),
    build: () => ({
      mode: 'single_pillar',
      pillars: ['how_companies_win'],
      rationale: 'Dependency or hierarchy question.',
    }),
  },
  {
    matches: (lower) =>
      wantsSignalMap(lower) &&
      /\b(what'?s coming|where will the real value accrue|where does the real value accrue|where does value accrue|what happens if|future|forecast|prediction|predict|signals?|next \d+|next decade|2030|2035|202[7-9])\b/.test(lower),
    build: () => ({
      mode: 'four_pillar_synthesis',
      pillars: FOUR_PILLAR_STACK,
      rationale: 'Explicit future / signal / prediction question.',
    }),
  },
  {
    matches: (lower) =>
      /\b(should i| vs | versus |tradeoff|rationalizing|conflict|tension|or should|optimize for)\b/.test(lower),
    build: () => ({
      mode: 'two_pillar',
      pillars: ['human_mind', 'money_game'],
      rationale: 'Tradeoff question. Use a direct comparison.',
    }),
  },
  {
    matches: (lower) =>
      /\b(first 10 users?|first ten users?|early users?|stick around|retention|retain|activation|onboarding|churn|user acquisition|get .*users?|keep .*users?)\b/.test(lower),
    build: () => ({
      mode: 'two_pillar',
      pillars: ['how_companies_win', 'move_people'],
      rationale: 'Early-user retention question. Combine product wedge with user persuasion, no router call needed.',
    }),
  },
  {
    matches: (lower) =>
      /\b(life|career|next 5 years|next five years|who should i become|what should i do with my)\b/.test(lower),
    build: () => ({
      mode: 'all_pillar_synthesis',
      pillars: ALL_PILLARS,
      rationale: 'Major orientation question. Use all pillars in prose.',
    }),
  },
]

function explicitQuestionShapeRoute(query, session) {
  const lower = String(query || '').toLowerCase().trim()
  const weightedPillars = Object.entries(session?.pillar_weights || {})
    .filter(([pillar]) => ALL_PILLARS.includes(pillar))
    .sort((a, b) => b[1] - a[1])
    .map(([pillar]) => pillar)
  const defaultSingle = weightedPillars[0] || 'human_mind'

  for (const rule of QUESTION_SHAPE_RULES) {
    if (rule.matches(lower)) {
      return rule.build({ defaultSingle })
    }
  }

  return null
}

function sourceMatchKey(item = {}) {
  return `${item.pillar || ''}|||${item.author || ''}|||${item.title || ''}`
}

function pillarDisplayName(pillar = '') {
  return pillar.replace(/_/g, ' ')
}

function sourceRank(source = {}) {
  const statusScore =
    source.enrichment_status === 'interpreted'
      ? 3
      : source.enrichment_status === 'claims_extracted'
        ? 2
        : source.enrichment_status === 'raw'
          ? 1
          : 0
  const interpretationConfidence = Number(source.axiom_interpretation_confidence) || 0
  const claimsConfidence = Number(source.source_claims_confidence) || 0
  const qualityScore =
    source.source_quality === 'foundational'
      ? 2
      : source.source_quality === 'high_signal'
        ? 1.5
        : source.source_quality === 'mixed'
          ? 1
          : source.source_quality === 'speculative'
            ? 0.5
            : 0

  return (statusScore * 10) + (interpretationConfidence * 5) + (claimsConfidence * 2) + qualityScore
}

function describeSourceWeight(source = {}) {
  const type = String(source.content_type || '').toLowerCase()
  const confidence = Math.max(
    Number(source.axiom_interpretation_confidence) || 0,
    Number(source.source_claims_confidence) || 0
  )

  const kind =
    type === 'academic_paper' ? 'white paper' :
    type === 'essay' || type === 'article' ? 'operator essay' :
    type === 'financial_document' ? 'annual letter' :
    type === 'podcast' ? 'podcast' :
    type === 'book' ? 'book' :
    'source'

  const weight = confidence >= 0.85 ? 'high' : confidence >= 0.7 ? 'medium' : 'low'
  return `${kind} weight: ${weight}`
}

function normalizeRouterPayload(payload = {}) {
  const requestedMode = ROUTER_MODES.has(payload.mode) ? payload.mode : 'single_pillar'
  let pillars = Array.isArray(payload.pillars)
    ? payload.pillars.filter((pillar) => ALL_PILLARS.includes(pillar))
    : []

  if (requestedMode === 'single_pillar') {
    pillars = [pillars[0] || payload.primary_pillar || 'human_mind'].filter((pillar) => ALL_PILLARS.includes(pillar))
  } else if (requestedMode === 'two_pillar') {
    pillars = [...new Set(pillars)].slice(0, 2)
    if (pillars.length < 2) pillars = ['human_mind', 'money_game']
  } else if (requestedMode === 'four_pillar_synthesis') {
    pillars = FOUR_PILLAR_STACK
  } else if (requestedMode === 'all_pillar_synthesis') {
    pillars = ALL_PILLARS
  }

  return {
    mode: requestedMode,
    pillars,
    rationale: typeof payload.rationale === 'string' ? payload.rationale.trim() : '',
  }
}

function fallbackRouteQuestionMode(query, session) {
  const explicit = explicitQuestionShapeRoute(query, session)
  if (explicit) return explicit

  const weightedPillars = Object.entries(session?.pillar_weights || {})
    .filter(([pillar]) => ALL_PILLARS.includes(pillar))
    .sort((a, b) => b[1] - a[1])
    .map(([pillar]) => pillar)

  return {
    mode: 'single_pillar',
    pillars: [weightedPillars[0] || 'human_mind'],
    rationale: 'Default to one pillar for a narrow or local question.',
  }
}

export async function routeQuestionMode(query, session) {
  const explicit = explicitQuestionShapeRoute(query, session)
  if (explicit) return explicit

  const cacheKey = stableStringify({
    query,
    profile: session?.axiom_profile || '',
    notes: session?.session_notes || '',
    weights: session?.pillar_weights || {},
  })

  return cachedAsync(routerCache, cacheKey, async () => {
    const parsed = await requestJsonObject({
      label: 'question router payload',
      maxCompletionTokens: 220,
      usageContext: {
        call_type: 'chat',
        session_id: session?.id || null,
      },
      messages: [
        {
          role: 'system',
          content: `You route questions for Axiom.

Return valid JSON only with this exact shape:
{
  "mode": "single_pillar|two_pillar|four_pillar_synthesis|all_pillar_synthesis",
  "pillars": ["human_mind|money_game|how_companies_win|whats_coming|think_sharper|move_people"],
  "rationale": "short string"
}

Rules:
- single_pillar: exactly 1 pillar
- two_pillar: exactly 2 pillars
- four_pillar_synthesis: always use ["whats_coming","how_companies_win","money_game","think_sharper"]
- all_pillar_synthesis: always use all six pillars
- For focused "tell me about this specific thing" questions, choose single_pillar or two_pillar.
- User context must influence the mode and pillar choice.
- Choose the smallest mode that can answer the question well.`,
        },
        {
          role: 'user',
          content: `Question: ${query}
Private theory: ${session?.axiom_profile || 'None'}
Session notes: ${session?.session_notes || 'None'}
Pillar weights: ${JSON.stringify(session?.pillar_weights || {})}`,
        },
      ],
    })
    return normalizeRouterPayload(parsed)
  }).catch(() => {
    return fallbackRouteQuestionMode(query, session)
  })
}

function emitTiming(options, step, data = {}) {
  if (typeof options?.onTiming === 'function') {
    options.onTiming(step, data)
  }
}

async function getHistoricalAbsorbedConceptCount(userId, options = {}) {
  if (!userId) return 0
  if (!options._historicalAbsorbedConceptCountPromise) {
    options._historicalAbsorbedConceptCountPromise = knowledgeSupabase
      .from('user_concept_states')
      .select('concept_id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('state', 'absorbed')
      .then(({ count, error }) => {
        if (error) {
          console.warn('[Axiom learning state] historical absorbed fetch failed', error)
          return 0
        }
        return count || 0
      })
      .catch(() => 0)
  }

  return options._historicalAbsorbedConceptCountPromise
}

async function resolveQueryEmbedding(query, options = {}) {
  const normalizedQuery = String(query || '').trim()
  const sharedText = String(options.queryEmbeddingText || '').trim()
  const canUseSharedEmbedding = sharedText && normalizedQuery === sharedText
  if (canUseSharedEmbedding && options.queryEmbedding) return options.queryEmbedding
  if (canUseSharedEmbedding && options.queryEmbeddingPromise) return options.queryEmbeddingPromise
  if (canUseSharedEmbedding && typeof options.getQueryEmbedding === 'function') {
    return options.getQueryEmbedding()
  }

  const cacheKey = normalizedQuery.toLowerCase()
  return cachedAsync(embeddingCache, cacheKey, async () => {
    emitTiming(options, 'embedding:start')
    const embedding = await generateEmbedding(normalizedQuery)
    emitTiming(options, 'embedding:done')
    return embedding
  })
}

export async function searchWikiForRoute(query, route, matchCount = 3, options = {}) {
  const mode = route?.mode || 'single_pillar'
  const pillars = Array.isArray(route?.pillars) && route.pillars.length > 0 ? route.pillars : [null]

  if (mode === 'single_pillar') {
    const result = await searchWiki(query, matchCount, pillars[0] || null, options)
    const historicalAbsorbedConceptCount = await getHistoricalAbsorbedConceptCount(
      options.userId || options.user_id || null,
      options
    )
    emitTiming(options, 'concepts:merged', {
      conceptCount: result.concepts?.length || 0,
      absorbedCount: result.concepts?.filter((concept) => concept.state === 'absorbed').length || 0,
      historicalAbsorbedCount: historicalAbsorbedConceptCount,
      totalAbsorbedCount: (result.concepts?.filter((concept) => concept.state === 'absorbed').length || 0) + historicalAbsorbedConceptCount,
      partialCount: result.concepts?.filter((concept) => concept.state === 'partial').length || 0,
      encounteredCount: result.concepts?.filter((concept) => concept.state === 'encountered').length || 0,
    })
    return {
      ...result,
      historicalAbsorbedConceptCount,
      pillarResults: {
        [pillars[0] || 'unscoped']: result,
      },
    }
  }

  const perPillarCount = mode === 'all_pillar_synthesis' ? 2 : Math.max(2, matchCount)
  const resultsByPillar = await Promise.all(
    pillars.map((pillar) => searchWiki(query, perPillarCount, pillar, options))
  )
  const pillarResults = Object.fromEntries(
    pillars.map((pillar, index) => [pillar, resultsByPillar[index]])
  )

  const chunkMap = new Map()
  const sourceMap = new Map()
  const conceptMap = new Map()
  let confidence = 0

  for (const result of resultsByPillar) {
    confidence = Math.max(confidence, result.confidence || 0)
    for (const chunk of result.chunks || []) {
      const key = sourceMatchKey(chunk)
      const existing = chunkMap.get(key)
      if (!existing || chunk.similarity > existing.similarity) {
        chunkMap.set(key, chunk)
      }
    }
    for (const source of result.sources || []) {
      sourceMap.set(sourceMatchKey(source), source)
    }
    for (const concept of result.concepts || []) {
      conceptMap.set(concept.id, concept)
    }
  }

  const chunkLimit = mode === 'all_pillar_synthesis' ? 8 : mode === 'four_pillar_synthesis' ? 6 : 4
  const chunks = [...chunkMap.values()]
    .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
    .slice(0, chunkLimit)

  const sources = [...sourceMap.values()].filter((source) =>
    chunks.some((chunk) => sourceMatchKey(chunk) === sourceMatchKey(source))
  )

  const selectedSourceIds = new Set(sources.map((source) => source.id).filter(Boolean))
  const concepts = [...conceptMap.values()]
    .filter((concept) => selectedSourceIds.has(concept.source_id))
    .slice(0, 60)
  const historicalAbsorbedConceptCount = await getHistoricalAbsorbedConceptCount(
    options.userId || options.user_id || null,
    options
  )
  const currentAbsorbedConceptCount = concepts.filter((concept) => concept.state === 'absorbed').length

  emitTiming(options, 'concepts:merged', {
    conceptCount: concepts.length,
    absorbedCount: currentAbsorbedConceptCount,
    historicalAbsorbedCount: historicalAbsorbedConceptCount,
    totalAbsorbedCount: currentAbsorbedConceptCount + historicalAbsorbedConceptCount,
    partialCount: concepts.filter((concept) => concept.state === 'partial').length,
    encounteredCount: concepts.filter((concept) => concept.state === 'encountered').length,
  })

  return { chunks, sources, confidence, pillarResults, concepts, historicalAbsorbedConceptCount }
}

function summarisePillarEvidence(pillar, result = {}) {
  const chunkCount = Array.isArray(result.chunks) ? result.chunks.length : 0
  const sourceNames = (result.sources || [])
    .slice(0, 3)
    .map((source) => source.title)
    .filter(Boolean)

  return [
    `${pillarDisplayName(pillar)} -> confidence ${Number(result.confidence || 0).toFixed(3)}`,
    chunkCount > 0 ? `${chunkCount} chunk${chunkCount === 1 ? '' : 's'}` : 'no strong chunk evidence',
    sourceNames.length > 0 ? `sources: ${sourceNames.join(', ')}` : 'no source interpretations retrieved',
  ].join(' | ')
}

export function formatRouteContext(route, pillarResults = {}) {
  if (!route) return ''

  const pillarsText = (route.pillars || []).map(pillarDisplayName).join(', ')
  const modeInstructions = {
    single_pillar: 'Answer through one pillar only. Keep the response tight and local. The user layer still applies fully.',
    two_pillar: 'Answer through two pillars. Surface the tension between them, then reconcile it into one judgment. The user layer applies inside both pillars.',
    four_pillar_synthesis: 'Answer through WHAT\'S COMING, HOW COMPANIES WIN, THE MONEY GAME, and THINK SHARPER. Each pillar must be filtered through the user before the synthesis.',
    all_pillar_synthesis: 'Answer through all six pillars, but weight them by relevance. Do not force equal coverage. Every pillar is filtered through the user.',
  }
  const evidenceLines = (route.pillars || [])
    .map((pillar) => summarisePillarEvidence(pillar, pillarResults[pillar]))
    .join('\n')

  return `Question routing mode: ${route.mode}
Selected pillars: ${pillarsText}
Routing rationale: ${route.rationale || 'None provided'}
Routing instruction: ${modeInstructions[route.mode] || 'Use the selected pillars and keep the user layer active throughout.'}
Per-pillar evidence:
${evidenceLines || 'No per-pillar evidence summary available.'}`
}

// ─── Query Expansion ─────────────────────────────────────────────────────────
async function expandQuery(query) {
  const cacheKey = String(query || '').trim().toLowerCase()
  if (!cacheKey) return []

  return cachedAsync(queryExpansionCache, cacheKey, async () => {
    const response = await openai.chat.completions.create({
      model: CHAT_MODEL,
      usage_context: { call_type: 'query_expansion' },
      messages: [
        {
          role: 'system',
          content: `You generate alternative phrasings of a query to improve semantic search retrieval.
Return exactly 3 alternative phrasings as a JSON array of strings. Nothing else.
Focus on: different vocabulary, related concepts, and how the topic might appear in books or essays.
Example input: "difference between resistance and not caring"
Example output: ["procrastination vs genuine disinterest", "resistance to finishing creative work", "Pressfield resistance definition"]`,
        },
        { role: 'user', content: query },
      ],
      max_completion_tokens: 150,
    })

    const raw = response.choices[0].message.content.trim()
    const alternatives = JSON.parse(raw)
    if (Array.isArray(alternatives)) return alternatives.slice(0, 3)
    return []
  }).catch(() => {
    return []
  })
}

// ─── Search Against One Query ─────────────────────────────────────────────────
async function searchSingleQuery(query, matchCount, filterPillar, options = {}) {
  const cacheKey = stableStringify({
    query: String(query || '').trim(),
    matchCount,
    filterPillar: filterPillar || null,
  })

  return cachedAsync(searchCache, cacheKey, async () => {
    try {
      const embedding = await resolveQueryEmbedding(query, options)
      emitTiming(options, 'vector_search:start', { filterPillar, matchCount })
      const { data, error } = await knowledgeSupabase.rpc('match_wiki_chunks', {
        query_embedding: embedding,
        match_count: matchCount,
        filter_pillar: filterPillar,
      })
      emitTiming(options, 'vector_search:done', {
        filterPillar,
        matchCount,
        resultCount: data?.length || 0,
      })
      if (error) return []
      return data || []
    } catch {
      return []
    }
  })
}

async function fetchSourcesForChunks(chunks, options = {}) {
  if (!chunks || chunks.length === 0) return []

  const titles = [...new Set(chunks.map((chunk) => chunk.title).filter(Boolean))]
  if (titles.length === 0) return []

  emitTiming(options, 'source_fetch:start', { titleCount: titles.length })
  const { data, error } = await knowledgeSupabase
    .from('wiki_sources')
    .select(`
      id,
      pillar,
      content_type,
      title,
      author,
      source_url,
      published_at,
      source_claims,
      axiom_interpretation,
      source_claims_confidence,
      axiom_interpretation_confidence,
      enrichment_status,
      source_quality,
      summary_for_retrieval
    `)
    .in('title', titles)
  emitTiming(options, 'source_fetch:done', {
    titleCount: titles.length,
    sourceCount: data?.length || 0,
  })

  if (error) return []

  const wantedKeys = new Set(chunks.map(sourceMatchKey))
  return (data || [])
    .filter((source) => wantedKeys.has(sourceMatchKey(source)))
    .sort((a, b) => sourceRank(b) - sourceRank(a))
}

async function fetchConceptsForSources(sources, options = {}) {
  const userId = options.userId || options.user_id || null
  const sourceIds = [...new Set((sources || []).map((source) => source.id).filter(Boolean))]
  if (sourceIds.length === 0) return []

  emitTiming(options, 'concepts:start', { sourceCount: sourceIds.length, hasUserId: Boolean(userId) })

  const { data: concepts, error: conceptError } = await knowledgeSupabase
    .from('source_learning_maps')
    .select(`
      id,
      source_id,
      concept_index,
      concept_name,
      concept_description,
      why_it_matters,
      absorbed_signal
    `)
    .in('source_id', sourceIds)
    .order('source_id', { ascending: true })
    .order('concept_index', { ascending: true })

  if (conceptError || !concepts?.length) {
    emitTiming(options, 'concepts:done', {
      sourceCount: sourceIds.length,
      conceptCount: 0,
      stateCount: 0,
      error: conceptError?.message,
    })
    if (conceptError) console.warn('[Axiom learning state] concept fetch failed', conceptError)
    return []
  }

  let stateByConceptId = new Map()
  if (userId) {
    const conceptIds = concepts.map((concept) => concept.id)
    const { data: states, error: stateError } = await knowledgeSupabase
      .from('user_concept_states')
      .select('concept_id,state,updated_at')
      .eq('user_id', userId)
      .in('concept_id', conceptIds)

    if (stateError) {
      console.warn('[Axiom learning state] state fetch failed', stateError)
    } else {
      stateByConceptId = new Map((states || []).map((state) => [state.concept_id, state]))
    }
  }

  const hydrated = concepts.map((concept) => {
    const userState = stateByConceptId.get(concept.id)
    const state = CONCEPT_STATES.includes(userState?.state) ? userState.state : null
    return {
      ...concept,
      state,
      state_label: state || 'not_yet_encountered',
      state_updated_at: userState?.updated_at || null,
    }
  })

  emitTiming(options, 'concepts:done', {
    sourceCount: sourceIds.length,
    conceptCount: hydrated.length,
    stateCount: stateByConceptId.size,
    absorbedCount: hydrated.filter((concept) => concept.state === 'absorbed').length,
    partialCount: hydrated.filter((concept) => concept.state === 'partial').length,
    encounteredCount: hydrated.filter((concept) => concept.state === 'encountered').length,
  })
  console.info('[Axiom learning state] retrieved concepts', {
    sourceCount: sourceIds.length,
    conceptCount: hydrated.length,
    states: hydrated.reduce((counts, concept) => {
      const key = concept.state || 'not_yet_encountered'
      counts[key] = (counts[key] || 0) + 1
      return counts
    }, {}),
  })

  return hydrated
}

// ─── Main Search ─────────────────────────────────────────────────────────────
// Returns { chunks, sources, confidence } where confidence is the top similarity score.
// If no chunk clears CONFIDENCE_THRESHOLD, returns { chunks: [], sources: [], confidence: 0 }.
export async function searchWiki(query, matchCount = 3, filterPillar = null, options = {}) {
  const rawResults = await searchSingleQuery(query, matchCount * 3, filterPillar, options)
  const rawSearch = await buildWikiSearchResult([rawResults], matchCount, options)
  if (rawSearch.confidence >= QUERY_EXPANSION_CONFIDENCE_FLOOR) {
    return rawSearch
  }

  if (!options.allowQueryExpansion) {
    emitTiming(options, 'query_expansion:skipped', {
      reason: 'disabled_for_turn',
      confidence: rawSearch.confidence,
      filterPillar,
    })
    return rawSearch
  }

  if (rawResults.length === 0) {
    emitTiming(options, 'query_expansion:skipped', {
      reason: 'no_initial_candidates',
      confidence: rawSearch.confidence,
      filterPillar,
    })
    return rawSearch
  }

  emitTiming(options, 'query_expansion:start', { confidence: rawSearch.confidence })
  const alternatives = (await expandQuery(query)).slice(0, EXPANDED_QUERY_SEARCH_LIMIT)
  emitTiming(options, 'query_expansion:done', { alternativeCount: alternatives.length })
  if (alternatives.length === 0) return rawSearch

  const expandedResultSets = await Promise.all(
    alternatives.map((q) => searchSingleQuery(q, matchCount * 3, filterPillar, options))
  )

  return buildWikiSearchResult([rawResults, ...expandedResultSets], matchCount, options)
}

async function buildWikiSearchResult(resultSets, matchCount, options = {}) {
  emitTiming(options, 'rerank:start', { resultSetCount: resultSets.length })
  // Merge — deduplicate by title, keep highest similarity per source
  const bestByTitle = new Map()
  for (const chunks of resultSets) {
    for (const chunk of chunks) {
      const existing = bestByTitle.get(chunk.title)
      if (!existing || chunk.similarity > existing.similarity) {
        bestByTitle.set(chunk.title, chunk)
      }
    }
  }

  const deduped = [...bestByTitle.values()].sort((a, b) => b.similarity - a.similarity)
  const aboveThreshold = deduped.filter((c) => c.similarity >= CONFIDENCE_THRESHOLD)

  if (aboveThreshold.length === 0) {
    emitTiming(options, 'rerank:done', {
      candidateCount: deduped.length,
      aboveThresholdCount: 0,
    })
    return { chunks: [], sources: [], confidence: 0 }
  }

  const results = aboveThreshold.slice(0, matchCount)
  const confidence = results[0].similarity
  emitTiming(options, 'rerank:done', {
    candidateCount: deduped.length,
    aboveThresholdCount: aboveThreshold.length,
    selectedCount: results.length,
    confidence,
  })
  const sources = await fetchSourcesForChunks(results, options)
  const concepts = await fetchConceptsForSources(sources, options)

  return { chunks: results, sources, confidence, concepts }
}

export function formatLearningStateContext(concepts = []) {
  const uniqueConcepts = []
  const seen = new Set()

  for (const concept of concepts || []) {
    if (!concept?.id || seen.has(concept.id)) continue
    seen.add(concept.id)
    uniqueConcepts.push(concept)
  }

  if (uniqueConcepts.length === 0) return ''

  const byStateRank = [...uniqueConcepts].sort((a, b) => {
    const rankDelta = (CONCEPT_STATE_RANK[b.state] || 0) - (CONCEPT_STATE_RANK[a.state] || 0)
    if (rankDelta) return rankDelta
    return String(a.concept_name || '').localeCompare(String(b.concept_name || ''))
  })

  const lines = byStateRank.slice(0, 40).map((concept) => {
    const state = concept.state === 'absorbed'
      ? 'absorbed'
      : concept.state === 'partial'
        ? 'partially understood'
        : concept.state === 'encountered'
          ? 'encountered'
          : 'not yet encountered'
    return `- ${concept.concept_name} — state: ${state}`
  })

  return `LEARNING STATE FOR THIS USER:
${lines.join('\n')}

Your job in this response:
- If a concept is absorbed, use it naturally without explaining it from scratch
- If a concept is partially understood, deepen it through the user's specific situation
- If a concept has not been encountered, introduce it naturally through what the user just shared — never as a lesson, always as insight that fits their moment`
}

function normalizeStateAction(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z]+/g, '_')
    .replace(/^_+|_+$/g, '')

  if (['no_change', 'none', 'unchanged', 'no_state_change'].includes(normalized)) return null
  if (['encountered', 'move_to_encountered', 'moved_to_encountered'].includes(normalized)) return 'encountered'
  if (['partial', 'move_to_partial', 'moved_to_partial', 'partially_understood'].includes(normalized)) return 'partial'
  if (['absorbed', 'move_to_absorbed', 'moved_to_absorbed'].includes(normalized)) return 'absorbed'
  return null
}

function shouldApplyConceptState(currentState, nextState) {
  if (!nextState) return false
  return (CONCEPT_STATE_RANK[nextState] || 0) > (CONCEPT_STATE_RANK[currentState] || 0)
}

async function persistConceptStateRows(rows) {
  const authHeaders = await getAuthHeaders()
  const response = await fetch(apiUrl('/api/knowledge/concept-states'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify({ rows }),
  })

  if (!response.ok) {
    let message = response.statusText
    try {
      const data = await response.json()
      message = data?.error || message
    } catch {}

    if (response.status === 503 && /knowledge service not configured/i.test(message)) {
      console.warn('[Axiom learning state] update skipped: knowledge service not configured')
      return { updated: 0, skipped: true, reason: 'knowledge_service_not_configured' }
    }

    throw new Error(message)
  }

  return response.json()
}

export async function updateConceptStatesAfterResponse({
  userId,
  concepts = [],
  userMessage = '',
  assistantMessage = '',
  sessionId = null,
} = {}) {
  if (!userId || !Array.isArray(concepts) || concepts.length === 0 || !assistantMessage) {
    console.info('[Axiom learning state] update skipped', {
      hasUserId: Boolean(userId),
      conceptCount: concepts?.length || 0,
      hasAssistantMessage: Boolean(assistantMessage),
    })
    return { updated: 0, skipped: true }
  }

  const uniqueConcepts = []
  const seen = new Set()
  for (const concept of concepts) {
    if (!concept?.id || seen.has(concept.id)) continue
    seen.add(concept.id)
    uniqueConcepts.push(concept)
  }
  if (uniqueConcepts.length === 0) return { updated: 0, skipped: true }

  const payload = await requestJsonObject({
    label: 'concept state update',
    maxCompletionTokens: 1600,
    usageContext: { call_type: 'concept_state_update', session_id: sessionId },
    messages: [
      {
        role: 'system',
        content: `You update a user's learning-state ledger for a mentorship app.
Return only valid JSON.

Schema:
{
  "updates": [
    {
      "concept_id": "uuid from the list",
      "action": "no_state_change|encountered|moved_to_partial|moved_to_absorbed",
      "reason": "brief reason"
    }
  ]
}

Rules:
- Use only concept_id values from the provided list.
- "encountered" means Axiom clearly introduced or used the concept in this response.
- "moved_to_partial" means the concept appears in the assistant response AND the user's reply engages with it directly, even briefly. Passive reading does not count. Active engagement does.
- "moved_to_absorbed" means the concept is being actively used, not just received. Classify absorbed when ANY ONE of these signals is present:
  1. The user applies the concept to their own specific situation in a way that shows they understand the mechanism, not just the label.
  2. The user proposes a concrete action, test, or decision directly derived from the concept.
  3. The user challenges or refines the concept based on their situation. Pushback that shows understanding counts as absorbed.
  4. The assistant explicitly confirms demonstrated understanding with phrases like "that is crisp enough to test", "that is the right edge", "that is usable", or equivalent language.
- Absorbed does not require all four signals. One strong signal is enough.
- Prefer moved_to_absorbed over moved_to_partial when the user is applying, acting from, or refining the mechanism.
- Never downgrade a concept.
- If the response did not materially use a concept and the user did not engage it, return no_state_change.
- The reason must name the exact signal that triggered the transition, such as "user applied mechanism to Axiom onboarding" or "assistant confirmed understanding as usable".`,
      },
      {
        role: 'user',
        content: `User message:
${userMessage}

Assistant response:
${assistantMessage}

Concepts in scope:
${uniqueConcepts.slice(0, 60).map((concept) => `- id: ${concept.id}
  name: ${concept.concept_name}
  current_state: ${concept.state || 'not_yet_encountered'}
  description: ${concept.concept_description}
  source_absorbed_signal: ${concept.absorbed_signal || 'None provided'}`).join('\n')}`,
      },
    ],
  })

  const updates = Array.isArray(payload?.updates) ? payload.updates : []
  const conceptById = new Map(uniqueConcepts.map((concept) => [concept.id, concept]))
  const rows = []
  const transitions = []

  for (const update of updates) {
    const conceptId = update?.concept_id
    const concept = conceptById.get(conceptId)
    if (!concept) continue
    const nextState = normalizeStateAction(update.action)
    if (!shouldApplyConceptState(concept.state, nextState)) continue
    const reason = typeof update.reason === 'string'
      ? update.reason.trim().slice(0, 240)
      : ''
    rows.push({
      user_id: userId,
      concept_id: conceptId,
      state: nextState,
      updated_at: new Date().toISOString(),
    })
    transitions.push({
      concept_id: conceptId,
      concept_name: concept.concept_name || '',
      from: concept.state || 'not_yet_encountered',
      to: nextState,
      reason,
    })
  }

  if (rows.length === 0) {
    console.info('[Axiom learning state] no updates applied', {
      conceptCount: uniqueConcepts.length,
      modelUpdates: updates.length,
    })
    return { updated: 0, skipped: false }
  }

  const result = await persistConceptStateRows(rows)
  if (result?.skipped) return { ...result, transitions }

  console.info('[Axiom learning state] updates applied', {
    updated: result?.updated || rows.length,
    states: result?.states || rows.reduce((counts, row) => {
      counts[row.state] = (counts[row.state] || 0) + 1
      return counts
    }, {}),
    transitions,
  })

  return { updated: result?.updated || rows.length, skipped: false, transitions }
}

// ─── Internalized Priors ─────────────────────────────────────────────────────
// Transforms retrieved chunks into first-person internalized knowledge statements.
// Groups by source so duplicate chunks from the same book produce one prior.
function formatSourceInterpretation(source) {
  const claims = source?.source_claims || {}
  const interpretation = source?.axiom_interpretation || {}
  const thesis = claims.core_thesis || source.summary_for_retrieval || ''
  const sourceDate = source?.published_at
    ? new Date(source.published_at).toISOString().slice(0, 10)
    : ''
  const themes = Array.isArray(claims.main_themes) ? claims.main_themes.slice(0, 3).join(', ') : ''
  const builderImplications = Array.isArray(interpretation?.practical_implications?.builders)
    ? interpretation.practical_implications.builders.slice(0, 2).join(' ')
    : ''
  const capitalImplications = Array.isArray(interpretation?.practical_implications?.capital)
    ? interpretation.practical_implications.capital.slice(0, 1).join(' ')
    : ''
  const uncertainty = Array.isArray(interpretation?.uncertainty_notes)
    ? interpretation.uncertainty_notes.slice(0, 1).join(' ')
    : ''

  return [
    thesis,
    `Source weighting: ${describeSourceWeight(source)}.`,
    sourceDate ? `Source date: ${sourceDate}.` : 'Source date: unknown in library metadata.',
    source?.source_url ? `Source URL: ${source.source_url}.` : '',
    themes ? `Themes: ${themes}.` : '',
    builderImplications ? `Builders: ${builderImplications}` : '',
    capitalImplications ? `Capital: ${capitalImplications}` : '',
    uncertainty ? `Uncertainty: ${uncertainty}` : '',
  ]
    .filter(Boolean)
    .join(' ')
    .trim()
}

export async function formatWikiContext(chunks, sources = [], options = {}) {
  if ((!chunks || chunks.length === 0) && (!sources || sources.length === 0)) return ''

  emitTiming(options, 'wiki_format:start', {
    chunkCount: chunks?.length || 0,
    sourceCount: sources?.length || 0,
  })

  // Group by (author, title) — merge key_frameworks from same source, skip null values
  const bySource = new Map()
  for (const chunk of chunks) {
    if (!chunk.key_frameworks) continue
    const key = `${chunk.author}|||${chunk.title}`
    if (!bySource.has(key)) {
      bySource.set(key, { author: chunk.author, title: chunk.title, texts: [] })
    }
    bySource.get(key).texts.push(chunk.key_frameworks)
  }

  for (const source of sources) {
    const key = `${source.author}|||${source.title}`
    const interpreted = formatSourceInterpretation(source)
    if (!bySource.has(key)) {
      bySource.set(key, { author: source.author, title: source.title, texts: [] })
    }
    if (interpreted) bySource.get(key).texts.push(interpreted)
  }

  if (bySource.size === 0) {
    emitTiming(options, 'wiki_format:done', {
      sourceGroupCount: 0,
      contextChars: 0,
    })
    return ''
  }

  const priors = [...bySource.values()].map(({ author, title, texts }) => {
    const combinedText = texts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 800)
    if (!combinedText) return ''
    return `Axiom knows from ${author || 'Unknown author'}, ${title || 'Unknown source'}: ${combinedText}`
  })

  const context = priors.filter(Boolean).join('\n\n')
  emitTiming(options, 'wiki_format:done', {
    sourceGroupCount: bySource.size,
    contextChars: context.length,
  })

  return context
}
