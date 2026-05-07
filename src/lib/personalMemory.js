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

const PILLARS = new Set([
  'human_mind',
  'money_game',
  'how_companies_win',
  'whats_coming',
  'think_sharper',
  'move_people',
])

function normalizePillar(value) {
  const pillar = typeof value === 'string' ? value.trim() : ''
  return PILLARS.has(pillar) ? pillar : null
}

function normalizeMemory(memory) {
  const type = MEMORY_TYPES.has(memory?.type) ? memory.type : 'fact'
  const content = typeof memory?.content === 'string' ? memory.content.trim() : ''
  const primaryPillar = normalizePillar(memory?.primary_pillar)
  const secondaryPillars = Array.isArray(memory?.secondary_pillars)
    ? [...new Set(memory.secondary_pillars.map(normalizePillar).filter(Boolean))]
      .filter((pillar) => pillar !== primaryPillar)
      .slice(0, 2)
    : []
  const pillarConfidence = typeof memory?.pillar_confidence === 'number'
    ? Math.min(1, Math.max(0, memory.pillar_confidence))
    : 0.7
  const importance = Number.isInteger(memory?.importance)
    ? Math.min(5, Math.max(1, memory.importance))
    : 3
  const confidence = typeof memory?.confidence === 'number'
    ? Math.min(1, Math.max(0, memory.confidence))
    : 0.7

  if (!content) return null
  return {
    type,
    content,
    primary_pillar: primaryPillar,
    secondary_pillars: secondaryPillars,
    pillar_confidence: pillarConfidence,
    importance,
    confidence,
  }
}

export async function searchPersonalMemory(userId, query, matchCount = 5) {
  if (!userId || !query) return []

  try {
    const embedding = await generateEmbedding(query)
    const { data, error } = await supabase.rpc('match_personal_memories', {
      query_embedding: embedding,
      match_user_id: userId,
      match_count: matchCount,
      similarity_threshold: 0.35,
    })

    if (error) return []

    const memories = data || []
    await markMemoriesUsed(memories.map((memory) => memory.id).filter(Boolean))
    return memories
  } catch {
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

export function formatNamedPatternsContext(memories) {
  if (!memories || memories.length === 0) return ''

  return memories
    .filter((memory) => memory.type === 'pattern' || memory.type === 'belief')
    .map((memory) => `- [${memory.type}] ${memory.content}`)
    .join('\n')
}

async function markMemoriesUsed(memoryIds) {
  if (!memoryIds.length) return

  const { error } = await supabase.rpc('mark_personal_memories_used', {
    memory_ids: memoryIds,
  })

  if (error) return
}

async function findSimilarMemory(userId, memory, embedding) {
  const { data, error } = await supabase.rpc('find_similar_personal_memory', {
    query_embedding: embedding,
    match_user_id: userId,
    match_type: memory.type,
    similarity_threshold: 0.82,
  })

  if (error) return null

  return data?.[0] || null
}

async function upsertPersonalMemory(sessionId, userId, memory) {
  if (!userId) return

  const embedding = await generateEmbedding(memory.content)
  const existing = await findSimilarMemory(userId, memory, embedding)

  if (existing) {
    const existingImportance = existing.importance || 1
    const existingConfidence = typeof existing.confidence === 'number' ? existing.confidence : 0.7
    const updates = {
      content: memory.content.length >= existing.content.length ? memory.content : existing.content,
      importance: Math.max(existingImportance, memory.importance),
      confidence: Math.min(1, Math.max(existingConfidence, memory.confidence)),
      primary_pillar: memory.primary_pillar || existing.primary_pillar || null,
      secondary_pillars: memory.secondary_pillars || existing.secondary_pillars || [],
      pillar_confidence: Math.max(Number(existing.pillar_confidence) || 0, memory.pillar_confidence || 0.7),
      embedding,
      updated_at: new Date().toISOString(),
    }

    const { error } = await supabase
      .from('personal_memories')
      .update(updates)
      .eq('id', existing.id)

    if (error) {
      if (/primary_pillar|secondary_pillars|pillar_confidence/.test(error.message || '')) {
        const { primary_pillar, secondary_pillars, pillar_confidence, ...legacyUpdates } = updates
        const { error: legacyError } = await supabase
          .from('personal_memories')
          .update(legacyUpdates)
          .eq('id', existing.id)
        if (legacyError) return
      }
    }
    return
  }

  const payload = {
    session_id: sessionId,
    user_id: userId,
    type: memory.type,
    content: memory.content,
    importance: memory.importance,
    confidence: memory.confidence,
    primary_pillar: memory.primary_pillar,
    secondary_pillars: memory.secondary_pillars,
    pillar_confidence: memory.pillar_confidence,
    embedding,
  }

  const { error } = await supabase.from('personal_memories').insert(payload)

  if (error) {
    if (/primary_pillar|secondary_pillars|pillar_confidence/.test(error.message || '')) {
      const { primary_pillar, secondary_pillars, pillar_confidence, ...legacyPayload } = payload
      const { error: legacyError } = await supabase.from('personal_memories').insert(legacyPayload)
      if (legacyError) return
    }
  }
}

async function savePersonalMemories(sessionId, userId, memories) {
  if (!userId) return

  for (const rawMemory of memories) {
    const memory = normalizeMemory(rawMemory)
    if (!memory) continue

    try {
      await upsertPersonalMemory(sessionId, userId, memory)
    } catch {}
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
      await supabase
        .from('sessions')
        .update(sessionUpdates)
        .eq('id', session.id)
    }

    await savePersonalMemories(session.id, session.user_id || null, update.memories || [])

    return { ...session, session_notes: sessionNotes, concept_progress: conceptProgress.length > 0 ? conceptProgress : session.concept_progress }
  } catch {
    return session
  }
}
