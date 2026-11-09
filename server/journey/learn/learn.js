// The Learn conversation. All writes go through here, through the injected
// supabase. The server decides when the Move is offered (moveOffer.js), never
// the model. One turn at a time per conversation: a lock taken by a
// compare-and-swap update stops double taps. Every founder turn carries a
// client_turn_id; a repeat returns the stored answer. Evidence is stored with
// each Axiom turn and is never sent to the app or accepted from it.
// Tables and columns: see ../schema_needs.md.
import { randomUUID } from 'node:crypto'
import { HttpError } from '../situations.js'
import { retrieveEvidence } from './retrieve.js'
import { searchNeed } from './searchNeed.js'
import { composeReply } from './reply.js'
import { decideMoveOffer, isRealReply, asksWhatNext, MAX_MOVE_OFFERS, MOVE_NOTICE, AXIOM_LINES } from './moveOffer.js'
import { hasMoveRoom, NO_ROOM_LINE } from '../move/room.js'
import { createSharing } from '../report/sharing.js'
import { createFounderLessons } from '../report/founderLessons.js'
import { styleOf } from '../prompts/style.js'

const SAY_MORE = 'Say a bit more.'
export const LOCK_MS = 2 * 60 * 1000

const notFound = () => new HttpError(404, { error: 'Not found' })
const busy = () => new HttpError(409, { error: 'This turn is still being processed. Try again in a moment.', code: 'turn_busy' })

// What the app sees of one Learn turn. Evidence, chunk ids, handles and
// validation flags stay on the server.
export const sourceView = (s) => ({ author: s.author, book: s.book, ...(s.quote ? { quote: s.quote } : {}) })
export function turnView(row) {
  if (row.role === 'founder') return { id: row.id, role: 'founder', text: row.text, created_at: row.created_at }
  return {
    id: row.id,
    role: 'axiom',
    kind: row.kind,
    text: row.text,
    sources: (row.sources ?? []).map(sourceView),
    picture: row.picture ?? null,
    follow_ups: row.follow_ups ?? [],
    move_offer: row.move_offer ?? 'none',
    move_notice: row.move_notice ?? null,
    ...(row.kind === 'followup' ? { for_turn_id: row.parent_turn_id, followup_index: row.followup_index } : {}),
    created_at: row.created_at,
  }
}

export function createLearn({ supabase, knowledgeSupabase = null, embed = null, callStructured, clock, log = () => {} }) {
  const sharing = createSharing({ supabase, clock })
  const founderLessons = createFounderLessons({ supabase, sharing, clock })
  const iso = () => new Date(clock.now()).toISOString()
  const one = async (query) => {
    const { data, error } = await query
    if (error) throw error
    return data
  }

  // ── Stored state ───────────────────────────────────────────────────────────

  const ownSituation = async (userId, id) => {
    const row = await one(supabase.from('situations').select().eq('id', id).eq('user_id', userId).maybeSingle())
    if (!row) throw notFound()
    return row
  }
  const ownConversation = async (userId, id) => {
    const row = await one(supabase.from('learn_conversations').select().eq('id', id).eq('user_id', userId).maybeSingle())
    if (!row) throw notFound()
    return row
  }
  const conversationOf = (situationId) =>
    one(supabase.from('learn_conversations').select().eq('situation_id', situationId).maybeSingle())
  const turnsOf = (conversationId) =>
    one(supabase.from('learn_turns').select().eq('conversation_id', conversationId).order('seq', { ascending: true }))
  const readOf = (situationId) =>
    one(supabase.from('reads').select().eq('situation_id', situationId).maybeSingle())
  const situationTurnsOf = (situationId) =>
    one(supabase.from('situation_turns').select().eq('situation_id', situationId).order('seq', { ascending: true }))

  // ── The lock: one turn at a time per conversation ──────────────────────────

  async function lock(conversation) {
    const token = randomUUID()
    const won = await one(supabase.from('learn_conversations').update({ lock_token: token, locked_at: iso() })
      .eq('id', conversation.id).is('lock_token', null).select('id'))
    if (won.length > 0) return token
    // A lock left by a crashed request is taken over once it is stale.
    const current = await one(supabase.from('learn_conversations').select('lock_token, locked_at').eq('id', conversation.id).maybeSingle())
    if (current?.lock_token && Date.parse(current.locked_at) < clock.now() - LOCK_MS) {
      const taken = await one(supabase.from('learn_conversations').update({ lock_token: token, locked_at: iso() })
        .eq('id', conversation.id).eq('lock_token', current.lock_token).select('id'))
      if (taken.length > 0) return token
    }
    throw busy()
  }
  const unlock = (conversation, token) =>
    supabase.from('learn_conversations').update({ lock_token: null, locked_at: null }).eq('id', conversation.id).eq('lock_token', token)

  async function withLock(conversation, fn) {
    const token = await lock(conversation)
    try {
      return await fn()
    } finally {
      try { await unlock(conversation, token) } catch (err) { log('unlock failed', err) }
    }
  }

  // ── What the model is given ────────────────────────────────────────────────

  // Built from this situation only; the sign-up answers feed only the first reading (Rafay, Nov 9).
  async function contextOf(situation, learnTurns) {
    const [situationTurns, read] = await Promise.all([situationTurnsOf(situation.id), readOf(situation.id)])
    const talkOf = (readTalk) => situationTurns.filter((t) => !t.filler && (t.result?.read_talk === true) === readTalk).map((t) => ({ role: t.role, text: t.text }))
    const situationTalk = talkOf(false)
    const readTalk = talkOf(true)
    const learnTalk = learnTurns.filter((t) => !t.filler && t.kind !== 'followup').map((t) => ({ role: t.role, text: t.text }))
    const founderSaid = [
      ...situationTalk.filter((t) => t.role === 'founder').map((t) => t.text),
      ...(read?.closing_answer ? [read.closing_answer] : []),
      ...readTalk.filter((t) => t.role === 'founder').map((t) => t.text),
    ]
    const learnSaid = learnTalk.filter((t) => t.role === 'founder').map((t) => t.text)
    return {
      prompt: {
        situation: situationTalk,
        read: read
          ? { headline: read.headline, body: read.body, closing_question: read.closing_question, founder_answer: read.closing_answer ?? null, skipped: read.skipped === true, talk_after: readTalk }
          : null,
        learn: learnTalk,
      },
      founderTexts: [...founderSaid, ...learnSaid],
      query: [situation.title, ...founderSaid, learnSaid.at(-1)].filter(Boolean).join('\n'),
    }
  }

  // Retrieval, one model call (two at most), and the stored Axiom turn.
  async function makeTurn({ userId, situation, conversation, mode, step, learnTurns, extra = {}, evidence: given = null, tapped = null }) {
    const ctx = await contextOf(situation, learnTurns)
    const usageContext = { step, kind: `learn_${mode}`, situation_id: situation.id }
    // The library is searched with what the founder needs, written from everything they said, never their raw words.
    const query = given || !knowledgeSupabase || !embed ? ctx.query
      : (await searchNeed({ prompt: ctx.prompt, callStructured, userId, usageContext, log })) ?? ctx.query
    const evidence = given ?? await retrieveEvidence({ knowledgeSupabase, embed, query, userId, usageContext, log })
    const reply = await composeReply({
      mode, step, evidence, founderTexts: ctx.founderTexts, usageContext,
      context: { ...ctx.prompt, ...(tapped ? { tapped } : {}), style: await styleOf(supabase, userId) },
      deps: { callStructured, userId, log },
    })
    const row = await one(supabase.from('learn_turns').insert({
      conversation_id: conversation.id, role: 'axiom', kind: mode === 'offer' ? 'reply' : mode, text: reply.text,
      filler: false, client_turn_id: null, evidence, sources: reply.sources, picture: reply.picture,
      follow_ups: reply.follow_ups, validation: reply.flags, move_offer: 'none', move_notice: null,
      parent_turn_id: null, followup_index: null, result: null, created_at: iso(), ...extra,
    }).select().single())
    if (reply.sources.length) {
      const byHandle = new Map(evidence.map((e) => [e.handle, e]))
      await one(supabase.from('lesson_citations').insert(reply.sources.map((s) => ({
        learn_turn_id: row.id, chunk_ids: [byHandle.get(s.handle).chunk_id], author: s.author, book_title: s.book,
        quote: s.quote ?? null, created_at: iso(),
      }))).select('id'))
    }
    // The newest checked subject and fact feed the move cards.
    const keep = {
      ...(reply.move_subject ? { move_subject: reply.move_subject } : {}),
      ...(reply.move_fact ? { move_fact: reply.move_fact } : {}),
      updated_at: iso(),
    }
    await one(supabase.from('learn_conversations').update(keep).eq('id', conversation.id).select('id'))
    await one(supabase.from('situations').update({ last_activity_at: iso() }).eq('id', situation.id).select('id'))
    return { row, subject: reply.move_subject ?? conversation.move_subject, fact: reply.move_fact ?? conversation.move_fact }
  }

  const offersOf = (conversation) => (Array.isArray(conversation.offers) ? conversation.offers : [])
  const response = (conversation, offers, extra) => ({
    learn_id: conversation.id,
    situation_id: conversation.situation_id,
    offers_made: offers.length,
    offers_left: Math.max(0, MAX_MOVE_OFFERS - offers.length),
    ...extra,
  })

  // ── Start: the lesson ──────────────────────────────────────────────────────

  async function start({ userId, situationId }) {
    const situation = await ownSituation(userId, situationId)
    const read = await readOf(situation.id)
    if (!read || !read.answered_at) throw new HttpError(409, { error: 'Answer or skip the question first.', code: 'read_unanswered' })

    let conversation = await conversationOf(situation.id)
    if (!conversation) {
      const inserted = await supabase.from('learn_conversations').insert({
        situation_id: situation.id, user_id: userId, offers: [], move_subject: null, move_fact: null,
        after_cap_said: false, lock_token: null, locked_at: null, created_at: iso(), updated_at: iso(),
      }).select().single()
      if (inserted.error && inserted.error.code !== '23505') throw inserted.error
      conversation = inserted.error ? await conversationOf(situation.id) : inserted.data
    }

    const lessonOf = (turns) => turns.find((t) => t.kind === 'lesson')
    const done = lessonOf(await turnsOf(conversation.id))
    if (done) return response(conversation, offersOf(conversation), { status: 'reply', turn: turnView(done), move_offer: 'none', move_notice: null })

    return withLock(conversation, async () => {
      const turns = await turnsOf(conversation.id)
      const raced = lessonOf(turns)
      if (raced) return response(conversation, offersOf(conversation), { status: 'reply', turn: turnView(raced), move_offer: 'none', move_notice: null })
      const { row } = await makeTurn({ userId, situation, conversation, mode: 'lesson', step: 'learn', learnTurns: turns })
      return response(conversation, offersOf(conversation), { status: 'reply', turn: turnView(row), move_offer: 'none', move_notice: null })
    })
  }

  // ── A founder reply ────────────────────────────────────────────────────────

  async function replayOf(conversationId, clientTurnId) {
    const turn = await one(supabase.from('learn_turns').select()
      .eq('conversation_id', conversationId).eq('client_turn_id', clientTurnId).eq('role', 'founder').maybeSingle())
    if (!turn?.result) throw busy()
    return turn.result
  }

  async function turn({ userId, learnId, text, clientTurnId, name = null }) {
    const conversation = await ownConversation(userId, learnId)
    const prior = await one(supabase.from('learn_turns').select('id').eq('conversation_id', conversation.id).eq('client_turn_id', clientTurnId).maybeSingle())
    if (prior) return replayOf(conversation.id, clientTurnId)

    return withLock(conversation, async () => {
      const turns = await turnsOf(conversation.id)
      if (!turns.some((t) => t.kind === 'lesson')) throw new HttpError(409, { error: 'The lesson has not started yet.', code: 'lesson_not_started' })
      const fresh = await ownConversation(userId, learnId)
      const offers = offersOf(fresh)
      const real = isRealReply(text)

      const claim = await supabase.from('learn_turns').insert({
        conversation_id: conversation.id, role: 'founder', kind: null, text, filler: !real, client_turn_id: clientTurnId,
        result: null, created_at: iso(),
      }).select().single()
      if (claim.error?.code === '23505') return replayOf(conversation.id, clientTurnId)
      if (claim.error) throw claim.error

      try {
        const answered = real
          ? await answer({ userId, conversation: fresh, offers, turns: [...turns, claim.data], text, name })
          : response(fresh, offers, { status: 'say_more', reply: SAY_MORE, turn: null, move_offer: 'none', move_notice: null })
        const result = real && answered.status === 'reply' ? { ...answered, ...(await founderCaseOf({ userId, conversation: fresh })) } : answered
        await one(supabase.from('learn_turns').update({ result }).eq('id', claim.data.id).select('id'))
        return result
      } catch (err) {
        // Free the turn id so the app can send it again.
        await supabase.from('learn_turns').delete().eq('id', claim.data.id)
        throw err
      }
    })
  }

  // At most one founder case per situation (source key = the conversation),
  // on the first real reply that finds an approved story. Never breaks Learn:
  // care, no story, a closed gate or any failure leave the reply as it is.
  async function founderCaseOf({ userId, conversation }) {
    try {
      const situation = await ownSituation(userId, conversation.situation_id)
      if (await sharing.careTouched(userId, situation)) return {}
      const { story, fresh, founder_lessons: lessons } = await founderLessons.forSource({ userId, sourceKey: `learn:${conversation.id}` })
      return {
        founder_case: fresh && story ? { story: story.story, lesson: story.lesson, outcome: story.outcome } : null,
        ...(lessons ? { founder_lessons: lessons } : {}),
      }
    } catch (err) {
      log('founder case failed', err)
      return {}
    }
  }

  // What the founder said back, oldest first: typed messages and tapped suggestions (a tap counts as a reply,
  // Rafay, Nov 2). A tapped suggestion is its label, read off the turn it was tapped under.
  const repliesOf = (turns) => turns.flatMap((t) => {
    if (t.role === 'founder') return [t.text]
    if (t.kind !== 'followup') return []
    const label = turns.find((p) => p.id === t.parent_turn_id)?.follow_ups?.[t.followup_index]
    return label ? [label] : []
  })

  // The offer for this reply: none while the founder already has 2 moves open (the offer is not used up).
  async function decide({ userId, conversation, offers, turns }) {
    const decision = decideMoveOffer({ replies: repliesOf(turns), offers })
    if (decision.offer !== 'none' && !(await hasMoveRoom({ supabase, userId, nowMs: clock.now(), exceptLearnId: conversation.id }))) {
      return { ...decision, offer: 'none', reason: 'no_room' }
    }
    return decision
  }

  // Puts the move card under `row` and records the offer. Returns { row, made, notice }.
  async function attachOffer({ conversation, offers, decision, row, subject, fact, name }) {
    if (decision.offer === 'none') return { row, made: offers, notice: null }
    const notice = decision.offer === 'first'
      ? { kind: 'first', kicker: MOVE_NOTICE.first.kicker, text: MOVE_NOTICE.first.text({ subject }) }
      : { kind: 'second', kicker: MOVE_NOTICE.second.kicker, text: MOVE_NOTICE.second.text({ name, fact }) }
    const made = [...offers, decision.realReplyCount]
    await one(supabase.from('learn_conversations').update({ offers: made, updated_at: iso() }).eq('id', conversation.id).select('id'))
    const updated = (await one(supabase.from('learn_turns').update({ move_offer: decision.offer, move_notice: notice }).eq('id', row.id).select()))[0]
    return { row: updated, made, notice }
  }

  async function answer({ userId, conversation, offers, turns, text, name }) {
    const situation = await ownSituation(userId, conversation.situation_id)
    const decision = await decide({ userId, conversation, offers, turns })
    const capped = decision.reason === 'cap'

    // A fixed line from the approved mock: no model call.
    const fixedTurn = (line) => one(supabase.from('learn_turns').insert({
      conversation_id: conversation.id, role: 'axiom', kind: 'reply', text: line, filler: false,
      client_turn_id: null, evidence: [], sources: [], picture: null, follow_ups: [], validation: [],
      move_offer: 'none', move_notice: null, parent_turn_id: null, followup_index: null, result: null, created_at: iso(),
    }).select().single())

    let row
    let subject = conversation.move_subject
    let fact = conversation.move_fact
    if (decision.offer !== 'none' && decision.reason === 'intent') {
      // They asked for the move: it comes at once, no lesson in between.
      row = await fixedTurn(AXIOM_LINES.intent)
    } else if (capped && asksWhatNext(text)) {
      row = await fixedTurn(AXIOM_LINES.after_cap)
    } else if (decision.reason === 'no_room' && asksWhatNext(text)) {
      row = await fixedTurn(NO_ROOM_LINE)
    } else {
      const mode = decision.offer === 'none' ? 'reply' : 'offer'
      ;({ row, subject, fact } = await makeTurn({ userId, situation, conversation, mode, step: 'learn', learnTurns: turns }))
      if (capped && !conversation.after_cap_said) {
        // Once, on the first reply after both cards: where the move waits.
        const text2 = `${row.text} ${AXIOM_LINES.after_cap}`
        await one(supabase.from('learn_conversations').update({ after_cap_said: true }).eq('id', conversation.id).select('id'))
        row = (await one(supabase.from('learn_turns').update({ text: text2 }).eq('id', row.id).select()))[0]
      }
    }

    const offered = await attachOffer({ conversation, offers, decision, row, subject, fact, name })
    return response(conversation, offered.made, { status: 'reply', turn: turnView(offered.row), move_offer: decision.offer, move_notice: offered.notice })
  }

  // ── A tapped follow-up suggestion ──────────────────────────────────────────

  // index: 0-based position in the tapped turn's follow_ups. turnId: the Axiom
  // turn whose suggestion was tapped (default: the newest one with any).
  async function followUp({ userId, learnId, index, turnId = null }) {
    const conversation = await ownConversation(userId, learnId)
    const turns = await turnsOf(conversation.id)
    const target = turnId
      ? turns.find((t) => t.id === turnId && t.role === 'axiom' && t.kind !== 'followup')
      : [...turns].reverse().find((t) => t.role === 'axiom' && t.kind !== 'followup' && (t.follow_ups ?? []).length > 0)
    const tapped = target?.follow_ups?.[index]
    if (!tapped) throw notFound()

    const answered = (list) => list.find((t) => t.kind === 'followup' && t.parent_turn_id === target.id && t.followup_index === index)
    const done = answered(turns)
    if (done) return response(conversation, offersOf(conversation), { status: 'reply', turn: turnView(done), move_offer: 'none', move_notice: null })

    return withLock(conversation, async () => {
      const now = await turnsOf(conversation.id)
      const raced = answered(now)
      if (raced) return response(conversation, offersOf(conversation), { status: 'reply', turn: turnView(raced), move_offer: 'none', move_notice: null })
      const situation = await ownSituation(userId, conversation.situation_id)
      const { row, subject, fact } = await makeTurn({
        userId, situation, conversation, mode: 'followup', step: 'followup', learnTurns: now,
        evidence: Array.isArray(target.evidence) ? target.evidence : [], tapped,
        extra: { parent_turn_id: target.id, followup_index: index },
      })
      // The tap counts as a reply, so it can bring the move card too.
      const fresh = await ownConversation(userId, learnId)
      const offers = offersOf(fresh)
      const decision = await decide({ userId, conversation: fresh, offers, turns: [...now, row] })
      const offered = await attachOffer({ conversation: fresh, offers, decision, row, subject, fact })
      return response(fresh, offered.made, { status: 'reply', turn: turnView(offered.row), move_offer: decision.offer, move_notice: offered.notice })
    })
  }

  // ── The whole conversation, for reopening the screen ───────────────────────

  async function get({ userId, learnId }) {
    const conversation = await ownConversation(userId, learnId)
    const turns = await turnsOf(conversation.id)
    return response(conversation, offersOf(conversation), { turns: turns.filter((t) => !t.filler).map(turnView) })
  }

  return { start, turn, followUp, get }
}
