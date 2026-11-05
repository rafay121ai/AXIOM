// "Is the answer to this request already stored?" For a founder at the daily
// cost cap, such a request is replayed for free; only a request that would make
// a model call is stopped. Each check mirrors the service's own replay path.
// A lookup error or a bad id counts as "not stored".
import { isUuid } from '../writeValidation.js'

export function createStoredAnswers(supabase) {
  const found = async (query) => {
    const { data, error } = await query.limit(1)
    return !error && Array.isArray(data) && data.length > 0
  }
  const owns = (table, id, userId) => found(supabase.from(table).select('id').eq('id', id).eq('user_id', userId))
  const guarded = (fn) => async (req) => {
    try {
      return Boolean(supabase) && await fn(req, req.user.id)
    } catch {
      return false
    }
  }
  const turnId = (req) => req.body?.client_turn_id
  const learnIdOf = async (id, userId) => {
    const { data } = await supabase.from('learn_conversations').select('id').eq('id', id).eq('user_id', userId).limit(1)
    return data?.[0]?.id ?? null
  }

  return {
    firstReading: guarded((_req, userId) => found(supabase.from('founder_profiles').select('user_id').eq('user_id', userId).not('first_reading', 'is', null))),
    situationStart: guarded((req, userId) => isUuid(turnId(req)) && found(supabase.from('situations').select('id').eq('user_id', userId).eq('create_turn_id', turnId(req)))),
    situationTurn: guarded(async (req, userId) => isUuid(req.params.id) && isUuid(turnId(req)) && await owns('situations', req.params.id, userId)
      && found(supabase.from('situation_turns').select('id').eq('situation_id', req.params.id).eq('client_turn_id', turnId(req)))),
    read: guarded(async (req, userId) => isUuid(req.params.id) && await owns('situations', req.params.id, userId)
      && found(supabase.from('reads').select('id').eq('situation_id', req.params.id))),
    learnStart: guarded(async (req, userId) => {
      if (!isUuid(req.params.id)) return false
      const { data } = await supabase.from('learn_conversations').select('id').eq('situation_id', req.params.id).eq('user_id', userId).limit(1)
      return Boolean(data?.[0]) && found(supabase.from('learn_turns').select('id').eq('conversation_id', data[0].id).eq('kind', 'lesson'))
    }),
    learnTurn: guarded(async (req, userId) => isUuid(req.params.id) && isUuid(turnId(req)) && await owns('learn_conversations', req.params.id, userId)
      && found(supabase.from('learn_turns').select('id').eq('conversation_id', req.params.id).eq('client_turn_id', turnId(req)))),
    followUp: guarded(async (req, userId) => isUuid(req.params.id) && isUuid(req.body?.turn_id) && /^\d$/.test(req.params.n) && await owns('learn_conversations', req.params.id, userId)
      && found(supabase.from('learn_turns').select('id').eq('conversation_id', req.params.id).eq('kind', 'followup').eq('parent_turn_id', req.body.turn_id).eq('followup_index', Number(req.params.n)))),
    moveCreate: guarded(async (req, userId) => isUuid(req.params.id) && Boolean(await learnIdOf(req.params.id, userId))
      && found(supabase.from('moves').select('id').eq('learn_id', req.params.id).neq('status', 'swapped'))),
    swapReplay: guarded((req, userId) => isUuid(req.params.id) && found(supabase.from('moves').select('id').eq('id', req.params.id).eq('user_id', userId).eq('status', 'swapped'))),
  }
}
