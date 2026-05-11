import { createClient } from '@supabase/supabase-js'

const knowledgeSupabaseUrl =
  import.meta.env.VITE_KNOWLEDGE_SUPABASE_URL ||
  import.meta.env.VITE_SUPABASE_URL ||
  'https://placeholder.supabase.co'

const knowledgeSupabaseAnonKey =
  import.meta.env.VITE_KNOWLEDGE_SUPABASE_ANON_KEY ||
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'placeholder'

export const knowledgeSupabase = createClient(knowledgeSupabaseUrl, knowledgeSupabaseAnonKey)
