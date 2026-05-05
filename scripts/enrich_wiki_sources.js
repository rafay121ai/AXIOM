import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'

const SOURCE_ENRICHMENT_MODEL = process.env.OPENAI_SOURCE_ENRICH_MODEL || 'gpt-5.4-mini-2026-03-17'
const SOURCE_ENRICHMENT_VERSION = 'wiki_sources_v1'
const BATCH_SIZE = Math.max(1, Number(process.env.WIKI_SOURCE_ENRICH_BATCH || 10))
const TIME_HORIZONS = new Set(['immediate', 'near_term', 'medium_term', 'long_term', 'timeless'])
const SIGNAL_TYPES = new Set([
  'capability_shift',
  'distribution_shift',
  'capital_flow',
  'behavior_change',
  'policy_shift',
  'infrastructure_bottleneck',
  'market_structure',
])

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

function sanitizeText(text) {
  return String(text || '')
    .replace(/\u0000/g, '')
    .replace(/[\u0080-\u009F]/g, '')
    .replace(/\uFFFD/g, '')
    .replace(/\\u[0-9a-fA-F]{4}/g, '')
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\uD7FF\uE000-\uFFFD]/g, '')
    .trim()
}

function clampConfidence(value, fallback = 0.5) {
  const num = Number(value)
  if (!Number.isFinite(num)) return fallback
  return Math.max(0, Math.min(1, num))
}

function cleanString(value, fallback = '') {
  const text = sanitizeText(String(value || '')).replace(/\s+/g, ' ').trim()
  return text || fallback
}

function cleanStringArray(values, limit = 8) {
  if (!Array.isArray(values)) return []
  return [...new Set(values.map((item) => cleanString(item)).filter(Boolean))].slice(0, limit)
}

function cleanImplications(value) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  return {
    builders: cleanStringArray(input.builders, 6),
    capital: cleanStringArray(input.capital, 6),
    operators: cleanStringArray(input.operators, 6),
    policy: cleanStringArray(input.policy, 6),
  }
}

function parseJsonContent(content) {
  const raw = String(content || '').trim()
  const withoutFence = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  return JSON.parse(withoutFence)
}

function buildEnrichmentExcerpt(rawText) {
  const cleaned = sanitizeText(rawText).replace(/\s+/g, ' ').trim()
  if (cleaned.length <= 18000) return cleaned

  const segment = 6000
  const middleStart = Math.max(0, Math.floor(cleaned.length / 2) - Math.floor(segment / 2))
  const endStart = Math.max(0, cleaned.length - segment)

  return [
    cleaned.slice(0, segment),
    cleaned.slice(middleStart, middleStart + segment),
    cleaned.slice(endStart),
  ].join('\n\n[...]\n\n')
}

function normalizeSourceClaims(payload) {
  const input = payload && typeof payload === 'object' ? payload : {}
  return {
    core_thesis: cleanString(input.core_thesis),
    main_themes: cleanStringArray(input.main_themes, 6),
    keywords: cleanStringArray(input.keywords, 12),
    domains: cleanStringArray(input.domains, 8),
    representative_claims: cleanStringArray(input.representative_claims, 6),
  }
}

function normalizeAxiomInterpretation(payload) {
  const input = payload && typeof payload === 'object' ? payload : {}
  const timeHorizon = cleanString(input.time_horizon)
  return {
    signal_types: cleanStringArray(input.signal_types, 6).filter((item) => SIGNAL_TYPES.has(item)),
    time_horizon: TIME_HORIZONS.has(timeHorizon) ? timeHorizon : null,
    practical_implications: cleanImplications(input.practical_implications),
    counterarguments: cleanStringArray(input.counterarguments, 6),
    uncertainty_notes: cleanStringArray(input.uncertainty_notes, 6),
  }
}

async function extractSourceClaims(rawText, source) {
  const excerpt = buildEnrichmentExcerpt(rawText)
  const response = await openai.chat.completions.create({
    model: SOURCE_ENRICHMENT_MODEL,
    response_format: { type: 'json_object' },
    max_completion_tokens: 700,
    messages: [
      {
        role: 'system',
        content: `You extract grounded claims from a source for Axiom's canonical knowledge layer.

Return valid JSON only with this exact shape:
{
  "core_thesis": "string",
  "main_themes": ["string"],
  "keywords": ["string"],
  "domains": ["string"],
  "representative_claims": ["string"],
  "confidence": 0.0
}

Rules:
- Use only what is clearly supported by the source text.
- Do not infer strategic implications.
- Keep core_thesis to one sharp sentence.
- main_themes should be 2 to 6 items.
- representative_claims should be concrete claims the source itself makes.
- confidence must be between 0 and 1.`,
      },
      {
        role: 'user',
        content: `Title: ${source.title}
Author: ${source.author || 'Unknown'}
Pillar: ${source.pillar}
Content type: ${source.content_type}

Source excerpt:
${excerpt}`,
      },
    ],
  })

  const parsed = parseJsonContent(response.choices[0]?.message?.content)
  return {
    claims: normalizeSourceClaims(parsed),
    confidence: clampConfidence(parsed.confidence, 0.55),
  }
}

async function interpretSourceForAxiom(rawText, source, sourceClaims) {
  const excerpt = buildEnrichmentExcerpt(rawText)
  const response = await openai.chat.completions.create({
    model: SOURCE_ENRICHMENT_MODEL,
    response_format: { type: 'json_object' },
    max_completion_tokens: 700,
    messages: [
      {
        role: 'system',
        content: `You interpret a source through Axiom's lens without pretending the source literally said these implications.

Return valid JSON only with this exact shape:
{
  "signal_types": ["capability_shift|distribution_shift|capital_flow|behavior_change|policy_shift|infrastructure_bottleneck|market_structure"],
  "time_horizon": "immediate|near_term|medium_term|long_term|timeless",
  "practical_implications": {
    "builders": ["string"],
    "capital": ["string"],
    "operators": ["string"],
    "policy": ["string"]
  },
  "counterarguments": ["string"],
  "uncertainty_notes": ["string"],
  "confidence": 0.0
}

Rules:
- This is Axiom's interpretation, not a quote from the source.
- Be specific, not generic.
- Include only implications that plausibly follow from the source claims.
- confidence must be between 0 and 1.`,
      },
      {
        role: 'user',
        content: `Title: ${source.title}
Author: ${source.author || 'Unknown'}
Pillar: ${source.pillar}
Content type: ${source.content_type}

Grounded source claims:
${JSON.stringify(sourceClaims, null, 2)}

Source excerpt:
${excerpt}`,
      },
    ],
  })

  const parsed = parseJsonContent(response.choices[0]?.message?.content)
  return {
    interpretation: normalizeAxiomInterpretation(parsed),
    confidence: clampConfidence(parsed.confidence, 0.5),
  }
}

async function fetchPendingSources(limit) {
  const { data, error } = await supabase
    .from('wiki_sources')
    .select('id, pillar, content_type, title, author, source_url, source_key, enrichment_status')
    .or('enrichment_status.is.null,enrichment_status.eq.raw,enrichment_status.eq.failed,enrichment_status.eq.claims_extracted')
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) throw new Error(`Could not fetch pending sources: ${error.message}`)
  return data || []
}

async function fetchSourceText(sourceId) {
  const { data, error } = await supabase
    .from('wiki_chunks')
    .select('key_frameworks')
    .eq('source_id', sourceId)
    .not('key_frameworks', 'is', null)
    .order('id', { ascending: true })
    .limit(24)

  if (error) throw new Error(`Could not fetch chunks for source ${sourceId}: ${error.message}`)

  const text = (data || [])
    .map((row) => sanitizeText(row.key_frameworks))
    .filter(Boolean)
    .join('\n\n')
    .trim()

  if (!text) throw new Error(`No chunk text found for source ${sourceId}`)
  return text
}

async function updateSource(id, payload) {
  const { error } = await supabase
    .from('wiki_sources')
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) throw new Error(`Could not update wiki_sources row ${id}: ${error.message}`)
}

async function enrichSource(source) {
  const rawText = await fetchSourceText(source.id)
  const enrichedAt = new Date().toISOString()

  const { claims, confidence: claimsConfidence } = await extractSourceClaims(rawText, source)
  await updateSource(source.id, {
    source_claims: claims,
    source_claims_confidence: claimsConfidence,
    enrichment_status: 'claims_extracted',
    enrichment_version: SOURCE_ENRICHMENT_VERSION,
    enriched_at: enrichedAt,
  })

  const { interpretation, confidence: interpretationConfidence } = await interpretSourceForAxiom(rawText, source, claims)
  await updateSource(source.id, {
    axiom_interpretation: interpretation,
    axiom_interpretation_confidence: interpretationConfidence,
    enrichment_status: 'interpreted',
    enrichment_version: SOURCE_ENRICHMENT_VERSION,
    enriched_at: enrichedAt,
  })
}

async function main() {
  console.log('─────────────────────────────────────────────────────────────')
  console.log('Axiom wiki_sources enrichment starting.')
  console.log(`Batch size: ${BATCH_SIZE}`)
  console.log(`Model: ${SOURCE_ENRICHMENT_MODEL}`)
  console.log('─────────────────────────────────────────────────────────────\n')

  if (!process.env.VITE_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('ERROR: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env')
    process.exit(1)
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error('ERROR: OPENAI_API_KEY must be set in .env')
    process.exit(1)
  }

  const pending = await fetchPendingSources(BATCH_SIZE)
  if (pending.length === 0) {
    console.log('No pending wiki_sources rows found.')
    return
  }

  console.log(`Found ${pending.length} pending source(s).\n`)

  let interpreted = 0
  let failed = 0

  for (let i = 0; i < pending.length; i++) {
    const source = pending[i]
    console.log(`[${i + 1}/${pending.length}] Enriching: ${source.title} (${source.pillar})`)

    try {
      await enrichSource(source)
      console.log('    Done. source_claims + axiom_interpretation saved.\n')
      interpreted++
    } catch (err) {
      console.log(`    FAILED — ${err.message}\n`)
      failed++
      try {
        await updateSource(source.id, {
          enrichment_status: 'failed',
          enrichment_version: SOURCE_ENRICHMENT_VERSION,
          enriched_at: new Date().toISOString(),
        })
      } catch (markErr) {
        console.warn(`    Could not mark source as failed: ${markErr.message}`)
      }
    }
  }

  console.log('─────────────────────────────────────────────────────────────')
  console.log('wiki_sources enrichment complete.')
  console.log(`  Attempted : ${pending.length}`)
  console.log(`  Succeeded : ${interpreted}`)
  console.log(`  Failed    : ${failed}`)
  console.log('─────────────────────────────────────────────────────────────')
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
