// careHold: while a founder has an open clear care event, every route that
// would read, teach or give a move answers with the care screen, asks no model
// and stores nothing. The check-in on home is the way out.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createApp } from '../app.js'
import { createFakeClock, createFakeOpenAI, createFakeSupabase } from '../testing/fakes.js'
import { FULL_ANSWERS } from '../journey/fixtures.js'

const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'founder@example.com' }
const OTHER = { id: '22222222-2222-4222-8222-222222222222', email: 'other@example.com' }
const ENV = { FRONTEND_URL: 'https://app.example.com' }
const NOW = Date.parse('2026-10-26T09:00:00.000Z')
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const SID = uuid(901)
const LID = uuid(902)
const MID = uuid(903)
const FIRST = 'I have a demo ready but I have not emailed the clinics that asked for pricing three weeks ago.'

// Every held route with a body that would pass validation and carries no care words.
const HELD = [
  ['/api/situations', { text: FIRST, client_turn_id: uuid(1) }],
  [`/api/situations/${SID}/turn`, { text: 'Four clinics asked.', client_turn_id: uuid(2) }],
  [`/api/situations/${SID}/read`, {}],
  [`/api/situations/${SID}/read/answer`, { text: 'Not yet.' }],
  [`/api/situations/${SID}/learn`, {}],
  [`/api/learn/${LID}/turn`, { text: 'How do I price it?', client_turn_id: uuid(3) }],
  [`/api/learn/${LID}/followup/0`, {}],
  [`/api/learn/${LID}/move`, {}],
  [`/api/moves/${MID}/commit`, { timezone: 'Asia/Karachi' }],
  [`/api/moves/${MID}/swap`, { reason: 'The clinic owner is away until Monday.' }],
  ['/api/first-reading', {}],
  [`/api/moves/${MID}/report`, { outcome: 'done', note: 'Both clinics replied.', client_turn_id: uuid(4) }],
]

const careEvent = (over = {}) => ({
  id: uuid(500), user_id: USER.id, level: 'clear', scope_id: null, created_at: '2026-10-26T08:00:00.000Z', resolved_at: null, ...over,
})

// failCareRead: every read of care_events returns an error, as a dropped
// database connection would.
async function setup({ events = [], script = [], failCareRead = false } = {}) {
  const base = createFakeSupabase({
    users: { tok: USER, tok2: OTHER },
    tables: {
      founder_profiles: [{ user_id: USER.id, signup_answers: FULL_ANSWERS }, { user_id: OTHER.id, signup_answers: FULL_ANSWERS }],
      care_events: events,
    },
  })
  const writes = []
  const supabase = {
    ...base,
    from(table) {
      const b = base.from(table)
      for (const op of ['insert', 'update', 'upsert', 'delete']) {
        const orig = b[op]
        b[op] = (...args) => { writes.push({ table, op }); return orig(...args) }
      }
      if (failCareRead && table === 'care_events') {
        const failed = { data: null, error: { message: 'connection lost' } }
        b.then = (res, rej) => Promise.resolve(failed).then(res, rej)
      }
      return b
    },
  }
  const openai = createFakeOpenAI(script)
  const app = createApp({ env: ENV, supabase, openai, clock: createFakeClock(NOW) })
  const server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  const url = `http://127.0.0.1:${server.address().port}`
  const as = (token) => async (method, path, body) => {
    const res = await fetch(`${url}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    return { status: res.status, body: text.startsWith('{') ? JSON.parse(text) : text }
  }
  const close = () => new Promise((r) => server.close(r))
  // openCare: writes straight to the store, as the care gate would have.
  const openCare = () => base.from('care_events').insert(careEvent())
  return { call: as('tok'), callOther: as('tok2'), openai, writes, rows: (t) => base.rows(t), openCare, close }
}

const verdict = () => JSON.stringify({
  topic: 'same', has_situation: true, has_detail: false, missing: 'number',
  question: 'How many of the clinics asked for pricing?', title: 'Pricing emails to clinics',
})

const assertCareScreen = (res, path) => {
  assert.equal(res.status, 200, path)
  assert.equal(res.body.care, 'clear', path)
  assert.equal(typeof res.body.message, 'string', path)
  assert.ok(res.body.message.length > 0, path)
  assert.ok(res.body.help, path)
}

test('every held route shows the care screen while clear care is open: no model call, nothing written', async () => {
  const { call, openai, writes, rows, close } = await setup({ events: [careEvent()] })
  try {
    for (const [path, body] of HELD) {
      assertCareScreen(await call('POST', path, body), path)
    }
    assert.equal(openai.calls.length, 0)
    assert.deepEqual(writes, [])
    assert.equal(rows('care_events').length, 1)
    assert.equal(rows('model_usage_logs').length, 0)
  } finally { await close() }
})

test('a held route with care words in the body still records no new event', async () => {
  const { call, openai, rows, close } = await setup({ events: [careEvent()] })
  try {
    const res = await call('POST', '/api/situations', { text: 'I want to kill myself', client_turn_id: uuid(7) })
    assertCareScreen(res, 'create')
    assert.equal(openai.calls.length, 0)
    assert.equal(rows('care_events').length, 1)
  } finally { await close() }
})

test('the check-in works while care is open, resolves the event, and the routes work again', async () => {
  const { call, openai, rows, close } = await setup({ events: [careEvent()], script: [verdict()] })
  try {
    const checkin = await call('POST', '/api/home/checkin', { text: 'A bit better today, thanks.' })
    assert.equal(checkin.status, 200)
    assert.deepEqual(checkin.body, { ok: true })
    assert.ok(rows('care_events').every((e) => e.resolved_at !== null))

    const created = await call('POST', '/api/situations', { text: FIRST, client_turn_id: uuid(1) })
    assert.equal(created.status, 200)
    assert.equal(created.body.care, undefined)
    assert.equal(created.body.status, 'follow_up')
    assert.equal(openai.calls.length, 1)

    // The rest reach their handlers (they fail on missing rows, not on care).
    for (const [path, body] of HELD.slice(1)) {
      const res = await call('POST', path, body)
      assert.equal(res.body?.care, undefined, path)
    }
  } finally { await close() }
})

test('an unclear event alone does not hold, nor does a resolved clear one', async () => {
  const { call, close } = await setup({
    events: [careEvent({ level: 'unclear' }), careEvent({ id: uuid(501), resolved_at: '2026-10-26T08:30:00.000Z' })],
    script: [verdict()],
  })
  try {
    const res = await call('POST', '/api/situations', { text: FIRST, client_turn_id: uuid(1) })
    assert.equal(res.status, 200)
    assert.equal(res.body.care, undefined)
    assert.equal(res.body.status, 'follow_up')
  } finally { await close() }
})

test("another founder's open care event does not hold this founder", async () => {
  const { callOther, close } = await setup({ events: [careEvent()], script: [verdict()] })
  try {
    const res = await callOther('POST', '/api/situations', { text: FIRST, client_turn_id: uuid(1) })
    assert.equal(res.status, 200)
    assert.equal(res.body.care, undefined)
    assert.equal(res.body.status, 'follow_up')
  } finally { await close() }
})

test('a failed care lookup is a 5xx on every held route, never a care screen, and asks no model', async () => {
  const { call, openai, writes, close } = await setup({ failCareRead: true })
  try {
    for (const [path, body] of HELD) {
      const res = await call('POST', path, body)
      assert.ok(res.status >= 500 && res.status < 600, `${path}: ${res.status}`)
      assert.equal(res.body?.care, undefined, path)
      assert.equal(res.body?.help, undefined, path)
    }
    assert.equal(openai.calls.length, 0)
    assert.deepEqual(writes, [])
  } finally { await close() }
})

test('GET routes are not held: home, history, history detail, and a situation', async () => {
  const { call, openai, openCare, close } = await setup({ script: [verdict()] })
  try {
    const created = await call('POST', '/api/situations', { text: FIRST, client_turn_id: uuid(1) })
    const id = created.body.situation_id
    assert.ok(id)
    await openCare()
    assertCareScreen(await call('POST', `/api/situations/${id}/read`, {}), 'read is held')
    const calls = openai.calls.length
    for (const path of ['/api/home', '/api/history', `/api/history/${id}`, `/api/situations/${id}`, '/api/situations/open']) {
      const res = await call('GET', path)
      assert.equal(res.status, 200, `${path}: ${JSON.stringify(res.body)}`)
      assert.equal(res.body.care, undefined, path)
    }
    assert.equal(openai.calls.length, calls)
  } finally { await close() }
})
