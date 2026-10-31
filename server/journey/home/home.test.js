import assert from 'node:assert/strict'
import test from 'node:test'
import { createApp } from '../../app.js'
import { createFakeClock, createFakeOpenAI, createFakeSupabase } from '../../testing/fakes.js'
import { FULL_ANSWERS } from '../fixtures.js'
import { BANNED_PHRASES } from '../ownWords.js'
import { CARE_COPY } from '../../care/copy.js'
import { contextOf, daysTo, fillGreeting, goalPhrase, pickGreeting } from './greeting.js'
import { containsPattern } from './historyService.js'
import { createAccount } from './accountService.js'
import { createSharing } from '../report/sharing.js'
import { ACCOUNT_COPY, DELETION_PLAN, GREETINGS, ITEM_LABELS } from './wording.js'
import { FADE_AFTER_MS } from './homeService.js'

const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'founder@example.com', user_metadata: { given_name: 'Sam' } }
const OTHER = { id: '22222222-2222-4222-8222-222222222222', email: 'other@example.com' }
const ENV = { FRONTEND_URL: 'https://app.example.com' }
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const NOW = Date.parse('2026-10-26T16:00:00.000Z') // Monday 9 pm in Karachi
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const at = (ms) => new Date(ms).toISOString()
const SIT_DONE = uuid(100)
const SIT_OPEN = uuid(101)
const SIT_OLD = uuid(102)
const SIT_OTHER = uuid(103)
const MOVE_DUE = uuid(300)

const move = (over = {}) => ({
  id: MOVE_DUE, user_id: USER.id, situation_id: SIT_DONE, learn_id: uuid(200), status: 'report_due',
  title: 'Ask both clinics for a call.', mission: 'Email the 2 clinics.', success_condition: 'Both reply.', words: '', checklist: ['a', 'b'],
  prediction: 'One will not reply.', start_minutes: 5, swap_count: 0, active_slot: 1,
  committed_at: at(NOW - 8 * HOUR), report_due_at: at(NOW - HOUR), closes_at: at(NOW + 40 * HOUR), created_at: at(NOW - 9 * HOUR), ...over,
})

const seed = ({ moves = [], settings = [], tokens = [{ id: uuid(1), user_id: USER.id, token: 'ExponentPushToken[abcdefghij1234567890]' }], care = [], reports, extraSituations = [], signedUp = true } = {}) => ({
  users: [{ id: USER.id, email: USER.email, first_name: 'Sam' }],
  founder_profiles: signedUp ? [{ user_id: USER.id, signup_answers: FULL_ANSWERS, timezone: 'Asia/Karachi', country: 'Pakistan', deadline: '2027-01-26', report_time_local: null }] : [],
  situations: [
    { id: SIT_DONE, user_id: USER.id, title: 'Pricing emails to clinics', status: 'open', last_activity_at: at(NOW - 3 * HOUR), created_at: at(NOW - 10 * HOUR) },
    { id: SIT_OPEN, user_id: USER.id, title: 'Hiring a first engineer', status: 'open', last_activity_at: at(NOW - 2 * DAY), created_at: at(NOW - 3 * DAY) },
    { id: SIT_OLD, user_id: USER.id, title: 'Domain name', status: 'open', last_activity_at: at(NOW - 30 * DAY), created_at: at(NOW - 31 * DAY) },
    { id: SIT_OTHER, user_id: OTHER.id, title: 'Someone else secret plan', status: 'open', last_activity_at: at(NOW), created_at: at(NOW) },
    ...extraSituations,
  ],
  reads: [
    { id: uuid(110), situation_id: SIT_DONE, headline: 'Nobody has said yes or no.', body: ['They asked three weeks ago.'], closing_question: 'Have you gone back?', closing_answer: 'No.', answered_at: at(NOW - 9 * HOUR), skipped: false, created_at: at(NOW - 9 * HOUR) },
    { id: uuid(111), situation_id: SIT_OPEN, headline: 'You have not posted the role.', body: ['No post yet.'], closing_question: 'Why not?', closing_answer: null, answered_at: null, skipped: false, created_at: at(NOW - 2 * DAY) },
  ],
  learn_conversations: [{ id: uuid(200), situation_id: SIT_DONE, user_id: USER.id, created_at: at(NOW - 9 * HOUR) }],
  learn_turns: [
    { id: uuid(210), seq: 1, conversation_id: uuid(200), role: 'axiom', kind: 'lesson', text: 'Ask for the call directly.', sources: [{ handle: 'S1', author: 'Rob Fitzpatrick', book: 'The Mom Test', quote: 'Talk about their life.' }], created_at: at(NOW - 9 * HOUR) },
    { id: uuid(211), seq: 2, conversation_id: uuid(200), role: 'axiom', kind: 'followup', text: 'More.', sources: [{ handle: 'S1', author: 'Rob Fitzpatrick', book: 'The Mom Test', quote: 'Talk about their life.' }], created_at: at(NOW - 9 * HOUR) },
  ],
  moves,
  reports: reports ?? [],
  user_settings: settings,
  push_tokens: tokens,
  care_events: care,
  consent_log: [],
  peer_outcomes: [{ id: uuid(900), status: 'pending_review', draft: { note: 'x' } }],
  outcome_author_links: [{ peer_outcome_id: uuid(900), user_id: USER.id, report_id: uuid(500), created_at: at(NOW) }],
})

// wrap(base) => the supabase the app uses (to fail or watch one table).
async function setup({ wrap = (b) => b, ...opts } = {}) {
  const base = createFakeSupabase({ users: { tok: USER, tok2: OTHER }, tables: seed(opts), unique: UNIQUE })
  const clock = createFakeClock(NOW)
  const app = createApp({ env: ENV, supabase: wrap(base), openai: createFakeOpenAI([]), clock })
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
    return { status: res.status, body: text.startsWith('{') ? JSON.parse(text) : text, text }
  }
  return { call: as('tok'), callOther: as('tok2'), callAnon: as(null), clock, rows: (t) => base.rows(t), close: () => new Promise((r) => server.close(r)) }
}

// The database's unique indexes these routes rely on (schema_needs.md).
const UNIQUE = {
  user_settings: [{ cols: ['user_id'] }],
  founder_profiles: [{ cols: ['user_id'] }],
  account_requests: [{ cols: ['user_id', 'kind'], where: (r) => r.status === 'queued' }],
}

// A supabase whose `method` on `table` answers with a database error.
const failing = (table, method) => (base) => ({
  ...base,
  from(t) {
    const b = base.from(t)
    if (t !== table) return b
    b[method] = () => {
      b.then = (resolve, reject) => Promise.resolve({ data: null, error: { code: 'XX000', message: 'db down' } }).then(resolve, reject)
      return b
    }
    return b
  },
})

// ── Greeting ─────────────────────────────────────────────────────────────────

test('greeting: time of day, name inside the sentence, goal only when it fits', () => {
  assert.equal(contextOf({ hour: 6, weekday: 'Monday' }), 'early')
  assert.equal(contextOf({ hour: 9, weekday: 'Monday' }), 'morning')
  assert.equal(contextOf({ hour: 13, weekday: 'Monday' }), 'midday')
  assert.equal(contextOf({ hour: 20, weekday: 'Monday' }), 'evening')
  assert.equal(contextOf({ hour: 2, weekday: 'Monday' }), 'late')
  assert.equal(contextOf({ hour: 10, weekday: 'Sunday' }), 'weekend')
  assert.equal(goalPhrase('My first 10 customers'), 'your first 10 customers')
  assert.equal(goalPhrase('Quit my job'), null)
  assert.equal(daysTo('2027-01-26', NOW), 93)
  assert.equal(daysTo('2026-10-01', NOW), null)

  const evening = pickGreeting({ nowMs: NOW, timeZone: 'Asia/Karachi', name: 'Sam' })
  assert.equal(evening.kind, 'evening')
  assert.match(evening.text, /^Day's nearly done, Sam\./)
  assert.doesNotMatch(pickGreeting({ nowMs: NOW, timeZone: 'Asia/Karachi', name: null }).text, /\{|, \./)
  const morning = Date.parse('2026-10-26T04:00:00Z') // 9 am Karachi
  const ids = new Set()
  for (let d = 0; d < 6; d += 1) ids.add(pickGreeting({ nowMs: morning + d * DAY, timeZone: 'Asia/Karachi', name: 'Sam', goal: 'My first 10 customers', deadline: '2027-01-26' }).id)
  assert.ok(ids.has('morning:goal'))
  const goal = pickGreeting({ nowMs: morning, timeZone: 'Asia/Karachi', name: 'Sam', goal: 'My first 10 customers', deadline: '2027-01-26', lastId: null })
  if (goal.id === 'morning:goal') assert.match(goal.text, /^93 days to your first 10 customers, Sam\./)
  const noGoal = pickGreeting({ nowMs: morning, timeZone: 'Asia/Karachi', name: 'Sam', goal: 'Quit my job', deadline: '2027-01-26' })
  assert.notEqual(noGoal.id, 'morning:goal')
})

test('greeting: never the same twice, and every line is in Axiom\'s voice', () => {
  for (const [kind, lines] of Object.entries(GREETINGS)) {
    assert.ok(lines.length >= 1, kind)
    for (const g of lines) {
      for (const phrase of [...BANNED_PHRASES, 'great question', 'certainly', 'i understand', 'absolutely', 'of course', "i'd be happy"]) {
        assert.ok(!g.text.toLowerCase().includes(String(phrase).toLowerCase()), `${g.id} holds ${phrase}`)
      }
      assert.ok(!/\b(he|she|his|her|him|guys|man|sir|ma'am|bro)\b/i.test(g.text), `${g.id} assumes gender`)
      assert.ok(!/great|sorry|!/i.test(g.text), `${g.id} breaks the voice guide`)
    }
  }
  for (const nowMs of [Date.parse('2026-10-26T01:00:00Z'), Date.parse('2026-10-26T04:00:00Z'), Date.parse('2026-10-26T08:00:00Z'), NOW, Date.parse('2026-10-26T20:00:00Z'), Date.parse('2026-10-31T06:00:00Z')]) {
    const first = pickGreeting({ nowMs, timeZone: 'Asia/Karachi', name: 'Sam' })
    const second = pickGreeting({ nowMs, timeZone: 'Asia/Karachi', name: 'Sam', lastId: first.id })
    assert.notEqual(second.id, first.id, first.kind)
  }
})

// ── Home ─────────────────────────────────────────────────────────────────────

test('home: greeting, at most 2 small items that fade, and the menu lists', async () => {
  const { call, rows, close } = await setup({ moves: [move(), move({ id: uuid(301), situation_id: SIT_OPEN, status: 'committed', active_slot: 2, title: 'Post the role.', report_due_at: at(NOW + 20 * HOUR), committed_at: at(NOW - HOUR) })] })
  try {
    const res = await call('GET', '/api/home')
    assert.equal(res.status, 200)
    const b = res.body
    assert.equal(b.care_check_in, false)
    assert.equal(b.greeting.kind, 'evening')
    assert.match(b.greeting.text, /Sam/)
    assert.equal(b.fade_after_ms, FADE_AFTER_MS)
    assert.equal(b.items.length, 2)
    assert.deepEqual(b.items.map((i) => i.kind), ['report', 'move'])
    assert.equal(b.items[0].label, ITEM_LABELS.report)
    assert.equal(b.items[1].label, 'Today: post the role')
    assert.deepEqual(b.items.map((i) => i.stays), [false, false])
    assert.deepEqual(b.items[0].target, { stage: 'report', situation_id: SIT_DONE, move_id: MOVE_DUE })
    assert.deepEqual(b.drawer.open.map((s) => s.id), [SIT_DONE, SIT_OPEN])
    assert.deepEqual(b.drawer.paused.map((s) => s.id), [SIT_OLD])
    assert.deepEqual(b.drawer.recent.map((s) => s.id), [SIT_DONE, SIT_OPEN, SIT_OLD])
    assert.deepEqual(b.due_reports.map((r) => r.move_id), [MOVE_DUE])
    assert.ok(!res.text.includes('Someone else'))
    assert.ok(!/streak|score|strike|warning/i.test(res.text))
    // The greeting id is kept, the next visit shows a different line.
    assert.equal(rows('user_settings')[0].last_greeting, b.greeting.kind + ':' + rows('user_settings')[0].last_greeting.split(':')[1])
    const again = await call('GET', '/api/home')
    assert.notEqual(again.body.greeting.text, b.greeting.text)
  } finally { await close() }
})

test('home: nothing open shows no items; an unfinished situation is the one next step; refused reminders keep the evening item', async () => {
  const quiet = await setup({ extraSituations: [] })
  try {
    const res = await quiet.call('GET', '/api/home')
    assert.deepEqual(res.body.items.map((i) => [i.kind, i.label]), [['situation', 'Pick up: pricing emails to clinics']])
    assert.deepEqual(res.body.items[0].target, { stage: 'learn', situation_id: SIT_DONE })
  } finally { await quiet.close() }

  const refused = await setup({ moves: [move()], tokens: [], settings: [{ user_id: USER.id, keep_items: true }] })
  try {
    const res = await refused.call('GET', '/api/home')
    assert.equal(res.body.reminders.push_registered, false)
    assert.equal(res.body.items[0].stays, true)
    assert.equal(res.body.items[1].stays, true)
  } finally { await refused.close() }
})

test('home: while care is open only the gentle check-in shows; the answer closes it and is never stored', async () => {
  const care = [{ id: uuid(800), user_id: USER.id, level: 'clear', scope_id: null, created_at: at(NOW - HOUR), resolved_at: null }]
  const { call, rows, close } = await setup({ moves: [move()], care })
  try {
    const res = await call('GET', '/api/home')
    assert.deepEqual([res.body.greeting.text, res.body.items, res.body.due_reports, res.body.care_check_in], [CARE_COPY.returnCheckIn, [], [], true])
    assert.equal(rows('user_settings').length, 0)

    assert.equal((await call('POST', '/api/home/checkin', {})).status, 400)
    assert.equal(rows('care_events')[0].resolved_at, null)
    const worrying = await call('POST', '/api/home/checkin', { text: 'I want to kill myself' })
    assert.equal(worrying.body.care, 'clear')
    const ok = await call('POST', '/api/home/checkin', { text: 'Better today, thanks' })
    assert.deepEqual(ok.body, { ok: true })
    assert.ok(rows('care_events').every((e) => e.resolved_at))
    assert.ok(!JSON.stringify(rows('care_events')).includes('Better today'))
    assert.equal((await call('GET', '/api/home')).body.care_check_in, false)
  } finally { await close() }
})

// ── History ──────────────────────────────────────────────────────────────────

const REPORT = { id: uuid(500), user_id: USER.id, move_id: MOVE_DUE, situation_id: SIT_DONE, outcome: 'done', note: 'One replied.', reply: 'Good. Confirm Thursday.', prediction: 'One will not reply.', prediction_check: 'right', share_state: 'shared', created_at: at(NOW - HOUR) }

test('history: newest first, one status word each, search, own situations only', async () => {
  const { call, callOther, close } = await setup({ moves: [move({ status: 'reported', active_slot: null })], reports: [REPORT] })
  try {
    const list = await call('GET', '/api/history')
    assert.deepEqual(list.body.items.map((i) => [i.id, i.status, i.status_label]), [
      [SIT_DONE, 'done', 'Done'], [SIT_OPEN, 'open', 'Open'], [SIT_OLD, 'paused', 'Paused'],
    ])
    assert.deepEqual((await call('GET', '/api/history?q=HIRING')).body.items.map((i) => i.id), [SIT_OPEN])
    assert.deepEqual((await call('GET', '/api/history?q=nothing')).body, { items: [] })
    assert.equal((await call('GET', `/api/history?q=${'x'.repeat(101)}`)).status, 400)
    assert.deepEqual((await callOther('GET', '/api/history')).body.items.map((i) => i.id), [SIT_OTHER])
  } finally { await close() }
})

test('history detail: read, lesson with author and book, move, how it went, shared or private, one action; nobody else\'s', async () => {
  const { call, callOther, callAnon, close } = await setup({ moves: [move({ status: 'reported', active_slot: null })], reports: [REPORT] })
  try {
    const res = await call('GET', `/api/history/${SIT_DONE}`)
    assert.equal(res.status, 200)
    const b = res.body
    assert.deepEqual([b.status, b.status_label], ['done', 'Done'])
    assert.equal(b.what_i_read.headline, 'Nobody has said yes or no.')
    assert.deepEqual(b.what_you_learned, { text: 'Ask for the call directly.', sources: [{ author: 'Rob Fitzpatrick', book: 'The Mom Test', quote: 'Talk about their life.' }] })
    assert.deepEqual(b.your_move, { title: 'Ask both clinics for a call.', mission: 'Email the 2 clinics.', success: 'Both reply.' })
    assert.equal(b.how_it_went.sharing, 'shared')
    assert.equal(b.how_it_went.outcome, 'done')
    assert.deepEqual(b.action, { kind: 'talk_again', label: 'Talk about this again', target: { stage: 'learn', situation_id: SIT_DONE } })
    for (const bad of [USER.id, 'user_id', 'peer_outcome', uuid(900), 'handle', 'evidence']) assert.ok(!res.text.includes(bad), `leaks ${bad}`)

    const open = await call('GET', `/api/history/${SIT_OPEN}`)
    assert.deepEqual([open.body.what_you_learned, open.body.your_move, open.body.how_it_went], [null, null, null])
    assert.deepEqual(open.body.action, { kind: 'pick_up', label: 'Pick it up', target: { stage: 'read', situation_id: SIT_OPEN } })
    const old = await call('GET', `/api/history/${SIT_OLD}`)
    assert.deepEqual(old.body.action, { kind: 'bring_back', label: 'Bring it back', target: { stage: 'situation', situation_id: SIT_OLD } })

    const due = await setup({ moves: [move()] })
    try { assert.deepEqual((await due.call('GET', `/api/history/${SIT_DONE}`)).body.action.target, { stage: 'report', situation_id: SIT_DONE, move_id: MOVE_DUE }) } finally { await due.close() }

    const priv = await setup({ moves: [move({ status: 'reported', active_slot: null })], reports: [{ ...REPORT, share_state: 'withdrawn' }] })
    try { assert.equal((await priv.call('GET', `/api/history/${SIT_DONE}`)).body.how_it_went.sharing, 'private') } finally { await priv.close() }

    for (const id of [SIT_DONE, SIT_OTHER, 'not-a-uuid', uuid(999)]) {
      const r = await callOther('GET', `/api/history/${id}`)
      if (id === SIT_OTHER) assert.equal(r.status, 200)
      else assert.deepEqual([r.status, r.body], [404, { error: 'Not found' }], id)
    }
    assert.equal((await callAnon('GET', `/api/history/${SIT_DONE}`)).status, 401)
  } finally { await close() }
})

// ── Settings ─────────────────────────────────────────────────────────────────

test('settings: defaults (share automatically off), and every change goes through the API', async () => {
  const { call, rows, close } = await setup()
  try {
    const got = await call('GET', '/api/settings')
    assert.equal(got.status, 200)
    assert.deepEqual(got.body.you, { name: 'Sam', email: USER.email, country: 'Pakistan', timezone: 'Asia/Karachi' })
    assert.equal(got.body.privacy.share_automatically, false)
    assert.deepEqual([got.body.mentor_style, got.body.keep_items], ['direct', false])
    assert.deepEqual([got.body.reminders.lock_screen, got.body.reminders.morning_on, got.body.reminders.evening_on], ['short', true, true])
    assert.equal(rows('user_settings').length, 0) // reading writes nothing

    const patched = await call('PUT', '/api/settings', {
      mentor_style: 'calm', keep_items: true, lock_screen: 'hidden', evening_on: false, checkin_time: '19:30', share_automatically: true,
    })
    assert.equal(patched.status, 200)
    assert.deepEqual([patched.body.mentor_style, patched.body.keep_items, patched.body.privacy.share_automatically], ['calm', true, true])
    assert.deepEqual([patched.body.reminders.lock_screen, patched.body.reminders.evening_on, patched.body.reminders.checkin_time], ['hidden', false, '19:30'])
    assert.deepEqual(rows('consent_log').map((l) => l.action), ['auto_share_on'])
    assert.equal((await call('GET', '/api/settings')).body.mentor_style, 'calm')
    await call('PUT', '/api/settings', { share_automatically: false })
    assert.deepEqual(rows('consent_log').map((l) => l.action), ['auto_share_on', 'auto_share_off'])
  } finally { await close() }
})

test('settings: bad input is a plain 400 and changes nothing; no auth is 401', async () => {
  const { call, callAnon, rows, close } = await setup()
  try {
    for (const body of [
      {}, [], { mentor_style: 'harsh' }, { keep_items: 'yes' }, { share_automatically: 1 }, { lock_screen: 'everything' },
      { colour: 'red' }, { mentor_style: 'calm', checkin_time: '25:99' }, { mentor_style: 'calm', quiet_hours: { start: '19:00', end: '21:00' }, checkin_time: '20:00' },
    ]) {
      const res = await call('PUT', '/api/settings', body)
      assert.equal(res.status, 400, JSON.stringify(body))
      assert.equal(typeof res.body.error, 'string')
    }
    assert.equal(rows('user_settings').length, 0)
    assert.equal(rows('consent_log').length, 0)
    assert.equal((await callAnon('GET', '/api/settings')).status, 401)
    assert.equal((await callAnon('PUT', '/api/settings', { keep_items: true })).status, 401)
  } finally { await close() }
})

// ── Account ──────────────────────────────────────────────────────────────────

test('account: with the switch off, delete asks for DELETE, records the request and deletes nothing', async () => {
  const { call, callAnon, rows, close } = await setup({ moves: [move()] })
  try {
    const tables = ['situations', 'moves', 'reads', 'reports', 'user_settings', 'founder_profiles', 'users', 'consent_log', 'learn_turns', 'peer_outcomes', 'outcome_author_links']
    const before = JSON.stringify(tables.map(rows))
    for (const bad of [undefined, {}, { confirm: 'delete' }, { confirm: true }]) {
      const refused = await call('DELETE', '/api/account', bad)
      assert.deepEqual([refused.status, refused.body.error], [400, ACCOUNT_COPY.confirmNeeded])
    }
    assert.equal(rows('account_requests').length, 0)
    const res = await call('DELETE', '/api/account', { confirm: 'DELETE' })
    assert.equal(res.status, 200)
    assert.deepEqual([res.body.status, res.body.deleted, res.body.plan, res.body.message], ['recorded', false, DELETION_PLAN, ACCOUNT_COPY.deleteRecorded])
    await call('DELETE', '/api/account', { confirm: 'DELETE' })
    assert.equal(JSON.stringify(tables.map(rows)), before)
    assert.deepEqual(rows('account_requests').map((r) => [r.user_id, r.kind, r.status]), [[USER.id, 'delete', 'queued']])
    assert.equal((await callAnon('DELETE', '/api/account')).status, 401)
    assert.equal((await callAnon('POST', '/api/account/export')).status, 401)
    assert.equal((await callAnon('DELETE', '/api/account', { confirm: 'DELETE' })).status, 401)
  } finally { await close() }
})

test('settings: name, time zone, sign-up answers and links', async () => {
  const { call, rows, close } = await setup()
  try {
    const got = (await call('GET', '/api/settings')).body
    assert.equal(got.you.timezone, 'Asia/Karachi')
    assert.deepEqual(got.signup_answers.stage, FULL_ANSWERS.stage)
    assert.deepEqual(got.links, { privacy: null, terms: null })
    const put = await call('PUT', '/api/settings', { name: ' Samira ', timezone: 'Europe/London' })
    assert.deepEqual([put.status, put.body.you.name, put.body.you.timezone], [200, 'Samira', 'Europe/London'])
    assert.equal(rows('users')[0].first_name, 'Samira')
    for (const bad of [{ name: '' }, { name: 5 }, { timezone: 'Mars/Base' }, { timezone: 7 }]) {
      assert.equal((await call('PUT', '/api/settings', bad)).status, 400, JSON.stringify(bad))
    }
    assert.equal(rows('users')[0].first_name, 'Samira')
  } finally { await close() }
})

test('history search reaches what the founder said and the Read headline', async () => {
  const { call, close } = await setup({ extraSituations: [] })
  try {
    assert.deepEqual((await call('GET', '/api/history?q=nobody has said')).body.items.map((i) => i.id), [SIT_DONE])
  } finally { await close() }
})

test('no founder text, name or id reaches the logs', async () => {
  const logged = []
  const original = console.error
  console.error = (...args) => logged.push(args.join(' '))
  const { call, close } = await setup({ moves: [move()] })
  try {
    await call('GET', '/api/home')
    await call('GET', '/api/history?q=secret')
    await call('PUT', '/api/settings', { name: 'Zed', timezone: 'Mars/Base' })
    await call('POST', '/api/home/checkin', { text: 'private words here' })
    await call('DELETE', '/api/account', { confirm: 'DELETE' })
  } finally { console.error = original; await close() }
  for (const line of logged) for (const bad of [USER.id, USER.email, 'Sam', 'Zed', 'private words', 'secret']) assert.ok(!line.includes(bad), `log holds ${bad}`)
})

test('home routes need sign-in', async () => {
  const { callAnon, close } = await setup()
  try {
    for (const [m, p] of [['GET', '/api/home'], ['POST', '/api/home/checkin'], ['GET', '/api/history'], ['GET', `/api/history/${SIT_DONE}`]]) {
      assert.equal((await callAnon(m, p, m === 'POST' ? {} : undefined)).status, 401, p)
    }
  } finally { await close() }
})

// ── Audit fixes ──────────────────────────────────────────────────────────────

test('greeting placeholders are filled in one pass; filled text is never read as a placeholder', () => {
  assert.equal(fillGreeting('{hour} am, {name}. What is the plan?', { hour: 6, name: '{day}', day: 'Monday' }), '6 am, {day}. What is the plan?')
  assert.equal(fillGreeting('{days} days to {goal}, {name}.', { days: 9, goal: 'your {name} list', name: 'Sam' }), '9 days to your {name} list, Sam.')
  assert.equal(fillGreeting('Still up, {name}? Make it count.', { name: null }), 'Still up? Make it count.')
})

test('check-in: when the care event cannot be closed, the answer is an error, never ok', async () => {
  const care = [{ id: uuid(800), user_id: USER.id, level: 'clear', scope_id: null, created_at: at(NOW - HOUR), resolved_at: null }]
  const { call, rows, close } = await setup({ care, wrap: failing('care_events', 'update') })
  try {
    const res = await call('POST', '/api/home/checkin', { text: 'Better today, thanks' })
    assert.equal(res.status, 500)
    assert.notDeepEqual(res.body, { ok: true })
    assert.equal(rows('care_events')[0].resolved_at, null)
  } finally { await close() }
})

test('settings: every check runs before any write, so a refused change writes nothing', async () => {
  const { call, rows, close } = await setup()
  try {
    // The time zone is fine, the check-in time falls in quiet hours: nothing changes.
    const res = await call('PUT', '/api/settings', { timezone: 'Europe/London', mentor_style: 'calm', checkin_time: '23:30' })
    assert.deepEqual([res.status, res.body.error], [400, 'checkin_time falls inside quiet hours'])
    assert.equal(res.body.code, 'quiet_hours_clash')
    assert.equal(rows('founder_profiles')[0].timezone, 'Asia/Karachi')
    assert.equal(rows('user_settings').length, 0)
  } finally { await close() }

  const early = await setup({ signedUp: false })
  try {
    for (const body of [{ keep_items: true, checkin_time: '21:00' }, { keep_items: true, timezone: 'Europe/London' }]) {
      const res = await early.call('PUT', '/api/settings', body)
      assert.deepEqual([res.status, res.body.error], [400, 'Finish sign-up first.'], JSON.stringify(body))
    }
    assert.equal(early.rows('founder_profiles').length, 0) // no stub profile before sign-up
    assert.equal(early.rows('user_settings').length, 0)
  } finally { await early.close() }
})

test('share automatically: the consent row is written first; if it fails the setting does not change', async () => {
  const base = createFakeSupabase({ tables: { user_settings: [], consent_log: [] } })
  const sharing = createSharing({ supabase: failing('consent_log', 'insert')(base), clock: createFakeClock(NOW) })
  await assert.rejects(sharing.setShareAuto(USER.id, true))
  assert.equal(base.rows('user_settings').length, 0)
  assert.equal(await sharing.shareAuto(USER.id), false)
})

test('account: two delete requests at once leave one queued row and both are answered', async () => {
  const base = createFakeSupabase({ tables: { account_requests: [] }, unique: UNIQUE })
  const account = createAccount({ supabase: base, clock: createFakeClock(NOW) })
  const ask = () => account.requestDelete(USER.id, { confirm: 'DELETE' }, false)
  const [a, b] = await Promise.all([ask(), ask()])
  assert.deepEqual([a.status, b.status, a.requested_at], ['recorded', 'recorded', b.requested_at])
  assert.equal(base.rows('account_requests').length, 1)
})

test('home says nothing about a queued delete request', async () => {
  const { call, close } = await setup({ moves: [move()] })
  try {
    const before = (await call('GET', '/api/home')).body
    await call('DELETE', '/api/account', { confirm: 'DELETE' })
    const after = await call('GET', '/api/home')
    assert.deepEqual(Object.keys(after.body), Object.keys(before))
    assert.doesNotMatch(after.text, /delet|account|request/i)
  } finally { await close() }
})

test('history search runs in the database, escaped, over this founder only', async () => {
  assert.equal(containsPattern('50%_off\\'), '%50\\%\\_off\\\\%')
  assert.equal(containsPattern('a*b'), '%a_b%')
  const searched = []
  const watch = (base) => ({
    ...base,
    from(t) {
      const b = base.from(t)
      const { ilike } = b
      b.ilike = (col, pattern) => { searched.push([t, col]); return ilike(col, pattern) }
      return b
    },
  })
  const { call, close } = await setup({ wrap: watch, extraSituations: [{ id: uuid(104), user_id: USER.id, title: 'Hiring a 1st engineer', status: 'open', last_activity_at: at(NOW - DAY), created_at: at(NOW - DAY) }] })
  try {
    assert.deepEqual((await call('GET', '/api/history?q=nobody has said')).body.items.map((i) => i.id), [SIT_DONE])
    assert.deepEqual(searched.map(([t, c]) => `${t}.${c}`).sort(), ['reads.headline', 'situation_turns.text', 'situations.title'])
    // _ and % are literal, not wildcards.
    assert.deepEqual((await call('GET', '/api/history?q=1_t')).body.items, [])
    assert.deepEqual((await call('GET', '/api/history?q=%25')).body.items, [])
    assert.deepEqual((await call('GET', '/api/history?q=1st')).body.items.map((i) => i.id), [uuid(104)])
    // Another founder's title never matches.
    assert.deepEqual((await call('GET', '/api/history?q=secret plan')).body.items, [])
  } finally { await close() }
})
