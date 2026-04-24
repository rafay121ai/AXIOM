import { generateWeeklyRead } from './openai'
import { supabase } from './supabase'

function startOfWeekDate(now = new Date()) {
  const date = new Date(now)
  const day = date.getDay()
  const diff = day === 0 ? -6 : 1 - day
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() + diff)
  return date
}

function formatWeekStart(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function normalizeRecentMessages(messages = []) {
  return messages
    .filter((message) => message?.content)
    .map((message) => ({
      role: message.role,
      content: message.content,
      created_at: message.created_at,
    }))
}

export async function fetchLatestWeeklyRead(sessionId) {
  if (!sessionId) return null

  const { data, error } = await supabase
    .from('weekly_reads')
    .select('*')
    .eq('session_id', sessionId)
    .order('week_start', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.warn('[Reads] Latest read fetch skipped:', error.message)
    return null
  }

  return data || null
}

export async function ensureCurrentWeeklyRead(session, recentMessages = []) {
  if (!session?.id) return null

  const weekStart = formatWeekStart(startOfWeekDate())

  const { data: existing, error: existingError } = await supabase
    .from('weekly_reads')
    .select('*')
    .eq('session_id', session.id)
    .eq('week_start', weekStart)
    .maybeSingle()

  if (existingError) {
    console.warn('[Reads] Current week fetch skipped:', existingError.message)
    return null
  }

  if (existing) return existing

  try {
    const normalizedMessages = normalizeRecentMessages(recentMessages)
    const content = await generateWeeklyRead(session, normalizedMessages)
    if (!content) return null

    const { data, error } = await supabase
      .from('weekly_reads')
      .insert({
        session_id: session.id,
        week_start: weekStart,
        content,
        source_message_count: normalizedMessages.length,
        updated_at: new Date().toISOString(),
      })
      .select('*')
      .single()

    if (error) {
      console.warn('[Reads] Insert skipped:', error.message)
      return null
    }

    return data
  } catch (err) {
    console.warn('[Reads] Generation skipped:', err?.message || err)
    return null
  }
}
