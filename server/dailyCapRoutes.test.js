// The $1-a-day cap on journey routes that call a model, and the list of routes
// the server may expose. Care runs first and is never capped.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createApp } from './app.js'
import { createFakeClock, createFakeOpenAI, createFakeSupabase } from './testing/fakes.js'
import { FULL_ANSWERS } from './journey/fixtures.js'
import { routesOf } from './e2e/harness.js'
import { DAILY_CAP_LINE } from './dailyCap.js'

const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'founder@example.com' }
const OTHER = { id: '22222222-2222-4222-8222-222222222222', email: 'other@example.com' }
const NOW = Date.parse('2026-10-26T09:00:00.000Z')
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const ID = uuid(901)

// Every route that makes a model call for a founder, with a body that passes validation.
const CAPPED = [
  ['/api/first-reading', {}],
  ['/api/situations', { text: 'I have a demo ready but have not emailed the clinics.', client_turn_id: uuid(1) }],
  [`/api/situations/${ID}/turn`, { text: 'Four clinics asked.', client_turn_id: uuid(2) }],
  [`/api/situations/${ID}/read`, {}],
  [`/api/situations/${ID}/learn`, {}],
  [`/api/learn/${ID}/turn`, { text: 'How do I price it?', client_turn_id: uuid(3) }],
  [`/api/learn/${ID}/followup/0`, {}],
  [`/api/learn/${ID}/move`, {}],
  [`/api/moves/${ID}/swap`, { reason: 'The clinic owner is away until Monday.' }],
]

async function setup({ spent = 1.5, env = {}, events = [], tables = {}, firstReading = null } = {}) {
  const supabase = createFakeSupabase({
    users: { tok: USER, tok2: OTHER },
    tables: {
      founder_profiles: [{ user_id: USER.id, signup_answers: FULL_ANSWERS, first_reading: firstReading }, { user_id: OTHER.id, signup_answers: FULL_ANSWERS }],
      care_events: events,
      ...tables,
      model_usage_logs: [{ id: uuid(70), user_id: USER.id, created_at: '2026-10-26T08:00:00.000Z', estimated_cost_usd: spent }],
    },
  })
  const openai = createFakeOpenAI([])
  const app = createApp({ env: { FRONTEND_URL: 'https://app.example.com', ...env }, supabase, openai, clock: createFakeClock(NOW) })
  const server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  const url = `http://127.0.0.1:${server.address().port}`
  const as = (token) => async (path, body) => {
    const res = await fetch(`${url}${path}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return { status: res.status, body: await res.json() }
  }
  return { app, supabase, openai, call: as('tok'), callOther: as('tok2'), close: () => new Promise((r) => server.close(r)) }
}

test('a founder at the cap gets 429 on every capped route, with no model call and no rows', async () => {
  const { call, openai, supabase, close } = await setup()
  try {
    for (const [path, body] of CAPPED) {
      const res = await call(path, body)
      assert.equal(res.status, 429, path)
      assert.equal(res.body.code, 'daily_cost_cap', path)
      assert.equal(res.body.line, DAILY_CAP_LINE, path)
    }
    // The report is never capped: one cheap call per move, and it is the loop the product runs on.
    assert.notEqual((await call(`/api/moves/${ID}/report`, { outcome: 'done', note: 'Both replied.', client_turn_id: uuid(4) })).status, 429)
    assert.equal(openai.calls.length, 0)
    for (const t of ['situations', 'situation_turns', 'reads', 'learn_turns', 'moves', 'reports']) assert.equal(supabase.rows(t).length, 0, t)
  } finally { await close() }
})

test('care is never capped: distress or an open care event at the cap still gets the care response', async () => {
  const a = await setup()
  try {
    const res = await a.call('/api/situations', { text: 'I want to kill myself', client_turn_id: uuid(1) })
    assert.equal(res.status, 200)
    assert.equal(res.body.care, 'clear')
    assert.equal(res.body.code, undefined)
  } finally { await a.close() }
  const b = await setup({ events: [{ id: uuid(500), user_id: USER.id, level: 'clear', scope_id: null, created_at: '2026-10-26T08:30:00.000Z', resolved_at: null }] })
  try {
    for (const [path, body] of CAPPED) {
      const res = await b.call(path, body)
      assert.equal(res.status, 200, path)
      assert.equal(res.body.care, 'clear', path)
    }
  } finally { await b.close() }
})

test('under the cap, another founder, and an admin account are not blocked', async () => {
  const a = await setup({ spent: 0.5 })
  try { assert.notEqual((await a.call('/api/situations', CAPPED[1][1])).status, 429) } finally { await a.close() }
  const b = await setup()
  try { assert.notEqual((await b.callOther('/api/situations', CAPPED[1][1])).status, 429) } finally { await b.close() }
  const c = await setup({ env: { ADMIN_USER_IDS: USER.id } })
  try { assert.notEqual((await c.call('/api/situations', CAPPED[1][1])).status, 429) } finally { await c.close() }
})

test('at the cap, a stored first reading, Read and turn are replayed free; a new turn is still stopped', async () => {
  const reading = { headline: 'h', body: 'b' }
  const { call, openai, close } = await setup({
    firstReading: reading,
    tables: {
      situations: [{ id: ID, user_id: USER.id, create_turn_id: uuid(11), title: 't', status: 'open' }],
      situation_turns: [{ id: uuid(21), situation_id: ID, role: 'founder', text: 'x', client_turn_id: uuid(2), result: { status: 'follow_up' } }],
      reads: [{ id: uuid(31), situation_id: ID, headline: 'Read', body: 'b', closing_question: 'q', answered_at: null, skipped: false }],
    },
  })
  try {
    assert.deepEqual((await call('/api/first-reading', {})).body, reading)
    const read = await call(`/api/situations/${ID}/read`, {})
    assert.equal(read.status, 200)
    assert.equal(read.body.headline, 'Read')
    assert.equal((await call(`/api/situations/${ID}/turn`, { text: 'Four clinics asked.', client_turn_id: uuid(2) })).status, 200) // replay
    assert.equal((await call(`/api/situations/${ID}/turn`, { text: 'Four clinics asked.', client_turn_id: uuid(99) })).status, 429) // new turn
    assert.equal(openai.calls.length, 0)
  } finally { await close() }
})

test('at the cap, an answered follow-up tap is replayed free; an unanswered one is stopped', async () => {
  const turn = uuid(41)
  const { call, openai, close } = await setup({
    tables: {
      situations: [{ id: uuid(12), user_id: USER.id, title: 't', status: 'open' }],
      learn_conversations: [{ id: ID, user_id: USER.id, situation_id: uuid(12) }],
      learn_turns: [
        { id: turn, conversation_id: ID, role: 'axiom', kind: 'lesson', text: 'lesson', follow_ups: ['One', 'Two'] },
        { id: uuid(42), conversation_id: ID, role: 'axiom', kind: 'followup', text: 'answer', parent_turn_id: turn, followup_index: 0 },
      ],
    },
  })
  try {
    assert.notEqual((await call(`/api/learn/${ID}/followup/0`, { turn_id: turn })).status, 429)
    assert.equal((await call(`/api/learn/${ID}/followup/1`, { turn_id: turn })).status, 429)
    assert.equal(openai.calls.length, 0)
  } finally { await close() }
})

test('a failed cost lookup fails open', async () => {
  const { supabase, call, close } = await setup()
  const from = supabase.from.bind(supabase)
  supabase.from = (t) => { if (t === 'model_usage_logs') throw new Error('db down'); return from(t) }
  const warn = console.warn
  console.warn = () => {}
  try { assert.notEqual((await call('/api/situations', CAPPED[1][1])).status, 429) } finally { console.warn = warn; await close() }
})

// Every /api/ route the server exposes is called by the app or listed here, so an old route cannot return unseen.
const NOT_CALLED_BY_APP = new Set([
  'GET /api/review/outcomes', 'POST /api/review/outcomes/:x/draft', 'POST /api/review/outcomes/:x', // reviewer tool, not a founder action
  'GET /api/situations/open', 'GET /api/learn/:x', 'GET /api/moves/active', 'GET /api/reports/:x', // journey reads the app does not call yet
  'GET /api/settings/sharing', 'PUT /api/settings/sharing', 'GET /api/settings/reminders', 'PUT /api/settings/reminders', // reached through /api/settings
])
const norm = (path) => path.replace(/\$\{[^}]*\}|:[a-z_]+/gi, ':x')

test('every /api/ route is called by app/src/api/http.ts or on the written list', async () => {
  const http = readFileSync(new URL('../app/src/api/http.ts', import.meta.url), 'utf8')
  const used = new Set([...http.matchAll(/'(GET|POST|PUT|DELETE|PATCH)',\s*[`'](\/api\/[^`'?]*)/g)].map((m) => `${m[1]} ${norm(m[2])}`))
  assert.ok(used.size > 20)
  const app = createApp({ env: { FRONTEND_URL: 'https://app.example.com' }, openai: createFakeOpenAI() })
  const served = routesOf(app).filter((r) => r.path.startsWith('/api/')).map((r) => `${r.method} ${norm(r.path)}`)
  assert.deepEqual(served.filter((r) => !used.has(r) && !NOT_CALLED_BY_APP.has(r)), [])
  assert.deepEqual([...NOT_CALLED_BY_APP].filter((r) => !served.includes(r)), [], 'listed but no longer served')
  assert.deepEqual([...NOT_CALLED_BY_APP].filter((r) => used.has(r)), [], 'listed but the app calls it')
})

// A limit must never block the loop (the evening report) or the saving of a founder's own words.
// Every write route is capped (CAPPED above) or listed here with its reason, so a new model route
// cannot ship unlisted, and a listed route that gains a cap fails.
const NOT_CAPPED = {
  'POST /api/situations/:x/read/answer': 'stores the founder\'s answer; never blocked',
  'POST /api/moves/:x/commit': 'no model call', 'POST /api/moves/:x/report': 'the evening report is the loop; never blocked',
  'POST /api/reports/:x/consent': 'no model call', 'POST /api/reports/:x/withdraw': 'no model call',
  'PUT /api/settings/sharing': 'no model call', 'PUT /api/settings': 'no model call', 'PUT /api/settings/reminders': 'no model call',
  'POST /api/home/checkin': 'the way out of care', 'POST /api/account/export': 'no model call', 'DELETE /api/account': 'no model call',
  'PUT /api/signup/answers/:x': 'stores sign-up answers; never blocked',
  'POST /api/push/token': 'no model call', 'DELETE /api/push/token': 'no model call',
  'POST /api/review/outcomes/:x/draft': 'reviewer tool', 'POST /api/review/outcomes/:x': 'reviewer tool',
}

test('every write route is capped or on the written not-capped list', () => {
  const app = createApp({ env: { FRONTEND_URL: 'https://app.example.com' }, openai: createFakeOpenAI() })
  const capped = new Set(CAPPED.map(([p]) => `POST ${norm(p.replace(ID, ':x').replace(/\/followup\/0/, '/followup/:x'))}`))
  const writes = routesOf(app).filter((r) => r.path.startsWith('/api/') && r.method !== 'GET').map((r) => `${r.method} ${norm(r.path)}`)
  assert.deepEqual(writes.filter((r) => !capped.has(r) && !Object.hasOwn(NOT_CAPPED, r)), [])
  assert.deepEqual(Object.keys(NOT_CAPPED).filter((r) => !writes.includes(r) || capped.has(r)), [], 'listed but gone, or capped')
})
