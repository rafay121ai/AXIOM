import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

dotenv.config()

const url = process.env.VITE_KNOWLEDGE_SUPABASE_URL
const key = process.env.KNOWLEDGE_SUPABASE_SERVICE_ROLE_KEY
const apply = process.argv.includes('--apply')

if (!url || !key) {
  console.error('Missing VITE_KNOWLEDGE_SUPABASE_URL or KNOWLEDGE_SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(url, key, { auth: { persistSession: false } })

async function fetchAll(table, columns) {
  const pageSize = 1000
  const rows = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .range(from, from + pageSize - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    rows.push(...(data || []))
    if (!data || data.length < pageSize) break
  }
  return rows
}

async function deleteIds(table, ids) {
  if (!ids.length) return 0
  const batchSize = 100
  let deleted = 0
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize)
    const { error } = await supabase.from(table).delete().in('id', batch)
    if (error) throw new Error(`${table} delete failed: ${error.message}`)
    deleted += batch.length
  }
  return deleted
}

async function main() {
  const [sources, chunks, maps] = await Promise.all([
    fetchAll('wiki_sources', 'id,title,pillar'),
    fetchAll('wiki_chunks', 'id,source_id,title,pillar'),
    fetchAll('source_learning_maps', 'id,source_id,concept_name'),
  ])

  const sourceIds = new Set(sources.map((source) => source.id))
  const chunksMissingSourceId = chunks.filter((chunk) => !chunk.source_id)
  const orphanChunks = chunks.filter((chunk) => chunk.source_id && !sourceIds.has(chunk.source_id))
  const orphanMaps = maps.filter((map) => map.source_id && !sourceIds.has(map.source_id))

  const report = {
    apply,
    counts: {
      sources: sources.length,
      chunks: chunks.length,
      source_learning_maps: maps.length,
      chunks_missing_source_id: chunksMissingSourceId.length,
      orphan_chunks: orphanChunks.length,
      orphan_learning_maps: orphanMaps.length,
    },
    samples: {
      chunks_missing_source_id: chunksMissingSourceId.slice(0, 5),
      orphan_chunks: orphanChunks.slice(0, 5),
      orphan_learning_maps: orphanMaps.slice(0, 5),
    },
  }

  if (apply) {
    report.deleted = {
      chunks_missing_source_id: await deleteIds('wiki_chunks', chunksMissingSourceId.map((chunk) => chunk.id)),
      orphan_chunks: await deleteIds('wiki_chunks', orphanChunks.map((chunk) => chunk.id)),
      orphan_learning_maps: await deleteIds('source_learning_maps', orphanMaps.map((map) => map.id)),
    }
  }

  console.log(JSON.stringify(report, null, 2))

  if (!apply && (
    chunksMissingSourceId.length > 0 ||
    orphanChunks.length > 0 ||
    orphanMaps.length > 0
  )) {
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
