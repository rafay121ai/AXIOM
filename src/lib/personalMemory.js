import { supabase } from './supabase'
import { generateEmbedding, generateMemoryUpdate } from './openai'

const MEMORY_TYPES = new Set([
  'goal',
  'pattern',
  'belief',
  'experiment_result',
  'preference',
  'decision',
  'fact',
])

function normalizeMemory(memory) {
  const type = MEMORY_TYPES.has(memory?.type) ? memory.type : 'fact'
  const content = typeof memory?.content === 'string' ? memory.content.trim() : ''
  const importance = Number.isInteger(memory?.importance)
    ? Math.min(5, Math.max(1, memory.importance))
    : 3
  const confidence = typeof memory?.confidence === 'number'
    ? Math.min(1, Math.max(0, memory.confidence))
    : 0.7

  if (!content) return null
  return { type, content, importance, confidence }
}

export async function searchPersonalMemory(sessionId, query, matchCount = 5) {
  if (!sessionId || !query) return []

  try {
    const embedding = await generateEmbedding(query)
    const { data, error } = await supabase.rpc('match_personal_memories', {
      query_embedding: embedding,
      match_session_id: sessionId,
      match_count: matchCount,
      similarity_threshold: 0.35,
    })

    if (error) {
      console.warn('[Memory] Search skipped:', error.message)
      return []
    }

    const memories = data || []
    await markMemoriesUsed(memories.map((memory) => memory.id).filter(Boolean))
    return memories
  } catch (err) {
    console.warn('[Memory] Search failed:', err?.message || err)
    return []
  }
}

export function formatPersonalMemoryContext(memories) {
  if (!memories || memories.length === 0) return ''

  return memories
    .map((memory) => {
      const type = memory.type || 'memory'
      const importance = memory.importance ? `importance ${memory.importance}` : 'stored memory'
      const usage = memory.use_count ? `, used ${memory.use_count}x` : ''
      return `- [${type}, ${importance}${usage}] ${memory.content}`
    })
    .join('\n')
}

async function markMemoriesUsed(memoryIds) {
  if (!memoryIds.length) return

  const { error } = await supabase.rpc('mark_personal_memories_used', {
    memory_ids: memoryIds,
  })

  if (error) {
    console.warn('[Memory] Usage update skipped:', error.message)
  }
}

async function findSimilarMemory(sessionId, memory, embedding) {
  const { data, error } = await supabase.rpc('find_similar_personal_memory', {
    query_embedding: embedding,
    match_session_id: sessionId,
    match_type: memory.type,
    similarity_threshold: 0.82,
  })

  if (error) {
    console.warn('[Memory] Dedupe skipped:', error.message)
    return null
  }

  return data?.[0] || null
}

async function upsertPersonalMemory(sessionId, memory) {
  const embedding = await generateEmbedding(memory.content)
  const existing = await findSimilarMemory(sessionId, memory, embedding)

  if (existing) {
    const existingImportance = existing.importance || 1
    const existingConfidence = typeof existing.confidence === 'number' ? existing.confidence : 0.7
    const updates = {
      content: memory.content.length >= existing.content.length ? memory.content : existing.content,
      importance: Math.max(existingImportance, memory.importance),
      confidence: Math.min(1, Math.max(existingConfidence, memory.confidence)),
      embedding,
      updated_at: new Date().toISOString(),
    }

    const { error } = await supabase
      .from('personal_memories')
      .update(updates)
      .eq('id', existing.id)

    if (error) {
      console.warn('[Memory] Update skipped:', error.message)
    }
    return
  }

  const { error } = await supabase.from('personal_memories').insert({
    session_id: sessionId,
    type: memory.type,
    content: memory.content,
    importance: memory.importance,
    confidence: memory.confidence,
    embedding,
  })

  if (error) {
    console.warn('[Memory] Insert skipped:', error.message)
  }
}

async function savePersonalMemories(sessionId, memories) {
  for (const rawMemory of memories) {
    const memory = normalizeMemory(rawMemory)
    if (!memory) continue

    try {
      await upsertPersonalMemory(sessionId, memory)
    } catch (err) {
      console.warn('[Memory] Save failed:', err?.message || err)
    }
  }
}

export async function updatePersonalMemory(session, recentMessages, userMessage, assistantMessage) {
  if (!session?.id || !userMessage || !assistantMessage) return session

  try {
    const update = await generateMemoryUpdate(session, recentMessages, userMessage, assistantMessage)
    const sessionNotes = update.session_notes || session.session_notes || ''
    const conceptProgress = update.concept_progress || []

    const sessionUpdates = {}
    if (sessionNotes && sessionNotes !== session.session_notes) {
      sessionUpdates.session_notes = sessionNotes
    }
    if (conceptProgress.length > 0) {
      sessionUpdates.concept_progress = conceptProgress
    }

    if (Object.keys(sessionUpdates).length > 0) {
      const { error } = await supabase
        .from('sessions')
        .update(sessionUpdates)
        .eq('id', session.id)

      if (error) {
        console.warn('[Memory] Session update skipped:', error.message)
      }
    }

    await savePersonalMemories(session.id, update.memories || [])

    return { ...session, session_notes: sessionNotes, concept_progress: conceptProgress.length > 0 ? conceptProgress : session.concept_progress }
  } catch (err) {
    console.warn('[Memory] Update failed:', err?.message || err)
    return session
  }
}
