import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import { createApp } from '../../app.js'
import { createFakeClock, createFakeOpenAI, createFakeSupabase } from '../../testing/fakes.js'
import { FULL_ANSWERS } from '../fixtures.js'
import { mountLearnRoutes, createMemoryHintProvider } from './learnRoutes.js'
import { evidenceFromRows, MAX_EVIDENCE } from './retrieve.js'
import { capWords, WORD_CAP } from './reply.js'
import { AXIOM_LINES } from './moveOffer.js'

const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'founder@example.com', user_metadata: { full_name: 'Rafay Essani' } }
const OTHER = { id: '22222222-2222-4222-8222-222222222222', email: 'other@example.com' }
const ENV = { FRONTEND_URL: 'https://app.example.com' }
const NOW = Date.parse('2026-10-26T09:00:00.000Z')
const SIT = '33333333-3333-4333-8333-333333333333'
const FIRST = 'I have a demo ready but I have not emailed the 2 clinics that asked for pricing three weeks ago.'
const READ_ANSWER = "No, I haven't gone back to either since the demo three weeks ago."
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const CHAT_MODEL = 'gpt-5.4-mini-2026-03-17'
const UTILITY_MODEL = 'gpt-4.1-mini'

const MOM_TEST = 'Compliments are worthless. When someone says they will think about it, you have learned nothing. It only counts when they give up something real, such as time, reputation or money.'
const ROWS = [
  { id: uuid(901), pillar: 'move_people', title: 'The Mom Test', author: 'Rob Fitzpatrick', key_frameworks: MOM_TEST, similarity: 0.52 },
  { id: uuid(902), pillar: 'move_people', title: 'The Mom Test', author: 'Rob Fitzpatrick', key_frameworks: 'Ask about their life, not your idea. Facts about the past beat opinions about the future.', similarity: 0.49 },
  { id: uuid(903), pillar: 'move_people', title: 'The Mom Test', author: 'Rob Fitzpatrick', key_frameworks: 'Keep it casual and push for commitment.', similarity: 0.47 },
  { id: uuid(904), pillar: 'move_people', title: 'Never Split the Difference', author: 'Chris Voss', key_frameworks: 'No is the start of the negotiation, not the end of it. Most people hear no and stop.', similarity: 0.41 },
  { id: uuid(905), pillar: 'money_game', title: 'Low Match', author: 'Some One', key_frameworks: 'Unrelated passage.', similarity: 0.12 },
]

// The real database refuses repeated unique keys. The in-memory fake does
// not, so this wrapper does it at insert time.
function withUniqueKeys(supabase) {
  const keys = {
    learn_conversations: [(r) => r.situation_id],
    learn_turns: [
      (r) => (r.client_turn_id ? `${r.conversation_id}|${r.client_turn_id}` : null),
      (r) => (r.parent_turn_id ? `${r.parent_turn_id}|${r.followup_index}` : null),
    ],
  }
  return {
    ...supabase,
    from(table) {
      const builder = supabase.from(table)
      if (!keys[table]) return builder
      const insert = builder.insert.bind(builder)
      builder.insert = (row) => {
        const clash = keys[table].some((key) => key(row) && supabase.rows(table).some((r) => key(r) === key(row)))
        if (clash) {
          const failed = { data: null, error: { code: '23505', message: 'duplicate key' } }
          const chain = { select: () => chain, single: () => chain, maybeSingle: () => chain, then: (res, rej) => Promise.resolve(failed).then(res, rej) }
          return chain
        }
        return insert(row)
      }
      return builder
    },
  }
}

function fakeKnowledge(rows = ROWS) {
  const calls = []
  return { calls, async rpc(name, args) { calls.push({ name, args }); return { data: rows, error: null } } }
}

const seed = ({ answered = true } = {}) => ({
  founder_profiles: [{ user_id: USER.id, signup_answers: FULL_ANSWERS }],
  situations: [{ id: SIT, user_id: USER.id, title: 'Pricing emails to clinics', status: 'open', follow_up_count: 0, created_at: new Date(NOW).toISOString(), last_activity_at: new Date(NOW).toISOString() }],
  situation_turns: [{ id: uuid(800), seq: 1, situation_id: SIT, role: 'founder', text: FIRST, filler: false, created_at: new Date(NOW).toISOString() }],
  reads: [{
    id: uuid(801), situation_id: SIT, headline: 'Nobody has actually said yes or no to this yet.',
    body: 'You wrote that the clinics asked for pricing three weeks ago.', closing_question: 'Have you gone back to either of those clinics since?',
    closing_answer: answered ? READ_ANSWER : null, skipped: false, answered_at: answered ? new Date(NOW).toISOString() : null,
  }],
})

// Slows each model call so two requests overlap (double-tap test).
function slow(openai, ms) {
  const create = openai.chat.completions.create.bind(openai.chat.completions)
  openai.chat.completions.create = async (...args) => { await new Promise((r) => setTimeout(r, ms)); return create(...args) }
  return openai
}

async function setup(script = [], { rows = ROWS, answered = true, delayMs = 0 } = {}) {
  const base = createFakeSupabase({ users: { tok: USER, tok2: OTHER }, tables: seed({ answered }) })
  const supabase = withUniqueKeys(base)
  const openai = createFakeOpenAI(script)
  if (delayMs) slow(openai, delayMs)
  const knowledge = fakeKnowledge(rows)
  const app = createApp({ env: ENV, supabase, knowledgeSupabase: knowledge, openai, clock: createFakeClock(NOW) })
  const server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  const url = `http://127.0.0.1:${server.address().port}`
  const as = (token) => async (method, path, body) => {
    const res = await fetch(`${url}${path}`, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    return { status: res.status, body: text.startsWith('{') ? JSON.parse(text) : text }
  }
  const chatCalls = () => openai.calls.filter((c) => c.payload?.messages)
  const close = () => new Promise((r) => server.close(r))
  return { call: as('tok'), callOther: as('tok2'), callAnon: as(null), openai, chatCalls, knowledge, rows: (t) => base.rows(t), close }
}

const learnReply = (over = {}) => JSON.stringify({
  reply: 'It has been three weeks since either clinic heard from you. Two clinics saw the demo and nothing has been asked of them since. A maybe from them tells you nothing; it only counts when they give up time or money. What would a real yes from one of those clinics be?',
  citations: [{ handle: 'E1', quote: 'you have learned nothing' }],
  picture_json: JSON.stringify({ type: 'timeline', data: { events: [{ when: 'three weeks ago', label: 'Clinics asked for pricing' }, { when: 'Today', label: 'No price sent yet' }] } }),
  follow_ups: ['What if they say no?', 'Give me the exact words to use'],
  move_subject: 'the two clinics',
  move_fact: 'The two clinics have heard nothing from you for three weeks.',
  ...over,
})
const turnReply = (over = {}) => learnReply({
  reply: 'The owner decides, so the ask goes to the owner of the first clinic. Both clinics have waited three weeks for a price. What would you ask that owner for?',
  citations: [], picture_json: '', follow_ups: [], move_subject: '', move_fact: '', ...over,
})
const offerReply = (over = {}) => turnReply({ reply: 'A paid pilot is a real yes from the first clinic, and the owner can give it. Your move is ready.', ...over })

const REAL1 = 'Yes, the owner of the first clinic decides about buying.'
const REAL2 = 'I want a paid pilot from the first clinic this month.'
const REAL3 = 'I will write to the owner tonight after work.'
const REAL4 = 'The second clinic has a manager I can also email.'

async function started(script, opts) {
  const ctx = await setup(script, opts)
  const res = await ctx.call('POST', `/api/situations/${SIT}/learn`)
  return { ...ctx, start: res, id: res.body.learn_id }
}
const sendTurn = (call, id, text, n) => call('POST', `/api/learn/${id}/turn`, { text, client_turn_id: uuid(n) })

// ── Retrieval ────────────────────────────────────────────────────────────────

test('evidence pack: opaque handles, at most 2 per book, low matches dropped, no more than 6', () => {
  const pack = evidenceFromRows(ROWS)
  assert.deepEqual(pack.map((e) => e.handle), ['E1', 'E2', 'E3'])
  assert.deepEqual(pack.map((e) => e.source_title), ['The Mom Test', 'The Mom Test', 'Never Split the Difference'])
  const many = Array.from({ length: 12 }, (_, i) => ({ id: uuid(i + 1), title: `Book ${i}`, author: `Author ${i}`, key_frameworks: 'Some passage text here.', similarity: 0.5 }))
  assert.equal(evidenceFromRows(many).length, MAX_EVIDENCE)
})

test('the word cap cuts at a sentence and keeps the closing question', () => {
  const long = `${'This is a sentence with seven words. '.repeat(40)}What will you ask them for?`
  const cut = capWords(long, WORD_CAP, { keepLast: true })
  assert.ok(cut.split(/\s+/).length <= WORD_CAP)
  assert.ok(cut.endsWith('What will you ask them for?'))
})

// ── Full flow ────────────────────────────────────────────────────────────────

test('full flow: lesson, two real replies, then the first move card', async () => {
  const { call, start, id, chatCalls, knowledge, rows, close } = await started([learnReply(), turnReply(), offerReply()])
  try {
    assert.equal(start.status, 200)
    const lesson = start.body.turn
    assert.equal(start.body.status, 'reply')
    assert.equal(lesson.kind, 'lesson')
    assert.ok(lesson.text.startsWith('It has been three weeks'))
    // Shown exactly as printed, with a leading ellipsis because it starts mid-sentence.
    assert.deepEqual(lesson.sources, [{ author: 'Rob Fitzpatrick', book: 'The Mom Test', quote: '…you have learned nothing' }])
    assert.equal(lesson.picture.type, 'timeline')
    assert.deepEqual(lesson.follow_ups, ['What if they say no?', 'Give me the exact words to use'])
    assert.equal(start.body.move_offer, 'none')
    assert.equal(start.body.offers_left, 2)

    // The model never sees ids, authors or titles; the app never sees evidence.
    const prompt = JSON.stringify(chatCalls()[0].payload.messages)
    assert.ok(!prompt.includes(uuid(901)) && !prompt.includes('Fitzpatrick') && !prompt.includes('Mom Test'))
    assert.ok(prompt.includes('gone back to either since the demo'))
    assert.ok(!JSON.stringify(start.body).match(/chunk|handle|evidence|E1/))
    assert.equal(knowledge.calls[0].name, 'match_wiki_chunks')

    const t1 = await sendTurn(call, id, REAL1, 1)
    assert.equal(t1.body.move_offer, 'none')
    assert.ok(t1.body.turn.text.endsWith('?'))
    const t2 = await sendTurn(call, id, REAL2, 2)
    assert.equal(t2.body.move_offer, 'first')
    assert.deepEqual(t2.body.move_notice, { kind: 'first', kicker: 'Your move', text: 'Your move for the two clinics is ready.' })
    assert.equal(t2.body.offers_made, 1)
    assert.ok(!t2.body.turn.text.includes('?'))

    const citations = rows('lesson_citations')
    assert.equal(citations.length, 1)
    assert.deepEqual(citations[0].chunk_ids, [uuid(901)])
    assert.equal(rows('learn_conversations')[0].lock_token, null)

    const view = await call('GET', `/api/learn/${id}`)
    assert.equal(view.status, 200)
    assert.deepEqual(view.body.turns.map((t) => t.role), ['axiom', 'founder', 'axiom', 'founder', 'axiom'])
    assert.equal(view.body.turns[4].move_offer, 'first')
    assert.ok(!JSON.stringify(view.body).match(/chunk|evidence|validation/))
  } finally { await close() }
})

test('asking what to do next brings the move at once, with no model call', async () => {
  const { call, id, chatCalls, close } = await started([learnReply()])
  try {
    const res = await sendTurn(call, id, 'So what should I do next?', 1)
    assert.equal(res.body.move_offer, 'first')
    assert.equal(res.body.turn.text, AXIOM_LINES.intent)
    assert.equal(res.body.move_notice.text, 'Your move for the two clinics is ready.')
    assert.equal(chatCalls().length, 1)
  } finally { await close() }
})

test('never more than two move cards; then the move waits on the home screen', async () => {
  const { call, id, chatCalls, close } = await started([learnReply(), turnReply(), offerReply(), offerReply(), turnReply({ reply: 'The manager can say yes too, so the second clinic gets the same ask. Who at the second clinic can say yes?' })])
  try {
    await sendTurn(call, id, REAL1, 1)
    assert.equal((await sendTurn(call, id, REAL2, 2)).body.move_offer, 'first')
    const filler = await sendTurn(call, id, 'ok', 3)
    assert.equal(filler.body.status, 'say_more')
    assert.equal(filler.body.reply, 'Say a bit more.')
    const second = await sendTurn(call, id, REAL3, 4)
    assert.equal(second.body.move_offer, 'second')
    assert.deepEqual(second.body.move_notice, {
      kind: 'second', kicker: 'Still waiting', text: 'It takes 10 minutes, Rafay. The two clinics have heard nothing from you for three weeks.',
    })
    assert.equal(second.body.offers_left, 0)
    const after = await sendTurn(call, id, REAL4, 5)
    assert.equal(after.body.move_offer, 'none')
    assert.ok(after.body.turn.text.endsWith(AXIOM_LINES.after_cap))
    const calls = chatCalls().length
    const asks = await sendTurn(call, id, 'what now', 6)
    assert.equal(asks.body.move_offer, 'none')
    assert.equal(asks.body.turn.text, AXIOM_LINES.after_cap)
    assert.equal(chatCalls().length, calls)
  } finally { await close() }
})

test('a repeated client_turn_id returns the stored answer and costs nothing', async () => {
  const { call, id, chatCalls, close } = await started([learnReply(), turnReply()])
  try {
    const a = await sendTurn(call, id, REAL1, 1)
    const b = await sendTurn(call, id, REAL1, 1)
    assert.deepEqual(a.body, b.body)
    assert.equal(chatCalls().length, 2)
  } finally { await close() }
})

test('start: needs the Read answered or skipped; a second start returns the same lesson', async () => {
  const early = await setup([learnReply()], { answered: false })
  try {
    const res = await early.call('POST', `/api/situations/${SIT}/learn`)
    assert.equal(res.status, 409)
    assert.equal(early.chatCalls().length, 0)
  } finally { await early.close() }

  const { call, start, chatCalls, close } = await started([learnReply()])
  try {
    const again = await call('POST', `/api/situations/${SIT}/learn`)
    assert.deepEqual(again.body.turn, start.body.turn)
    assert.equal(chatCalls().length, 1)
  } finally { await close() }
})

// ── Sources and checks ───────────────────────────────────────────────────────

test('no verified source: the reply is built from the founder only, and says nothing about books', async () => {
  const noSource = learnReply({
    reply: 'It has been three weeks since either clinic heard from you. As Rob Fitzpatrick writes in The Mom Test, opinions are worthless. Nothing has been asked of the 2 clinics since the demo. What would a real yes from one of those clinics be?',
    citations: [],
  })
  const { start, chatCalls, close } = await started([noSource, noSource], { rows: [] })
  try {
    assert.equal(start.status, 200)
    const prompt = JSON.parse(chatCalls()[0].payload.messages[2].content)
    assert.deepEqual(prompt.evidence, [])
    assert.deepEqual(start.body.turn.sources, [])
    assert.ok(!/Fitzpatrick|Mom Test|book/i.test(start.body.turn.text))
    assert.ok(start.body.turn.text.includes('three weeks'))
    assert.ok(start.body.turn.text.endsWith('?'))
  } finally { await close() }
})

test('a fabricated quote is stripped, in the citation and in the prose', async () => {
  const fake = learnReply({
    reply: 'It has been three weeks since either clinic heard from you. The lesson is plain: "always ask for money on the first call". What would a real yes from one of those clinics be?',
    citations: [{ handle: 'E1', quote: 'Always ask for money on the first call' }],
  })
  const { start, chatCalls, close } = await started([fake, fake])
  try {
    assert.equal(chatCalls().length, 2)
    const retry = chatCalls()[1].payload.messages.at(-1).content
    assert.match(retry, /word for word/)
    assert.deepEqual(start.body.turn.sources, [{ author: 'Rob Fitzpatrick', book: 'The Mom Test' }])
    assert.ok(!/always ask for money/i.test(start.body.turn.text))
    assert.ok(!/["“”]/.test(start.body.turn.text))
  } finally { await close() }
})

test('an author named in the prose is removed; the source line still comes from the row', async () => {
  const named = learnReply({
    reply: 'It has been three weeks since either clinic heard from you. Fitzpatrick says a maybe from a customer is worth nothing. What would a real yes from one of those clinics be?',
  })
  const { start, close } = await started([named, named])
  try {
    assert.ok(!/Fitzpatrick/.test(start.body.turn.text))
    assert.equal(start.body.turn.sources[0].author, 'Rob Fitzpatrick')
    assert.equal(start.body.turn.sources[0].book, 'The Mom Test')
  } finally { await close() }
})

test('a picture with a number the founder never gave is rejected', async () => {
  const invented = learnReply({
    picture_json: JSON.stringify({ type: 'split_bar', data: { parts: [{ label: 'Clinics that reply', value: 40 }, { label: 'Clinics that do not', value: 60 }] } }),
  })
  const { start, chatCalls, close } = await started([invented])
  try {
    assert.equal(start.body.turn.picture, null)
    assert.equal(chatCalls().length, 1)
  } finally { await close() }
})

test('the reply is held to 200 words', async () => {
  const long = learnReply({ reply: `${'The 2 clinics asked for pricing three weeks ago and heard nothing. '.repeat(25)}What would a real yes from one of those clinics be?` })
  const { start, close } = await started([long, long])
  try {
    const text = start.body.turn.text
    assert.ok(text.split(/\s+/).length <= WORD_CAP)
    assert.ok(text.endsWith('What would a real yes from one of those clinics be?'))
  } finally { await close() }
})

// ── Follow-up taps ───────────────────────────────────────────────────────────

test('a tapped follow-up uses the stored evidence, the follow-up model, and answers once', async () => {
  const answer = turnReply({
    reply: 'If the first clinic says no, ask what would have to change for a yes. A no from the owner is still a real answer after three weeks of silence.',
    citations: [{ handle: 'E3', quote: 'No is the start of the negotiation' }],
    follow_ups: ['Another tap'],
  })
  const { call, id, chatCalls, openai, knowledge, close } = await started([learnReply(), answer])
  try {
    const embeddingsBefore = openai.calls.filter((c) => c.payload?.input).length
    const res = await call('POST', `/api/learn/${id}/followup/0`, { evidence: [{ handle: 'E1', text: 'Client evidence is ignored.' }] })
    assert.equal(res.status, 200)
    assert.equal(res.body.turn.kind, 'followup')
    assert.equal(res.body.turn.followup_index, 0)
    assert.deepEqual(res.body.turn.follow_ups, [])
    assert.deepEqual(res.body.turn.sources, [{ author: 'Chris Voss', book: 'Never Split the Difference', quote: 'No is the start of the negotiation' }])
    const tap = chatCalls()[1].payload
    assert.equal(tap.model, UTILITY_MODEL)
    const input = JSON.parse(tap.messages[2].content)
    assert.equal(input.tapped, 'What if they say no?')
    assert.ok(!JSON.stringify(input.evidence).includes('Client evidence'))
    assert.equal(knowledge.calls.length, 1)
    assert.equal(openai.calls.filter((c) => c.payload?.input).length, embeddingsBefore)

    const again = await call('POST', `/api/learn/${id}/followup/0`)
    assert.deepEqual(again.body.turn, res.body.turn)
    assert.equal(chatCalls().length, 2)
    assert.equal((await call('POST', `/api/learn/${id}/followup/5`)).status, 404)
  } finally { await close() }
})

// ── Usage, locks, ownership, care ────────────────────────────────────────────

test('usage rows: one embedding and one learn call per turn, on the right models', async () => {
  const { call, id, chatCalls, rows, close } = await started([learnReply(), turnReply()])
  try {
    await sendTurn(call, id, REAL1, 1)
    assert.deepEqual(chatCalls().map((c) => c.payload.model), [CHAT_MODEL, CHAT_MODEL])
    const usage = rows('model_usage_logs')
    assert.equal(usage.filter((u) => u.call_type === 'embedding').length, 2)
    assert.equal(usage.filter((u) => u.model === CHAT_MODEL).length, 2)
    assert.ok(usage.every((u) => u.user_id === USER.id))
  } finally { await close() }
})

test('double tap: two turns at once, one is answered and the other is told to wait', async () => {
  const { call, id, rows, close } = await started([learnReply(), turnReply(), turnReply()], { delayMs: 150 })
  try {
    const [a, b] = await Promise.all([sendTurn(call, id, REAL1, 1), sendTurn(call, id, REAL2, 2)])
    assert.deepEqual([a.status, b.status].sort(), [200, 409])
    assert.equal(rows('learn_turns').filter((t) => t.role === 'founder').length, 1)
    assert.equal(rows('learn_conversations')[0].lock_token, null)
  } finally { await close() }
})

test("another founder's situation or conversation is a plain 404", async () => {
  const { id, callOther, callAnon, close } = await started([learnReply()])
  try {
    assert.equal((await callOther('POST', `/api/situations/${SIT}/learn`)).status, 404)
    assert.equal((await callOther('GET', `/api/learn/${id}`)).status, 404)
    assert.equal((await sendTurn(callOther, id, REAL1, 1)).status, 404)
    assert.equal((await callOther('POST', `/api/learn/${id}/followup/0`)).status, 404)
    assert.deepEqual((await callOther('GET', '/api/learn/not-a-uuid')).body, { error: 'Not found' })
    assert.equal((await callAnon('GET', `/api/learn/${id}`)).status, 401)
  } finally { await close() }
})

test('care gate: a clear signal stops the turn before any lesson, move or model call', async () => {
  const { call, id, chatCalls, rows, close } = await started([learnReply()])
  try {
    const res = await sendTurn(call, id, 'I want to kill myself', 1)
    assert.equal(res.body.care, 'clear')
    assert.equal(res.body.turn, undefined)
    assert.equal(res.body.move_offer, undefined)
    assert.equal(chatCalls().length, 1)
    assert.equal(rows('learn_turns').filter((t) => t.role === 'founder').length, 0)
    assert.deepEqual(rows('learn_conversations')[0].offers, [])
  } finally { await close() }
})

// ── Loading hint ─────────────────────────────────────────────────────────────

async function hintServer(provider) {
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { req.user = { id: USER.id }; next() })
  mountLearnRoutes(app, { supabase: null, care: { careHold: (_req, _res, next) => next(), careGate: () => (_req, _res, next) => next() }, callStructured: null, clock: createFakeClock(NOW), hintProvider: provider })
  const server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  const get = async (path) => (await fetch(`http://127.0.0.1:${server.address().port}${path}`)).json()
  return { get, close: () => new Promise((r) => server.close(r)) }
}

test('loading hint: book name and verified quote only, or null', async () => {
  const lesson = { lesson_id: 'mom_l01', source_title: 'The Mom Test', author: 'Rob Fitzpatrick', short_quote: 'you have learned nothing', text: MOM_TEST }
  const fake = { lesson_id: 'x_l01', source_title: 'Made Up', short_quote: 'Never in the passage at all.', text: MOM_TEST }
  const withLessons = await hintServer(createMemoryHintProvider([lesson, fake]))
  try {
    for (const s of ['a', 'b', 'c']) {
      const body = await withLessons.get(`/api/loading-hint?seed=${s}`)
      assert.deepEqual(body, { hint: { book: 'The Mom Test', quote: '…you have learned nothing' } })
    }
  } finally { await withLessons.close() }

  const empty = await hintServer(createMemoryHintProvider())
  try {
    assert.deepEqual(await empty.get('/api/loading-hint'), { hint: null })
  } finally { await empty.close() }

  const { call, callAnon, close } = await setup([])
  try {
    assert.deepEqual((await call('GET', '/api/loading-hint')).body, { hint: null })
    assert.equal((await callAnon('GET', '/api/loading-hint')).status, 401)
  } finally { await close() }
})
