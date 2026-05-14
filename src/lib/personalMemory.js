import { supabase } from './supabase'
import { generateEmbedding, generateMemoryUpdate } from './openai'
import { postApiJson } from './api'

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
    ? Math.min(7, Math.max(1, memory.importance))
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

function emitTiming(options, step, data = {}) {
  if (typeof options?.onTiming === 'function') {
    options.onTiming(step, data)
  }
}

async function resolveQueryEmbedding(query, options = {}) {
  const normalizedQuery = String(query || '').trim()
  const sharedText = String(options.queryEmbeddingText || '').trim()
  const canUseSharedEmbedding = sharedText && normalizedQuery === sharedText
  if (canUseSharedEmbedding && options.queryEmbedding) return options.queryEmbedding
  if (canUseSharedEmbedding && options.queryEmbeddingPromise) return options.queryEmbeddingPromise
  if (canUseSharedEmbedding && typeof options.getQueryEmbedding === 'function') {
    return options.getQueryEmbedding()
  }

  emitTiming(options, 'embedding:start')
  const embedding = await generateEmbedding(query)
  emitTiming(options, 'embedding:done')
  return embedding
}

export async function searchPersonalMemory(userId, query, matchCount = 5, options = {}) {
  if (!userId || !query) return []

  try {
    const embedding = await resolveQueryEmbedding(query, options)
    emitTiming(options, 'vector_search:start', { matchCount })
    const { data, error } = await supabase.rpc('match_personal_memories', {
      query_embedding: embedding,
      match_user_id: userId,
      match_count: matchCount,
      similarity_threshold: 0.35,
    })
    emitTiming(options, 'vector_search:done', {
      matchCount,
      resultCount: data?.length || 0,
    })

    if (error) return []

    const memories = data || []
    emitTiming(options, 'mark_used:start', { memoryCount: memories.length })
    markMemoriesUsed(memories.map((memory) => memory.id).filter(Boolean))
      .finally(() => emitTiming(options, 'mark_used:done', { memoryCount: memories.length }))
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

  try {
    await postApiJson('/api/personal-memories/mark-used', {
      memory_ids: memoryIds,
    })
  } catch {}
}

async function upsertPersonalMemory(sessionId, userId, memory) {
  if (!userId) return

  const embedding = await generateEmbedding(memory.content)
  await postApiJson('/api/personal-memories', {
    session_id: sessionId,
    memory,
    embedding,
  })
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

export async function recordExperimentAvoidancePattern(session, experiment, userText = '') {
  if (!session?.id || !session?.user_id || !experiment?.description) return false

  const content = [
    `User avoided the experiment "${experiment.description}".`,
    'This was reported as a choice, not an external constraint.',
    userText ? `Their explanation: ${String(userText).trim()}` : '',
  ].filter(Boolean).join(' ')

  try {
    await upsertPersonalMemory(session.id, session.user_id, {
      type: 'pattern',
      content,
      primary_pillar: 'human_mind',
      secondary_pillars: experiment.pillar ? [normalizePillar(experiment.pillar)].filter(Boolean) : [],
      pillar_confidence: 0.8,
      importance: 7,
      confidence: 0.8,
    })
    return true
  } catch (error) {
    console.error('Failed to record experiment avoidance pattern', {
      error,
      session_id: session.id,
      experiment_id: experiment.id,
    })
    return false
  }
}

export async function recordExperimentResistancePattern(session, experiment, userText = '', reasonStrength = 'weak') {
  if (!session?.id || !session?.user_id || !experiment?.description) return false

  const content = [
    `User pushed back on the experiment "${experiment.description}".`,
    `The stated reason was ${reasonStrength === 'real' ? 'a real constraint' : 'weak or vague resistance'}.`,
    userText ? `Their explanation: ${String(userText).trim()}` : '',
  ].filter(Boolean).join(' ')

  try {
    await upsertPersonalMemory(session.id, session.user_id, {
      type: 'pattern',
      content,
      primary_pillar: 'human_mind',
      secondary_pillars: experiment.pillar ? [normalizePillar(experiment.pillar)].filter(Boolean) : [],
      pillar_confidence: 0.75,
      importance: reasonStrength === 'real' ? 4 : 6,
      confidence: 0.75,
    })
    return true
  } catch (error) {
    console.error('Failed to record experiment resistance pattern', {
      error,
      session_id: session.id,
      experiment_id: experiment.id,
      reason_strength: reasonStrength,
    })
    return false
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
