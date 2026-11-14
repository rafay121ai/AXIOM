// Retrieval for Learn, on the server. The same search the removed web app
// used (match_wiki_chunks on the Knowledge project), through an injected
// knowledgeSupabase and an injected embedder. Returns an evidence pack whose
// rows carry opaque handles (E1..En); the model sees handle, author, title and text,
// never a database id.
//
// Attribution is book level until the lesson tables exist: a passage carries
// author and title from its row, and never a quote, chapter or page of ours.
import { MODELS } from '../../config.js'

export const MATCH_COUNT = 20
export const MAX_PER_BOOK = 2
export const MAX_EVIDENCE = 6
// Flag LESSON_CITES: a wider pool for the model to pick from, and verified lessons attached to it.
export const POOL_MAX = 10
export const MIN_LESSON_SIMILARITY = 0.35
const LESSON_MATCH_COUNT = 50
const LESSON_DIMENSIONS = 512
// From the old search: strong hits in this corpus sit around 0.35 to 0.45.
export const MIN_SIMILARITY = 0.3
export const PASSAGE_MAX_CHARS = 1200
const QUERY_MAX_CHARS = 2000

const bookKey = (row) => `${String(row.author).trim().toLowerCase()}|${String(row.title).trim().toLowerCase()}`
const passageOf = (text) => {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim()
  return t.length <= PASSAGE_MAX_CHARS ? t : t.slice(0, PASSAGE_MAX_CHARS).replace(/\s+\S*$/, '')
}

// Pure: search rows -> evidence pack. Keeps the best passages, at most
// MAX_PER_BOOK per book and `max` (MAX_EVIDENCE) in total.
export function evidenceFromRows(rows, max = MAX_EVIDENCE) {
  const usable = (Array.isArray(rows) ? rows : [])
    .filter((r) => r?.id && r.author?.trim() && r.title?.trim() && passageOf(r.key_frameworks) && Number(r.similarity) >= MIN_SIMILARITY)
    .sort((a, b) => Number(b.similarity) - Number(a.similarity))
  const perBook = new Map()
  const picked = []
  for (const row of usable) {
    const key = bookKey(row)
    if ((perBook.get(key) ?? 0) >= MAX_PER_BOOK) continue
    perBook.set(key, (perBook.get(key) ?? 0) + 1)
    picked.push(row)
    if (picked.length >= max) break
  }
  return picked.map((row, i) => ({
    handle: `E${i + 1}`,
    chunk_id: row.id,
    author: row.author.trim(),
    source_title: row.title.trim(),
    pillar: row.pillar ?? null,
    text: passageOf(row.key_frameworks),
    similarity: Number(row.similarity),
  }))
}

// jsonb paragraphs may be strings or { id, text }: strings only, empties dropped, total capped.
function paragraphsOf(raw) {
  const out = []
  let used = 0
  for (const p of Array.isArray(raw) ? raw : []) {
    const t = String(typeof p === 'string' ? p : p?.text ?? '').replace(/\s+/g, ' ').trim()
    if (!t) continue
    const room = PASSAGE_MAX_CHARS - used
    if (room <= 0) break
    out.push(t.length <= room ? t : t.slice(0, room).replace(/\s+\S*$/, ''))
    used += t.length + 1
  }
  return out.filter(Boolean)
}

// Gives each pool row the best lesson of its own book (never another book's), each lesson once.
// Books are matched by source id (wiki_chunks.source_id = lessons.wiki_source_id), not by spelling.
// Never throws: any failure leaves the rows as they are.
async function attachLessons({ knowledgeSupabase, embed, input, userId, usageContext, pool, log }) {
  try {
    const { data: chunkRows, error: chunkError } = await knowledgeSupabase.from('wiki_chunks').select('id, source_id').in('id', pool.map((e) => e.chunk_id))
    if (chunkError) throw chunkError
    const sourceOf = new Map((Array.isArray(chunkRows) ? chunkRows : []).filter((c) => c?.id && c.source_id).map((c) => [c.id, c.source_id]))
    const sourceIds = [...new Set(pool.map((e) => sourceOf.get(e.chunk_id)).filter(Boolean))]
    if (!sourceIds.length) return pool
    const embedding = await embed(input, { userId, usageContext, dimensions: LESSON_DIMENSIONS })
    const { data, error } = await knowledgeSupabase.rpc('match_lessons', {
      query_embedding: embedding,
      match_count: LESSON_MATCH_COUNT,
      filter_pillar: null,
      filter_sources: sourceIds,
    })
    if (error) throw error
    const lessons = (Array.isArray(data) ? data : [])
      .filter((l) => l?.lesson_id && l.wiki_source_id && Number(l.similarity) >= MIN_LESSON_SIMILARITY)
      .sort((a, b) => Number(b.similarity) - Number(a.similarity))
    const taken = new Set()
    return pool.map((row) => {
      const sourceId = sourceOf.get(row.chunk_id)
      const l = sourceId && lessons.find((x) => !taken.has(x.lesson_id) && x.wiki_source_id === sourceId)
      const paragraphs = l ? paragraphsOf(l.paragraphs) : []
      if (!paragraphs.length) return row
      taken.add(l.lesson_id)
      return { ...row, lesson: { lesson_id: l.lesson_id, chapter: l.chapter ?? null, page_start: l.page_start ?? null, page_end: l.page_end ?? null, principle: l.principle ?? '', applies_when: l.applies_when ?? '', paragraphs } }
    })
  } catch (err) {
    log('lesson lookup failed', err)
    return pool
  }
}

// Never throws: a failed embedding or search means no evidence, and the
// reply is then built from the founder's own facts only.
export async function retrieveEvidence({ knowledgeSupabase, embed, query, userId = null, usageContext = {}, log = () => {}, lessonCites = false }) {
  const input = String(query ?? '').replace(/\s+/g, ' ').trim().slice(0, QUERY_MAX_CHARS)
  if (!knowledgeSupabase || !embed || !input) return []
  try {
    const embedding = await embed(input, { userId, usageContext })
    const { data, error } = await knowledgeSupabase.rpc('match_wiki_chunks', {
      query_embedding: embedding,
      match_count: MATCH_COUNT,
      filter_pillar: null,
    })
    if (error) throw error
    if (!lessonCites) return evidenceFromRows(data)
    const pool = evidenceFromRows(data, POOL_MAX)
    const rows = pool.length ? await attachLessons({ knowledgeSupabase, embed, input, userId, usageContext, pool, log }) : pool
    log('learn evidence pool', { rows: rows.length, with_lesson: rows.filter((r) => r.lesson).length })
    return rows
  } catch (err) {
    log('retrieval failed', err)
    return []
  }
}

// The embedder the app injects: one OpenAI embedding call, with its usage row.
export function createEmbedder({ openai, logModelUsage, clock = { now: () => Date.now() } }) {
  return async function embed(input, { userId = null, usageContext = {}, dimensions } = {}) {
    const startedAt = clock.now()
    const context = { ...usageContext, call_type: 'embedding' }
    let response
    try {
      response = await openai.embeddings.create({ model: MODELS.embedding, input, ...(dimensions ? { dimensions } : {}) })
    } catch (err) {
      await logModelUsage({
        userId, usageContext: context, model: MODELS.embedding, latencyMs: clock.now() - startedAt,
        error: true, errorDetails: err?.message || 'Embedding request failed',
      })
      throw err
    }
    await logModelUsage({ userId, usageContext: context, model: MODELS.embedding, usage: response.usage || null, latencyMs: clock.now() - startedAt })
    const embedding = response.data?.[0]?.embedding
    if (!Array.isArray(embedding) || embedding.length === 0) throw new Error('Embedding response had no vector')
    return embedding
  }
}
