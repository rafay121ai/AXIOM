import { supabase } from './supabase'
import { generateEmbedding, openai, CHAT_MODEL } from './openai'

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

// ─── Query Expansion ─────────────────────────────────────────────────────────
async function expandQuery(query) {
  try {
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
  } catch (err) {
    console.warn('[RAG] Query expansion failed (falling back to original query only):', err?.message || err)
  }
  return []
}

// ─── Search Against One Query ─────────────────────────────────────────────────
async function searchSingleQuery(query, matchCount, filterPillar) {
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
}

export async function searchWiki(query, matchCount = 3, filterPillar = null) {
  // Expand query + run all searches in parallel
  const alternatives = await expandQuery(query)
  const allQueries = [query, ...alternatives]

  console.log(`[RAG] Expanded to ${allQueries.length} queries:`, allQueries)

  const resultSets = await Promise.all(
    allQueries.map((q) => searchSingleQuery(q, matchCount * 3, filterPillar))
  )

  // Merge all results — deduplicate by title, keep highest similarity per source
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

  // Apply threshold; fall back to top results if nothing qualifies
  const aboveThreshold = deduped.filter((c) => c.similarity >= 0.5)
  const results = (aboveThreshold.length > 0 ? aboveThreshold : deduped).slice(0, matchCount)

  console.log(`[RAG] Top chunks: ${results.map((c) => `"${c.title}" (${c.similarity.toFixed(3)})`).join(', ')}`)

  return results
}

// ─── Format for System Prompt ────────────────────────────────────────────────
export function formatWikiContext(chunks) {
  if (!chunks || chunks.length === 0) return ''

  return chunks
    .map(
      (chunk) =>
        `[${chunk.title} — ${chunk.author}]\n${chunk.key_frameworks}`
    )
    .join('\n\n---\n\n')
}
