import { createClient } from '@supabase/supabase-js'

const knowledgeSupabaseUrl =
  import.meta.env.VITE_KNOWLEDGE_SUPABASE_URL ||
  'https://placeholder.supabase.co'

const knowledgeSupabaseAnonKey =
  import.meta.env.VITE_KNOWLEDGE_SUPABASE_ANON_KEY ||
  'placeholder'

try {
  const host = new URL(knowledgeSupabaseUrl).host
  console.info('[Axiom knowledge Supabase]', { host })
} catch {
  console.info('[Axiom knowledge Supabase]', { host: 'invalid-url' })
}

export const knowledgeSupabase = createClient(knowledgeSupabaseUrl, knowledgeSupabaseAnonKey)
