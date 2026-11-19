// A clear care signal retires what the per-message memory pass learned from that
// situation's messages (Rafay, Nov 19). Never deletes: the item is marked superseded
// (dropped for a thread) and its receipts stay. An item also backed by sign-up, a report
// or another situation stays. Background only (scheduleMemory); every query is scoped to one founder.
import { isUuid } from '../../writeValidation.js'
import { scheduleMemory } from './extractBeliefs.js'

const RETIRED = { founder_beliefs: ['active', 'superseded'], founder_traits: ['active', 'superseded'], founder_world: ['active', 'superseded'], founder_vocabulary: ['active', 'superseded'], founder_threads: ['open', 'dropped'] }
const KINDS = ['situation', 'read', 'learn', 'swap', 'move']

const ok = async (query) => {
  const { data, error } = await query
  if (error) throw error
  return data ?? []
}
const ids = (rows) => rows.map((r) => r.id)

// The situation a care-stopped request belongs to: the id is a situation, a learn conversation or a move of this founder. Null otherwise.
export async function situationOfRequest({ supabase, userId, refs }) {
  for (const id of [...new Set(refs)].filter(isUuid)) {
    const hit = (await ok(supabase.from('situations').select('id').eq('id', id).eq('user_id', userId).limit(1)))[0]
      ?? (await ok(supabase.from('learn_conversations').select('situation_id').eq('id', id).eq('user_id', userId).limit(1)))[0]
      ?? (await ok(supabase.from('moves').select('situation_id').eq('id', id).eq('user_id', userId).limit(1)))[0]
    if (hit) return hit.situation_id ?? hit.id
  }
  return null
}

export async function retireSituationMemory({ supabase, userId, situationId, log = () => {} }) {
  try {
    if (!userId || !isUuid(situationId)) return { retired: 0 }
    if ((await ok(supabase.from('situations').select('id').eq('id', situationId).eq('user_id', userId).limit(1))).length === 0) return { retired: 0 }
    const conversations = ids(await ok(supabase.from('learn_conversations').select('id').eq('situation_id', situationId).eq('user_id', userId)))
    const sources = new Set([
      ...ids(await ok(supabase.from('situation_turns').select('id').eq('situation_id', situationId))),
      ...ids(await ok(supabase.from('reads').select('id').eq('situation_id', situationId))),
      ...ids(await ok(supabase.from('moves').select('id').eq('situation_id', situationId).eq('user_id', userId))),
      ...conversations,
      ...(conversations.length ? ids(await ok(supabase.from('learn_turns').select('id').in('conversation_id', conversations))) : []),
    ])
    if (sources.size === 0) return { retired: 0 }
    const touched = await ok(supabase.from('memory_evidence').select('item_table, item_id').eq('user_id', userId).in('source_kind', KINDS).in('source_id', [...sources]))
    let retired = 0
    for (const [table, [from, to]] of Object.entries(RETIRED)) {
      const candidates = [...new Set(touched.filter((e) => e.item_table === table).map((e) => e.item_id))]
      if (candidates.length === 0) continue
      const all = await ok(supabase.from('memory_evidence').select('item_id, source_kind, source_id').eq('user_id', userId).eq('item_table', table).in('item_id', candidates))
      const outside = new Set(all.filter((e) => !KINDS.includes(e.source_kind) || !sources.has(e.source_id)).map((e) => e.item_id))
      const only = candidates.filter((id) => !outside.has(id))
      if (only.length === 0) continue
      retired += (await ok(supabase.from(table).update({ status: to }).eq('user_id', userId).eq('status', from).in('id', only).select('id'))).length
    }
    return { retired }
  } catch (err) {
    log('memory retire failed', err)
    return { retired: 0 }
  }
}

// The care gate's after-care step: scheduled, never awaited, so the help message is not delayed.
export const retireAfterCare = ({ supabase, userId, level, refs, log }) => {
  if (level !== 'clear') return null
  return scheduleMemory(async () => {
    const situationId = await situationOfRequest({ supabase, userId, refs })
    if (situationId) await retireSituationMemory({ supabase, userId, situationId, log })
  }, log)
}
