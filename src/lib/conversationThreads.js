import { supabase } from './supabase'
import { sendApiWrite } from './api'

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

  const { data, error } = await sendApiWrite('POST', '/api/threads', {
    id: threadId,
    session_id: sessionId,
    title: shortTitle(title),
    primary_pillar: primaryPillar,
  })

  if (error) return null
  return data
}
