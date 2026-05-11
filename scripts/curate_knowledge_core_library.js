import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const TARGET_CORE_SOURCES = 35
const MIN_HEALTHY_SOURCES = 30
const BATCH_SIZE = 100

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

function scoreSource(source) {
  let score = 0

  if (source.source_claims) score += 20
  if (source.axiom_interpretation) score += 20
  if (source.summary_for_retrieval) score += 8
  if (/complete|enriched|done/i.test(source.enrichment_status || '')) score += 12

  const claimConfidence = Number(source.source_claims_confidence)
  if (Number.isFinite(claimConfidence)) score += claimConfidence * 8

  const interpretationConfidence = Number(source.axiom_interpretation_confidence)
  if (Number.isFinite(interpretationConfidence)) score += interpretationConfidence * 8

  const quality = String(source.source_quality || '').toLowerCase()
  if (/primary|canonical|high|excellent|strong/.test(quality)) score += 12
  if (/weak|thin|low/.test(quality)) score -= 12

  return score
}

function groupBy(items, keyFn) {
  const groups = new Map()
  for (const item of items) {
    const key = keyFn(item) || 'unknown'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(item)
  }
  return groups
}

function byScoreThenTitle(a, b) {
  return scoreSource(b) - scoreSource(a) || String(a.title || '').localeCompare(String(b.title || ''))
}

function chooseCoreSources(sources) {
  if (sources.length <= TARGET_CORE_SOURCES) return [...sources].sort(byScoreThenTitle)

  const selected = new Map()
  const byType = groupBy(sources, (source) => source.content_type)
  const typeEntries = [...byType.entries()]
    .map(([type, rows]) => [type, [...rows].sort(byScoreThenTitle)])
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))

  // First pass: keep every available source type represented.
  for (const [, rows] of typeEntries) {
    if (selected.size >= TARGET_CORE_SOURCES) break
    selected.set(rows[0].id, rows[0])
  }

  // Second pass: fill proportionally by type so one content type does not dominate.
  for (const [, rows] of typeEntries) {
    const proportionalTarget = Math.max(
      1,
      Math.round((rows.length / sources.length) * TARGET_CORE_SOURCES)
    )
    for (const source of rows) {
      if (selected.size >= TARGET_CORE_SOURCES) break
      const selectedOfType = [...selected.values()].filter((item) => item.content_type === source.content_type).length
      if (selectedOfType >= proportionalTarget) break
      selected.set(source.id, source)
    }
  }

  // Final pass: fill remaining slots by quality.
  for (const source of [...sources].sort(byScoreThenTitle)) {
    if (selected.size >= TARGET_CORE_SOURCES) break
    selected.set(source.id, source)
  }

  return [...selected.values()].sort(byScoreThenTitle)
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
      .select(`
        id,
        pillar,
        content_type,
        title,
        author,
        source_quality,
        enrichment_status,
        source_claims,
        axiom_interpretation,
        source_claims_confidence,
        axiom_interpretation_confidence,
        summary_for_retrieval,
        is_core_library
      `)
      .order('id', { ascending: true })
      .range(from, Math.min(from + BATCH_SIZE - 1, (count || 0) - 1))

    if (error) throw error
    rows.push(...(data || []))
  }

  return { rows, total: count || 0 }
}

async function updateCoreFlags(allSources, coreSources) {
  const allIds = allSources.map((source) => source.id)
  const coreIds = coreSources.map((source) => source.id)

  for (let index = 0; index < allIds.length; index += BATCH_SIZE) {
    const ids = allIds.slice(index, index + BATCH_SIZE)
    const { error } = await supabase
      .from('wiki_sources')
      .update({ is_core_library: false })
      .in('id', ids)

    if (error) throw error
  }

  for (let index = 0; index < coreIds.length; index += BATCH_SIZE) {
    const ids = coreIds.slice(index, index + BATCH_SIZE)
    const { error } = await supabase
      .from('wiki_sources')
      .update({ is_core_library: true })
      .in('id', ids)

    if (error) throw error
  }
}

function logDistribution(label, sources) {
  const byPillar = groupBy(sources, (source) => source.pillar)
  console.log(label)
  for (const [pillar, rows] of [...byPillar.entries()].sort()) {
    const typeCounts = [...groupBy(rows, (source) => source.content_type).entries()]
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .map(([type, typeRows]) => `${type}:${typeRows.length}`)
      .join(', ')
    console.log(`- ${pillar}: ${rows.length} (${typeCounts})`)
  }
}

async function main() {
  const { rows: sources, total } = await fetchAllSources()
  console.log(`Fetched ${sources.length} / ${total} sources for curation.`)
  const byPillar = groupBy(sources, (source) => source.pillar)
  const selected = []

  for (const [pillar, rows] of byPillar.entries()) {
    const core = chooseCoreSources(rows)
    selected.push(...core)

    if (rows.length < MIN_HEALTHY_SOURCES) {
      console.log(`${pillar}: only ${rows.length} sources exist; kept all, needs ${MIN_HEALTHY_SOURCES - rows.length}-${TARGET_CORE_SOURCES - rows.length} more sources.`)
    }
  }

  await updateCoreFlags(sources, selected)

  logDistribution('Core library distribution:', selected)
  logDistribution('Archived distribution:', sources.filter((source) => !selected.some((core) => core.id === source.id)))
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
