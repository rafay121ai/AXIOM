import assert from 'node:assert/strict'
import test from 'node:test'
import { createApp } from '../app.js'
import { createFakeClock, createFakeOpenAI, createFakePushSender, createFakeSupabase } from '../testing/fakes.js'
import { FULL_ANSWERS } from '../journey/fixtures.js'
import { createPushScheduler } from '../push/scheduler.js'
import { composePush } from '../push/compose.js'
import { decidePush } from '../push/policy.js'
import { ITEM_LABELS } from '../journey/home/wording.js'
import { firedTriggers, goalNear, twoMisses } from './triggers.js'
import { createProactive, OPENER_CLOSE_MS } from './run.js'
import { openerText } from './wording.js'

const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'founder@example.com', user_metadata: { given_name: 'Sam' } }
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
const NOW = Date.parse('2026-11-04T09:00:00.000Z') // 2 pm in Karachi
const at = (ms) => new Date(ms).toISOString()
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const KARACHI = 'Asia/Karachi'

// ── Triggers ─────────────────────────────────────────────────────────────────

test('goal_near: 14 and 3 day windows, days counted on the founder\'s calendar', () => {
  const days = (n, zone = 'UTC', now = NOW) => goalNear({ nowMs: now, timeZone: zone, deadline: at(now + n * DAY).slice(0, 10), goal: 'My first 10 customers' })
  assert.equal(days(15), null)
  assert.equal(days(14).key, `goal:${at(NOW + 14 * DAY).slice(0, 10)}:14`)
  assert.equal(days(4).facts.window, 14)
  assert.equal(days(3).facts.window, 3)
  assert.equal(days(1).facts.window, 3)
  assert.equal(days(0), null)
  assert.equal(days(-2), null, 'nothing once the date has passed')
  assert.equal(goalNear({ nowMs: NOW, timeZone: 'UTC', deadline: '2026-11-18', goal: '  ' }), null)

  // 01:00 on 21 Nov in Karachi is still 20 Nov in UTC: 14 days to 5 Dec there, 15 in UTC.
  const lateUtc = Date.parse('2026-11-20T20:00:00Z')
  assert.equal(goalNear({ nowMs: lateUtc, timeZone: KARACHI, deadline: '2026-12-05', goal: 'My first 10 customers' }).facts.days, 14)
  assert.equal(goalNear({ nowMs: lateUtc, timeZone: 'UTC', deadline: '2026-12-05', goal: 'My first 10 customers' }), null)
  // Across midnight the other way: 03:00 on 5 Dec in UTC is 08:00 in Karachi, deadline today there.
  assert.equal(goalNear({ nowMs: Date.parse('2026-12-04T20:00:00Z'), timeZone: KARACHI, deadline: '2026-12-05', goal: 'My first 10 customers' }), null)
})

const report = (n, outcome, move_title = `Move ${n}.`) => ({ id: uuid(n), outcome, created_at: at(NOW - (10 - n) * DAY), move_title })

test('two_misses: the last two reports by date, both Couldn\'t or Didn\'t', () => {
  const hit = twoMisses({ nowMs: NOW, reports: [report(1, 'done'), report(3, 'couldnt', 'Email the clinics.'), report(2, 'didnt', 'Call Bilal.')] })
  assert.deepEqual(hit, { source: 'reports', key: `misses:${uuid(3)}`, kind: 'two_misses', facts: { moves: ['Call Bilal.', 'Email the clinics.'] } })
  assert.equal(twoMisses({ nowMs: NOW, reports: [report(1, 'didnt'), report(2, 'done'), report(3, 'couldnt')] }), null, 'a Done in between')
  assert.equal(twoMisses({ nowMs: NOW, reports: [report(1, 'done'), report(2, 'couldnt')] }), null)
  assert.equal(twoMisses({ nowMs: NOW, reports: [report(1, 'couldnt')] }), null)
  assert.equal(twoMisses({ nowMs: NOW, reports: [report(1, 'couldnt'), report(2, 'didnt', ' ')] }), null)
  // The last miss must be from the past week: an old pair is not raised at launch.
  assert.ok(twoMisses({ nowMs: NOW + DAY, reports: [report(2, 'couldnt'), report(3, 'didnt')] }), '7 days old: still raised')
  assert.equal(twoMisses({ nowMs: NOW + 2 * DAY, reports: [report(2, 'couldnt'), report(3, 'didnt')] }), null, '8 days old')
})

test('triggers: priority is goal in 3 days, two misses, goal in 14 days', () => {
  const reports = [report(1, 'couldnt'), report(2, 'didnt')]
  const input = (deadline) => ({ nowMs: NOW, timeZone: 'UTC', deadline, goal: 'My first 10 customers', reports })
  assert.deepEqual(firedTriggers(input('2026-11-06')).map((t) => t.key), ['goal:2026-11-06:3', `misses:${uuid(2)}`])
  assert.deepEqual(firedTriggers(input('2026-11-14')).map((t) => t.kind), ['two_misses', 'goal_near'])
  assert.deepEqual(firedTriggers(input('2027-06-01')).map((t) => t.kind), ['two_misses'])
})

test('opener wording: the approved sentences, filled with the founder\'s words', () => {
  const goal = goalNear({ nowMs: NOW, timeZone: 'UTC', deadline: '2026-11-15', goal: 'My first 10 customers' })
  assert.equal(openerText(goal.kind, goal.facts), 'You said "My first 10 customers" by 15 November 2026. That is 11 days away. Where is it now?')
  const soon = goalNear({ nowMs: NOW, timeZone: 'UTC', deadline: '2026-11-07', goal: 'My first 10 customers' })
  assert.equal(openerText(soon.kind, soon.facts), '3 days to 7 November 2026, and you said "My first 10 customers". What is left?')
  const quoted = goalNear({ nowMs: NOW, timeZone: 'UTC', deadline: '2026-11-15', goal: 'Ship "v2"' })
  assert.equal(openerText(quoted.kind, quoted.facts), "You said \"Ship 'v2'\" by 15 November 2026. That is 11 days away. Where is it now?")
  const last = goalNear({ nowMs: NOW, timeZone: 'UTC', deadline: '2026-11-05', goal: 'My first 10 customers' })
  assert.equal(openerText(last.kind, last.facts), '1 day to 5 November 2026, and you said "My first 10 customers". What is left?')
  assert.equal(openerText('two_misses', { moves: ['Call Bilal.', 'Email the clinics.'] }), 'Your last two moves did not happen: call Bilal and email the clinics. What got in the way?')
})

// ── The gate and the job ─────────────────────────────────────────────────────

const UNIQUE = {
  situations: [{ cols: ['user_id', 'trigger_key'] }],
  notification_log: [{ cols: ['user_id', 'dedupe_key'] }, { cols: ['user_id', 'local_day', 'slot'], where: (r) => r.status === 'sending' || r.status === 'sent' }],
  push_tokens: [{ cols: ['token'] }],
  user_settings: [{ cols: ['user_id'] }],
  founder_profiles: [{ cols: ['user_id'] }],
  account_requests: [{ cols: ['user_id', 'kind'], where: (r) => r.status === 'queued' }],
}

const sit = (n, over = {}) => ({ id: uuid(n), user_id: USER.id, title: `Situation ${n}`, status: 'open', follow_up_count: 0, last_activity_at: at(NOW - DAY), created_at: at(NOW - 2 * DAY), ...over })
const opener = (n, ageMs, over = {}) => sit(n, { started_by: 'axiom', trigger_key: `old:${n}`, created_at: at(NOW - ageMs), last_activity_at: at(NOW - ageMs), ...over })

function setup({ tables = {}, now = NOW, care = false, timezone = KARACHI, deadline = '2026-11-15', wrap = (b) => b } = {}) {
  const base = createFakeSupabase({
    unique: UNIQUE,
    tables: {
      founder_profiles: [{ user_id: USER.id, timezone, deadline, signup_answers: FULL_ANSWERS }],
      situations: [sit(1)],
      ...tables,
    },
  })
  const clock = createFakeClock(now)
  const logged = []
  const supabase = wrap(base)
  const proactive = createProactive({ supabase, clock, isCareOpen: async () => care, log: (what) => logged.push(what) })
  return { base, clock, logged, proactive, supabase, made: () => base.rows('situations').filter((s) => s.started_by === 'axiom' && s.trigger_key?.startsWith('goal:')) }
}

test('job: makes one opener, a situation in the founder\'s words with Axiom\'s line as turn 1', async () => {
  const s = setup()
  assert.equal(await s.proactive.run(), 1)
  const [made] = s.made()
  assert.equal(made.trigger_key, 'goal:2026-11-15:14')
  assert.equal(made.title, 'My first 10 customers')
  assert.equal(made.status, 'open')
  const turns = s.base.rows('situation_turns')
  assert.deepEqual(turns.map((t) => [t.situation_id, t.role, t.text]), [[made.id, 'axiom', 'You said "My first 10 customers" by 15 November 2026. That is 11 days away. Where is it now?']])
  assert.equal(await s.proactive.run(), 0, 'the same trigger is never made twice')
})

test('job: the second miss opener titles the situation with the second move', async () => {
  const s = setup({
    deadline: null,
    tables: {
      moves: [{ id: uuid(70), user_id: USER.id, title: 'Call Bilal.', committed_at: at(NOW - 5 * DAY) }, { id: uuid(71), user_id: USER.id, title: 'Email the clinics.', committed_at: at(NOW - 3 * DAY) }],
      reports: [{ id: uuid(80), user_id: USER.id, move_id: uuid(70), outcome: 'didnt', created_at: at(NOW - 4 * DAY) }, { id: uuid(81), user_id: USER.id, move_id: uuid(71), outcome: 'couldnt', created_at: at(NOW - 2 * DAY) }],
    },
  })
  assert.equal(await s.proactive.run(), 1)
  const made = s.base.rows('situations').find((x) => x.started_by === 'axiom')
  assert.deepEqual([made.trigger_key, made.title], [`misses:${uuid(81)}`, 'Email the clinics.'])
})

const skips = {
  'a care event is open': { care: true },
  'a delete request is waiting': { tables: { account_requests: [{ id: uuid(60), user_id: USER.id, kind: 'delete', status: 'pending' }] } },
  'pushes are paused for inactivity': { tables: { situations: [sit(1, { last_activity_at: at(NOW - 15 * DAY) })] } },
  'an earlier opener is unanswered and under 7 days old': { tables: { situations: [sit(1), opener(2, 5 * DAY)] } },
  'the last opener is under 3 days old (even one that was answered)': { tables: { situations: [sit(1), opener(2, 2 * DAY)], situation_turns: [{ id: uuid(90), situation_id: uuid(2), role: 'founder', text: 'x' }] } },
  'it is before 07:00 where the founder is': { now: Date.parse('2026-11-04T01:00:00Z') }, // 6 am in Karachi
}
for (const [why, opts] of Object.entries(skips)) {
  test(`gate: nothing when ${why}`, async () => {
    const s = setup(opts)
    const before = s.base.rows('situations').length
    assert.equal(await s.proactive.run(), 0)
    assert.equal(s.base.rows('situations').length, before)
  })
}

test('gate: from 07:00 local, and an answered opener older than 3 days does not block', async () => {
  const s = setup({
    now: Date.parse('2026-11-04T02:00:00Z'), // 7 am in Karachi
    tables: { situations: [sit(1), opener(2, 4 * DAY)], situation_turns: [{ id: uuid(90), situation_id: uuid(2), role: 'founder', text: 'x' }] },
  })
  assert.equal(await s.proactive.run(), 1)
})

test('a founder without a deadline and without misses gets nothing', async () => {
  assert.equal(await setup({ deadline: null }).proactive.run(), 0)
})

test('an opener nobody answered in 7 days closes quietly; an answered one stays open', async () => {
  const s = setup({
    tables: {
      situations: [sit(1), opener(2, OPENER_CLOSE_MS + HOUR), opener(3, OPENER_CLOSE_MS + HOUR)],
      situation_turns: [{ id: uuid(90), situation_id: uuid(3), role: 'founder', text: 'x' }],
    },
  })
  await s.proactive.run()
  const status = (n) => s.base.rows('situations').find((x) => x.id === uuid(n))
  assert.equal(status(2).status, 'closed')
  assert.equal(status(2).title, 'Situation 2', 'nothing else changes')
  assert.equal(status(3).status, 'open')
})

test('two runs at once make one opener (a duplicate key means already made)', async () => {
  const s = setup()
  const second = createProactive({ supabase: s.supabase, clock: s.clock, isCareOpen: async () => false, log: (what) => s.logged.push(what) })
  const counts = await Promise.all([s.proactive.run(), second.run()])
  assert.equal(counts.reduce((a, b) => a + b, 0), 1)
  assert.equal(s.made().length, 1)
  assert.equal(s.base.rows('situation_turns').length, 1)
  assert.deepEqual(s.logged, [])
})

test('if the opener line cannot be stored, no empty opener is left', async () => {
  const s = setup({
    wrap: (base) => ({
      ...base,
      from(t) {
        const b = base.from(t)
        const insert = b.insert.bind(b)
        if (t === 'situation_turns') b.insert = (p) => { const r = insert(p); b.then = (res) => Promise.resolve({ data: null, error: { code: 'XX000', message: 'db down' } }).then(res); return r }
        return b
      },
    }),
  })
  assert.equal(await s.proactive.run(), 0)
  assert.deepEqual(s.logged, ['founder skipped'])
  assert.equal(s.made().length, 0)
  assert.equal(s.base.rows('situation_turns').length, 0)
})

// ── Situations: the daily limit, Home ────────────────────────────────────────

const ENV = { FRONTEND_URL: 'https://app.example.com' }
async function appSetup({ tables, replies = [] }) {
  const base = createFakeSupabase({ users: { tok: USER }, tables: { users: [{ id: USER.id, email: USER.email, first_name: 'Sam' }], founder_profiles: [{ user_id: USER.id, timezone: KARACHI, deadline: '2026-11-15', signup_answers: FULL_ANSWERS }], ...tables }, unique: UNIQUE })
  const clock = createFakeClock(NOW)
  const app = createApp({ env: ENV, supabase: base, openai: createFakeOpenAI(replies), clock })
  const server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  const call = async (method, path, body) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method, headers: { authorization: 'Bearer tok', 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: res.status, body: await res.json() }
  }
  return { call, base, close: () => new Promise((r) => server.close(r)) }
}

test('the 5 a day limit counts only situations the founder started', async () => {
  const today = at(NOW - HOUR)
  const founderFive = [1, 2, 3, 4, 5].map((n) => sit(n, { created_at: today }))
  const verdict = JSON.stringify({ topic: 'same', has_situation: true, has_detail: true, missing: 'none', question: '', title: 'Pricing emails to clinics' })
  const a = await appSetup({ tables: { situations: [...founderFive.slice(0, 4), opener(9, HOUR)] }, replies: [verdict] })
  try {
    const ok = await a.call('POST', '/api/situations', { text: 'I have not emailed the 2 clinics that asked for pricing.', client_turn_id: uuid(500) })
    assert.equal(ok.status, 200, 'an opener from Axiom is not one of the founder\'s five')
  } finally { await a.close() }
  const b = await appSetup({ tables: { situations: [...founderFive, opener(9, HOUR)] } })
  try {
    assert.equal((await b.call('POST', '/api/situations', { text: 'I have not emailed the 2 clinics that asked for pricing.', client_turn_id: uuid(501) })).status, 429)
  } finally { await b.close() }
})

test('Home: an unanswered opener is the first item, never fades, and opens that situation', async () => {
  const line = 'You said "My first 10 customers" by 15 November 2026. That is 11 days away. Where is it now?'
  const a = await appSetup({
    tables: { situations: [sit(1), opener(2, HOUR, { title: 'My first 10 customers' })], situation_turns: [{ id: uuid(90), situation_id: uuid(2), seq: 1, role: 'axiom', text: line }], reads: [], moves: [], reports: [], user_settings: [], push_tokens: [] },
  })
  try {
    const home = await a.call('GET', '/api/home')
    assert.equal(home.status, 200)
    const [first] = home.body.items
    assert.deepEqual(first, { kind: 'situation', label: ITEM_LABELS.opener.replace('{opener}', line), title: 'My first 10 customers', stays: true, target: { stage: 'situation', situation_id: uuid(2) } })
    assert.equal(first.label, `Axiom asked: ${line}`)
    assert.equal(home.body.drawer.to_do.filter((i) => i.target.situation_id === uuid(2)).length, 1)

    // Once the founder has answered it, it is an ordinary situation.
    a.base.from('situation_turns').insert({ situation_id: uuid(2), seq: 2, role: 'founder', text: 'Three so far.' }).then(() => {})
    const after = await a.call('GET', '/api/home')
    assert.ok(!after.body.items.some((i) => i.label.startsWith('Axiom asked')))
  } finally { await a.close() }
})

// ── Push ─────────────────────────────────────────────────────────────────────

const TOKEN = 'ExponentPushToken[abcdefghij1234567890]'
const LINE = 'You said "My first 10 customers" by 15 November 2026. That is 11 days away. Where is it now?'
const MORNING_START = Date.parse('2026-11-04T03:00:00Z') // 8 am in Karachi

function pushSetup({ now = MORNING_START, log = [], settings = [], moves = [], createdAt = Date.parse('2026-11-04T02:05:00Z'), lock = null } = {}) {
  const base = createFakeSupabase({
    unique: UNIQUE,
    tables: {
      founder_profiles: [{ user_id: USER.id, timezone: KARACHI }],
      situations: [sit(1, { last_activity_at: at(createdAt) }), opener(2, now - createdAt, { trigger_key: 'goal:2026-11-15:14', title: 'My first 10 customers' })],
      situation_turns: [{ id: uuid(90), situation_id: uuid(2), seq: 1, role: 'axiom', text: LINE }],
      moves,
      push_tokens: [{ id: uuid(1), user_id: USER.id, token: TOKEN, platform: 'ios', timezone: KARACHI, updated_at: at(createdAt) }],
      user_settings: lock ? [{ user_id: USER.id, lock_screen: lock, ...settings }] : settings,
      notification_log: log,
    },
  })
  const clock = createFakeClock(now)
  const sender = createFakePushSender()
  const scheduler = createPushScheduler({ supabase: base, sender, clock, isCareOpen: async () => false, nameOf: async () => 'Sam', log: () => {} })
  return { base, sender, scheduler }
}

test('push: the opener takes the morning slot on the day it was made', async () => {
  const s = pushSetup()
  await s.scheduler.tick()
  assert.deepEqual(s.sender.sent.map((m) => [m.body, m.data.kind, m.data.situation_id]), [['Sam, where are you with your goal?', 'proactive', uuid(2)]])
  assert.deepEqual(s.base.rows('notification_log').map((r) => [r.kind, r.slot, r.status]), [['proactive', 'morning', 'sent']])
})

test('push: it replaces the morning move push and the quiet check, and uses the full line when asked', async () => {
  const committed = Date.parse('2026-11-03T08:00:00Z')
  const move = { id: uuid(70), user_id: USER.id, situation_id: uuid(1), title: 'Ask both clinics for a call.', status: 'committed', committed_at: at(committed), report_due_at: at(Date.parse('2026-11-04T15:00:00Z')), closes_at: at(committed + 2 * DAY), time_zone: KARACHI }
  const s = pushSetup({ moves: [move], lock: 'full' })
  await s.scheduler.tick()
  assert.deepEqual(s.sender.sent.map((m) => m.body), [LINE])
  assert.deepEqual(s.base.rows('notification_log').map((r) => r.kind), ['proactive'])
})

test('push: slot window passed means no push; the next day it is not today\'s opener', async () => {
  const late = pushSetup({ now: Date.parse('2026-11-04T08:00:00Z') }) // 1 pm in Karachi
  await late.scheduler.tick()
  assert.deepEqual(late.sender.sent, [])
  const next = pushSetup({ now: Date.parse('2026-11-05T03:00:00Z') })
  await next.scheduler.tick()
  assert.deepEqual(next.sender.sent, [])
})

test('push: not once answered, not when the morning switch is off, and the day keeps its 2 pushes', async () => {
  const answered = pushSetup()
  answered.base.from('situation_turns').insert({ situation_id: uuid(2), seq: 2, role: 'founder', text: 'Three so far.' }).then(() => {})
  await answered.scheduler.tick()
  assert.deepEqual(answered.sender.sent, [])

  const off = pushSetup({ settings: [{ user_id: USER.id, morning_on: false }] })
  await off.scheduler.tick()
  assert.deepEqual(off.sender.sent, [])

  const day = '2026-11-04'
  const row = (kind, slot, n) => ({ id: uuid(600 + n), user_id: USER.id, kind, slot, local_day: day, status: 'sent', dedupe_key: `k${n}`, attempts: 1, created_at: at(MORNING_START) })
  const full = pushSetup({ log: [row('quiet_check', 'morning', 1)] })
  await full.scheduler.tick()
  assert.deepEqual(full.sender.sent, [], 'the morning slot is already used')
  const item = { key: 'proactive:x', dueAt: 0, expiresAt: Infinity, situationId: uuid(2), situationTitle: 'x' }
  const founder = { timeZone: KARACHI, hasDevice: true, lastActivityAt: at(MORNING_START - HOUR), settings: {} }
  const decision = decidePush({ founder, now: MORNING_START, log: [row('evening', 'evening', 2), row('quiet_check', 'morning', 3)], care: false, kind: 'proactive', item })
  assert.deepEqual(decision, { send: false, reason: 'cap' })
})

test('push wording: short lines by trigger, hidden is just Axiom, full is the opener', () => {
  const item = { situationId: uuid(2), situationTitle: 'x', opener: LINE }
  const body = (trigger, lockScreen, name = 'Sam') => composePush({ kind: 'proactive', item: { ...item, trigger }, name, lockScreen }).body
  assert.equal(body('goal_near', 'short'), 'Sam, where are you with your goal?')
  assert.equal(body('two_misses', 'short'), 'Sam, what got in the way of your last two moves?')
  assert.equal(body('two_misses', 'short', null), 'About your last two moves.')
  assert.equal(body('goal_near', 'hidden'), 'Axiom')
  assert.equal(body('goal_near', 'full'), LINE)
})
