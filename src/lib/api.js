import { supabase } from './supabase'

const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '')

export function apiUrl(path) {
  return `${API_BASE}${path}`
}

async function getAuthHeaders() {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function readError(response) {
  try {
    const data = await response.json()
    return data?.error || response.statusText
  } catch {
    return response.statusText
  }
}

export async function postApiJson(path, body = {}) {
  const authHeaders = await getAuthHeaders()
  const response = await fetch(apiUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new Error(await readError(response))
  }

  return response.json()
}
