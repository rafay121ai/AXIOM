import { supabase } from './supabase'
import { generateEmbedding, openai, CHAT_MODEL, requestJsonObject } from './openai'

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
const ARTIFACT_STRATEGIES = new Set([
  'none',
  'signal_map',
  'comparison_table',
  'quadrant',
  'mental_model',
  'behavior_loop',
  'reasoning_cycle',
  'reasoning_stack',
  'reasoning_curve',
  'reasoning_wave',
  'reasoning_pyramid',
])
const CACHE_TTL_MS = 5 * 60 * 1000
const MAX_CACHE_ENTRIES = 120
const queryExpansionCache = new Map()
const searchCache = new Map()
const routerCache = new Map()
const priorSynthesisCache = new Map()

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

const QUESTION_SHAPE_RULES = [
  {
    matches: (lower) =>
      /\b(what is changing|what'?s changing|how is .* changing|what changes)\b/.test(lower) &&
      /\b(bottleneck|constraint|less obvious|people are missing|hidden constraint|hidden bottleneck)\b/.test(lower) &&
      !/\b(show me|map|visuali[sz]e|signal map|landscape|terrain)\b/.test(lower),
    build: () => ({
      mode: 'single_pillar',
      pillars: ['whats_coming'],
      artifactStrategy: 'none',
      rationale: 'Focused future-mechanism question. Explain the specific bottleneck in prose; do not force a signal map.',
    }),
  },
  {
    matches: (lower) =>
      /\b(value stack|stack of value|capture stack|value ladder|layer cake|stack in)\b/.test(lower) ||
      (/\b(show me|map|visuali[sz]e)\b/.test(lower) && /\b(stack|layers|ladder)\b/.test(lower)),
    build: () => ({
      mode: 'two_pillar',
      pillars: ['how_companies_win', 'money_game'],
      artifactStrategy: 'reasoning_stack',
      rationale: 'Focused structural layer question. Use a stack, not a broad landscape artifact.',
    }),
  },
  {
    matches: (lower) =>
      /\b(compounding loop|compounding cycle|what does .*compounding.*look like|how does .*compound|loop in a career)\b/.test(lower),
    build: ({ defaultSingle }) => ({
      mode: 'single_pillar',
      pillars: [defaultSingle === 'human_mind' ? 'money_game' : defaultSingle],
      artifactStrategy: 'reasoning_cycle',
      rationale: 'Compounding is a recurring mechanism. Show the reinforcing loop directly.',
    }),
  },
  {
    matches: (lower) =>
      /\b(stay stuck|stuck even when|self-justification|identity protection|avoidance loop|loop keeps me stuck|why do people repeat)\b/.test(lower),
    build: () => ({
      mode: 'two_pillar',
      pillars: ['human_mind', 'think_sharper'],
      artifactStrategy: 'behavior_loop',
      rationale: 'Psychological stuckness is a defensive loop. Use a behavior loop artifact.',
    }),
  },
  {
    matches: (lower) =>
      /\b(hype cycle|rise[, ]+peak[, ]+and decline|rise and decline|adoption curve|s-curve|compounding curve|show me the curve)\b/.test(lower),
    build: ({ nodePillar, lower }) => ({
      mode: 'single_pillar',
      pillars: [nodePillar || 'think_sharper'],
      artifactStrategy: /\bhype|wave|swell\b/.test(lower) ? 'reasoning_wave' : 'reasoning_curve',
      rationale: 'Phase-change question. Use a curve or wave artifact to make the movement visible.',
    }),
  },
  {
    matches: (lower) =>
      /\b(pyramid|hierarchy|depends on what|built on what|foundation of|layers of dependency)\b/.test(lower),
    build: ({ nodePillar }) => ({
      mode: 'single_pillar',
      pillars: [nodePillar || 'how_companies_win'],
      artifactStrategy: 'reasoning_pyramid',
      rationale: 'Dependency or hierarchy question. Use a pyramid artifact.',
    }),
  },
  {
    matches: (lower) =>
      wantsSignalMap(lower) &&
      /\b(what'?s coming|where will the real value accrue|where does the real value accrue|where does value accrue|what happens if|future|forecast|prediction|predict|signals?|next \d+|next decade|2030|2035|202[7-9])\b/.test(lower),
    build: () => ({
      mode: 'four_pillar_synthesis',
      pillars: FOUR_PILLAR_STACK,
      artifactStrategy: 'signal_map',
      rationale: 'Explicit future / signal / prediction question. Use a full signal map.',
    }),
  },
  {
    matches: (lower) =>
      /\b(should i| vs | versus |tradeoff|rationalizing|conflict|tension|or should|optimize for)\b/.test(lower),
    build: ({ nodePillar }) => ({
      mode: 'two_pillar',
      pillars: nodePillar ? [nodePillar, 'think_sharper'] : ['human_mind', 'money_game'],
      artifactStrategy: 'comparison_table',
      rationale: 'Tradeoff question. Use a direct comparison.',
    }),
  },
  {
    matches: (lower) =>
      /\b(life|career|next 5 years|next five years|who should i become|what should i do with my)\b/.test(lower),
    build: () => ({
      mode: 'all_pillar_synthesis',
      pillars: ALL_PILLARS,
      artifactStrategy: 'signal_map',
      rationale: 'Major orientation question. Use all pillars and a full synthesis artifact.',
    }),
  },
]

function explicitQuestionShapeRoute(query, session, nodeContext = null) {
  const lower = String(query || '').toLowerCase().trim()
  const nodePillar = nodeContext?.pillar && ALL_PILLARS.includes(nodeContext.pillar) ? nodeContext.pillar : null
  const weightedPillars = Object.entries(session?.pillar_weights || {})
    .filter(([pillar]) => ALL_PILLARS.includes(pillar))
    .sort((a, b) => b[1] - a[1])
    .map(([pillar]) => pillar)
  const defaultSingle = nodePillar || weightedPillars[0] || 'human_mind'

  for (const rule of QUESTION_SHAPE_RULES) {
    if (rule.matches(lower)) {
      return rule.build({ lower, nodePillar, defaultSingle })
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

function normalizeRouterPayload(payload = {}, query = '') {
  const lower = String(query || '').toLowerCase()
  const signalMapAllowed = wantsSignalMap(lower)
  const requestedMode = ROUTER_MODES.has(payload.mode) ? payload.mode : 'single_pillar'
  let pillars = Array.isArray(payload.pillars)
    ? payload.pillars.filter((pillar) => ALL_PILLARS.includes(pillar))
    : []
  let artifactStrategy = ARTIFACT_STRATEGIES.has(payload.artifact_strategy) ? payload.artifact_strategy : 'none'

  if (requestedMode === 'single_pillar') {
    pillars = [pillars[0] || payload.primary_pillar || 'human_mind'].filter((pillar) => ALL_PILLARS.includes(pillar))
    artifactStrategy = artifactStrategy === 'none' ? 'none' : artifactStrategy
  } else if (requestedMode === 'two_pillar') {
    pillars = [...new Set(pillars)].slice(0, 2)
    if (pillars.length < 2) pillars = ['human_mind', 'money_game']
    if (artifactStrategy === 'none') artifactStrategy = 'comparison_table'
  } else if (requestedMode === 'four_pillar_synthesis') {
    pillars = FOUR_PILLAR_STACK
    if (artifactStrategy === 'none') artifactStrategy = signalMapAllowed ? 'signal_map' : 'none'
  } else if (requestedMode === 'all_pillar_synthesis') {
    pillars = ALL_PILLARS
    if (artifactStrategy === 'none') artifactStrategy = signalMapAllowed ? 'signal_map' : 'none'
  }

  if (artifactStrategy === 'signal_map' && !signalMapAllowed) {
    artifactStrategy = 'none'
  }

  return {
    mode: requestedMode,
    pillars,
    artifactStrategy,
    rationale: typeof payload.rationale === 'string' ? payload.rationale.trim() : '',
  }
}

function fallbackRouteQuestionMode(query, session, nodeContext = null) {
  const explicit = explicitQuestionShapeRoute(query, session, nodeContext)
  if (explicit) return explicit
  const nodePillar = nodeContext?.pillar && ALL_PILLARS.includes(nodeContext.pillar) ? nodeContext.pillar : null

  const weightedPillars = Object.entries(session?.pillar_weights || {})
    .filter(([pillar]) => ALL_PILLARS.includes(pillar))
    .sort((a, b) => b[1] - a[1])
    .map(([pillar]) => pillar)

  return {
    mode: 'single_pillar',
    pillars: [nodePillar || weightedPillars[0] || 'human_mind'],
    artifactStrategy: 'none',
    rationale: 'Default to one pillar for a narrow or local question.',
  }
}

export async function routeQuestionMode(query, session, nodeContext = null) {
  const explicit = explicitQuestionShapeRoute(query, session, nodeContext)
  if (explicit) return explicit

  const cacheKey = stableStringify({
    query,
    profile: session?.axiom_profile || '',
    notes: session?.session_notes || '',
    weights: session?.pillar_weights || {},
    node: nodeContext
      ? {
          id: nodeContext.id,
          label: nodeContext.label,
          type: nodeContext.type,
          pillar: nodeContext.pillar,
        }
      : null,
  })

  return cachedAsync(routerCache, cacheKey, async () => {
    const parsed = await requestJsonObject({
      label: 'question router payload',
      maxCompletionTokens: 220,
      messages: [
        {
          role: 'system',
          content: `You route questions for Axiom.

Return valid JSON only with this exact shape:
{
  "mode": "single_pillar|two_pillar|four_pillar_synthesis|all_pillar_synthesis",
  "pillars": ["human_mind|money_game|how_companies_win|whats_coming|think_sharper|move_people"],
  "artifact_strategy": "none|signal_map|comparison_table|quadrant|mental_model|behavior_loop|reasoning_cycle|reasoning_stack|reasoning_curve|reasoning_wave|reasoning_pyramid",
  "rationale": "short string"
}

Rules:
- single_pillar: exactly 1 pillar
- two_pillar: exactly 2 pillars
- four_pillar_synthesis: always use ["whats_coming","how_companies_win","money_game","think_sharper"]
- all_pillar_synthesis: always use all six pillars
- Use signal_map only when the user explicitly asks about signals, forecasts, predictions, future effects, what's coming, where things are moving, or a named future horizon.
- For focused "tell me about this specific thing" questions, choose single_pillar or two_pillar with artifact_strategy "none" unless the user asks for a visual/map.
- User context must influence the mode and pillar choice.
- Choose the smallest mode that can answer the question well.`,
        },
        {
          role: 'user',
          content: `Question: ${query}
Private theory: ${session?.axiom_profile || 'None'}
Session notes: ${session?.session_notes || 'None'}
Pillar weights: ${JSON.stringify(session?.pillar_weights || {})}
Selected node: ${nodeContext ? `${nodeContext.label} | pillar: ${nodeContext.pillar || 'unknown'} | type: ${nodeContext.type}` : 'None'}`,
        },
      ],
    })
    return normalizeRouterPayload(parsed, query)
  }).catch((err) => {
    console.warn('[RAG] Question routing failed (falling back):', err?.message || err)
    return fallbackRouteQuestionMode(query, session, nodeContext)
  })
}

export async function searchWikiForRoute(query, route, matchCount = 3) {
  const mode = route?.mode || 'single_pillar'
  const pillars = Array.isArray(route?.pillars) && route.pillars.length > 0 ? route.pillars : [null]

  if (mode === 'single_pillar') {
    const result = await searchWiki(query, matchCount, pillars[0] || null)
    return {
      ...result,
      pillarResults: {
        [pillars[0] || 'unscoped']: result,
      },
    }
  }

  const perPillarCount = mode === 'all_pillar_synthesis' ? 2 : Math.max(2, matchCount)
  const resultsByPillar = await Promise.all(
    pillars.map((pillar) => searchWiki(query, perPillarCount, pillar))
  )
  const pillarResults = Object.fromEntries(
    pillars.map((pillar, index) => [pillar, resultsByPillar[index]])
  )

  const chunkMap = new Map()
  const sourceMap = new Map()
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
  }

  const chunkLimit = mode === 'all_pillar_synthesis' ? 8 : mode === 'four_pillar_synthesis' ? 6 : 4
  const chunks = [...chunkMap.values()]
    .sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
    .slice(0, chunkLimit)

  const sources = [...sourceMap.values()].filter((source) =>
    chunks.some((chunk) => sourceMatchKey(chunk) === sourceMatchKey(source))
  )

  return { chunks, sources, confidence, pillarResults }
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
  const artifactInstruction = route.artifactStrategy && route.artifactStrategy !== 'none'
    ? `Required artifact strategy: ${route.artifactStrategy}`
    : 'Recommended artifact strategy: none'
  const evidenceLines = (route.pillars || [])
    .map((pillar) => summarisePillarEvidence(pillar, pillarResults[pillar]))
    .join('\n')

  return `Question routing mode: ${route.mode}
Selected pillars: ${pillarsText}
Routing rationale: ${route.rationale || 'None provided'}
Routing instruction: ${modeInstructions[route.mode] || 'Use the selected pillars and keep the user layer active throughout.'}
${artifactInstruction}
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
  }).catch((err) => {
    console.warn('[RAG] Query expansion failed (falling back to original query only):', err?.message || err)
    return []
  })
}

// ─── Search Against One Query ─────────────────────────────────────────────────
async function searchSingleQuery(query, matchCount, filterPillar) {
  const cacheKey = stableStringify({
    query: String(query || '').trim(),
    matchCount,
    filterPillar: filterPillar || null,
  })

  return cachedAsync(searchCache, cacheKey, async () => {
    const embedding = await generateEmbedding(query)
    const { data, error } = await supabase.rpc('match_wiki_chunks', {
      query_embedding: embedding,
      match_count: matchCount,
      filter_pillar: filterPillar,
    })
    if (error) {
      console.error(`RAG search error for query "${query}":`, error)
      return []
    }
    return data || []
  })
}

async function fetchSourcesForChunks(chunks) {
  if (!chunks || chunks.length === 0) return []

  const titles = [...new Set(chunks.map((chunk) => chunk.title).filter(Boolean))]
  if (titles.length === 0) return []

  const { data, error } = await supabase
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

  if (error) {
    console.warn('[RAG] Source fetch failed (continuing with chunks only):', error.message)
    return []
  }

  const wantedKeys = new Set(chunks.map(sourceMatchKey))
  return (data || [])
    .filter((source) => wantedKeys.has(sourceMatchKey(source)))
    .sort((a, b) => sourceRank(b) - sourceRank(a))
}

// ─── Main Search ─────────────────────────────────────────────────────────────
// Returns { chunks, sources, confidence } where confidence is the top similarity score.
// If no chunk clears CONFIDENCE_THRESHOLD, returns { chunks: [], sources: [], confidence: 0 }.
export async function searchWiki(query, matchCount = 3, filterPillar = null) {
  const alternatives = await expandQuery(query)
  const allQueries = [query, ...alternatives]

  const resultSets = await Promise.all(
    allQueries.map((q) => searchSingleQuery(q, matchCount * 3, filterPillar))
  )

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
    return { chunks: [], sources: [], confidence: 0 }
  }

  const results = aboveThreshold.slice(0, matchCount)
  const confidence = results[0].similarity
  const sources = await fetchSourcesForChunks(results)

  return { chunks: results, sources, confidence }
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

export async function formatWikiContext(chunks, sources = []) {
  if ((!chunks || chunks.length === 0) && (!sources || sources.length === 0)) return ''

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

  if (bySource.size === 0) return ''

  // Synthesize each source into an internalized prior in parallel
  const priors = await Promise.all(
    [...bySource.values()].map(({ author, title, texts }) => {
      // Cap combined text at 1200 chars to stay well inside token limits
      const combinedText = texts.join('\n\n').slice(0, 1200)
      return synthesizePrior(author, title, combinedText)
    })
  )

  return priors.filter(Boolean).join('\n\n')
}

async function synthesizePrior(author, title, combinedText) {
  const cacheKey = stableStringify({ author, title, combinedText })

  return cachedAsync(priorSynthesisCache, cacheKey, async () => {
    const response = await openai.chat.completions.create({
      model: CHAT_MODEL,
      messages: [
        {
          role: 'system',
          content: `You write internalized knowledge statements for a mentor AI named Axiom.

Format (strict): Axiom knows from [Author], [Title]: [synthesis]

Rules:
- Maximum 2 sentences.
- Write in Axiom's voice — direct, absorbed, opinionated. Not a quote. Not a summary. Something Axiom has internalized and would deploy from memory.
- Capture the sharpest, most actionable insight from the source material.
- Do not hedge. Do not use "suggests" or "argues". State it as fact Axiom holds.

Author: ${author}
Source: ${title}`,
        },
        { role: 'user', content: combinedText },
      ],
      max_completion_tokens: 120,
    })
    return response.choices[0].message.content.trim()
  }).catch((err) => {
    console.warn(`[RAG] Prior synthesis failed for "${title}":`, err?.message || err)
    // Fallback: reformat raw text without LLM — take first sentence only
    const firstSentence = combinedText.split(/[.!?]/)[0].trim()
    return `Axiom knows from ${author}, ${title}: ${firstSentence}.`
  })
}
