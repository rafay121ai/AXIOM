import assert from 'node:assert/strict'
import test from 'node:test'
import { createApp } from '../app.js'
import { createFakeClock, createFakeOpenAI, createFakePushSender, createFakeSupabase } from '../testing/fakes.js'
import { BANNED_PHRASES, TEASER, norm, wordRx } from '../journey/ownWords.js'
import { decidePush, inQuietHours, localDay, PAUSE_AFTER_MS, DAY_MS } from './policy.js'
import { composePush, HIDDEN_BODY, LOCK_SCREEN_MODES, PUSH_WORDING } from './compose.js'
import { duePushes } from './due.js'
import { createPushScheduler } from './scheduler.js'
import { cleanTokenPayload, EXPO_TOKEN_RX } from './tokens.js'
import { createExpoSender } from './expoSender.js'

const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'founder@example.com' }
const OTHER = { id: '22222222-2222-4222-8222-222222222222', email: 'other@example.com' }
const ENV = { FRONTEND_URL: 'https://app.example.com' }
const HOUR = 60 * 60 * 1000
const MIN = 60 * 1000
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const at = (ms) => new Date(ms).toISOString()
const T = (s) => Date.parse(s)
const TOKEN = 'ExponentPushToken[abcdefghij1234567890]'
const TOKEN2 = 'ExponentPushToken[zyxwvutsrq0987654321]'

// Karachi is UTC+5 all year. Morning push 8 am = 03:00Z, check-in 8 pm = 15:00Z.
const COMMITTED = T('2026-10-26T02:00:00Z') // 7 am in Karachi
const DUE = T('2026-10-26T15:00:00Z')
const CLOSES = COMMITTED + 48 * HOUR
const MOVE_ID = uuid(300)
const LEARN = uuid(200)
const SIT = uuid(100)

const move = (over = {}) => ({
  id: MOVE_ID, user_id: USER.id, situation_id: SIT, learn_id: LEARN, status: 'committed',
  title: 'Ask both clinics that asked for pricing for a call.', committed_at: at(COMMITTED),
  report_due_at: at(DUE), closes_at: at(CLOSES), time_zone: 'Asia/Karachi', ...over,
})

const seed = ({ moves = [move()], tokens = [{ id: uuid(1), token: TOKEN, user_id: USER.id, platform: 'ios', timezone: 'Asia/Karachi', updated_at: at(COMMITTED) }], settings = [], situations, timezone = 'Asia/Karachi' } = {}) => ({
  founder_profiles: [{ user_id: USER.id, timezone, report_time_local: null }],
  situations: situations ?? [{ id: SIT, user_id: USER.id, title: 'Pricing emails to clinics', status: 'open', last_activity_at: at(COMMITTED) }],
  learn_conversations: [{ id: LEARN, situation_id: SIT, user_id: USER.id, move_subject: 'the two clinics' }],
  moves,
  push_tokens: tokens,
  user_settings: settings,
  notification_log: [],
})

// The real database keeps (user_id, dedupe_key) unique in notification_log
// and token unique in push_tokens. The in-memory fake does not, so this does.
const UNIQUE = { notification_log: ['user_id', 'dedupe_key'], push_tokens: ['token'], user_settings: ['user_id'], founder_profiles: ['user_id'] }
function withKeys(base) {
  return {
    ...base,
    from(table) {
      const b = base.from(table)
      let payload = null
      const { insert, then } = b
      b.insert = (p) => { payload = p; insert(p); return b }
      b.then = (resolve, reject) => {
        const cols = UNIQUE[table]
        if (payload && cols && base.rows(table).some((r) => cols.every((c) => r[c] === payload[c]))) {
          return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key' } }).then(resolve, reject)
        }
        return then(resolve, reject)
      }
      return b
    },
  }
}

function schedulerSetup({ care = async () => false, respond, name = 'Rafay', start = T('2026-10-26T03:00:00Z'), ...opts } = {}) {
  const base = createFakeSupabase({ tables: seed(opts) })
  const supabase = withKeys(base)
  const clock = createFakeClock(start)
  const sender = createFakePushSender(respond ? { respond } : undefined)
  const make = () => createPushScheduler({ supabase, sender, clock, isCareOpen: care, nameOf: async () => name, log: () => {} })
  return { base, supabase, clock, sender, scheduler: make(), make, log: () => base.rows('notification_log') }
}

// ── Policy (pure) ────────────────────────────────────────────────────────────

const founder = (over = {}) => ({
  timeZone: 'Asia/Karachi', hasDevice: true, lastActivityAt: at(COMMITTED),
  settings: { morning_on: true, evening_on: true, quiet_hours: { start: '22:00', end: '06:00' } }, ...over,
})
const eveningItem = { key: `evening:${MOVE_ID}`, dueAt: DUE, expiresAt: CLOSES, moveId: MOVE_ID, title: 'Ask both clinics for a call.', reported: false }
const decide = (over = {}) => decidePush({ founder: founder(), now: DUE, log: [], care: false, kind: 'evening', item: eveningItem, ...over })

test('policy: a due push with something real goes out', () => {
  const d = decide()
  assert.equal(d.send, true)
  assert.equal(d.localDay, '2026-10-26')
})

test('policy: care open, or unknown, means no push', () => {
  assert.equal(decide({ care: true }).reason, 'care')
  assert.equal(decide({ care: undefined }).reason, 'care')
  assert.equal(decide({ care: null }).reason, 'care')
})

test('policy: at most 2 a day, counted from the log by local day; failed sends do not count', () => {
  const row = (kind, key, status = 'sent', day = '2026-10-26') => ({ kind, dedupe_key: key, status, local_day: day, attempts: 1 })
  const two = [row('morning', 'morning:2026-10-26'), row('evening', 'evening:x')]
  assert.equal(decide({ log: two }).reason, 'cap')
  // 'sending' counts (it may have reached the phone).
  assert.equal(decide({ log: [row('morning', 'm'), row('evening', 'e', 'sending')] }).reason, 'cap')
  // Failed rows hold no place.
  assert.equal(decide({ log: [row('morning', 'm'), row('evening', 'e', 'failed')] }).send, true)
  // Yesterday's pushes do not count today.
  assert.equal(decide({ log: [row('morning', 'm', 'sent', '2026-10-25'), row('evening', 'e', 'sent', '2026-10-25')] }).send, true)
  // One evening slot a day: a second check-in waits.
  assert.equal(decide({ log: [row('evening', 'evening:other')] }).reason, 'slot_used')
})

test('policy: dedupe, and a failed row is retried at most 3 times', () => {
  const sent = { kind: 'evening', dedupe_key: eveningItem.key, status: 'sent', local_day: '2026-10-25', attempts: 1 }
  assert.equal(decide({ log: [sent] }).reason, 'already_sent')
  assert.equal(decide({ log: [{ ...sent, status: 'sending' }] }).reason, 'already_sent')
  const failed = { ...sent, id: 'r1', status: 'failed' }
  assert.equal(decide({ log: [failed] }).retry, failed)
  assert.equal(decide({ log: [{ ...failed, attempts: 3 }] }).reason, 'already_sent')
})

test('policy: 14 days without activity pauses every push', () => {
  assert.equal(decide({ founder: founder({ lastActivityAt: at(DUE - PAUSE_AFTER_MS) }) }).reason, 'paused')
  assert.equal(decide({ founder: founder({ lastActivityAt: at(DUE - PAUSE_AFTER_MS + MIN) }) }).send, true)
  assert.equal(decide({ founder: founder({ lastActivityAt: null }) }).reason, 'paused')
})

test('policy: the morning and evening switches', () => {
  const off = (k) => founder({ settings: { morning_on: true, evening_on: true, [k]: false } })
  assert.equal(decide({ founder: off('evening_on') }).reason, 'off')
  assert.equal(decide({ founder: off('evening_on'), kind: 'reminder' }).reason, 'off')
  assert.equal(decide({ founder: off('morning_on') }).send, true)
  const quiet = { key: 'quiet:s', dueAt: DUE, expiresAt: DUE + HOUR, situationId: SIT, situationTitle: 'Pricing' }
  assert.equal(decide({ founder: off('morning_on'), kind: 'quiet_check', item: quiet }).reason, 'off')
  assert.equal(decide({ founder: off('morning_on'), kind: 'morning', item: { ...eveningItem, key: 'morning:d' } }).reason, 'off')
})

test('policy: nothing real, not due, expired, reported, no device', () => {
  assert.equal(decide({ item: { ...eveningItem, title: '  ' } }).reason, 'nothing_real')
  assert.equal(decide({ item: { ...eveningItem, moveId: null } }).reason, 'nothing_real')
  assert.equal(decide({ kind: 'quiet_check', item: { key: 'q', dueAt: DUE, expiresAt: DUE + 1, situationId: SIT, situationTitle: null } }).reason, 'nothing_real')
  assert.equal(decide({ now: DUE - 1 }).reason, 'not_due')
  assert.equal(decide({ now: CLOSES }).reason, 'expired')
  assert.equal(decide({ item: { ...eveningItem, reported: true } }).reason, 'reported')
  assert.equal(decide({ founder: founder({ hasDevice: false }) }).reason, 'no_device')
})

test('policy: one reminder, only after the check-in push went out', () => {
  const item = { ...eveningItem, key: `reminder:${MOVE_ID}`, dueAt: DUE + DAY_MS }
  const now = DUE + DAY_MS
  assert.equal(decide({ kind: 'reminder', item, now }).reason, 'no_check_in_push')
  const evening = { kind: 'evening', dedupe_key: `evening:${MOVE_ID}`, status: 'sent', local_day: '2026-10-26', attempts: 1 }
  assert.equal(decide({ kind: 'reminder', item, now, log: [evening] }).send, true)
  const reminder = { kind: 'reminder', dedupe_key: item.key, status: 'sent', local_day: '2026-10-27', attempts: 1 }
  assert.equal(decide({ kind: 'reminder', item, now: now + HOUR, log: [evening, reminder] }).reason, 'already_sent')
})

test('quiet hours follow the founder time zone, across daylight saving', () => {
  const q = { start: '22:00', end: '06:00' }
  // 17:30Z is 10:30 pm in Karachi (quiet), 11 pm in Kolkata (quiet), 1:30 pm in New York (not).
  assert.equal(inQuietHours(T('2026-10-26T17:30:00Z'), 'Asia/Karachi', q), true)
  assert.equal(inQuietHours(T('2026-10-26T16:30:00Z'), 'Asia/Karachi', q), false)
  assert.equal(inQuietHours(T('2026-10-26T17:30:00Z'), 'Asia/Kolkata', q), true)
  assert.equal(inQuietHours(T('2026-10-26T17:30:00Z'), 'America/New_York', q), false)
  // New York leaves daylight saving at 06:00Z on 1 November 2026.
  assert.equal(inQuietHours(T('2026-10-31T10:30:00Z'), 'America/New_York', q), false) // 6:30 am EDT
  assert.equal(inQuietHours(T('2026-11-01T10:30:00Z'), 'America/New_York', q), true) // 5:30 am EST
  assert.equal(inQuietHours(T('2026-11-01T11:00:00Z'), 'America/New_York', q), false) // 6:00 am EST
  // London enters summer time on 29 March 2026: 05:30Z is 6:30 am BST.
  assert.equal(inQuietHours(T('2026-03-28T05:30:00Z'), 'Europe/London', q), true)
  assert.equal(inQuietHours(T('2026-03-29T05:30:00Z'), 'Europe/London', q), false)
  // A window that does not wrap.
  assert.equal(inQuietHours(T('2026-10-26T13:00:00Z'), 'UTC', { start: '12:00', end: '14:00' }), true)
  // The local day turns at local midnight.
  assert.equal(localDay(T('2026-10-26T19:30:00Z'), 'Asia/Karachi'), '2026-10-27')
  assert.equal(localDay(T('2026-10-26T19:30:00Z'), 'America/New_York'), '2026-10-26')
  // A check-in at 11 pm is held by quiet hours and goes out when they end.
  const late = { ...eveningItem, dueAt: T('2026-10-26T18:00:00Z') }
  assert.equal(decide({ item: late, now: late.dueAt }).reason, 'quiet_hours')
  assert.equal(decide({ item: late, now: T('2026-10-27T01:00:00Z') }).send, true) // 6 am in Karachi
})

test('due pushes: morning only before the check-in; one reminder a day later or before close', () => {
  const moves = [{ ...move(), subject: 'the two clinics' }]
  const kinds = (now) => duePushes({ now, timeZone: 'Asia/Karachi', moves, lastActivityAt: at(COMMITTED) }).map((p) => p.kind)
  assert.deepEqual(kinds(T('2026-10-26T03:00:00Z')), ['morning', 'evening', 'reminder'])
  assert.deepEqual(kinds(T('2026-10-27T03:00:00Z')), ['evening', 'reminder'])
  const [, , reminder] = duePushes({ now: T('2026-10-26T03:00:00Z'), timeZone: 'Asia/Karachi', moves, lastActivityAt: at(COMMITTED) })
  assert.equal(at(reminder.item.dueAt), '2026-10-27T15:00:00.000Z')
  // Committed at 7:30 pm: check-in the next evening, the move closes before a
  // second evening, so the reminder comes an hour before it closes.
  const late = { ...move({ committed_at: '2026-10-26T14:30:00Z', report_due_at: '2026-10-27T15:00:00Z', closes_at: '2026-10-28T14:30:00Z' }) }
  const r = duePushes({ now: T('2026-10-27T03:00:00Z'), timeZone: 'Asia/Karachi', moves: [late], lastActivityAt: late.committed_at })
  assert.deepEqual(r.map((p) => p.kind), ['morning', 'evening', 'reminder'])
  assert.equal(at(r[2].item.dueAt), '2026-10-28T13:30:00.000Z')
  // Quiet for 3 days: the quiet check replaces the morning push.
  const q = duePushes({ now: T('2026-10-30T03:00:00Z'), timeZone: 'Asia/Karachi', moves: [], quietSituation: { id: SIT, title: 'Pricing' }, lastActivityAt: at(COMMITTED) })
  assert.deepEqual(q.map((p) => p.kind), ['quiet_check'])
})

// ── Compose ──────────────────────────────────────────────────────────────────

const ITEMS = {
  evening: { moveId: MOVE_ID, situationId: SIT, title: 'Ask both clinics that asked for pricing for a call.', subject: 'the two clinics' },
  reminder: { moveId: MOVE_ID, situationId: SIT, title: 'Ask both clinics that asked for pricing for a call.', subject: 'the two clinics' },
  morning: { moveId: MOVE_ID, situationId: SIT, title: 'Ask both clinics that asked for pricing for a call.', subject: 'the two clinics' },
  quiet_check: { situationId: SIT, situationTitle: 'Pricing emails to clinics' },
}

test('compose: the approved push, the name inside, and the three lock-screen modes', () => {
  assert.equal(composePush({ kind: 'evening', item: ITEMS.evening, name: 'Rafay', lockScreen: 'full' }).body, 'Rafay, how did the two clinics go?')
  assert.equal(composePush({ kind: 'evening', item: ITEMS.evening, name: 'Rafay', lockScreen: 'short' }).body, 'Rafay, how did it go?')
  assert.equal(composePush({ kind: 'evening', item: ITEMS.evening, name: 'Rafay', lockScreen: 'hidden' }).body, HIDDEN_BODY)
  // Short is the default, and an unknown mode falls back to it.
  assert.equal(composePush({ kind: 'evening', item: ITEMS.evening, name: 'Rafay' }).body, 'Rafay, how did it go?')
  assert.equal(composePush({ kind: 'evening', item: ITEMS.evening, name: 'Rafay', lockScreen: 'loud' }).body, 'Rafay, how did it go?')
  assert.equal(composePush({ kind: 'morning', item: ITEMS.morning, name: 'Rafay', lockScreen: 'full' }).body,
    'Morning, Rafay. Today: ask both clinics that asked for pricing for a call.')
  assert.equal(composePush({ kind: 'quiet_check', item: ITEMS.quiet_check, name: 'Rafay', lockScreen: 'full' }).body,
    'Rafay, where are you with pricing emails to clinics?')
  // Short and Hidden never name the move.
  for (const kind of Object.keys(ITEMS)) {
    for (const mode of ['short', 'hidden']) {
      const { body } = composePush({ kind, item: ITEMS[kind], name: 'Rafay', lockScreen: mode })
      assert.doesNotMatch(body, /clinic|pricing/i, `${kind} ${mode}`)
    }
  }
  // Hidden does not show the name either; the tap still opens the right screen.
  const hidden = composePush({ kind: 'evening', item: ITEMS.evening, name: 'Rafay', lockScreen: 'hidden' })
  assert.doesNotMatch(hidden.body, /Rafay/)
  assert.deepEqual(hidden.data, { kind: 'evening', open: 'report', move_id: MOVE_ID, situation_id: SIT })
  // No name known: the line still reads.
  assert.equal(composePush({ kind: 'evening', item: ITEMS.evening, name: null, lockScreen: 'full' }).body, 'How did the two clinics go?')
  assert.equal(composePush({ kind: 'evening', item: { ...ITEMS.evening, subject: null }, name: 'Rafay', lockScreen: 'full' }).body,
    'Ask both clinics that asked for pricing for a call. How did it go, Rafay?')
})

test('compose: no push contains a banned phrase or a teaser, in any mode', () => {
  const lines = []
  for (const kind of Object.keys(PUSH_WORDING)) {
    for (const mode of LOCK_SCREEN_MODES) {
      for (const name of ['Rafay', null]) {
        for (const subject of ['the two clinics', null]) {
          lines.push(composePush({ kind, item: { ...ITEMS[kind], subject }, name, lockScreen: mode }).body)
        }
      }
    }
  }
  for (const line of lines) {
    const t = norm(line)
    for (const p of BANNED_PHRASES) assert.equal(wordRx(p).test(t), false, `"${p}" in "${line}"`)
    assert.equal(TEASER.test(t), false, line)
    assert.ok(line.length <= 160, line)
    assert.doesNotMatch(line, /you missed|streak|warning|strike/i, line)
  }
  // Stored text holding a banned phrase never reaches a lock screen.
  const bad = composePush({ kind: 'evening', item: { ...ITEMS.evening, subject: 'the great clinic idea' }, name: 'Rafay', lockScreen: 'full' })
  assert.equal(bad.body, 'Rafay, how did it go?')
})

// ── Scheduler ────────────────────────────────────────────────────────────────

test('scheduler: morning and evening, then nothing more that day, however often it ticks', async () => {
  const s = schedulerSetup()
  for (let t = T('2026-10-26T00:00:00Z'); t < T('2026-10-26T19:00:00Z'); t += 5 * MIN) {
    s.clock.set(t)
    await s.scheduler.tick()
  }
  assert.deepEqual(s.sender.sent.map((m) => m.data.kind), ['morning', 'evening'])
  assert.equal(s.sender.sent[0].to, TOKEN)
  assert.equal(s.sender.sent[1].body, 'Rafay, how did it go?') // Short by default
  assert.deepEqual(s.log().map((r) => [r.kind, r.status, r.local_day]), [['morning', 'sent', '2026-10-26'], ['evening', 'sent', '2026-10-26']])
})

test('scheduler: the cap of 2 holds with two moves due the same evening', async () => {
  const second = move({ id: uuid(301), title: 'Call the gym owner who asked about the trial.', learn_id: null })
  const s = schedulerSetup({ moves: [move(), second] })
  for (let t = T('2026-10-26T00:00:00Z'); t < T('2026-10-26T19:00:00Z'); t += 10 * MIN) {
    s.clock.set(t)
    await s.scheduler.tick()
  }
  assert.equal(s.sender.sent.length, 2)
  const counted = s.log().filter((r) => r.local_day === '2026-10-26' && r.status === 'sent')
  assert.equal(counted.length, 2)
})

test('scheduler: one reminder the next evening, then the move closes quietly', async () => {
  const s = schedulerSetup()
  for (let t = T('2026-10-26T00:00:00Z'); t < CLOSES + 6 * HOUR; t += 15 * MIN) {
    s.clock.set(t)
    await s.scheduler.tick()
  }
  assert.deepEqual(s.sender.sent.map((m) => m.data.kind), ['morning', 'evening', 'reminder'])
  assert.equal(s.log().find((r) => r.kind === 'reminder').local_day, '2026-10-27')
})

test('scheduler: a reported move gets no check-in push', async () => {
  const s = schedulerSetup({ moves: [move({ status: 'reported' })], start: DUE })
  await s.scheduler.tick()
  assert.equal(s.sender.sent.length, 0)
})

test('scheduler: idempotent across ticks, restarts and two schedulers at once', async () => {
  const s = schedulerSetup({ start: DUE })
  const other = s.make() // a restarted or second process on the same database
  await Promise.all([s.scheduler.tick(), other.tick(), s.scheduler.tick()])
  await other.tick()
  assert.equal(s.sender.sent.length, 1)
  assert.equal(s.log().length, 1)
})

test('scheduler: the log row is written before the push is sent', async () => {
  let seen = null
  const s = schedulerSetup({
    start: DUE,
    respond: (message) => {
      seen = s.base.rows('notification_log').map((r) => [r.dedupe_key, r.status])
      return { ok: true, message }
    },
  })
  await s.scheduler.tick()
  assert.deepEqual(seen, [[`evening:${MOVE_ID}`, 'sending']])
  assert.equal(s.log()[0].status, 'sent')
})

test('scheduler: a failed send is retried on the same row and counted once', async () => {
  let fail = true
  const s = schedulerSetup({ start: DUE, respond: () => (fail ? { ok: false, error: 'network' } : { ok: true }) })
  await s.scheduler.tick()
  assert.deepEqual(s.log().map((r) => [r.status, r.attempts]), [['failed', 1]])
  fail = false
  s.clock.advance(MIN)
  await s.scheduler.tick()
  await s.scheduler.tick()
  assert.deepEqual(s.log().map((r) => [r.status, r.attempts]), [['sent', 2]])
  assert.equal(s.sender.sent.length, 2) // one failed try, one delivery
})

test('scheduler: a sender that keeps failing gives up after 3 tries; a throw is a failure too', async () => {
  const s = schedulerSetup({ start: DUE, respond: () => { throw new Error('boom') } })
  for (let i = 0; i < 6; i += 1) {
    await s.scheduler.tick()
    s.clock.advance(MIN)
  }
  assert.equal(s.sender.sent.length, 3)
  assert.deepEqual(s.log().map((r) => [r.status, r.attempts]), [['failed', 3]])
})

test('scheduler: a device Expo no longer knows is dropped', async () => {
  const s = schedulerSetup({
    start: DUE,
    tokens: [
      { id: uuid(1), token: TOKEN, user_id: USER.id, platform: 'ios', timezone: null, updated_at: at(COMMITTED) },
      { id: uuid(2), token: TOKEN2, user_id: USER.id, platform: 'android', timezone: null, updated_at: at(COMMITTED - 1) },
    ],
    respond: (m) => (m.to === TOKEN2 ? { ok: false, invalidToken: true, error: 'DeviceNotRegistered' } : { ok: true }),
  })
  await s.scheduler.tick()
  assert.deepEqual(s.base.rows('push_tokens').map((r) => r.token), [TOKEN])
  assert.equal(s.log()[0].status, 'sent')
})

test('scheduler: nothing while care is open or the care lookup fails', async () => {
  for (const care of [async () => true, async () => { throw new Error('db down') }]) {
    const s = schedulerSetup({ start: DUE, care })
    const summary = await s.scheduler.tick()
    assert.equal(summary.paused_for_care, 1)
    assert.equal(s.sender.sent.length, 0)
    assert.equal(s.log().length, 0)
  }
  assert.throws(() => createPushScheduler({ supabase: createFakeSupabase(), sender: createFakePushSender(), clock: createFakeClock() }), /isCareOpen/)
})

test('scheduler: the care check from the app pauses pushes', async () => {
  const base = createFakeSupabase({
    tables: { ...seed(), care_events: [{ id: uuid(9), user_id: USER.id, level: 'clear', resolved_at: null, created_at: at(COMMITTED) }] },
  })
  const app = createApp({ env: ENV, supabase: base, openai: createFakeOpenAI([]), clock: createFakeClock(DUE) })
  const sender = createFakePushSender()
  const scheduler = createPushScheduler({ supabase: base, sender, clock: createFakeClock(DUE), isCareOpen: app.locals.isCareOpen, log: () => {} })
  await scheduler.tick()
  assert.equal(sender.sent.length, 0)
})

test('scheduler: switches off, no device, and 14 days quiet mean no push', async () => {
  const off = schedulerSetup({ settings: [{ user_id: USER.id, morning_on: false, evening_on: true }] })
  for (const t of [T('2026-10-26T03:00:00Z'), DUE]) { off.clock.set(t); await off.scheduler.tick() }
  assert.deepEqual(off.sender.sent.map((m) => m.data.kind), ['evening'])

  const none = schedulerSetup({ start: DUE, tokens: [] })
  await none.scheduler.tick()
  assert.equal(none.log().length, 0)

  const paused = schedulerSetup({ moves: [], start: COMMITTED + 15 * DAY_MS })
  await paused.scheduler.tick()
  assert.equal(paused.sender.sent.length, 0)
})

test('scheduler: after 3 quiet days, one check on the open situation, in the founder\'s mode', async () => {
  const s = schedulerSetup({ moves: [], settings: [{ user_id: USER.id, lock_screen: 'full' }], start: T('2026-10-29T03:00:00Z') })
  await s.scheduler.tick()
  assert.deepEqual(s.sender.sent.map((m) => m.body), ['Rafay, where are you with pricing emails to clinics?'])
  for (let d = 1; d <= 3; d += 1) {
    s.clock.set(T('2026-10-29T03:00:00Z') + d * DAY_MS)
    await s.scheduler.tick()
  }
  assert.equal(s.sender.sent.length, 1)
})

// ── Tokens and settings through the API ──────────────────────────────────────

async function apiSetup(tables = {}) {
  const base = createFakeSupabase({ users: { tok: USER, tok2: OTHER }, tables: { founder_profiles: [], user_settings: [], push_tokens: [], ...tables } })
  const app = createApp({ env: ENV, supabase: withKeys(base), openai: createFakeOpenAI([]), clock: createFakeClock(DUE) })
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
  return { call: as('tok'), callOther: as('tok2'), callAnon: as(null), rows: (t) => base.rows(t), close: () => new Promise((r) => server.close(r)) }
}

test('token format is checked', () => {
  assert.equal(EXPO_TOKEN_RX.test(TOKEN), true)
  assert.equal(EXPO_TOKEN_RX.test('ExpoPushToken[abcdefghij1234567890]'), true)
  for (const bad of ['', 'abc', 'ExponentPushToken[]', 'ExponentPushToken[abc def ghi jkl]', `ExponentPushToken[${'a'.repeat(300)}]`, 'fcm:abcdefghijkl']) {
    assert.equal(EXPO_TOKEN_RX.test(bad), false, bad)
  }
  assert.ok(cleanTokenPayload({ token: TOKEN, platform: 'web' }).error)
  assert.ok(cleanTokenPayload({ token: TOKEN, platform: 'ios', timezone: 'Mars/Base' }).error)
  assert.deepEqual(cleanTokenPayload({ token: TOKEN, platform: 'ios' }).value, { token: TOKEN, platform: 'ios', timezone: null })
})

test('push token routes: auth, validation, one row per device, ownership', async () => {
  const { call, callOther, callAnon, rows, close } = await apiSetup()
  try {
    assert.equal((await callAnon('POST', '/api/push/token', { token: TOKEN, platform: 'ios' })).status, 401)
    assert.equal((await call('POST', '/api/push/token', { token: 'nope', platform: 'ios' })).status, 400)
    assert.equal((await call('POST', '/api/push/token', { token: TOKEN, platform: 'blackberry' })).status, 400)

    const ok = await call('POST', '/api/push/token', { token: TOKEN, platform: 'ios', timezone: 'Asia/Karachi' })
    assert.deepEqual([ok.status, ok.body], [200, { registered: true, platform: 'ios' }])
    await call('POST', '/api/push/token', { token: TOKEN, platform: 'ios', timezone: 'Asia/Dubai' })
    assert.deepEqual(rows('push_tokens').map((r) => [r.user_id, r.timezone]), [[USER.id, 'Asia/Dubai']])

    // Someone else cannot remove it.
    const theirs = await callOther('DELETE', '/api/push/token', { token: TOKEN })
    assert.deepEqual([theirs.status, theirs.body], [200, { removed: false }])
    assert.equal(rows('push_tokens').length, 1)

    // The phone signs in to another account: the token moves with it.
    await callOther('POST', '/api/push/token', { token: TOKEN, platform: 'ios' })
    assert.deepEqual(rows('push_tokens').map((r) => r.user_id), [OTHER.id])
    assert.deepEqual((await call('DELETE', '/api/push/token', { token: TOKEN })).body, { removed: false })
    assert.deepEqual((await callOther('DELETE', '/api/push/token', { token: TOKEN })).body, { removed: true })
    assert.equal(rows('push_tokens').length, 0)
    assert.equal((await call('DELETE', '/api/push/token', { token: 'x' })).status, 400)
  } finally {
    await close()
  }
})

test('reminder settings: defaults, partial updates, validation', async () => {
  const { call, callAnon, rows, close } = await apiSetup()
  try {
    assert.equal((await callAnon('GET', '/api/settings/reminders')).status, 401)
    const first = await call('GET', '/api/settings/reminders')
    assert.deepEqual(first.body, {
      checkin_time: '20:00', morning_on: true, evening_on: true, lock_screen: 'short',
      quiet_hours: { start: '22:00', end: '06:00' }, timezone: null, push_registered: false,
    })

    const put = await call('PUT', '/api/settings/reminders', { checkin_time: '21:15', morning_on: false, lock_screen: 'hidden' })
    assert.equal(put.status, 200)
    assert.equal(put.body.checkin_time, '21:15')
    assert.equal(put.body.morning_on, false)
    assert.equal(put.body.lock_screen, 'hidden')
    assert.equal(rows('founder_profiles')[0].report_time_local, '21:15') // where the Move reads it
    await call('PUT', '/api/settings/reminders', { quiet_hours: { start: '23:00', end: '07:00' } })
    assert.equal(rows('user_settings').length, 1)
    assert.deepEqual((await call('GET', '/api/settings/reminders')).body.quiet_hours, { start: '23:00', end: '07:00' })

    const bad = async (body) => (await call('PUT', '/api/settings/reminders', body)).status
    assert.equal(await bad({}), 400)
    assert.equal(await bad({ volume: 3 }), 400)
    assert.equal(await bad({ checkin_time: '8pm' }), 400)
    assert.equal(await bad({ checkin_time: '24:00' }), 400)
    assert.equal(await bad({ morning_on: 'yes' }), 400)
    assert.equal(await bad({ lock_screen: 'nothing' }), 400)
    assert.equal(await bad({ quiet_hours: { start: '22:00', end: '22:00' } }), 400)
    assert.equal(await bad({ quiet_hours: { start: '22:00' } }), 400)
    // A check-in inside quiet hours could never ring.
    const inside = await call('PUT', '/api/settings/reminders', { checkin_time: '23:30' })
    assert.deepEqual([inside.status, inside.body.error], [400, 'checkin_time falls inside quiet hours'])
    assert.equal(rows('founder_profiles')[0].report_time_local, '21:15')
  } finally {
    await close()
  }
})

// ── The real sender, against a fake fetch (nothing reaches Expo) ─────────────

test('the Expo sender reads tickets and flags a device that is gone', async () => {
  const reply = (status, json) => async () => ({ ok: status === 200, status, json: async () => json })
  const okSender = createExpoSender({ fetchImpl: reply(200, { data: { status: 'ok', id: 'x' } }) })
  assert.deepEqual(await okSender.send({ to: TOKEN, body: 'b' }), { ok: true })
  const gone = createExpoSender({ fetchImpl: reply(200, { data: { status: 'error', details: { error: 'DeviceNotRegistered' } } }) })
  assert.deepEqual(await gone.send({ to: TOKEN, body: 'b' }), { ok: false, invalidToken: true, error: 'DeviceNotRegistered' })
  const down = createExpoSender({ fetchImpl: async () => { throw new Error('offline') } })
  assert.deepEqual(await down.send({ to: TOKEN, body: 'b' }), { ok: false, invalidToken: false, error: 'network' })
})
