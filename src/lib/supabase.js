import { createClient } from '@supabase/supabase-js'

const viteEnv = import.meta.env || {}
const supabaseUrl = viteEnv.VITE_SUPABASE_URL || 'https://placeholder.supabase.co'
const supabaseAnonKey = viteEnv.VITE_SUPABASE_ANON_KEY || 'placeholder'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

export const AXIOM_SESSION_TOKEN_KEY = 'axiom_session_token'

export function getStoredSessionToken() {
  return localStorage.getItem(AXIOM_SESSION_TOKEN_KEY)
}

export function setStoredSessionToken(token) {
  if (!token) return
  localStorage.setItem(AXIOM_SESSION_TOKEN_KEY, token)
}

export function clearStoredSessionToken() {
  localStorage.removeItem(AXIOM_SESSION_TOKEN_KEY)
}
