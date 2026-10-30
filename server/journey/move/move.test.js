import assert from 'node:assert/strict'
import test from 'node:test'
import { createApp } from '../../app.js'
import { createFakeClock, createFakeOpenAI, createFakeSupabase } from '../../testing/fakes.js'
import { FULL_ANSWERS } from '../fixtures.js'
import { checkMove, isRealSwapReason, NEED_REASON } from './moveChecks.js'
import { reportDueAt, REPORT_WINDOW_MS } from './schedule.js'
import { NO_ROOM_LINE } from './room.js'

const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'founder@example.com' }
const OTHER = { id: '22222222-2222-4222-8222-222222222222', email: 'other@example.com' }
const ENV = { FRONTEND_URL: 'https://app.example.com' }
const NOW = Date.parse('2026-10-26T09:00:00.000Z') // 2 pm in Karachi
const HOUR = 60 * 60 * 1000
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const SIT = uuid(100)
const LEARN = uuid(200)
const FIRST = 'I have a demo ready but I have not emailed the 2 clinics that asked for pricing three weeks ago.'
const at = (ms) => new Date(ms).toISOString()

const MOVE = {
  title: 'Ask both clinics that asked for pricing for a call.',
  mission: 'Email the 2 clinics that asked for pricing and ask each for a 20-minute call.',
  success: 'Both clinics reply with a day and time for the call.',
  words: 'I have the pricing you asked for. Can we book 20 minutes to go through it?',
  checklist: ['Open the last email from each clinic', 'Paste the wording and make it sound like you', 'Send it to both clinics'],
  prediction: 'At least one of the clinics will not reply. That is also an answer.',
  hypothesis: 'Tests whether the clinics will reply with a day and time when asked directly.',
  start_minutes: 5,
}
const moveJson = (over = {}) => JSON.stringify({ ...MOVE, ...over })
const FOUNDER_TEXTS = [FIRST, 'I am building scheduling software for dental clinics in Karachi.']

// ── Pure checks ──────────────────────────────────────────────────────────────

test('a move that keeps every rule passes the validator and the checks', () => {
  const { problems, validation, move } = checkMove({ data: MOVE, founderTexts: FOUNDER_TEXTS })
  assert.deepEqual(problems, [])
  assert.equal(validation.ok, true)
  assert.equal(move.checklist.length, 3)
})

test('the experiment validator rejects a move with no yes or no answer', () => {
  const { problems, validation } = checkMove({ data: { ...MOVE, success: 'You feel clearer about the clinics.' }, founderTexts: FOUNDER_TEXTS })
  assert.equal(validation.reason, 'vague_success_condition')
  assert.ok(problems.length > 0)
})

test('own facts, start, and only-variable rules', () => {
  const problemsOf = (over) => checkMove({ data: { ...MOVE, ...over }, founderTexts: FOUNDER_TEXTS }).problems.join(' | ')
  assert.match(problemsOf({ mission: 'Email the 5 clinics that asked for pricing and ask each for a call.' }), /never gave: 5/)
  assert.match(problemsOf({ mission: 'Email the 2 clinics that asked for pricing by Friday and ask for a call.' }), /deadline/)
  assert.match(problemsOf({ mission: 'Wait for the clinics to email you, then send the pricing.' }), /start it alone/)
  assert.match(problemsOf({ mission: 'Get your cofounder to email the 2 clinics that asked for pricing.' }), /start it alone/)
  assert.match(problemsOf({ start_minutes: 30 }), /within 10 minutes/)
  assert.match(problemsOf({ title: 'Send a short email to them.', mission: 'Send an email to them and ask for a call.' }), /nothing from this founder/)
  // A leading banned phrase is stripped; a sentence holding one is dropped.
  const cleaned = checkMove({ data: { ...MOVE, prediction: 'Absolutely, one of the clinics will not reply.' }, founderTexts: FOUNDER_TEXTS })
  assert.equal(cleaned.move.prediction, 'One of the clinics will not reply.')
  assert.match(problemsOf({ prediction: 'One of the clinics will reply, of course.' }), /prediction is empty/)
})

test('a swap needs a real reason; "I\'m busy" is not one', () => {
  for (const r of ["I'm busy", 'busy', 'ok', 'no time', "I'm too tired", "don't feel like it"]) assert.equal(isRealSwapReason(r), false, r)
  for (const r of ['I only have their email', "The clinics' owner is away until Monday", "I'm busy today but I only have their phone numbers"]) assert.equal(isRealSwapReason(r), true, r)
})

test('the report is due at the chosen local time, an hour ahead at least, never after 48 hours', () => {
  // 2 pm in Karachi: due 8 pm the same day.
  assert.equal(at(reportDueAt({ nowMs: NOW, timeZone: 'Asia/Karachi' }).at), '2026-10-26T15:00:00.000Z')
  // 7:30 pm in Karachi: 8 pm is too close, so the next evening.
  assert.equal(at(reportDueAt({ nowMs: Date.parse('2026-10-26T14:30:00Z'), timeZone: 'Asia/Karachi' }).at), '2026-10-27T15:00:00.000Z')
  // A chosen time, and no zone means UTC.
  const r = reportDueAt({ nowMs: NOW, timeLocal: '18:30:00' })
  assert.deepEqual([at(r.at), r.local_time, r.time_zone], ['2026-10-26T18:30:00.000Z', '18:30', 'UTC'])
  // Across the end of daylight saving in New York (1 November 2026).
  const ny = Date.parse('2026-11-01T02:00:00Z') // 10 pm on 31 October, EDT
  assert.equal(at(reportDueAt({ nowMs: ny, timeZone: 'America/New_York' }).at), '2026-11-02T01:00:00.000Z')
  for (const tz of ['Pacific/Kiritimati', 'Pacific/Pago_Pago', 'UTC']) {
    for (let h = 0; h < 24; h += 1) {
      const now = NOW + h * HOUR
      const due = reportDueAt({ nowMs: now, timeZone: tz }).at
      assert.ok(due - now >= HOUR && due - now <= REPORT_WINDOW_MS, `${tz} +${h}h`)
    }
  }
})

// ── Through the API ──────────────────────────────────────────────────────────

// The real database refuses repeated unique keys. The in-memory fake does
// not, so this wrapper does it for moves: one first move per Learn
// conversation, one replacement per move, and (user_id, active_slot) unique.
function withMoveKeys(base) {
  return {
    ...base,
    from(table) {
      const b = base.from(table)
      if (table !== 'moves') return b
      const eqs = []
      let action = 'select'
      let payload = null
      const { eq, insert, update, then } = b
      b.eq = (c, v) => { eqs.push([c, v]); eq(c, v); return b }
      b.insert = (p) => { action = 'insert'; payload = p; insert(p); return b }
      b.update = (p) => { action = 'update'; payload = p; update(p); return b }
      b.then = (resolve, reject) => {
        const rows = base.rows('moves')
        let clash = false
        if (action === 'insert') {
          clash = rows.some((r) => (payload.swapped_from == null ? r.swapped_from == null && r.learn_id === payload.learn_id : r.swapped_from === payload.swapped_from))
        }
        if (action === 'update' && payload.active_slot != null) {
          const hits = rows.filter((r) => eqs.every(([c, v]) => r[c] === v))
          clash = hits.some((h) => rows.some((r) => r.id !== h.id && r.user_id === h.user_id && r.active_slot === payload.active_slot))
        }
        if (clash) return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key' } }).then(resolve, reject)
        return then(resolve, reject)
      }
      return b
    },
  }
}

const draft = (n, over = {}) => ({
  id: uuid(300 + n), user_id: USER.id, situation_id: uuid(110 + n), learn_id: uuid(210 + n), status: 'draft',
  title: MOVE.title, mission: MOVE.mission, success_condition: MOVE.success, words: MOVE.words, checklist: MOVE.checklist,
  prediction: MOVE.prediction, hypothesis: MOVE.hypothesis, start_minutes: 5, validation: { ok: true }, swap_count: 0,
  swapped_from: null, active_slot: null, created_at: at(NOW - n * 1000), ...over,
})

const seed = ({ offers = [2], moves = [], timezone = 'Asia/Karachi' } = {}) => ({
  founder_profiles: [{ user_id: USER.id, signup_answers: FULL_ANSWERS, timezone, report_time_local: null }],
  situations: [{ id: SIT, user_id: USER.id, title: 'Pricing emails to clinics', status: 'open', follow_up_count: 0, created_at: at(NOW), last_activity_at: at(NOW) }],
  situation_turns: [{ id: uuid(101), seq: 1, situation_id: SIT, role: 'founder', text: FIRST, filler: false, created_at: at(NOW) }],
  reads: [{ id: uuid(102), situation_id: SIT, headline: 'Nobody has said yes or no yet.', body: 'The clinics asked for pricing three weeks ago.', closing_question: 'Have you gone back to either clinic since?', closing_answer: 'No, not since the demo.', skipped: false, answered_at: at(NOW) }],
  learn_conversations: [{ id: LEARN, situation_id: SIT, user_id: USER.id, offers, move_subject: 'the two clinics', move_fact: null, after_cap_said: false, lock_token: null, locked_at: null, created_at: at(NOW), updated_at: at(NOW) }],
  learn_turns: [
    { id: uuid(103), seq: 1, conversation_id: LEARN, role: 'axiom', kind: 'lesson', text: 'The two clinics have waited three weeks. What would a real yes be?', filler: false, sources: [], follow_ups: [], move_offer: 'none', created_at: at(NOW) },
    { id: uuid(104), seq: 2, conversation_id: LEARN, role: 'founder', kind: null, text: 'A paid pilot from the first clinic.', filler: false, created_at: at(NOW) },
  ],
  moves,
})

async function setup(script = [], opts = {}) {
  const base = createFakeSupabase({ users: { tok: USER, tok2: OTHER }, tables: seed(opts) })
  const openai = createFakeOpenAI(script)
  const clock = createFakeClock(NOW)
  const app = createApp({ env: ENV, supabase: withMoveKeys(base), openai, clock })
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
  return { call: as('tok'), callOther: as('tok2'), callAnon: as(null), clock, chatCalls, rows: (t) => base.rows(t), close: () => new Promise((r) => server.close(r)) }
}

test('the move card: written once after an offer, checked, nothing server-only in it', async () => {
  const { call, chatCalls, rows, close } = await setup([moveJson()])
  try {
    const res = await call('POST', `/api/learn/${LEARN}/move`)
    assert.equal(res.status, 200)
    const m = res.body.move
    assert.equal(m.status, 'draft')
    assert.equal(m.title, MOVE.title)
    assert.equal(m.success, MOVE.success)
    assert.deepEqual(m.checklist, MOVE.checklist)
    assert.equal(m.can_swap, true)
    assert.ok(!JSON.stringify(res.body).match(/hypothesis|validation|active_slot|swap_reason/))
    assert.equal(chatCalls()[0].payload.model, 'gpt-5.4-mini-2026-03-17')
    assert.equal(rows('model_usage_logs').filter((u) => u.user_id === USER.id).length, 1)

    const again = await call('POST', `/api/learn/${LEARN}/move`)
    assert.deepEqual(again.body, res.body)
    assert.equal(chatCalls().length, 1)
    assert.equal(rows('moves').length, 1)
  } finally { await close() }
})

test('a move that fails the validator twice is never shown or stored', async () => {
  const vague = moveJson({ success: 'You feel clearer about the clinics.' })
  const { call, chatCalls, rows, close } = await setup([vague, vague])
  try {
    const res = await call('POST', `/api/learn/${LEARN}/move`)
    assert.equal(res.status, 503)
    assert.deepEqual(res.body, { error: 'Something went wrong. Try again.' })
    assert.equal(chatCalls().length, 2)
    assert.match(chatCalls()[1].payload.messages.at(-1).content, /yes or no/)
    assert.equal(rows('moves').length, 0)
  } finally { await close() }
})

test('a retry that fixes the problem is shown', async () => {
  const { call, chatCalls, close } = await setup([moveJson({ mission: 'Email the 7 clinics by Friday.' }), moveJson()])
  try {
    const res = await call('POST', `/api/learn/${LEARN}/move`)
    assert.equal(res.status, 200)
    assert.match(chatCalls()[1].payload.messages.at(-1).content, /never gave: 7/)
  } finally { await close() }
})

test('no move before Learn offered one, and none without room', async () => {
  const early = await setup([moveJson()], { offers: [] })
  try {
    const notReady = await early.call('POST', `/api/learn/${LEARN}/move`)
    assert.deepEqual([notReady.status, notReady.body], [409, { error: 'The move is not ready yet.', code: 'move_not_ready' }])
    assert.equal(early.chatCalls().length, 0)
  } finally { await early.close() }

  const committed = (n, slot) => draft(n, { status: 'committed', active_slot: slot, committed_at: at(NOW), report_due_at: at(NOW + 6 * HOUR), closes_at: at(NOW + 48 * HOUR) })
  const full = await setup([moveJson()], { moves: [committed(1, 1), committed(2, 2)] })
  try {
    const res = await full.call('POST', `/api/learn/${LEARN}/move`)
    assert.equal(res.status, 409)
    assert.equal(res.body.error, 'move_cap')
    assert.equal(res.body.code, 'move_cap')
    assert.equal(res.body.message, NO_ROOM_LINE)
    assert.equal(res.body.moves.length, 2)
    assert.equal(full.chatCalls().length, 0)
  } finally { await full.close() }
})

test('at most 2 committed moves, even when three commits arrive at once', async () => {
  const { call, rows, close } = await setup([], { moves: [draft(1), draft(2), draft(3)] })
  try {
    const results = await Promise.all([1, 2, 3].map((n) => call('POST', `/api/moves/${uuid(300 + n)}/commit`)))
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 200, 409])
    assert.equal(results.find((r) => r.status === 409).body.error, 'move_cap')
    const active = rows('moves').filter((m) => m.status === 'committed')
    assert.equal(active.length, 2)
    assert.deepEqual(active.map((m) => m.active_slot).sort(), [1, 2])
    const list = await call('GET', '/api/moves/active')
    assert.equal(list.body.room, false)
    assert.equal(list.body.moves.length, 3)
  } finally { await close() }
})

test('commit is idempotent and schedules the evening report', async () => {
  const { call, rows, close } = await setup([], { moves: [draft(1)] })
  try {
    const [a, b] = await Promise.all([call('POST', `/api/moves/${uuid(301)}/commit`), call('POST', `/api/moves/${uuid(301)}/commit`)])
    assert.equal(a.status, 200)
    assert.equal(b.status, 200)
    assert.deepEqual(a.body, b.body)
    // 2 pm in Karachi: the founder's saved zone, default 8 pm.
    assert.deepEqual(a.body.report, { due_at: '2026-10-26T15:00:00.000Z', local_time: '20:00', time_zone: 'Asia/Karachi' })
    assert.equal(a.body.move.status, 'committed')
    assert.equal(a.body.move.report_due_at, '2026-10-26T15:00:00.000Z')
    const row = rows('moves')[0]
    assert.equal(row.closes_at, at(NOW + REPORT_WINDOW_MS))
    const c = await call('POST', `/api/moves/${uuid(301)}/commit`)
    assert.deepEqual(c.body, a.body)
  } finally { await close() }
})

test('commit uses the phone time zone when none is saved, and refuses a bad one', async () => {
  const { call, close } = await setup([], { moves: [draft(1)], timezone: null })
  try {
    assert.equal((await call('POST', `/api/moves/${uuid(301)}/commit`, { timezone: 'Not/AZone' })).status, 400)
    const res = await call('POST', `/api/moves/${uuid(301)}/commit`, { timezone: 'Europe/London' })
    assert.deepEqual(res.body.report, { due_at: '2026-10-26T20:00:00.000Z', local_time: '20:00', time_zone: 'Europe/London' })
  } finally { await close() }
})

test('swap: once, only with a real reason, behind the care gate', async () => {
  const swapped = moveJson({
    title: 'Email the clinics their pricing today.',
    mission: 'Email the pricing to the 2 clinics that asked for it and ask each for a 20-minute call.',
  })
  const { call, chatCalls, rows, close } = await setup([swapped], { moves: [draft(1, { learn_id: LEARN, situation_id: SIT })] })
  try {
    const busy = await call('POST', `/api/moves/${uuid(301)}/swap`, { reason: "I'm busy" })
    assert.deepEqual(busy.body, { status: 'need_reason', reply: NEED_REASON })
    assert.equal(chatCalls().length, 0)

    const care = await call('POST', `/api/moves/${uuid(301)}/swap`, { reason: 'I want to kill myself' })
    assert.equal(care.body.care, 'clear')
    assert.equal(rows('moves').length, 1)

    // Care stays open until the founder checks in on home: starting the move is held too, with no model call.
    const held = await call('POST', `/api/moves/${uuid(301)}/commit`, {})
    assert.equal(held.body.care, 'clear')
    assert.equal(rows('moves')[0].status, 'draft')
    assert.equal(chatCalls().length, 0)
    assert.deepEqual((await call('POST', '/api/home/checkin', { text: 'All fine, back to the clinics.' })).body, { ok: true })

    const res = await call('POST', `/api/moves/${uuid(301)}/swap`, { reason: 'I only have their email, not their phone numbers' })
    assert.equal(res.status, 200)
    assert.equal(res.body.status, 'swapped')
    assert.equal(res.body.replaced_id, uuid(301))
    assert.equal(res.body.move.status, 'draft')
    assert.equal(res.body.move.can_swap, false)
    assert.equal(res.body.move.swapped_from, uuid(301))
    const prompt = JSON.parse(chatCalls()[0].payload.messages[1].content)
    assert.equal(prompt.swap.reason, 'I only have their email, not their phone numbers')
    const old = rows('moves').find((m) => m.id === uuid(301))
    assert.equal(old.status, 'swapped') // kept, not deleted

    const repeat = await call('POST', `/api/moves/${uuid(301)}/swap`, { reason: 'I only have their email, not their phone numbers' })
    assert.deepEqual(repeat.body, res.body)
    const twice = await call('POST', `/api/moves/${res.body.move.id}/swap`, { reason: 'The owner is away and I only have the front desk email' })
    assert.equal(twice.status, 409)
    assert.equal(twice.body.error, 'swap_used')
    assert.equal(twice.body.code, 'swap_used')
    assert.equal(chatCalls().length, 1)

    // The card for this conversation now opens the replacement.
    assert.equal((await call('POST', `/api/learn/${LEARN}/move`)).body.move.id, res.body.move.id)
  } finally { await close() }
})

test("another founder's move is a plain 404; no auth is 401", async () => {
  const { callOther, callAnon, close } = await setup([], { moves: [draft(1)] })
  try {
    assert.equal((await callOther('GET', `/api/moves/${uuid(301)}`)).status, 404)
    assert.equal((await callOther('POST', `/api/moves/${uuid(301)}/commit`)).status, 404)
    assert.equal((await callOther('POST', `/api/moves/${uuid(301)}/swap`, { reason: 'I only have their email address' })).status, 404)
    assert.equal((await callOther('POST', `/api/learn/${LEARN}/move`)).status, 404)
    assert.deepEqual((await callOther('GET', '/api/moves/not-a-uuid')).body, { error: 'Not found' })
    assert.deepEqual((await callOther('GET', '/api/moves/active')).body.moves, [])
    assert.equal((await callAnon('GET', '/api/moves/active')).status, 401)
  } finally { await close() }
})

test('no route removes or penalises; an unreported move closes quietly and frees its slot', async () => {
  const { call, clock, rows, close } = await setup([], { moves: [draft(1)] })
  try {
    for (const [method, path] of [['DELETE', `/api/moves/${uuid(301)}`], ['POST', `/api/moves/${uuid(301)}/cancel`], ['POST', `/api/moves/${uuid(301)}/remove`], ['POST', `/api/moves/${uuid(301)}/status`]]) {
      assert.equal((await call(method, path)).status, 404, `${method} ${path}`)
    }
    await call('POST', `/api/moves/${uuid(301)}/commit`)
    clock.advance(7 * HOUR)
    assert.equal((await call('GET', `/api/moves/${uuid(301)}`)).body.move.status, 'report_due')
    clock.advance(42 * HOUR)
    const closed = await call('GET', `/api/moves/${uuid(301)}`)
    assert.equal(closed.body.move.status, 'closed_no_report')
    assert.ok(!JSON.stringify(closed.body).match(/strike|warning|penalt|removed|ghost/i))
    assert.equal(rows('moves')[0].active_slot, null)
    const list = await call('GET', '/api/moves/active')
    assert.deepEqual([list.body.moves.length, list.body.room], [0, true])
  } finally { await close() }
})

test('Learn offers no card while 2 moves are open, and says so when asked', async () => {
  const committed = (n, slot) => draft(n, { status: 'committed', active_slot: slot, committed_at: at(NOW), report_due_at: at(NOW + 6 * HOUR), closes_at: at(NOW + 48 * HOUR) })
  const { call, chatCalls, rows, close } = await setup([], { offers: [], moves: [committed(1, 1), committed(2, 2)] })
  try {
    const res = await call('POST', `/api/learn/${LEARN}/turn`, { text: 'So what should I do next?', client_turn_id: uuid(900) })
    assert.equal(res.status, 200)
    assert.equal(res.body.move_offer, 'none')
    assert.equal(res.body.move_notice, null)
    assert.equal(res.body.turn.text, NO_ROOM_LINE)
    assert.deepEqual(rows('learn_conversations')[0].offers, [])
    assert.equal(chatCalls().length, 0)
  } finally { await close() }
})
