import { supabase } from './supabase'

const ACTIVE_APP_SESSION_KEY = 'axiom_active_app_session_id'

function deviceLabel() {
  if (typeof navigator === 'undefined') return 'unknown'
  const pointer = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches
    ? 'touch'
    : 'pointer'
  return `${pointer}; ${navigator.platform || 'unknown'}`
}

function secondsBetween(startedAt, endedAt = new Date()) {
  const start = new Date(startedAt).getTime()
  const end = new Date(endedAt).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  return Math.max(0, Math.round((end - start) / 1000))
}

export async function startAppSession({ userId, entryPoint = 'direct' } = {}) {
  if (!userId) return null

  const { data, error } = await supabase
    .from('app_sessions')
    .insert({
      user_id: userId,
      entry_point: entryPoint,
      last_ping_at: new Date().toISOString(),
      device: deviceLabel(),
    })
    .select('id, started_at')
    .single()

  if (error || !data?.id) return null

  try {
    sessionStorage.setItem(ACTIVE_APP_SESSION_KEY, data.id)
  } catch {
    // ignore storage failures
  }

  return data
}

export async function pingAppSession(appSessionId) {
  if (!appSessionId) return
  await supabase
    .from('app_sessions')
    .update({ last_ping_at: new Date().toISOString() })
    .eq('id', appSessionId)
}

export async function closeAppSession(appSessionId, startedAt) {
  if (!appSessionId) return
  const endedAt = new Date()
  const payload = {
    ended_at: endedAt.toISOString(),
    last_ping_at: endedAt.toISOString(),
  }
  const duration = secondsBetween(startedAt, endedAt)
  if (duration !== null) payload.duration_seconds = duration

  await supabase
    .from('app_sessions')
    .update(payload)
    .eq('id', appSessionId)

  try {
    if (sessionStorage.getItem(ACTIVE_APP_SESSION_KEY) === appSessionId) {
      sessionStorage.removeItem(ACTIVE_APP_SESSION_KEY)
    }
  } catch {
    // ignore storage failures
  }
}

export async function incrementAppSessionMessagesSent(amount = 1) {
  let appSessionId = null
  try {
    appSessionId = sessionStorage.getItem(ACTIVE_APP_SESSION_KEY)
  } catch {
    return
  }
  if (!appSessionId) return

  const { data } = await supabase
    .from('app_sessions')
    .select('messages_sent')
    .eq('id', appSessionId)
    .maybeSingle()

  const next = Math.max(0, Number(data?.messages_sent || 0) + amount)
  await supabase
    .from('app_sessions')
    .update({ messages_sent: next, last_ping_at: new Date().toISOString() })
    .eq('id', appSessionId)
}
