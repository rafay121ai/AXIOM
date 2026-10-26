// Room for a move: at most 2 committed moves per founder (LIMITS.MAX_ACTIVE_MOVES).
// Learn asks this before it offers a move card; the Move service asks it before
// it writes one. The hard limit is the commit itself (moveService.js), which
// takes one of 2 numbered slots that the database keeps unique per founder.
import { LIMITS } from '../../config.js'

// Moves that hold a slot: committed and not yet reported or closed.
export const ACTIVE_STATUSES = Object.freeze(['committed', 'report_due'])

// Axiom's line when the founder asks for a move and both slots are taken.
export const NO_ROOM_LINE = `You have ${LIMITS.MAX_ACTIVE_MOVES} moves open. Tell me how one of them went first, then I will give you the next.`

// Active moves of this founder, past their report window or not yet closed
// excluded. exceptLearnId: a move already made for this Learn conversation
// does not count against it (its card opens that move).
export async function activeMoves({ supabase, userId, nowMs, exceptLearnId = null }) {
  const { data, error } = await supabase.from('moves').select('id, learn_id, title, status, closes_at')
    .eq('user_id', userId).in('status', ACTIVE_STATUSES)
  if (error) throw error
  const now = new Date(nowMs).toISOString()
  return (data ?? []).filter((m) => m.closes_at > now && (!exceptLearnId || m.learn_id !== exceptLearnId))
}

export async function hasMoveRoom(args) {
  return (await activeMoves(args)).length < LIMITS.MAX_ACTIVE_MOVES
}
