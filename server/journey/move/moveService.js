// The Move: create it from the Learn conversation, show it, commit it, swap it
// once, list the open ones, and close quietly what was never reported. All
// writes go through here, through the injected supabase. Rules enforced in
// code, not in the prompt:
// - a move is written only after Learn offered one, and only with room;
// - it is shown only when moveChecks.js and the experiment validator pass,
//   and the validator runs again at commit;
// - at most 2 committed moves per founder: a commit takes slot 1 or 2, and the
//   database keeps (user_id, active_slot) unique, so concurrent commits can
//   never take a third;
// - one swap per move, with a real reason;
// - commit sets report_due_at (the founder's check-in time, default 8 pm
//   local, never later than 48 hours) and closes_at (48 hours);
// - no strikes, warnings or removal: an unreported move closes quietly.
// Tables and columns: see ../schema_needs.md.
import { LIMITS } from '../../config.js'
import { createSignupStore } from '../signup.js'
import { buildEvidence } from '../firstReading.js'
import { HttpError } from '../situations.js'
import { checkMove, experimentOf, isRealSwapReason, NEED_REASON } from './moveChecks.js'
import { validateExperimentQuality } from '../../experimentQuality.js'
import { MOVE_SCHEMA, moveMessages } from './prompts/move.js'
import { activeMoves, ACTIVE_STATUSES, NO_ROOM_LINE } from './room.js'
import { reportDueAt, REPORT_WINDOW_MS } from './schedule.js'
import { styleOf } from '../prompts/style.js'

export const OPEN_STATUSES = Object.freeze(['draft', ...ACTIVE_STATUSES])
const SWAPPABLE = new Set(['draft', 'committed'])
const SLOTS = Array.from({ length: LIMITS.MAX_ACTIVE_MOVES }, (_, i) => i + 1)
const MAX_SWAPS = 1

const notFound = () => new HttpError(404, { error: 'Not found' })
const failed = () => new HttpError(503, { error: 'Something went wrong. Try again.' })
const noRoom = (moves) => new HttpError(409, {
  error: 'move_cap', code: 'move_cap', message: NO_ROOM_LINE, moves: moves.map((m) => ({ id: m.id, title: m.title, status: m.status })),
})

// What the app sees of a move. The hypothesis, validator result, swap reason
// and slot stay on the server.
export function moveView(row) {
  return {
    id: row.id,
    learn_id: row.learn_id,
    situation_id: row.situation_id,
    status: row.status,
    title: row.title,
    mission: row.mission,
    success: row.success_condition,
    words: row.words || null,
    checklist: row.checklist ?? [],
    prediction: row.prediction,
    start_minutes: row.start_minutes,
    can_swap: SWAPPABLE.has(row.status) && (row.swap_count ?? 0) < MAX_SWAPS,
    swapped_from: row.swapped_from ?? null,
    committed_at: row.committed_at ?? null,
    report_due_at: row.report_due_at ?? null,
    report_time_local: row.report_time_local ?? null,
    time_zone: row.time_zone ?? null,
    created_at: row.created_at,
  }
}

export function createMoves({ supabase, callStructured, clock, log = () => {} }) {
  const signup = createSignupStore({ supabase, clock })
  const iso = (ms = clock.now()) => new Date(ms).toISOString()
  const one = async (query) => {
    const { data, error } = await query
    if (error) throw error
    return data
  }

  // ── Stored state ───────────────────────────────────────────────────────────

  const ownMove = async (userId, id) => {
    const row = await one(supabase.from('moves').select().eq('id', id).eq('user_id', userId).maybeSingle())
    if (!row) throw notFound()
    return row
  }
  const ownConversation = async (userId, id) => {
    const row = await one(supabase.from('learn_conversations').select().eq('id', id).eq('user_id', userId).maybeSingle())
    if (!row) throw notFound()
    return row
  }
  // The newest move of a Learn conversation that was not swapped away.
  const currentMoveOf = async (learnId) => {
    const rows = await one(supabase.from('moves').select().eq('learn_id', learnId).neq('status', 'swapped')
      .order('created_at', { ascending: false }).limit(1))
    return rows[0] ?? null
  }
  const replacementOf = (moveId) => one(supabase.from('moves').select().eq('swapped_from', moveId).maybeSingle())

  // Moves past their report time become report_due; moves past their 48-hour
  // window close quietly and free their slot. Nothing else changes: no strike,
  // no warning, no removal.
  async function settle(userId) {
    const now = iso()
    await one(supabase.from('moves').update({ status: 'closed_no_report', active_slot: null, closed_at: now, updated_at: now })
      .eq('user_id', userId).in('status', ACTIVE_STATUSES).lte('closes_at', now).select('id'))
    await one(supabase.from('moves').update({ status: 'report_due', updated_at: now })
      .eq('user_id', userId).eq('status', 'committed').lte('report_due_at', now).select('id'))
  }

  // ── Writing a move ─────────────────────────────────────────────────────────

  async function contextOf(userId, conversation) {
    const [situationTurns, read, learnTurns, { answers }] = await Promise.all([
      one(supabase.from('situation_turns').select().eq('situation_id', conversation.situation_id).order('seq', { ascending: true })),
      one(supabase.from('reads').select().eq('situation_id', conversation.situation_id).maybeSingle()),
      one(supabase.from('learn_turns').select().eq('conversation_id', conversation.id).order('seq', { ascending: true })),
      signup.load(userId),
    ])
    const { evidence: signUp, answerTexts } = buildEvidence(answers)
    const talkOf = (readTalk) => situationTurns.filter((t) => !t.filler && (t.result?.read_talk === true) === readTalk).map((t) => ({ role: t.role, text: t.text }))
    const situation = talkOf(false)
    const readTalk = talkOf(true)
    const learn = learnTurns.filter((t) => !t.filler && t.kind !== 'followup').map((t) => ({ role: t.role, text: t.text }))
    return {
      prompt: {
        signUp,
        situation,
        read: read ? { headline: read.headline, body: read.body, closing_question: read.closing_question, founder_answer: read.closing_answer ?? null, talk_after: readTalk } : null,
        learn,
        subject: conversation.move_subject,
        fact: conversation.move_fact,
      },
      founderTexts: [
        ...answerTexts,
        ...situation.filter((t) => t.role === 'founder').map((t) => t.text),
        ...(read?.closing_answer ? [read.closing_answer] : []),
        ...readTalk.filter((t) => t.role === 'founder').map((t) => t.text),
        ...learn.filter((t) => t.role === 'founder').map((t) => t.text),
      ],
    }
  }

  // One model call, a second naming the problems. Nothing is shown unless
  // every check passes.
  async function compose({ userId, conversation, kind, swap = null }) {
    const ctx = await contextOf(userId, conversation)
    const style = await styleOf(supabase, userId)
    const founderTexts = swap ? [...ctx.founderTexts, swap.reason] : ctx.founderTexts
    let problems = null
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      let data
      try {
        ;({ data } = await callStructured({
          step: 'move',
          schema: MOVE_SCHEMA,
          schemaName: 'move',
          maxCompletionTokens: 900,
          userId,
          usageContext: { step: 'move', kind, situation_id: conversation.situation_id },
          messages: moveMessages({ ...ctx.prompt, ...(swap ? { swap } : {}), style }, problems),
        }))
      } catch (err) {
        log('model call failed', err)
        throw failed()
      }
      const verdict = checkMove({ data, founderTexts })
      if (verdict.problems.length === 0) return verdict
      problems = verdict.problems
    }
    log('move failed the checks twice', { problems })
    throw failed()
  }

  const rowOf = ({ move, validation }, base) => ({
    ...base,
    status: 'draft',
    title: move.title,
    mission: move.mission,
    success_condition: move.success,
    words: move.words,
    checklist: move.checklist,
    prediction: move.prediction,
    hypothesis: move.hypothesis,
    start_minutes: move.start_minutes,
    validation,
    active_slot: null,
    committed_at: null,
    report_due_at: null,
    report_time_local: null,
    time_zone: null,
    closes_at: null,
    closed_at: null,
    swap_reason: null,
    swapped_at: null,
    created_at: iso(),
    updated_at: iso(),
  })

  // ── Public operations ──────────────────────────────────────────────────────

  // The move behind Learn's card. The same conversation always returns the same
  // move (a repeat costs no model call).
  async function create({ userId, learnId }) {
    const conversation = await ownConversation(userId, learnId)
    await settle(userId)
    const existing = await currentMoveOf(conversation.id)
    if (existing) return { move: moveView(existing) }
    if (!Array.isArray(conversation.offers) || conversation.offers.length === 0) {
      throw new HttpError(409, { error: 'The move is not ready yet.', code: 'move_not_ready' })
    }
    const active = await activeMoves({ supabase, userId, nowMs: clock.now() })
    if (active.length >= LIMITS.MAX_ACTIVE_MOVES) throw noRoom(active)

    const made = await compose({ userId, conversation, kind: 'move_create' })
    const inserted = await supabase.from('moves').insert(rowOf(made, {
      user_id: userId, situation_id: conversation.situation_id, learn_id: conversation.id, swap_count: 0, swapped_from: null,
    })).select().single()
    if (inserted.error?.code === '23505') return { move: moveView(await currentMoveOf(conversation.id)) }
    if (inserted.error) throw inserted.error
    return { move: moveView(inserted.data) }
  }

  async function get({ userId, moveId }) {
    await settle(userId)
    return { move: moveView(await ownMove(userId, moveId)) }
  }

  // Open moves for the home screen: drafts waiting to be committed, committed
  // moves, and moves whose report is due. room: whether a new one can be committed.
  async function listActive({ userId }) {
    await settle(userId)
    const rows = await one(supabase.from('moves').select().eq('user_id', userId).in('status', OPEN_STATUSES)
      .order('created_at', { ascending: true }))
    const committed = rows.filter((r) => ACTIVE_STATUSES.includes(r.status)).length
    return { moves: rows.map(moveView), room: committed < LIMITS.MAX_ACTIVE_MOVES, max_active: LIMITS.MAX_ACTIVE_MOVES }
  }

  // timeZone: the phone's time zone, used when the founder has none saved.
  async function commit({ userId, moveId, timeZone = null }) {
    const move = await ownMove(userId, moveId)
    if (ACTIVE_STATUSES.includes(move.status)) return committedView(move)
    if (move.status !== 'draft') throw new HttpError(409, { error: 'You already started this move.', code: 'move_not_committable' })
    if (!validateExperimentQuality(experimentOf({ ...move, success: move.success_condition })).ok) throw failed()

    await settle(userId)
    const { data: profile } = await supabase.from('founder_profiles').select('report_time_local, timezone').eq('user_id', userId).maybeSingle()
    const nowMs = clock.now()
    const due = reportDueAt({ nowMs, timeLocal: profile?.report_time_local ?? null, timeZone: profile?.timezone || timeZone })
    const fields = {
      status: 'committed', committed_at: iso(nowMs), report_due_at: iso(due.at), report_time_local: due.local_time,
      time_zone: due.time_zone, closes_at: iso(nowMs + REPORT_WINDOW_MS), updated_at: iso(nowMs),
    }
    for (const slot of SLOTS) {
      const won = await supabase.from('moves').update({ ...fields, active_slot: slot })
        .eq('id', move.id).eq('user_id', userId).eq('status', 'draft').select()
      if (won.error?.code === '23505') continue // that slot is taken
      if (won.error) throw won.error
      if (won.data.length > 0) return committedView(won.data[0])
      // Someone else changed it first (a double tap): answer from what is stored.
      const now = await ownMove(userId, move.id)
      if (ACTIVE_STATUSES.includes(now.status)) return committedView(now)
      throw new HttpError(409, { error: 'You already started this move.', code: 'move_not_committable' })
    }
    throw noRoom(await activeMoves({ supabase, userId, nowMs }))
  }
  const committedView = (row) => ({ move: moveView(row), report: { due_at: row.report_due_at, local_time: row.report_time_local, time_zone: row.time_zone } })

  // One change per move, with a real reason. The old move is kept, marked
  // swapped; the new one is a draft to commit.
  async function swap({ userId, moveId, reason }) {
    const move = await ownMove(userId, moveId)
    if (move.status === 'swapped') {
      const replacement = await replacementOf(move.id)
      if (!replacement) throw new HttpError(409, { error: 'This move is still being changed. Try again in a moment.', code: 'move_changing' })
      return { status: 'swapped', replaced_id: move.id, move: moveView(replacement) }
    }
    if (!SWAPPABLE.has(move.status)) throw new HttpError(409, { error: 'You already started this move.', code: 'move_not_changeable' })
    if ((move.swap_count ?? 0) >= MAX_SWAPS) throw new HttpError(409, { error: 'swap_used', code: 'swap_used', message: 'You have changed this move once already.' })
    if (!isRealSwapReason(reason)) return { status: 'need_reason', reply: NEED_REASON }

    const conversation = await ownConversation(userId, move.learn_id)
    const made = await compose({
      userId, conversation, kind: 'move_swap', swap: { previous: { title: move.title, mission: move.mission }, reason },
    })
    const now = iso()
    const claimed = await one(supabase.from('moves')
      .update({ status: 'swapped', active_slot: null, swap_reason: reason, swapped_at: now, updated_at: now })
      .eq('id', move.id).eq('user_id', userId).eq('status', move.status).eq('swap_count', move.swap_count ?? 0).select('id'))
    if (claimed.length === 0) return swap({ userId, moveId, reason })

    const inserted = await supabase.from('moves').insert(rowOf(made, {
      user_id: userId, situation_id: move.situation_id, learn_id: move.learn_id, swap_count: (move.swap_count ?? 0) + 1, swapped_from: move.id,
    })).select().single()
    if (inserted.error?.code === '23505') return { status: 'swapped', replaced_id: move.id, move: moveView(await replacementOf(move.id)) }
    if (inserted.error) {
      // Put the old move back as it was, so nothing is lost.
      await supabase.from('moves').update({
        status: move.status, active_slot: move.active_slot ?? null, swap_reason: null, swapped_at: null, updated_at: iso(),
      }).eq('id', move.id).eq('status', 'swapped')
      throw inserted.error
    }
    return { status: 'swapped', replaced_id: move.id, move: moveView(inserted.data) }
  }

  return { create, get, listActive, commit, swap, settle }
}
