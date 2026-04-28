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

const CONFIDENCE_THRESHOLD = 0.75

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

// ─── Main Search ─────────────────────────────────────────────────────────────
// Returns { chunks, confidence } where confidence is the top similarity score.
// If no chunk clears CONFIDENCE_THRESHOLD, returns { chunks: [], confidence: 0 }.
export async function searchWiki(query, matchCount = 3, filterPillar = null) {
  const alternatives = await expandQuery(query)
  const allQueries = [query, ...alternatives]

  console.log(`[RAG] Expanded to ${allQueries.length} queries:`, allQueries)

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
    console.log(`[RAG] Top similarity ${deduped[0]?.similarity?.toFixed(3) ?? 'n/a'} — below threshold (${CONFIDENCE_THRESHOLD}). Returning empty context.`)
    return { chunks: [], confidence: 0 }
  }

  const results = aboveThreshold.slice(0, matchCount)
  const confidence = results[0].similarity

  console.log(`[RAG] Confidence: ${confidence.toFixed(3)} | chunks: ${results.map((c) => `"${c.title}" (${c.similarity.toFixed(3)})`).join(', ')}`)

  return { chunks: results, confidence }
}

// ─── Internalized Priors ─────────────────────────────────────────────────────
// Transforms retrieved chunks into first-person internalized knowledge statements.
// Groups by source so duplicate chunks from the same book produce one prior.
export async function formatWikiContext(chunks) {
  if (!chunks || chunks.length === 0) return ''

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
  try {
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
  } catch (err) {
    console.warn(`[RAG] Prior synthesis failed for "${title}":`, err?.message || err)
    // Fallback: reformat raw text without LLM — take first sentence only
    const firstSentence = combinedText.split(/[.!?]/)[0].trim()
    return `Axiom knows from ${author}, ${title}: ${firstSentence}.`
  }
}
