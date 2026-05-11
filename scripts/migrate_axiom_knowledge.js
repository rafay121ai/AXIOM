import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'

const BATCH_SIZE = 100
const LEARNING_MAP_MODEL =
  process.env.OPENAI_LEARNING_MAP_MODEL ||
  process.env.OPENAI_SOURCE_ENRICH_MODEL ||
  'gpt-5.4-mini-2026-03-17'
const LEARNING_MAP_PROMPT = `You are building a learning map for a mentorship app. Based on these source chunks, extract exactly 10-15 core concepts that a person must genuinely absorb to say they've understood this source deeply. For each concept return: concept_name (short, 3-5 words), concept_description (one clear sentence), why_it_matters (one sentence on why this changes how someone thinks or acts), absorbed_signal (one sentence describing what a person sounds like when they've genuinely internalized this vs just heard it). Return only valid JSON as an array.`

const WIKI_SOURCE_COLUMNS = [
  'id',
  'pillar',
  'content_type',
  'title',
  'author',
  'source_url',
  'source_key',
  'summary_for_retrieval',
  'source_quality',
  'created_at',
  'updated_at',
  'enrichment_status',
  'enrichment_version',
  'enriched_at',
  'source_claims',
  'axiom_interpretation',
  'source_claims_confidence',
  'axiom_interpretation_confidence',
  'published_at',
]

const WIKI_CHUNK_COLUMNS = [
  'id',
  'pillar',
  'content_type',
  'title',
  'author',
  'key_frameworks',
  'embedding',
  'created_at',
  'chunk_index',
  'source_id',
]

function requiredEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required env var: ${name}`)
  return value
}

function requiredFirstEnv(names) {
  for (const name of names) {
    if (process.env[name]) return process.env[name]
  }
  throw new Error(`Missing required env var: ${names.join(' or ')}`)
}

const sourceSupabase = createClient(
  requiredEnv('VITE_SUPABASE_URL'),
  requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { persistSession: false } }
)

const knowledgeSupabase = createClient(
  requiredEnv('VITE_KNOWLEDGE_SUPABASE_URL'),
  requiredFirstEnv(['KNOWLEDGE_SUPABASE_SERVICE_ROLE_KEY', 'VITE_KNOWLEDGE_SUPABASE_SERVICE_ROLE_KEY']),
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

function parseConceptPayload(content) {
  const parsed = JSON.parse(String(content || '').trim())
  if (Array.isArray(parsed)) return parsed
  if (Array.isArray(parsed?.concepts)) return parsed.concepts
  throw new Error('OpenAI returned JSON, but not a concept array.')
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

async function countRows(client, table) {
  const { count, error } = await client
    .from(table)
    .select('id', { count: 'exact', head: true })

  if (error) throw new Error(`Count failed for ${table}: ${formatSupabaseError(error)}`)
  return count || 0
}

function formatSupabaseError(error) {
  const message = error?.message || String(error)
  if (/Could not find the table/i.test(message)) {
    return `${message}. Run supabase/migrations/20260511000002_axiom_knowledge_schema.sql against the axiom-knowledge database first.`
  }
  return message
}

async function fetchBatch(client, table, columns, from, to) {
  const { data, error } = await client
    .from(table)
    .select(columns.join(','))
    .order('id', { ascending: true })
    .range(from, to)

  if (error) throw new Error(`Fetch failed for ${table} ${from}-${to}: ${formatSupabaseError(error)}`)
  return data || []
}

async function upsertBatch(client, table, rows) {
  if (rows.length === 0) return

  const { error } = await client
    .from(table)
    .upsert(rows, { onConflict: 'id' })

  if (!error) return

  const message = formatSupabaseError(error)
  if (/statement timeout/i.test(message) && rows.length > 1) {
    const splitAt = Math.ceil(rows.length / 2)
    await upsertBatch(client, table, rows.slice(0, splitAt))
    await upsertBatch(client, table, rows.slice(splitAt))
    return
  }

  throw new Error(`Upsert failed for ${table}: ${message}`)
}

async function migrateTable(table, columns) {
  const sourceCount = await countRows(sourceSupabase, table)
  const initialTargetCount = await countRows(knowledgeSupabase, table)
  console.log(`${table}: source count ${sourceCount}`)
  console.log(`${table}: initial target count ${initialTargetCount}`)

  if (initialTargetCount === sourceCount) {
    console.log(`${table}: counts already match, skipping copy`)
    return
  }

  if (initialTargetCount > sourceCount) {
    throw new Error(`${table}: target has more rows than source, source ${sourceCount}, target ${initialTargetCount}`)
  }

  for (let from = initialTargetCount; from < sourceCount; from += BATCH_SIZE) {
    const to = Math.min(from + BATCH_SIZE - 1, sourceCount - 1)
    const rows = await fetchBatch(sourceSupabase, table, columns, from, to)
    await upsertBatch(knowledgeSupabase, table, rows)
    console.log(`${table}: migrated ${Math.min(to + 1, sourceCount)} / ${sourceCount}`)
  }

  const targetCount = await countRows(knowledgeSupabase, table)
  console.log(`${table}: target count ${targetCount}`)

  if (sourceCount !== targetCount) {
    throw new Error(`${table}: count mismatch, source ${sourceCount}, target ${targetCount}`)
  }
}

async function fetchKnowledgeSources() {
  const total = await countRows(knowledgeSupabase, 'wiki_sources')
  const all = []

  for (let from = 0; from < total; from += BATCH_SIZE) {
    const { data, error } = await knowledgeSupabase
      .from('wiki_sources')
      .select('id,title,author,pillar')
      .order('title', { ascending: true })
      .range(from, Math.min(from + BATCH_SIZE - 1, total - 1))

    if (error) throw new Error(`Fetch sources failed: ${formatSupabaseError(error)}`)
    all.push(...(data || []))
  }

  return all
}

async function fetchChunksForSource(sourceId) {
  const { data, error } = await knowledgeSupabase
    .from('wiki_chunks')
    .select('id,chunk_index,key_frameworks')
    .eq('source_id', sourceId)
    .order('chunk_index', { ascending: true, nullsFirst: false })

  if (error) throw new Error(`Fetch chunks failed for source ${sourceId}: ${formatSupabaseError(error)}`)
  return data || []
}

async function callOpenAIForLearningMap(source, chunks) {
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

async function sourceHasLearningMap(sourceId) {
  const { count, error } = await knowledgeSupabase
    .from('source_learning_maps')
    .select('id', { count: 'exact', head: true })
    .eq('source_id', sourceId)

  if (error) throw new Error(`Learning map count failed for source ${sourceId}: ${formatSupabaseError(error)}`)
  return (count || 0) > 0
}

async function insertLearningMap(source, concepts) {
  const rows = concepts.map((concept) => ({
    source_id: source.id,
    ...concept,
  }))

  const { error } = await knowledgeSupabase
    .from('source_learning_maps')
    .upsert(rows, { onConflict: 'source_id,concept_index' })

  if (error) throw new Error(`Learning map upsert failed for ${source.title}: ${formatSupabaseError(error)}`)
}

async function generateLearningMaps() {
  const sources = await fetchKnowledgeSources()
  const succeeded = []
  const failed = []
  const skipped = []

  console.log(`learning_maps: source count ${sources.length}`)

  for (const source of sources) {
    try {
      if (await sourceHasLearningMap(source.id)) {
        skipped.push(source.title)
        console.log(`learning_maps: skipped existing map for ${source.title}`)
        continue
      }

      const chunks = await fetchChunksForSource(source.id)
      if (chunks.length === 0) throw new Error('No chunks found for source.')

      const concepts = await callOpenAIForLearningMap(source, chunks)
      await insertLearningMap(source, concepts)
      succeeded.push(source.title)
      console.log(`learning_maps: succeeded ${source.title} (${concepts.length} concepts)`)
    } catch (error) {
      failed.push({ title: source.title, error: error.message })
      console.error(`learning_maps: failed ${source.title}: ${error.message}`)
    }
  }

  console.log(`learning_maps: success ${succeeded.length}, skipped ${skipped.length}, failed ${failed.length}`)
  if (failed.length > 0) {
    console.log('learning_maps failed sources:')
    for (const item of failed) console.log(`- ${item.title}: ${item.error}`)
  }
}

async function verifyRagQuery() {
  const query = process.env.KNOWLEDGE_VERIFY_QUERY || 'How should someone think about competitive advantage?'
  const embeddingResponse = await openai.embeddings.create({
    model: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
    input: query,
  })

  const embedding = embeddingResponse.data[0].embedding
  const { data, error } = await knowledgeSupabase.rpc('match_wiki_chunks', {
    query_embedding: embedding,
    match_count: 3,
    filter_pillar: null,
  })

  if (error) throw new Error(`RAG verification failed: ${formatSupabaseError(error)}`)

  console.log(`verify: query "${query}" returned ${data?.length || 0} chunks`)
  for (const row of data || []) {
    console.log(`- ${row.title || 'Untitled'} (${row.pillar || 'no pillar'}) similarity=${Number(row.similarity || 0).toFixed(4)}`)
  }
}

async function main() {
  console.log('axiom-knowledge migration starting')
  console.log('Step 2: migrating wiki_sources')
  await migrateTable('wiki_sources', WIKI_SOURCE_COLUMNS)

  console.log('Step 2: migrating wiki_chunks')
  await migrateTable('wiki_chunks', WIKI_CHUNK_COLUMNS)

  console.log('Step 3: generating learning maps')
  await generateLearningMaps()

  console.log('Step 5: verifying RAG query')
  await verifyRagQuery()

  console.log('axiom-knowledge migration complete')
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
