import assert from 'node:assert/strict'
import test from 'node:test'
import { createApp } from '../app.js'
import { createFakeClock, createFakeOpenAI, createFakePushSender, createFakeSupabase } from '../testing/fakes.js'
import { BANNED_PHRASES, TEASER, norm, wordRx } from '../journey/ownWords.js'
import { decidePush, inQuietHours, localDay, PAUSE_AFTER_MS, DAY_MS, NUDGE_SPACING_MS } from './policy.js'
import { composePush, composeSignalPush, HIDDEN_BODY, LOCK_SCREEN_MODES, PUSH_WORDING, voiceProblems } from './compose.js'
import { duePushes, NUDGE_THREAD_QUIET_MS } from './due.js'
import { createPushScheduler } from './scheduler.js'
import { cleanTokenPayload, EXPO_TOKEN_RX } from './tokens.js'
import { founderFirstName } from '../journey/home/name.js'
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

// The database's unique indexes (schema_needs.md), enforced by the fake:
// one row per push, and one counting row per founder, local day and slot.
const COUNTING = (r) => r.status === 'sending' || r.status === 'sent'
const UNIQUE = {
  notification_log: [{ cols: ['user_id', 'dedupe_key'] }, { cols: ['user_id', 'local_day', 'slot'], where: COUNTING }],
  push_tokens: [{ cols: ['token'] }],
  user_settings: [{ cols: ['user_id'] }],
  founder_profiles: [{ cols: ['user_id'] }],
  account_requests: [{ cols: ['user_id', 'kind'], where: (r) => r.status === 'queued' }],
}

function schedulerSetup({ care = async () => false, respond, name = 'Rafay', start = T('2026-10-26T03:00:00Z'), tables = {}, maxRows, pageSize, ...opts } = {}) {
  const base = createFakeSupabase({ tables: { ...seed(opts), ...tables }, unique: UNIQUE, maxRows })
  const supabase = base
  const clock = createFakeClock(start)
  const sender = createFakePushSender(respond ? { respond } : undefined)
  const make = ({ db = supabase, at = clock } = {}) => createPushScheduler({ supabase: db, sender, clock: at, isCareOpen: care, nameOf: async () => name, log: () => {}, pageSize })
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
  nudge: { nudge: 'thread', text: 'Get both clinics to agree on pricing' },
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

// Holds the first `n` notification_log reads until all `n` have been asked,
// so two schedulers decide from the same (stale) log before either claims.
function withLogBarrier(base, n = 2) {
  const waiting = []
  let reads = 0
  return {
    ...base,
    from(table) {
      const b = base.from(table)
      if (table !== 'notification_log') return b
      let write = false
      for (const m of ['insert', 'update', 'delete', 'upsert']) {
        const original = b[m]
        b[m] = (...args) => { write = true; original(...args); return b }
      }
      const { then } = b
      b.then = (resolve, reject) => {
        if (write || reads >= n) return then(resolve, reject)
        reads += 1
        const go = new Promise((r) => waiting.push(r))
        if (waiting.length === n) waiting.forEach((r) => r())
        return go.then(() => then(resolve, reject))
      }
      return b
    },
  }
}

const MORNING_SENT = { id: uuid(700), user_id: USER.id, kind: 'morning', dedupe_key: 'morning:2026-10-26', status: 'sent', local_day: '2026-10-26', slot: 'morning', attempts: 1, created_at: at(T('2026-10-26T03:00:00Z')) }
const countedToday = (s) => s.log().filter((r) => r.local_day === '2026-10-26' && COUNTING(r))

test('scheduler: two interleaved schedulers on one database never send a third push in a day', async () => {
  const second = move({ id: uuid(301), title: 'Call the gym owner who asked about the trial.', learn_id: null })
  const s = schedulerSetup({ start: DUE, moves: [move(), second], tables: { notification_log: [MORNING_SENT] } })
  const db = withLogBarrier(s.base)
  const [a, b] = [s.make({ db }), s.make({ db })]
  await Promise.all([a.tick(), b.tick()])
  assert.equal(s.sender.sent.length, 1)
  assert.equal(countedToday(s).length, 2)
})

test('scheduler: the database slot index stops a third push the stale log would allow', async () => {
  // A sees the first move still open; B, later, sees only the second. Both read
  // the log before either claims, so only the (user, day, slot) index stops B.
  const first = move({ report_due_at: at(DUE), closes_at: at(DUE + 10 * MIN) })
  const second = move({ id: uuid(301), title: 'Call the gym owner who asked about the trial.', learn_id: null, report_due_at: at(DUE + MIN) })
  const s = schedulerSetup({ start: DUE, moves: [first, second], tables: { notification_log: [MORNING_SENT] } })
  const db = withLogBarrier(s.base)
  const a = s.make({ db, at: createFakeClock(DUE + 5 * MIN) })
  const b = s.make({ db, at: createFakeClock(DUE + 15 * MIN) })
  await Promise.all([a.tick(), b.tick()])
  assert.equal(s.sender.sent.length, 1)
  assert.equal(countedToday(s).length, 2)
  assert.deepEqual(countedToday(s).map((r) => r.slot).sort(), ['evening', 'morning'])
})

test('scheduler: a founder with a queued delete request gets no pushes', async () => {
  const deleting = schedulerSetup({ start: DUE, tables: { account_requests: [{ id: uuid(60), user_id: USER.id, kind: 'delete', status: 'queued' }] } })
  await deleting.scheduler.tick()
  assert.equal(deleting.sender.sent.length, 0)
  assert.equal(deleting.log().length, 0)
  const exporting = schedulerSetup({ start: DUE, tables: { account_requests: [{ id: uuid(61), user_id: USER.id, kind: 'export', status: 'queued' }] } })
  await exporting.scheduler.tick()
  assert.equal(exporting.sender.sent.length, 1)
})

test('scheduler: queries are paged, so a row cap never drops a founder', async () => {
  const founders = [1, 2, 3, 4, 5].map((n) => `00000000-0000-4000-8000-0000000000a${n}`)
  const s = schedulerSetup({
    start: DUE,
    maxRows: 2,
    pageSize: 2,
    moves: founders.map((u, i) => move({ id: uuid(400 + i), user_id: u, situation_id: uuid(500 + i), learn_id: null })),
    tokens: founders.map((u, i) => ({ id: uuid(10 + i), token: `ExponentPushToken[founder${i}abcdefgh]`, user_id: u, platform: 'ios', timezone: 'Asia/Karachi', updated_at: at(COMMITTED) })),
  })
  await s.scheduler.tick()
  assert.equal(s.sender.sent.length, founders.length)
})

test('scheduler: nothing due now means no settings, care or log reads for that founder', async () => {
  const s = schedulerSetup({ start: T('2026-10-26T08:00:00Z') }) // 1 pm in Karachi: morning over, check-in ahead
  const read = []
  let cared = 0
  const db = { ...s.base, from: (t) => { read.push(t); return s.base.from(t) } }
  const scheduler = createPushScheduler({ supabase: db, sender: s.sender, clock: s.clock, isCareOpen: async () => { cared += 1; return false }, nameOf: async () => null, log: () => {} })
  await scheduler.tick()
  assert.equal(s.sender.sent.length, 0)
  assert.equal(cared, 0)
  assert.ok(!read.includes('notification_log') && !read.includes('user_settings'), read.join(','))
})

test('scheduler: the push uses the same first name as the greeting (saved name first, then sign-in)', async () => {
  const s = schedulerSetup({ start: DUE, tables: { users: [{ id: USER.id, first_name: 'Samira' }] } })
  s.base.auth.admin = { getUserById: async () => ({ data: { user: { user_metadata: { given_name: 'Sam' } } }, error: null }) }
  const scheduler = createPushScheduler({ supabase: s.base, sender: s.sender, clock: s.clock, isCareOpen: async () => false, log: () => {} })
  await scheduler.tick()
  assert.equal(s.sender.sent[0].body, 'Samira, how did it go?')
  assert.equal(await founderFirstName(s.base, OTHER.id), 'Sam') // no saved name: the sign-in name
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

test('scheduler: a send Expo clearly refused is retried on the same row and counted once', async () => {
  let fail = true
  const s = schedulerSetup({ start: DUE, respond: () => (fail ? { ok: false, unknown: false, error: 'MessageRateExceeded' } : { ok: true }) })
  await s.scheduler.tick()
  assert.deepEqual(s.log().map((r) => [r.status, r.attempts]), [['failed', 1]])
  fail = false
  s.clock.advance(MIN)
  await s.scheduler.tick()
  await s.scheduler.tick()
  assert.deepEqual(s.log().map((r) => [r.status, r.attempts]), [['sent', 2]])
  assert.equal(s.sender.sent.length, 2) // one failed try, one delivery
})

test('scheduler: a sender Expo keeps refusing gives up after 3 tries', async () => {
  const s = schedulerSetup({ start: DUE, respond: () => ({ ok: false, unknown: false, error: 'InvalidCredentials' }) })
  for (let i = 0; i < 6; i += 1) {
    await s.scheduler.tick()
    s.clock.advance(MIN)
  }
  assert.equal(s.sender.sent.length, 3)
  assert.deepEqual(s.log().map((r) => [r.status, r.attempts]), [['failed', 3]])
})

test('scheduler: a timeout, network error, 5xx or throw is unknown: the row stays sending, counts, and is never resent', async () => {
  for (const respond of [
    () => ({ ok: false, unknown: true, error: 'timeout' }),
    () => ({ ok: false, unknown: true, error: 'http_502' }),
    () => { throw new Error('socket hang up') },
  ]) {
    const s = schedulerSetup({ start: DUE, respond })
    const summary = await s.scheduler.tick()
    assert.equal(summary.unknown, 1)
    for (let i = 0; i < 5; i += 1) {
      s.clock.advance(10 * MIN)
      await s.scheduler.tick()
    }
    assert.equal(s.sender.sent.length, 1)
    assert.deepEqual(s.log().map((r) => [r.status, r.attempts, r.local_day, r.slot]), [['sending', 1, '2026-10-26', 'evening']])
  }
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
  const base = createFakeSupabase({ users: { tok: USER, tok2: OTHER }, tables: { founder_profiles: [], user_settings: [], push_tokens: [], ...tables }, unique: UNIQUE })
  const app = createApp({ env: ENV, supabase: base, openai: createFakeOpenAI([]), clock: createFakeClock(DUE) })
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
  const { call, callAnon, rows, close } = await apiSetup({ founder_profiles: [{ user_id: USER.id, timezone: null, report_time_local: null }] })
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
    assert.equal(inside.body.code, 'quiet_hours_clash')
    assert.equal(rows('founder_profiles')[0].report_time_local, '21:15')
  } finally {
    await close()
  }
})

test('reminder settings: before sign-up a check-in time is refused and nothing is written, no stub profile', async () => {
  const { call, rows, close } = await apiSetup()
  try {
    const res = await call('PUT', '/api/settings/reminders', { lock_screen: 'full', checkin_time: '21:00' })
    assert.deepEqual([res.status, res.body.error], [400, 'Finish sign-up first.'])
    assert.equal(rows('founder_profiles').length, 0)
    assert.equal(rows('user_settings').length, 0)
    // Settings that live on user_settings alone still save.
    assert.equal((await call('PUT', '/api/settings/reminders', { lock_screen: 'full' })).status, 200)
    assert.equal(rows('founder_profiles').length, 0)
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
  assert.deepEqual(await gone.send({ to: TOKEN, body: 'b' }), { ok: false, unknown: false, invalidToken: true, error: 'DeviceNotRegistered' })
  // Unknown: it may have reached the phone.
  const down = createExpoSender({ fetchImpl: async () => { throw new Error('offline') } })
  assert.deepEqual(await down.send({ to: TOKEN, body: 'b' }), { ok: false, unknown: true, invalidToken: false, error: 'network' })
  const slow = createExpoSender({ fetchImpl: async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }) } })
  assert.equal((await slow.send({ to: TOKEN, body: 'b' })).error, 'timeout')
  assert.equal((await slow.send({ to: TOKEN, body: 'b' })).unknown, true)
  const broken = createExpoSender({ fetchImpl: reply(503, null) })
  assert.deepEqual(await broken.send({ to: TOKEN, body: 'b' }), { ok: false, unknown: true, invalidToken: false, error: 'http_503' })
  const noTicket = createExpoSender({ fetchImpl: reply(200, { data: [] }) })
  assert.equal((await noTicket.send({ to: TOKEN, body: 'b' })).unknown, true)
  // A clear refusal: retried later.
  const refused = createExpoSender({ fetchImpl: reply(400, { errors: [{ code: 'VALIDATION_ERROR' }] }) })
  assert.deepEqual(await refused.send({ to: TOKEN, body: 'b' }), { ok: false, unknown: false, invalidToken: false, error: 'VALIDATION_ERROR' })
})

// ── Nudges from memory (C1) ─────────────────────────────────────────────────

// Karachi: 8 am local on Nov 20 is 03:00Z. The goal date is a week ahead.
const NOW = T('2026-11-20T03:00:00Z')
const GOAL = { text: '20 paying clinics', date: '2026-11-27' }
const THREAD = { id: uuid(500), user_id: USER.id, title: 'Get Shifa Clinic to sign', status: 'open', updated_at: at(NOW - 8 * DAY_MS) }

test('due: a goal date exactly a week ahead and a thread quiet for 7 days give nudges, freshest thread first', () => {
  const older = { ...THREAD, id: uuid(501), title: 'Find a cheaper way to reach schools', updated_at: at(NOW - 20 * DAY_MS) }
  const got = duePushes({ now: NOW, timeZone: 'Asia/Karachi', goal: GOAL, threads: [older, THREAD] })
  assert.deepEqual(got.map((p) => [p.kind, p.item.nudge, p.item.text]), [
    ['nudge', 'goal', '20 paying clinics'], ['nudge', 'thread', 'Get Shifa Clinic to sign'], ['nudge', 'thread', 'Find a cheaper way to reach schools'],
  ])
  assert.equal(got[0].item.key, 'nudge:goal:2026-11-27')
  assert.equal(got[1].item.key, `nudge:thread:${THREAD.id}:${THREAD.updated_at}`)
  // Six or eight days ahead, or a thread touched within the week: nothing.
  for (const date of ['2026-11-26', '2026-11-28']) assert.equal(duePushes({ now: NOW, timeZone: 'Asia/Karachi', goal: { ...GOAL, date } }).length, 0)
  assert.equal(duePushes({ now: NOW, timeZone: 'Asia/Karachi', threads: [{ ...THREAD, updated_at: at(NOW - NUDGE_THREAD_QUIET_MS + HOUR) }] }).length, 0)
})

test('due: a move or a quiet situation keeps the morning; no nudge is offered', () => {
  const m = move({ committed_at: at(NOW - 2 * HOUR), report_due_at: at(NOW + 12 * HOUR), closes_at: at(NOW + 40 * HOUR) })
  const withMove = duePushes({ now: NOW, timeZone: 'Asia/Karachi', moves: [m], goal: GOAL, threads: [THREAD] })
  assert.equal(withMove.some((p) => p.kind === 'nudge'), false)
  const quiet = duePushes({ now: NOW, timeZone: 'Asia/Karachi', quietSituation: { id: SIT, title: 'Pricing' }, lastActivityAt: at(NOW - 4 * DAY_MS), goal: GOAL, threads: [THREAD] })
  assert.deepEqual(quiet.map((p) => p.kind), ['quiet_check'])
})

test('policy: a nudge takes the morning slot, follows the morning switch, and waits 3 days after the last one', () => {
  const item = { key: 'nudge:goal:2026-11-27', dueAt: NOW, expiresAt: NOW + 4 * HOUR, nudge: 'goal', text: '20 paying clinics' }
  const f = founder({ lastActivityAt: at(NOW - DAY_MS) })
  const go = (over = {}) => decidePush({ founder: f, now: NOW, log: [], care: false, kind: 'nudge', item, ...over })
  assert.equal(go().send, true)
  assert.equal(go().slot, 'morning')
  const sent = (daysAgo, kind = 'nudge') => ({ kind, status: 'sent', dedupe_key: `x${daysAgo}`, local_day: localDay(NOW - daysAgo * DAY_MS, 'Asia/Karachi'), created_at: at(NOW - daysAgo * DAY_MS) })
  assert.equal(go({ log: [sent(2)] }).reason, 'nudge_spacing')
  assert.equal(go({ log: [sent(NUDGE_SPACING_MS / DAY_MS)] }).send, true)
  assert.equal(go({ log: [{ ...sent(0, 'morning'), created_at: at(NOW - HOUR) }] }).reason, 'slot_used')
  assert.equal(go({ founder: { ...f, settings: { ...f.settings, morning_on: false } } }).reason, 'off')
  assert.equal(go({ item: { ...item, text: ' ' } }).reason, 'nothing_real')
  assert.equal(go({ item: { ...item, nudge: 'other' } }).reason, 'nothing_real')
  assert.equal(go({ care: true }).reason, 'care')
  assert.equal(go({ founder: { ...f, lastActivityAt: at(NOW - PAUSE_AFTER_MS) } }).reason, 'paused')
})

test('compose: the approved nudge lines, in the founder\'s own words, open home', () => {
  const goal = { nudge: 'goal', text: '20 paying clinics' }
  const full = (item, name = 'Rafay') => composePush({ kind: 'nudge', item, name, lockScreen: 'full' })
  assert.equal(full(goal).body, 'Rafay, 7 days to 20 paying clinics. Where are you?')
  assert.equal(full(goal, null).body, '7 days to 20 paying clinics. Where are you?')
  assert.equal(full({ nudge: 'thread', text: 'Get Shifa Clinic to sign' }).body, 'Rafay, where are you with "Get Shifa Clinic to sign"?')
  assert.equal(full({ nudge: 'thread', text: 'Decide on "Plan B" pricing.' }).body, 'Rafay, where are you with "Decide on Plan B pricing"?')
  assert.equal(composePush({ kind: 'nudge', item: goal, name: 'Rafay' }).body, 'Rafay, your goal date is a week away.')
  assert.equal(composePush({ kind: 'nudge', item: ITEMS.nudge, name: 'Rafay' }).body, 'Rafay, one of your open questions has gone quiet.')
  assert.deepEqual(full(goal).data, { kind: 'nudge', open: 'home' })
  // A stored goal holding a banned phrase falls back to the short line.
  assert.equal(full({ nudge: 'goal', text: 'a great launch' }).body, 'Rafay, your goal date is a week away.')
})

const nudgeSetup = ({ threads = [THREAD], profile = {}, profiles = [], settings = [{ user_id: USER.id, lock_screen: 'full' }], situations = [], ...opts } = {}) => schedulerSetup({
  moves: [], settings, start: NOW,
  // Active a day ago: not quiet (no quiet_check), not paused.
  situations: [{ id: SIT, user_id: USER.id, title: 'Pricing emails to clinics', status: 'open', last_activity_at: at(NOW - DAY_MS) }, ...situations],
  tables: {
    founder_profiles: [{ user_id: USER.id, timezone: 'Asia/Karachi', report_time_local: null, deadline: null, signup_answers: {}, ...profile }, ...profiles],
    founder_threads: threads,
  },
  ...opts,
})

test('scheduler: one thread nudge in the morning, none the next two days, then the next thread', async () => {
  const second = { ...THREAD, id: uuid(501), title: 'Find a cheaper way to reach schools', updated_at: at(NOW - 10 * DAY_MS) }
  const s = nudgeSetup({ threads: [THREAD, second] })
  const days = []
  for (let d = 0; d < 4; d += 1) {
    // The founder stays active (a situation touched yesterday), so no quiet_check takes the morning.
    await s.supabase.from('situations').update({ last_activity_at: at(NOW + (d - 1) * DAY_MS) }).eq('id', SIT)
    for (let t = NOW - 3 * HOUR + d * DAY_MS; t < NOW + 12 * HOUR + d * DAY_MS; t += 30 * MIN) {
      s.clock.set(t)
      await s.scheduler.tick()
    }
    days.push(s.sender.sent.length)
  }
  assert.deepEqual(days, [1, 1, 1, 2])
  assert.deepEqual(s.sender.sent.map((m) => m.body), [
    'Rafay, where are you with "Get Shifa Clinic to sign"?',
    'Rafay, where are you with "Find a cheaper way to reach schools"?',
  ])
  assert.deepEqual(s.log().map((r) => [r.kind, r.slot, r.status, r.move_id, r.situation_id]), [['nudge', 'morning', 'sent', null, null], ['nudge', 'morning', 'sent', null, null]])
})

test('scheduler: the goal nudge goes out a week before the sign-up goal date, in the founder\'s words', async () => {
  const s = nudgeSetup({ threads: [], profile: { deadline: '2026-11-27', signup_answers: { goal: { goal: '20 paying clinics', when: 'This month', date: '2026-11-27' } } } })
  await s.scheduler.tick()
  assert.deepEqual(s.sender.sent.map((m) => m.body), ['Rafay, 7 days to 20 paying clinics. Where are you?'])
  assert.equal(s.log()[0].dedupe_key, 'nudge:goal:2026-11-27')
})

test('scheduler: each founder is nudged about their own thread only', async () => {
  const s = nudgeSetup({
    threads: [THREAD, { ...THREAD, id: uuid(502), user_id: OTHER.id, title: 'Hire a second baker' }],
    tokens: [
      { id: uuid(1), token: TOKEN, user_id: USER.id, platform: 'ios', timezone: 'Asia/Karachi', updated_at: at(NOW) },
      { id: uuid(2), token: TOKEN2, user_id: OTHER.id, platform: 'ios', timezone: 'Asia/Karachi', updated_at: at(NOW) },
    ],
    situations: [{ id: uuid(101), user_id: OTHER.id, title: 'Bakery hours', status: 'open', last_activity_at: at(NOW - DAY_MS) }],
    profiles: [{ user_id: OTHER.id, timezone: 'Asia/Karachi', deadline: null, signup_answers: {} }],
    settings: [{ user_id: USER.id, lock_screen: 'full' }, { user_id: OTHER.id, lock_screen: 'full' }],
  })
  await s.scheduler.tick()
  const to = Object.fromEntries(s.sender.sent.map((m) => [m.to, m.body]))
  assert.match(to[TOKEN], /Shifa Clinic/)
  assert.doesNotMatch(to[TOKEN], /baker/)
  assert.match(to[TOKEN2], /second baker/)
  assert.doesNotMatch(to[TOKEN2], /Shifa/)
})

test('scheduler: no nudge while care is open, after 14 quiet days, or twice from two schedulers', async () => {
  const care = nudgeSetup({ care: async () => true })
  await care.scheduler.tick()
  assert.equal(care.sender.sent.length, 0)

  const paused = nudgeSetup()
  await paused.supabase.from('situations').update({ last_activity_at: at(NOW - 15 * DAY_MS) }).eq('id', SIT)
  await paused.scheduler.tick()
  assert.equal(paused.sender.sent.length, 0)

  const twice = nudgeSetup()
  await Promise.all([twice.scheduler.tick(), twice.make().tick(), twice.scheduler.tick()])
  assert.equal(twice.sender.sent.length, 1)
  assert.equal(twice.log().length, 1)
})

test('scheduler: no nudge about a thread whose situation is already reported; an open one still goes', async () => {
  const DONE_SIT = uuid(110)
  const OPEN_SIT = uuid(111)
  const doneThread = { ...THREAD, id: uuid(510), title: 'Pricing emails to clinics', updated_at: at(NOW - 8 * DAY_MS) }
  const openThread = { ...THREAD, id: uuid(511), title: 'Hire a part-time nurse', updated_at: at(NOW - 9 * DAY_MS) }
  const evidence = (thread, sit) => ({ id: thread.id, user_id: USER.id, item_table: 'founder_threads', item_id: thread.id, source_kind: 'situation', source_id: sit, snippet: thread.title })
  const s = nudgeSetup({
    threads: [doneThread, openThread],
    situations: [
      { id: DONE_SIT, user_id: USER.id, title: 'Pricing emails to clinics', status: 'open', last_activity_at: at(NOW - 8 * DAY_MS) },
      { id: OPEN_SIT, user_id: USER.id, title: 'Hire a part-time nurse', status: 'open', last_activity_at: at(NOW - 9 * DAY_MS) },
    ],
  })
  await s.supabase.from('memory_evidence').insert([evidence(doneThread, DONE_SIT), evidence(openThread, OPEN_SIT)])
  await s.supabase.from('reports').insert({ id: uuid(600), user_id: USER.id, situation_id: DONE_SIT, outcome: 'done', created_at: at(NOW - 7 * DAY_MS) })
  await s.scheduler.tick()
  assert.deepEqual(s.sender.sent.map((m) => m.body), ['Rafay, where are you with "Hire a part-time nurse"?'])
})

test('scheduler: a thread quiet for 21 days or more is not offered again', async () => {
  const s = nudgeSetup({ threads: [{ ...THREAD, updated_at: at(NOW - 21 * DAY_MS) }] })
  await s.scheduler.tick()
  assert.equal(s.sender.sent.length, 0)
})

test('compose: a title that starts with the word "A" is lowercased mid-sentence, "AI" and "I" are kept', () => {
  const morning = (title) => composePush({ kind: 'morning', item: { ...ITEMS.morning, title }, name: 'Rafay', lockScreen: 'full' }).body
  assert.equal(morning('A few clinics need a call.'), 'Morning, Rafay. Today: a few clinics need a call.')
  assert.equal(morning('AI pricing page goes live.'), 'Morning, Rafay. Today: AI pricing page goes live.')
  assert.equal(morning('I send the invoice.'), 'Morning, Rafay. Today: I send the invoice.')
})

// ── Signal pushes (S4) ───────────────────────────────────────────────────────

const SIG_NOW = T('2026-10-26T06:00:00Z') // 11 am in Karachi
const signal = (n, over = {}) => ({
  id: uuid(900 + n), user_id: USER.id, lane: 'people', toolkit: 'gmail', external_ref_hash: `hash-${n}`.padEnd(20, 'x'),
  facts: { what_happened: `Dana Lee replied about the pilot ${n}`, source_name: 'Dana Lee', replied_thread: true }, impact: 'x', urgency: 2, status: 'new',
  situation_id: null, created_at: at(SIG_NOW - 10 * MIN), expires_at: at(SIG_NOW + 5 * HOUR), ...over,
})
const meeting = (n, minutes, over = {}) => signal(n, { toolkit: 'googlecalendar', lane: 'time', urgency: 3, situation_id: SIT,
  facts: { what_happened: 'Pilot call with Dana Lee', source_name: 'Google Calendar', accepted: true, meeting_start: at(SIG_NOW + minutes * MIN) }, ...over })
const signalSetup = ({ signals, world = [], settings = [], care, start = SIG_NOW, tables = {}, ...opts } = {}) => {
  const s = schedulerSetup({ moves: [], start, care, settings, tables: { signals, founder_world: world, ...tables }, ...opts })
  const scheduler = createPushScheduler({ supabase: s.supabase, sender: s.sender, clock: s.clock, isCareOpen: care ?? (async () => false), nameOf: async () => 'Rafay', log: () => {}, signalPush: true })
  return { ...s, scheduler, sigs: () => s.base.rows('signals') }
}
const worldDana = [{ id: uuid(800), user_id: USER.id, name: 'Dana Lee', kind: 'person', status: 'active', mention_count: 2, last_mentioned_at: at(SIG_NOW - DAY_MS) }]

test('policy: signal rows never count against the 2 a day of morning and evening', () => {
  const log = ['signal_1', 'signal_2', 'extreme_1'].map((slot, i) => ({ kind: 'signal', slot, local_day: '2026-10-26', status: 'sent', dedupe_key: `s${i}`, created_at: at(DUE) }))
  assert.equal(decide({ log }).send, true)
  assert.equal(decide({ log: [...log, { kind: 'morning', slot: 'morning', local_day: '2026-10-26', status: 'sent', dedupe_key: 'm', created_at: at(DUE) }, { kind: 'evening', slot: 'evening', local_day: '2026-10-26', status: 'sent', dedupe_key: 'e', created_at: at(DUE) }] }).reason, 'cap')
})

test('signal push: the 5th signal of a day is held; its slot is the database cap', async () => {
  const s = signalSetup({ signals: [1, 2, 3, 4, 5].map((n) => signal(n)) })
  await s.scheduler.tick()
  assert.equal(s.sender.sent.length, 4)
  assert.deepEqual(s.log().map((r) => r.slot).sort(), ['signal_1', 'signal_2', 'signal_3', 'signal_4'])
  assert.equal(s.sigs().filter((r) => r.status === 'pushed').length, 4)
  await s.scheduler.tick()
  assert.equal(s.sender.sent.length, 4)
  assert.equal(s.sigs().filter((r) => r.status === 'new').length, 1)
})

test('signal push: two schedulers with a stale log cannot get a 5th through (23505 path)', async () => {
  const day = localDay(SIG_NOW, 'Asia/Karachi')
  const taken = ['signal_1', 'signal_2', 'signal_3'].map((slot) => ({ id: `x-${slot}`, user_id: USER.id, kind: 'signal', slot, local_day: day, status: 'sent', dedupe_key: `old:${slot}`, attempts: 1, created_at: at(SIG_NOW - 4 * HOUR) }))
  const s = signalSetup({ signals: [signal(1), signal(2)], tables: { notification_log: taken } })
  const db = withLogBarrier(s.base)
  const make = () => createPushScheduler({ supabase: db, sender: s.sender, clock: s.clock, isCareOpen: async () => false, nameOf: async () => 'Rafay', log: () => {}, signalPush: true })
  await Promise.all([make().tick(), make().tick()])
  assert.equal(s.sender.sent.length, 1)
  assert.equal(s.log().filter((r) => r.local_day === day && COUNTING(r)).length, 4)
})

test('signal push: morning and evening still send after 4 signals went out', async () => {
  const s = signalSetup({ signals: [1, 2, 3, 4].map((n) => signal(n)), moves: [move()], start: T('2026-10-26T03:00:00Z') })
  s.base.rows('signals').forEach((r) => { r.created_at = at(T('2026-10-26T03:00:00Z') - MIN); r.expires_at = at(T('2026-10-26T09:00:00Z')) })
  const sch = createPushScheduler({ supabase: s.supabase, sender: s.sender, clock: s.clock, isCareOpen: async () => false, nameOf: async () => 'Rafay', log: () => {}, signalPush: true })
  await sch.tick()
  s.clock.set(DUE)
  await sch.tick()
  const kinds = s.sender.sent.map((m) => m.data.kind)
  assert.equal(kinds.filter((k) => k === 'signal').length, 4)
  assert.ok(kinds.includes('morning') && kinds.includes('evening'))
})

test('signal push: only new, urgency 2 or more, not expired, not stale', async () => {
  const s = signalSetup({ signals: [signal(1, { urgency: 1 }), signal(2, { status: 'shown' }), signal(3, { expires_at: at(SIG_NOW - MIN) }), signal(4, { created_at: at(SIG_NOW - 7 * HOUR) })] })
  await s.scheduler.tick()
  assert.equal(s.sender.sent.length, 0)
})

test('signal push: extreme needs urgency 3, a meeting within 3 hours or a known person, and the founder\'s world; it takes only its own slot', async () => {
  const ok = signalSetup({ signals: [meeting(1, 90)] })
  await ok.scheduler.tick()
  assert.deepEqual(ok.log().map((r) => r.slot), ['extreme_1'])
  const bad = [
    meeting(2, 200), // beyond 3 hours
    meeting(3, 60, { urgency: 2 }), // not urgency 3
    meeting(4, 60, { situation_id: null, facts: { what_happened: 'Standup with the team', source_name: 'Google Calendar', accepted: true, meeting_start: at(SIG_NOW + 60 * MIN) } }), // names nothing of theirs
    signal(5, { urgency: 3, facts: { what_happened: 'Someone new asks for a call', source_name: 'Sam Roe' } }), // gmail, not a known person
  ]
  const s = signalSetup({ signals: bad })
  await s.scheduler.tick()
  assert.ok(s.log().every((r) => !r.slot.startsWith('extreme')))
  const gm = signalSetup({ signals: [signal(6, { urgency: 3 })], world: worldDana })
  await gm.scheduler.tick()
  assert.deepEqual(gm.log().map((r) => r.slot), ['extreme_1'])
})

test('signal push: extreme has 2 places; the third waits, and never takes a signal slot', async () => {
  const s = signalSetup({ signals: [meeting(1, 60), meeting(2, 70), meeting(3, 80)] })
  await s.scheduler.tick()
  assert.deepEqual(s.log().map((r) => r.slot).sort(), ['extreme_1', 'extreme_2'])
})

test('signal push: quiet hours hold; an extreme event within 3 hours is the one exception', async () => {
  const night = T('2026-10-26T18:00:00Z') // 11 pm in Karachi
  const mk = (sigs) => signalSetup({ signals: sigs, start: night })
  const held = mk([signal(1, { created_at: at(night - MIN), expires_at: at(night + HOUR) }), meeting(2, 200, { created_at: at(night - MIN), expires_at: at(night + 4 * HOUR), facts: { what_happened: 'Pilot call with Dana Lee', source_name: 'Google Calendar', accepted: true, meeting_start: at(night + 200 * MIN) } })])
  await held.scheduler.tick()
  assert.equal(held.sender.sent.length, 0)
  const soon = mk([meeting(3, 0, { created_at: at(night - MIN), expires_at: at(night + 4 * HOUR), facts: { what_happened: 'Pilot call with Dana Lee', source_name: 'Google Calendar', accepted: true, meeting_start: at(night + 120 * MIN) } })])
  await soon.scheduler.tick()
  assert.equal(soon.sender.sent.length, 1)
  assert.equal(soon.log()[0].slot, 'extreme_1')
})

test('signal push: nothing while care is open, or for a founder being deleted', async () => {
  const c = signalSetup({ signals: [signal(1)], care: async () => true })
  await c.scheduler.tick()
  assert.equal(c.sender.sent.length, 0)
  const d = signalSetup({ signals: [signal(1)], tables: { account_requests: [{ id: uuid(5), user_id: USER.id, kind: 'delete', status: 'queued' }] } })
  await d.scheduler.tick()
  assert.equal(d.sender.sent.length, 0)
})

test('signal push: off unless asked for', async () => {
  const s = signalSetup({ signals: [signal(1)] })
  const off = createPushScheduler({ supabase: s.supabase, sender: s.sender, clock: s.clock, isCareOpen: async () => false, log: () => {} })
  await off.tick()
  assert.equal(s.sender.sent.length, 0)
})

test('signal push: the lock screen is short by default and even when the setting is full; hidden is just Axiom; no content in the body or the log', async () => {
  for (const [lock, expected] of [[undefined, 'Rafay, an email that needs you today has come in.'], ['full', 'Rafay, an email that needs you today has come in.'], ['hidden', HIDDEN_BODY]]) {
    const s = signalSetup({ signals: [signal(1)], settings: lock ? [{ user_id: USER.id, lock_screen: lock }] : [] })
    await s.scheduler.tick()
    assert.equal(s.sender.sent[0].body, expected)
    assert.deepEqual(voiceProblems(s.sender.sent[0].body), [])
    assert.ok(!JSON.stringify(s.log()).includes('Dana'))
  }
  const m = signalSetup({ signals: [meeting(1, 90)] })
  await m.scheduler.tick()
  assert.equal(m.sender.sent[0].body, 'Rafay, a meeting starts in 90 minutes.')
})

test('signal push: unknown is never resent; a refused send is retried at most 3 times; a signal pushed once is not pushed again', async () => {
  const unk = signalSetup({ signals: [signal(1)], respond: () => ({ ok: false, unknown: true, error: 'timeout' }) })
  for (let i = 0; i < 4; i += 1) await unk.scheduler.tick()
  assert.equal(unk.sender.sent.length, 1)
  const bad = signalSetup({ signals: [signal(1)], respond: () => ({ ok: false, unknown: false, error: 'refused' }) })
  for (let i = 0; i < 6; i += 1) await bad.scheduler.tick()
  assert.equal(bad.sender.sent.length, 3)
  assert.equal(bad.sigs()[0].status, 'new')
  const once = signalSetup({ signals: [signal(1)] })
  for (let i = 0; i < 3; i += 1) await once.scheduler.tick()
  assert.equal(once.sender.sent.length, 1)
})

test('signal push: a meeting the founder did not accept, or an email with no reply of theirs, is never extreme', async () => {
  const invite = meeting(1, 60); delete invite.facts.accepted
  const stranger = signal(2, { urgency: 3, facts: { what_happened: 'Dana Lee replied about the pilot', source_name: 'Dana Lee' } })
  const s = signalSetup({ signals: [invite, stranger], world: worldDana, start: T('2026-10-26T18:00:00Z') })
  s.base.rows('signals').forEach((r) => { r.created_at = at(T('2026-10-26T18:00:00Z') - MIN); r.expires_at = at(T('2026-10-26T22:00:00Z')); if (r.facts.meeting_start) r.facts.meeting_start = at(T('2026-10-26T18:00:00Z') + 60 * MIN) })
  await s.scheduler.tick()
  assert.equal(s.sender.sent.length, 0) // quiet hours hold both
})

test('compose signal: 90 minutes is not rounded to 2 hours; a past or missing start is the generic line', () => {
  const body = (start, toolkit = 'googlecalendar') => composeSignalPush({ item: { toolkit, meetingStart: start, signalId: 'x' }, name: 'Rafay', now: SIG_NOW }).body
  assert.equal(body(SIG_NOW + 90 * MIN), 'Rafay, a meeting starts in 90 minutes.')
  assert.equal(body(SIG_NOW + 150 * MIN), 'Rafay, a meeting starts in 2 hours.')
  assert.equal(body(SIG_NOW - 5 * MIN), 'Rafay, something in your tools needs you today.')
  assert.equal(body(NaN), 'Rafay, something in your tools needs you today.')
})
