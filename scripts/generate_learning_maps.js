import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'

const BATCH_SIZE = 100
const LEARNING_MAP_MODEL =
  process.env.OPENAI_LEARNING_MAP_MODEL ||
  process.env.OPENAI_SOURCE_ENRICH_MODEL ||
  'gpt-5.4-mini-2026-03-17'

const LEARNING_MAP_PROMPT = `You are building a learning map for a mentorship app. Based on these source chunks, extract exactly 10-15 core concepts that a person must genuinely absorb to say they've understood this source deeply. For each concept return: concept_name (short, 3-5 words), concept_description (one clear sentence), why_it_matters (one sentence on why this changes how someone thinks or acts), absorbed_signal (one sentence describing what a person sounds like when they've genuinely internalized this vs just heard it). Return only valid JSON as an array.`

function requiredEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required env var: ${name}`)
  return value
}

function firstEnv(names) {
  for (const name of names) {
    if (process.env[name]) return process.env[name]
  }
  throw new Error(`Missing required env var: ${names.join(' or ')}`)
}

const supabase = createClient(
  requiredEnv('VITE_KNOWLEDGE_SUPABASE_URL'),
  firstEnv(['KNOWLEDGE_SUPABASE_SERVICE_ROLE_KEY', 'VITE_KNOWLEDGE_SUPABASE_SERVICE_ROLE_KEY']),
  { auth: { persistSession: false } }
)

const openai = new OpenAI({ apiKey: requiredEnv('OPENAI_API_KEY') })

function sanitizeText(text) {
  return String(text || '')
    .replace(/\u0000/g, '')
    .replace(/[\u0080-\u009F]/g, '')
    .replace(/\uFFFD/g, '')
    .replace(/\\u[0-9a-fA-F]{4}/g, '')
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\uD7FF\uE000-\uFFFD]/g, '')
    .trim()
}

function cleanString(value) {
  return sanitizeText(value).replace(/\s+/g, ' ').trim()
}

function buildChunkExcerpt(chunks) {
  const text = chunks
    .map((chunk, index) => {
      const framework = cleanString(chunk.key_frameworks)
      return framework ? `Chunk ${index + 1}: ${framework}` : ''
    })
    .filter(Boolean)
    .join('\n\n')

  if (text.length <= 50000) return text

  const segment = 16000
  const middleStart = Math.max(0, Math.floor(text.length / 2) - Math.floor(segment / 2))
  const endStart = Math.max(0, text.length - segment)

  return [
    text.slice(0, segment),
    text.slice(middleStart, middleStart + segment),
    text.slice(endStart),
  ].join('\n\n[...]\n\n')
}

function parseConceptPayload(content) {
  const parsed = JSON.parse(String(content || '').trim())
  if (Array.isArray(parsed)) return parsed
  if (Array.isArray(parsed?.concepts)) return parsed.concepts
  throw new Error('OpenAI returned JSON, but not a concept array.')
}

function normalizeConcept(item, index) {
  const concept = item && typeof item === 'object' ? item : {}
  return {
    concept_index: index + 1,
    concept_name: cleanString(concept.concept_name).slice(0, 120),
    concept_description: cleanString(concept.concept_description),
    why_it_matters: cleanString(concept.why_it_matters),
    absorbed_signal: cleanString(concept.absorbed_signal),
  }
}

async function fetchAllSources() {
  const { count, error: countError } = await supabase
    .from('wiki_sources')
    .select('id', { count: 'exact', head: true })

  if (countError) throw countError

  const rows = []
  for (let from = 0; from < (count || 0); from += BATCH_SIZE) {
    const { data, error } = await supabase
      .from('wiki_sources')
      .select('id,title,author,pillar,content_type')
      .order('id', { ascending: true })
      .range(from, Math.min(from + BATCH_SIZE - 1, (count || 0) - 1))

    if (error) throw error
    rows.push(...(data || []))
  }

  return rows
}

async function fetchChunksForSource(sourceId) {
  const { data, error } = await supabase
    .from('wiki_chunks')
    .select('id,chunk_index,key_frameworks')
    .eq('source_id', sourceId)
    .order('chunk_index', { ascending: true, nullsFirst: false })

  if (error) throw error
  return data || []
}

async function sourceHasLearningMap(sourceId) {
  const { count, error } = await supabase
    .from('source_learning_maps')
    .select('id', { count: 'exact', head: true })
    .eq('source_id', sourceId)

  if (error) throw error
  return (count || 0) > 0
}

async function generateConcepts(source, chunks) {
  const response = await openai.chat.completions.create({
    model: LEARNING_MAP_MODEL,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'source_learning_map',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            concepts: {
              type: 'array',
              minItems: 10,
              maxItems: 15,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  concept_name: { type: 'string' },
                  concept_description: { type: 'string' },
                  why_it_matters: { type: 'string' },
                  absorbed_signal: { type: 'string' },
                },
                required: [
                  'concept_name',
                  'concept_description',
                  'why_it_matters',
                  'absorbed_signal',
                ],
              },
            },
          },
          required: ['concepts'],
        },
      },
    },
    messages: [
      {
        role: 'system',
        content: `${LEARNING_MAP_PROMPT}

For this API call, wrap the array in a JSON object with this shape: {"concepts":[...]}.`,
      },
      {
        role: 'user',
        content: `Source: ${source.title || 'Untitled'}${source.author ? ` by ${source.author}` : ''}
Pillar: ${source.pillar || 'unknown'}
Content type: ${source.content_type || 'unknown'}

Chunks:
${buildChunkExcerpt(chunks)}`,
      },
    ],
    max_completion_tokens: 3000,
  })

  const concepts = parseConceptPayload(response.choices[0]?.message?.content).map(normalizeConcept)
  if (concepts.length < 10 || concepts.length > 15) {
    throw new Error(`Expected 10-15 concepts, got ${concepts.length}`)
  }

  for (const concept of concepts) {
    if (
      !concept.concept_name ||
      !concept.concept_description ||
      !concept.why_it_matters ||
      !concept.absorbed_signal
    ) {
      throw new Error('OpenAI returned a concept with missing fields.')
    }
  }

  return concepts
}

async function insertLearningMap(sourceId, concepts) {
  const rows = concepts.map((concept) => ({ source_id: sourceId, ...concept }))
  const { error } = await supabase
    .from('source_learning_maps')
    .upsert(rows, { onConflict: 'source_id,concept_index' })

  if (error) throw error
}

async function main() {
  const sources = await fetchAllSources()
  const succeeded = []
  const skipped = []
  const failed = []

  console.log(`Generating learning maps for ${sources.length} sources with ${LEARNING_MAP_MODEL}.`)

  for (let index = 0; index < sources.length; index++) {
    const source = sources[index]
    const label = `${source.title || 'Untitled'} (${source.pillar || 'unknown'})`

    try {
      if (await sourceHasLearningMap(source.id)) {
        skipped.push(label)
        console.log(`[${index + 1}/${sources.length}] skipped existing: ${label}`)
        continue
      }

      const chunks = await fetchChunksForSource(source.id)
      if (chunks.length === 0) throw new Error('No chunks found for source.')

      const concepts = await generateConcepts(source, chunks)
      await insertLearningMap(source.id, concepts)
      succeeded.push(label)
      console.log(`[${index + 1}/${sources.length}] succeeded: ${label} (${concepts.length} concepts)`)
    } catch (error) {
      failed.push({ source: label, error: error.message })
      console.error(`[${index + 1}/${sources.length}] failed: ${label}: ${error.message}`)
    }
  }

  console.log(`Learning maps complete. success=${succeeded.length}, skipped=${skipped.length}, failed=${failed.length}`)
  if (failed.length > 0) {
    console.log('Failed sources:')
    for (const item of failed) console.log(`- ${item.source}: ${item.error}`)
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
