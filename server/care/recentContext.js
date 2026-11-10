// Earlier founder messages of the current situation, for the care classifier.
// Every lookup is scoped by user_id; a failure or a missing row gives [] and
// never changes a screening. Message text is never logged.
import { isUuid } from '../writeValidation.js'

const KEEP = 4
const FIELDS = ['text', 'reason', 'note']

export function createRecentContext({ supabase, log = () => {} }) {
  const first = async (query) => {
    const { data, error } = await query
    if (error) throw error
    return data?.[0] ?? null
  }
  const rows = async (query) => {
    const { data, error } = await query
    if (error) throw error
    return data || []
  }

  // Founder rows of a situation and of its learn conversation, oldest first, last 4.
  async function ofSituation(userId, situationId, current) {
    if (!supabase || !userId || !isUuid(situationId)) return []
    const situation = await first(supabase.from('situations').select('id').eq('id', situationId).eq('user_id', userId).limit(1))
    if (!situation) return []
    const conversation = await first(supabase.from('learn_conversations').select('id').eq('situation_id', situationId).eq('user_id', userId).limit(1))
    const newest = (table, key, id) => rows(supabase.from(table).select('text, created_at')
      .eq(key, id).eq('role', 'founder').eq('filler', false).order('created_at', { ascending: false }).limit(KEEP + 2))
    const [turns, learn] = await Promise.all([
      newest('situation_turns', 'situation_id', situationId),
      conversation ? newest('learn_turns', 'conversation_id', conversation.id) : [],
    ])
    return [...turns, ...learn]
      .filter((r) => typeof r.text === 'string' && r.text.trim() && !current.includes(r.text.trim()))
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
      .slice(-KEEP)
      .map((r) => r.text)
  }

  const safely = (find) => async (req) => {
    try {
      const userId = req.user?.id
      const current = FIELDS.map((f) => req.body?.[f]).filter((v) => typeof v === 'string').map((v) => v.trim())
      const situationId = await find(userId, req.params?.id)
      return situationId ? await ofSituation(userId, situationId, current) : []
    } catch (err) {
      log('context lookup failed', err)
      return []
    }
  }
  const via = (table) => (userId, id) => isUuid(id)
    ? first(supabase.from(table).select('situation_id').eq('id', id).eq('user_id', userId).limit(1)).then((r) => r?.situation_id)
    : null

  return {
    forSituation: safely((_userId, id) => id),
    forLearn: safely(via('learn_conversations')),
    forMove: safely(via('moves')),
  }
}
