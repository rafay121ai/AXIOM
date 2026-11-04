// Situations and the Read. All writes go through here, through the injected
// supabase. The 2 follow-up cap is enforced here, not in the prompt: the
// counter moves only by a compare-and-swap update, so concurrent turns can
// never take a third. Tables and columns: see schema_needs.md.
import { LIMITS } from '../config.js'
import { createSignupStore } from './signup.js'
import { buildEvidence } from './firstReading.js'
import { checkHook } from './hooks.js'
import { stripFiller, isFillerReply } from './filler.js'
import { SITUATION_SCHEMA, situationMessages } from './prompts/situation.js'
import { createRead } from './theRead.js'
import { BANNED_PHRASES, norm, wordRx } from './ownWords.js'
import { styleOf } from './prompts/style.js'

export const MAX_NEW_SITUATIONS_PER_DAY = 5
export const TEXT_MAX = 2000
export const MIN_SITUATION_WORDS = 3
const SAY_MORE = 'Say a bit more.'
const TITLE_MAX = 60
const CAS_TRIES = 5
const OPEN_LIST_MAX = 20

export class HttpError extends Error {
  constructor(status, body) {
    super(body.error)
    this.status = status
    this.body = body
  }
}
const notFound = () => new HttpError(404, { error: 'Not found' })

const truncate = (text, n) => {
  const t = String(text).replace(/\s+/g, ' ').trim()
  return t.length <= n ? t : t.slice(0, n).replace(/\s+\S*$/, '')
}
const numbersIn = (text) => String(text).match(/\d+/g) ?? []
// A title is the founder's topic: no banned phrase, no number they did not write.
const titleOk = (title, founderTexts) => {
  const t = norm(title)
  const known = new Set(founderTexts.flatMap(numbersIn))
  return t.length >= 3 && !BANNED_PHRASES.some((b) => wordRx(b).test(t)) && numbersIn(t).every((n) => known.has(n))
}
const OPENER_NOTE = 'Axiom opened this situation with this question. These are not the founder\'s words.'
const busy = () => new HttpError(409, { error: 'This turn is still being processed. Try again in a moment.', code: 'turn_busy' })

export function createSituations({ supabase, callStructured, clock, log = () => {} }) {
  const signup = createSignupStore({ supabase, clock })
  const iso = () => new Date(clock.now()).toISOString()
  const one = async (query) => {
    const { data, error } = await query
    if (error) throw error
    return data
  }

  // ── Reads of stored state ──────────────────────────────────────────────────

  const ownSituation = async (userId, id) => {
    const row = await one(supabase.from('situations').select().eq('id', id).eq('user_id', userId).maybeSingle())
    if (!row) throw notFound()
    return row
  }

  const turnsOf = (situationId) =>
    one(supabase.from('situation_turns').select().eq('situation_id', situationId).order('seq', { ascending: true }))

  const readOf = (situationId) =>
    one(supabase.from('reads').select().eq('situation_id', situationId).maybeSingle())

  // The conversation as the model sees it. Axiom's own opening question is
  // labelled, so it is context and never the founder's words (quote checks
  // read founder turns only).
  const modelTurns = (turns) => turns.filter((t) => !t.filler).map((t, i) => ({
    role: t.role,
    text: t.text,
    ...(i === 0 && t.role === 'axiom' ? { note: OPENER_NOTE } : {}),
  }))

  const founderTextsOf = (turns) => turns.filter((t) => t.role === 'founder' && !t.filler).map((t) => t.text)

  // ── Counting: the follow-up cap and the daily limit ────────────────────────

  // Takes one follow-up if one is left. One conditional update per try: it
  // matches only while the counter still holds the value we read.
  async function takeFollowUp(situation) {
    for (let i = 0; i < CAS_TRIES; i += 1) {
      const current = await one(supabase.from('situations').select('follow_up_count')
        .eq('id', situation.id).eq('user_id', situation.user_id).maybeSingle())
      if (!current || current.follow_up_count >= LIMITS.MAX_FOLLOW_UPS) return false
      const won = await one(supabase.from('situations')
        .update({ follow_up_count: current.follow_up_count + 1, last_activity_at: iso() })
        .eq('id', situation.id).eq('user_id', situation.user_id).eq('follow_up_count', current.follow_up_count)
        .select('id'))
      if (won.length > 0) return true
    }
    return false
  }

  async function newToday(userId) {
    const day = new Date(clock.now()).toISOString().slice(0, 10)
    // Only situations the founder started count: Axiom's openers are not theirs.
    const rows = await one(supabase.from('situations').select('id').eq('user_id', userId).neq('started_by', 'axiom').gte('created_at', `${day}T00:00:00.000Z`))
    return rows.length
  }

  async function openList(userId) {
    const rows = await one(supabase.from('situations').select()
      .eq('user_id', userId).eq('status', 'open').order('last_activity_at', { ascending: false }).limit(OPEN_LIST_MAX))
    return rows.map((s) => ({ id: s.id, title: s.title, follow_up_count: s.follow_up_count, last_activity_at: s.last_activity_at }))
  }

  // ── The model's view of one turn ───────────────────────────────────────────

  // Returns { topic, enough, question, title }. Never throws: a failed model
  // call or a question that will not pass ends in "enough", never in a stall.
  async function assess({ userId, situation, signUpAnswers, turns, followUpsLeft }) {
    const { evidence, answerTexts } = buildEvidence(signUpAnswers)
    const conversation = modelTurns(turns)
    const sources = [...founderTextsOf(turns), ...answerTexts]
    let problems = null
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const { data } = await callStructured({
          step: 'followup',
          schema: SITUATION_SCHEMA,
          schemaName: 'situation_turn',
          maxCompletionTokens: 400,
          userId,
          usageContext: { step: 'followup', kind: 'situation_turn', situation_id: situation.id },
          messages: situationMessages({ signUp: evidence, conversation, followUpsLeft }, problems),
        })
        const enough = (data.has_situation && data.has_detail) || data.missing === 'none'
        const base = { topic: data.topic, title: data.title.trim() }
        if (enough || followUpsLeft <= 0) return { ...base, enough: true, question: null }
        const question = stripFiller(data.question).text
        const verdict = checkHook({ text: question, sources })
        if (verdict.ok && question.length <= 220) return { ...base, enough: false, question }
        problems = verdict.problems
      } catch (err) {
        log('model call failed', err)
        return { topic: 'same', title: null, enough: true, question: null }
      }
    }
    log('follow-up question failed the checks', { problems })
    return { topic: 'same', title: null, enough: true, question: null }
  }

  // ── One founder turn ───────────────────────────────────────────────────────

  async function replayOf(situationId, clientTurnId) {
    const turn = await one(supabase.from('situation_turns').select()
      .eq('situation_id', situationId).eq('client_turn_id', clientTurnId).eq('role', 'founder').maybeSingle())
    if (!turn?.result) throw busy()
    return turn.result
  }

  const state = (situation, count) => ({
    situation_id: situation.id,
    follow_up_count: count,
    follow_ups_left: Math.max(0, LIMITS.MAX_FOLLOW_UPS - count),
  })

  const startSituation = (userId, clientTurnId) =>
    one(supabase.from('situations').insert({
      user_id: userId, title: null, status: 'open', follow_up_count: 0,
      create_turn_id: clientTurnId, created_at: iso(), last_activity_at: iso(),
    }).select().single())

  // Claims the turn id, then decides. `first` marks the opening text of a
  // situation: it needs a real description and can never be a topic change.
  async function runTurn({ userId, situation, text, clientTurnId, first = false }) {
    const filler = isFillerReply(text, { minWords: first ? MIN_SITUATION_WORDS : 1 })
    const say = { ...state(situation, situation.follow_up_count), status: 'say_more', reply: SAY_MORE }
    const claim = await supabase.from('situation_turns').insert({
      situation_id: situation.id, role: 'founder', text, client_turn_id: clientTurnId,
      filler, result: filler ? say : null, created_at: iso(),
    }).select().single()
    if (claim.error?.code === '23505') return replayOf(situation.id, clientTurnId)
    if (claim.error) throw claim.error
    if (filler) return say

    try {
      const result = await decide({ userId, situation, text, clientTurnId, first })
      await one(supabase.from('situation_turns').update({ result }).eq('id', claim.data.id).select('id'))
      return result
    } catch (err) {
      // Free the turn id so the app can send it again.
      await supabase.from('situation_turns').delete().eq('id', claim.data.id)
      throw err
    }
  }

  async function decide({ userId, situation, text, clientTurnId, first }) {
    const [turns, signUp] = await Promise.all([turnsOf(situation.id), signup.load(userId)])
    const before = founderTextsOf(turns).length - 1 // this turn is already stored
    const left = LIMITS.MAX_FOLLOW_UPS - situation.follow_up_count
    const verdict = await assess({ userId, situation, signUpAnswers: signUp.answers, turns, followUpsLeft: left })

    if (!first && verdict.topic === 'new' && before > 0 && (await newToday(userId)) < MAX_NEW_SITUATIONS_PER_DAY) {
      const fresh = await startSituation(userId, clientTurnId)
      try {
        const inner = await runTurn({ userId, situation: fresh, text, clientTurnId, first: true })
        return { ...inner, started_new: true, previous_situation_id: situation.id }
      } catch (err) {
        await supabase.from('situations').delete().eq('id', fresh.id)
        throw err
      }
    }

    let count = situation.follow_up_count
    let question = null
    if (!verdict.enough && (await takeFollowUp(situation))) {
      question = verdict.question
      count += 1
      await one(supabase.from('situation_turns').insert({ situation_id: situation.id, role: 'axiom', text: question, filler: false, result: null, created_at: iso() }).select('id'))
    }
    const fresh = await one(supabase.from('situations').select('follow_up_count, title').eq('id', situation.id).maybeSingle())
    count = Math.max(count, fresh?.follow_up_count ?? 0)
    const title = fresh?.title ?? (verdict.title && titleOk(verdict.title, founderTextsOf(turns)) ? verdict.title : truncate(text, TITLE_MAX))
    await one(supabase.from('situations').update({ title, last_activity_at: iso() }).eq('id', situation.id).select('id'))
    return { ...state(situation, count), title, status: question ? 'follow_up' : 'ready', reply: question }
  }

  // ── Public operations ──────────────────────────────────────────────────────

  // unlimited: a test account, which skips the daily limit.
  async function create({ userId, text, clientTurnId, unlimited = false }) {
    const existing = await one(supabase.from('situations').select().eq('user_id', userId).eq('create_turn_id', clientTurnId).maybeSingle())
    if (existing) return replayOf(existing.id, clientTurnId)

    if (isFillerReply(text, { minWords: MIN_SITUATION_WORDS })) {
      return { situation_id: null, status: 'say_more', reply: SAY_MORE, follow_up_count: 0, follow_ups_left: LIMITS.MAX_FOLLOW_UPS }
    }
    if (!unlimited && (await newToday(userId)) >= MAX_NEW_SITUATIONS_PER_DAY) {
      throw new HttpError(429, {
        error: 'daily_limit',
        message: `You have started ${MAX_NEW_SITUATIONS_PER_DAY} situations today. That is the limit for one day. Pick one of the open ones.`,
        open: await openList(userId),
      })
    }
    let situation
    try {
      situation = await startSituation(userId, clientTurnId)
    } catch (err) {
      if (err?.code !== '23505') throw err
      return create({ userId, text, clientTurnId })
    }
    try {
      return await runTurn({ userId, situation, text, clientTurnId, first: true })
    } catch (err) {
      await supabase.from('situations').delete().eq('id', situation.id)
      throw err
    }
  }

  async function turn({ userId, situationId, text, clientTurnId }) {
    const situation = await ownSituation(userId, situationId)
    const prior = await one(supabase.from('situation_turns').select('id').eq('situation_id', situation.id).eq('client_turn_id', clientTurnId).maybeSingle())
    if (prior) return replayOf(situation.id, clientTurnId)
    if (await readOf(situation.id)) throw new HttpError(409, { error: 'The Read has started for this situation. Start a new one for something else.', code: 'read_started' })
    return runTurn({ userId, situation, text, clientTurnId })
  }

  async function list(userId) {
    return { situations: await openList(userId) }
  }

  async function get(userId, situationId) {
    const situation = await ownSituation(userId, situationId)
    const [turns, read] = await Promise.all([turnsOf(situation.id), readOf(situation.id)])
    return {
      situation: { id: situation.id, title: situation.title, status: situation.status, follow_up_count: situation.follow_up_count, created_at: situation.created_at },
      turns: turns.filter((t) => !t.filler).map((t) => ({ role: t.role, text: t.text, created_at: t.created_at })),
      read: read ? readView(read) : null,
    }
  }

  const readView = (row) => ({
    headline: row.headline, body: row.body, closing_question: row.closing_question,
    answered: row.answered_at !== null, skipped: row.skipped === true,
  })

  async function read({ userId, situationId }) {
    const situation = await ownSituation(userId, situationId)
    const stored = await readOf(situation.id)
    if (stored) return { situation_id: situation.id, ...readView(stored) }

    const turns = await turnsOf(situation.id)
    if (founderTextsOf(turns).length === 0) throw new HttpError(409, { error: 'Tell me what is going on first.', code: 'situation_empty' })
    const { answers } = await signup.load(userId)
    const { read: made, source } = await createRead({
      signUpAnswers: answers,
      situationId: situation.id,
      conversation: modelTurns(turns),
      style: await styleOf(supabase, userId),
      deps: { callStructured, userId, log },
    })
    const inserted = await supabase.from('reads').insert({
      situation_id: situation.id, headline: made.headline, body: made.body,
      closing_question: made.closing_question, source, closing_answer: null, skipped: false, answered_at: null, created_at: iso(),
    }).select().single()
    if (inserted.error?.code === '23505') return { situation_id: situation.id, ...readView(await readOf(situation.id)) }
    if (inserted.error) throw inserted.error
    await one(supabase.from('situations').update({ last_activity_at: iso() }).eq('id', situation.id).select('id'))
    return { situation_id: situation.id, ...readView(inserted.data) }
  }

  // The reply to the closing question, or a skip. First answer wins.
  async function answerRead({ userId, situationId, text, skip }) {
    const situation = await ownSituation(userId, situationId)
    const stored = await readOf(situation.id)
    if (!stored) throw new HttpError(409, { error: 'There is no Read for this situation yet.', code: 'read_missing' })
    if (!skip && isFillerReply(text)) return { status: 'say_more', reply: SAY_MORE }
    const won = await one(supabase.from('reads')
      .update({ closing_answer: skip ? null : text, skipped: Boolean(skip), answered_at: iso() })
      .eq('id', stored.id).is('answered_at', null).select('id'))
    if (won.length > 0) await one(supabase.from('situations').update({ last_activity_at: iso() }).eq('id', situation.id).select('id'))
    return { status: 'stored', situation_id: situation.id, skipped: won.length > 0 ? Boolean(skip) : stored.skipped === true, next: 'learn' }
  }

  return { create, turn, list, get, read, answerRead }
}
