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
// MAX_PER_BOOK per book and MAX_EVIDENCE in total.
export function evidenceFromRows(rows) {
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
    if (picked.length >= MAX_EVIDENCE) break
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


// Never throws: a failed embedding or search means no evidence, and the
// reply is then built from the founder's own facts only.
export async function retrieveEvidence({ knowledgeSupabase, embed, query, userId = null, usageContext = {}, log = () => {} }) {
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
    return evidenceFromRows(data)
  } catch (err) {
    log('retrieval failed', err)
    return []
  }
}

// The embedder the app injects: one OpenAI embedding call, with its usage row.
export function createEmbedder({ openai, logModelUsage, clock = { now: () => Date.now() } }) {
  return async function embed(input, { userId = null, usageContext = {} } = {}) {
    const startedAt = clock.now()
    const context = { ...usageContext, call_type: 'embedding' }
    let response
    try {
      response = await openai.embeddings.create({ model: MODELS.embedding, input })
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
