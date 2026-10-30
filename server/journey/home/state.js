// Where each of a founder's situations stands, read from stored rows. Shared by
// Home (what was left off, the drawer) and History (the status word). Reads
// only: nothing here writes.
import { PAUSE_AFTER_MS } from '../../push/policy.js'
import { ACTIVE_STATUSES } from '../move/room.js'

export const HISTORY_MAX = 200

const one = async (query) => {
  const { data, error } = await query
  if (error) throw error
  return data
}

// Everything the stage and status need, for these situations, in 4 queries.
export async function loadStates(supabase, userId, situations) {
  const ids = situations.map((s) => s.id)
  if (ids.length === 0) return new Map()
  const [reads, conversations, moves, reports] = await Promise.all([
    one(supabase.from('reads').select().in('situation_id', ids)),
    one(supabase.from('learn_conversations').select().eq('user_id', userId).in('situation_id', ids)),
    one(supabase.from('moves').select().eq('user_id', userId).in('situation_id', ids)),
    one(supabase.from('reports').select().eq('user_id', userId).in('situation_id', ids)),
  ])
  const newest = (rows) => [...rows].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0] ?? null
  const states = new Map()
  for (const s of situations) {
    const own = (rows) => rows.filter((r) => r.situation_id === s.id)
    states.set(s.id, {
      read: own(reads)[0] ?? null,
      learn: own(conversations)[0] ?? null,
      move: newest(own(moves).filter((m) => m.status !== 'swapped')),
      report: newest(own(reports)),
    })
  }
  return states
}

// The screen that picks this situation up: situation, read, learn, move or report.
// Learn covers the lesson and the move offer.
// null once it is done (reported) or its move closed quietly.
export function stageOf(state) {
  const { read, move, report } = state
  if (report) return null
  if (move) {
    if (move.status === 'closed_no_report') return null
    return move.status === 'report_due' ? 'report' : 'move'
  }
  if (!read) return 'situation'
  if (!read.answered_at) return 'read'
  return 'learn'
}

export const isIdle = (situation, nowMs) => nowMs - Date.parse(situation.last_activity_at) >= PAUSE_AFTER_MS

// Paused: marked paused, or quiet for 14 days. No warning, nothing deleted.
export const isPaused = (situation, nowMs) =>
  situation.status === 'paused' || (situation.status === 'open' && isIdle(situation, nowMs))

// open | done | couldnt | didnt | paused. A reported outcome wins.
export function statusOf(situation, state, nowMs) {
  if (state.report) return state.report.outcome
  if (situation.status === 'closed' || state.move?.status === 'closed_no_report' || isPaused(situation, nowMs)) return 'paused'
  return 'open'
}

export const isActiveMove = (move) => ACTIVE_STATUSES.includes(move?.status)
