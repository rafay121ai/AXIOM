import { supabase } from './supabase'

function shortTitle(value = '') {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  if (!text) return 'Branch thread'
  return text.length > 80 ? `${text.slice(0, 77)}...` : text
}

export async function ensureConversationThread({
  threadId,
  userId,
  sessionId,
  title = '',
  primaryPillar = null,
} = {}) {
  if (!threadId || !userId || !sessionId) return null

  const { data: existing } = await supabase
    .from('conversation_threads')
    .select('id')
    .eq('id', threadId)
    .maybeSingle()

  if (existing?.id) return existing

  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('conversation_threads')
    .insert({
      id: threadId,
      user_id: userId,
      session_id: sessionId,
      title: shortTitle(title),
      primary_pillar: primaryPillar,
      started_at: now,
      last_message_at: now,
      status: 'active',
      updated_at: now,
    })
    .select('id')
    .single()

  if (error) return null
  return data
}
