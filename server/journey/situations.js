// Situations and the Read. All writes go through here, through the injected
// supabase. The 2 follow-up cap is enforced here, not in the prompt: the
// counter moves only by a compare-and-swap update, so concurrent turns can
// never take a third. Tables and columns: see schema_needs.md.
import { LIMITS } from '../config.js'
import { checkHook } from './hooks.js'
import { stripFiller, isFillerReply } from './filler.js'
import { SITUATION_SCHEMA, situationMessages } from './prompts/situation.js'
import { READ_TALK_SCHEMA, readTalkMessages } from './prompts/readTalk.js'
import { createRead } from './theRead.js'
import { BANNED_PHRASES, norm, wordRx } from './ownWords.js'
import { styleOf } from './prompts/style.js'
import { loadTrackRecord } from './memory/trackRecord.js'
import { loadBrief } from './memory/brief.js'

export const MAX_NEW_SITUATIONS_PER_DAY = 5
export const TEXT_MAX = 2000
export const MIN_SITUATION_WORDS = 3
const SAY_MORE = 'Say a bit more.'
export const MAX_READ_QUESTIONS = 2
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
const busy = () => new HttpError(409, { error: 'This turn is still being processed. Try again in a moment.', code: 'turn_busy' })

export function createSituations({ supabase, callStructured, clock, log = () => {} }) {
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

  const founderTextsOf = (turns) => turns.filter((t) => t.role === 'founder' && !t.filler).map((t) => t.text)
  // The talk after the Read lives in situation_turns, marked in result (Rafay, Nov 9).
  const isReadTalk = (t) => t.result?.read_talk === true

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
    const rows = await one(supabase.from('situations').select('id').eq('user_id', userId).gte('created_at', `${day}T00:00:00.000Z`))
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
  async function assess({ userId, situation, turns, followUpsLeft }) {
    const conversation = turns.filter((t) => !t.filler).map((t) => ({ role: t.role, text: t.text }))
    const sources = founderTextsOf(turns)
    const brief = await loadBrief(supabase, userId, sources.join('\n'))
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
          messages: situationMessages({ conversation, followUpsLeft, brief }, problems),
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
    const turns = await turnsOf(situation.id)
    const before = founderTextsOf(turns).length - 1 // this turn is already stored
    const left = LIMITS.MAX_FOLLOW_UPS - situation.follow_up_count
    const verdict = await assess({ userId, situation, turns, followUpsLeft: left })

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
      turns: turns.filter((t) => !t.filler && !isReadTalk(t)).map((t) => ({ role: t.role, text: t.text, created_at: t.created_at })),
      read: read ? readView(read, turns) : null,
    }
  }

  // answered: the talk after the Read is over and Learn is next. talk: what was said since the question, to resume it.
  const readView = (row, turns = []) => ({
    headline: row.headline, body: row.body, closing_question: row.closing_question,
    answered: row.answered_at !== null, skipped: row.skipped === true,
    talk: row.answered_at === null && row.closing_answer
      ? [{ role: 'founder', text: row.closing_answer }, ...turns.filter(isReadTalk).map((t) => ({ role: t.role, text: t.text }))]
      : [],
  })

  async function read({ userId, situationId }) {
    const situation = await ownSituation(userId, situationId)
    const stored = await readOf(situation.id)
    if (stored) return { situation_id: situation.id, ...readView(stored, await turnsOf(situation.id)) }

    const turns = await turnsOf(situation.id)
    if (founderTextsOf(turns).length === 0) throw new HttpError(409, { error: 'Tell me what is going on first.', code: 'situation_empty' })
    const { read: made, source } = await createRead({
      situationId: situation.id,
      conversation: turns.filter((t) => !t.filler).map((t) => ({ role: t.role, text: t.text })),
      style: await styleOf(supabase, userId),
      trackRecord: await loadTrackRecord(supabase, userId, log),
      brief: await loadBrief(supabase, userId, founderTextsOf(turns).join('\n')),
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

  // The reply to the closing question, a reply in the talk after it, or a skip.
  // Axiom asks at most MAX_READ_QUESTIONS more questions, then Learn is next
  // (Rafay, Nov 9). answered_at marks the talk as over. overCap: at the daily
  // cost limit the answer is still saved, only the question is skipped.
  async function answerRead({ userId, situationId, text, skip, overCap = false }) {
    const situation = await ownSituation(userId, situationId)
    const stored = await readOf(situation.id)
    if (!stored) throw new HttpError(409, { error: 'There is no Read for this situation yet.', code: 'read_missing' })
    const toLearn = (row) => ({ status: 'stored', situation_id: situation.id, skipped: row.skipped === true, next: 'learn' })
    if (stored.answered_at) return toLearn(stored)
    if (!skip && isFillerReply(text)) return { status: 'say_more', reply: SAY_MORE }
    // Skipping after answering the Read's question only ends the talk; the answer stays.
    if (skip) return toLearn(await finishRead(situation, stored, stored.closing_answer ? {} : { skipped: true }))

    if (!stored.closing_answer) {
      // First answer wins; a second tap that lost the race carries on with the stored one.
      await one(supabase.from('reads').update({ closing_answer: text }).eq('id', stored.id).is('closing_answer', null).select('id'))
    } else {
      const talk = (await turnsOf(situation.id)).filter(isReadTalk)
      // shortcut: a resend of the same text after a dropped reply is not stored twice; no client turn id on this route yet.
      const last = talk.at(-1)
      if (!(last?.role === 'founder' && last.text === text)) {
        await one(supabase.from('situation_turns').insert({ situation_id: situation.id, role: 'founder', text, filler: false, result: { read_talk: true }, created_at: iso() }).select('id'))
      }
    }
    await one(supabase.from('situations').update({ last_activity_at: iso() }).eq('id', situation.id).select('id'))

    const [row, turns] = await Promise.all([readOf(situation.id), turnsOf(situation.id)])
    const asked = turns.filter((t) => isReadTalk(t) && t.role === 'axiom').length
    const question = overCap || asked >= MAX_READ_QUESTIONS ? null : await nextReadQuestion({ userId, situation, row, turns, questionsLeft: MAX_READ_QUESTIONS - asked })
    if (!question) return toLearn(await finishRead(situation, row, {}))
    await one(supabase.from('situation_turns').insert({ situation_id: situation.id, role: 'axiom', text: question, filler: false, result: { read_talk: true }, created_at: iso() }).select('id'))
    return { status: 'talk', situation_id: situation.id, reply: question }
  }

  async function finishRead(situation, row, fields) {
    await one(supabase.from('reads').update({ ...fields, answered_at: iso() }).eq('id', row.id).is('answered_at', null).select('id'))
    return readOf(situation.id)
  }

  // The next question in the talk after the Read, or null when Learn should start.
  // Any model failure, or a question that fails the checks twice, means Learn: the talk never blocks the journey.
  async function nextReadQuestion({ userId, situation, row, turns, questionsLeft }) {
    const talk = [{ role: 'founder', text: row.closing_answer }, ...turns.filter(isReadTalk).map((t) => ({ role: t.role, text: t.text }))]
    const situationTalk = turns.filter((t) => !t.filler && !isReadTalk(t)).map((t) => ({ role: t.role, text: t.text }))
    const sources = [...founderTextsOf(turns), row.closing_answer]
    const brief = await loadBrief(supabase, userId, sources.join('\n'))
    let problems = null
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const { data } = await callStructured({
          step: 'followup',
          schema: READ_TALK_SCHEMA,
          schemaName: 'read_talk',
          maxCompletionTokens: 400,
          userId,
          usageContext: { step: 'followup', kind: 'read_talk', situation_id: situation.id },
          messages: readTalkMessages({ situation: situationTalk, read: { headline: row.headline, body: row.body, closing_question: row.closing_question }, talk, questionsLeft, brief }, problems),
        })
        // The server decides: Learn starts only when the goal, the blocker and one concrete detail are all known.
        if (data.knows_goal && data.knows_blocker && data.knows_detail) return null
        const question = stripFiller(data.question).text
        const verdict = checkHook({ text: question, sources })
        if (verdict.ok && question.length <= 220) return question
        problems = verdict.problems
      } catch (err) {
        log('model call failed', err)
        return null
      }
    }
    log('read talk question failed the checks', { problems })
    return null
  }

  return { create, turn, list, get, read, answerRead }
}
