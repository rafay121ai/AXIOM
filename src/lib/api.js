import { supabase } from './supabase'

function resolveApiBase() {
  return (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')
}

const API_BASE = resolveApiBase()

export function apiUrl(path) {
  return `${API_BASE}${path}`
}

async function getAuthHeaders() {
  const { data } = await supabase.auth.getSession()
  let token = data.session?.access_token

  if (!token) {
    const { data: refreshed } = await supabase.auth.refreshSession()
    token = refreshed.session?.access_token
  }

  if (!token) {
    throw new Error('No active auth session')
  }
  return { Authorization: `Bearer ${token}` }
}

async function readError(response) {
  try {
    const data = await response.json()
    return data || { error: response.statusText }
  } catch {
    return { error: response.statusText }
  }
}

export async function postApiJson(path, body = {}, { keepalive = false } = {}) {
  const authHeaders = await getAuthHeaders()
  const response = await fetch(apiUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify(body),
    ...(keepalive ? { keepalive: true } : {}),
  })

  if (!response.ok) {
    const data = await readError(response)
    const error = new Error(data?.error || data?.reason || response.statusText)
    error.status = response.status
    error.data = data
    throw error
  }

  return response.json()
}

export async function getApiJson(path) {
  const authHeaders = await getAuthHeaders()
  const response = await fetch(apiUrl(path), {
    method: 'GET',
    headers: { ...authHeaders },
  })

  if (!response.ok) {
    const data = await readError(response)
    const error = new Error(data?.error || data?.reason || response.statusText)
    error.status = response.status
    error.data = data
    throw error
  }

  return response.json()
}

export async function trackProductEvent(event, properties = {}) {
  try {
    await postApiJson('/api/events', { event, properties })
    return true
  } catch (error) {
    console.warn('[Product Event] request failed', {
      event,
      error: error?.message || String(error),
    })
    return false
  }
}
