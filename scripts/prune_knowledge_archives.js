import 'dotenv/config'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'

const BATCH_SIZE = 100
const CHUNK_BACKUP_COLUMNS = `
  id,
  source_id,
  pillar,
  content_type,
  title,
  author,
  key_frameworks,
  created_at,
  chunk_index
`
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUTPUT_DIR = path.join(__dirname, 'output')

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

function hasFlag(flag) {
  return process.argv.includes(flag)
}

const supabase = createClient(
  requiredEnv('VITE_KNOWLEDGE_SUPABASE_URL'),
  firstEnv(['KNOWLEDGE_SUPABASE_SERVICE_ROLE_KEY', 'VITE_KNOWLEDGE_SUPABASE_SERVICE_ROLE_KEY']),
  { auth: { persistSession: false } }
)

function groupCounts(rows, keyFn) {
  const counts = new Map()
  for (const row of rows) {
    const key = keyFn(row) || 'unknown'
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))
}

async function fetchAll(table, select, buildQuery = (query) => query) {
  const { count, error: countError } = await buildQuery(
    supabase.from(table).select('id', { count: 'exact', head: true })
  )

  if (countError) throw countError

  const rows = []
  for (let from = 0; from < (count || 0); from += BATCH_SIZE) {
    const { data, error } = await buildQuery(
      supabase
        .from(table)
        .select(select)
        .order('id', { ascending: true })
        .range(from, Math.min(from + BATCH_SIZE - 1, (count || 0) - 1))
    )

    if (error) throw error
    rows.push(...(data || []))
  }

  return rows
}

async function fetchArchivedSources() {
  return fetchAll(
    'wiki_sources',
    '*',
    (query) => query.eq('is_core_library', false)
  )
}

async function fetchChunksForSourceIds(sourceIds) {
  const rows = []

  for (const sourceId of sourceIds) {
    const { count, error: countError } = await supabase
      .from('wiki_chunks')
      .select('id', { count: 'exact', head: true })
      .eq('source_id', sourceId)

    if (countError) throw countError

    for (let from = 0; from < (count || 0); from += BATCH_SIZE) {
      const { data, error } = await supabase
        .from('wiki_chunks')
        .select(CHUNK_BACKUP_COLUMNS)
        .eq('source_id', sourceId)
        .order('chunk_index', { ascending: true, nullsFirst: false })
        .range(from, Math.min(from + BATCH_SIZE - 1, (count || 0) - 1))

      if (error) throw error
      rows.push(...(data || []))
    }
  }

  return rows
}

async function fetchCoreSources() {
  return fetchAll(
    'wiki_sources',
    'id,pillar,content_type,title,author,is_core_library',
    (query) => query.eq('is_core_library', true)
  )
}

async function writeBackup(archivedSources, archivedChunks, coreSources) {
  await fs.mkdir(OUTPUT_DIR, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const filePath = path.join(OUTPUT_DIR, `knowledge_archived_sources_backup_${stamp}.json`)

  const payload = {
    created_at: new Date().toISOString(),
    project_url: process.env.VITE_KNOWLEDGE_SUPABASE_URL,
    archived_source_count: archivedSources.length,
    archived_chunk_count: archivedChunks.length,
    core_source_count: coreSources.length,
    core_counts_by_pillar: Object.fromEntries(groupCounts(coreSources, (source) => source.pillar)),
    archived_counts_by_pillar: Object.fromEntries(groupCounts(archivedSources, (source) => source.pillar)),
    note: 'Archived chunk embeddings are intentionally excluded from this backup to avoid Supabase statement timeouts. They can be regenerated from key_frameworks if these rows are restored.',
    archived_sources: archivedSources,
    archived_chunks: archivedChunks,
  }

  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8')
  return filePath
}

async function deleteInBatches(table, ids) {
  let deleted = 0

  for (let index = 0; index < ids.length; index += BATCH_SIZE) {
    const batch = ids.slice(index, index + BATCH_SIZE)
    const { error } = await supabase
      .from(table)
      .delete()
      .in('id', batch)

    if (error) throw error
    deleted += batch.length
    console.log(`${table}: deleted ${deleted} / ${ids.length}`)
  }
}

async function deleteChunksForArchivedSources(sourceIds) {
  let processed = 0

  for (const sourceId of sourceIds) {
    const { error } = await supabase
      .from('wiki_chunks')
      .delete()
      .eq('source_id', sourceId)

    if (error) throw error
    processed += 1
    console.log(`wiki_chunks: deleted chunks for ${processed} / ${sourceIds.length} archived sources`)
  }
}

async function main() {
  const confirmDelete = hasFlag('--confirm-delete')
  const archivedSources = await fetchArchivedSources()
  const archivedSourceIds = archivedSources.map((source) => source.id)
  const archivedChunks = await fetchChunksForSourceIds(archivedSourceIds)
  const coreSources = await fetchCoreSources()
  const backupPath = await writeBackup(archivedSources, archivedChunks, coreSources)

  console.log(`Backup written: ${backupPath}`)
  console.log(`Core sources: ${coreSources.length}`)
  for (const [pillar, count] of groupCounts(coreSources, (source) => source.pillar)) {
    console.log(`- core ${pillar}: ${count}`)
  }

  console.log(`Archived sources to delete: ${archivedSources.length}`)
  for (const [pillar, count] of groupCounts(archivedSources, (source) => source.pillar)) {
    console.log(`- archived ${pillar}: ${count}`)
  }
  console.log(`Archived chunks to delete: ${archivedChunks.length}`)

  if (!confirmDelete) {
    console.log('Dry run complete. Re-run with -- --confirm-delete to delete archived rows.')
    return
  }

  await deleteChunksForArchivedSources(archivedSourceIds)
  await deleteInBatches('wiki_sources', archivedSourceIds)

  const remainingSources = await fetchAll(
    'wiki_sources',
    'id,pillar,content_type,title,author,is_core_library',
    (query) => query
  )

  console.log('Delete complete. Remaining sources:')
  for (const [pillar, count] of groupCounts(remainingSources, (source) => source.pillar)) {
    console.log(`- ${pillar}: ${count}`)
  }
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
