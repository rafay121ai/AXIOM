// S1: poll, backfill, queue, worker, filter, breaker. Fakes only: no Composio, no model, no Supabase.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createFakeClock, createFakeSupabase } from '../testing/fakes.js'
import { filterItem, overridable } from './filter.js'
import { FIXTURES, SECRETS } from './fixtures/index.js'
import { BACKFILL, createIngestion } from './ingest.js'
import { createBreaker } from './read.js'
import { createWorker, MAX_ATTEMPTS, STALE_LOCK_MS } from './worker.js'

const NOW = Date.parse('2026-11-27T12:00:00.000Z')
const U = '11111111-1111-4111-8111-111111111111'
const UNIQUE = { connector_jobs: [{ cols: ['user_id', 'toolkit', 'external_id'] }] }
const account = (o = {}) => ({ id: `a-${o.toolkit ?? 'gmail'}`, user_id: U, toolkit: 'gmail', status: 'active', last_sync_at: '2026-11-27T11:50:00.000Z', last_error_code: null, ...o })
const db = (tables = {}) => createFakeSupabase({ tables, unique: UNIQUE })
const msgs = (n, from = 0) => Array.from({ length: n }, (_, i) => ({ messageId: `m${from + i}`, messageTimestamp: `${1000 + i}` }))

// A fake connectors.run: script[slug] is a function(args) returning data, or throwing.
function fakeConnectors(script) {
  const calls = []
  return { calls, run: async (userId, slug, args) => { calls.push({ slug, args }); return { data: await script[slug](args) } } }
}
function setup({ tables, script = {}, logs = [] } = {}) {
  const supabase = db(tables)
  const clock = createFakeClock(NOW)
  const connectors = fakeConnectors(script)
  const handled = []
  const ing = createIngestion({ supabase, connectors, clock, handleItem: async (u, t, i) => handled.push({ t, i }), log: (what, info) => logs.push(`${what} ${info ?? ''}`) })
  return { supabase, clock, connectors, ing, handled, logs }
}
const jobs = (s) => s.supabase.rows('connector_jobs')

test('a poll queues one job per item and a repeat queues nothing new', async () => {
  const s = setup({ tables: { connector_accounts: [account()] }, script: { GMAIL_FETCH_EMAILS: () => ({ messages: msgs(3) }) } })
  await s.ing.poll()
  assert.equal(jobs(s).length, 3)
  assert.ok(jobs(s).every((j) => j.kind === 'poll' && /^m\d\|1\d{3}$/.test(j.external_id)))
  assert.ok(jobs(s).every((j) => Object.keys(j).sort().join() === 'external_id,id,kind,run_after,toolkit,user_id'))
  const before = s.supabase.rows('connector_accounts')[0].last_sync_at
  s.clock.advance(300000)
  await s.ing.poll()
  assert.equal(jobs(s).length, 3)
  assert.notEqual(s.supabase.rows('connector_accounts')[0].last_sync_at, before)
  assert.match(s.connectors.calls[0].args.query, /^after:\d+$/)
})

test('last_sync_at does not move when the enqueue fails', async () => {
  const s = setup({ tables: { connector_accounts: [account()] }, script: { GMAIL_FETCH_EMAILS: () => ({ messages: msgs(2) }) } })
  const real = s.supabase.from
  s.supabase.from = (t) => (t === 'connector_jobs' ? { insert: () => Promise.resolve({ error: { code: '57014' } }) } : real(t))
  await s.ing.poll()
  assert.equal(s.supabase.rows('connector_accounts')[0].last_sync_at, '2026-11-27T11:50:00.000Z')
  assert.equal(s.supabase.rows('connector_accounts')[0].last_error_code, 'enqueue_error')
})

test('a poll only uses read-only tools, for all three tools', async () => {
  const s = setup({ tables: { connector_accounts: [account(), account({ toolkit: 'googlecalendar', id: 'a2' }), account({ toolkit: 'notion', id: 'a3' })] }, script: {
    GMAIL_FETCH_EMAILS: () => ({ messages: [] }), GOOGLECALENDAR_EVENTS_LIST: () => ({ items: [{ id: 'e1', updated: '2026-11-27T10:00:00Z' }] }),
    NOTION_SEARCH_NOTION_PAGE: () => ({ results: [{ id: 'p1', last_edited_time: '2026-11-27T11:55:00.000Z' }, { id: 'p0', last_edited_time: '2026-11-01T00:00:00.000Z' }], has_more: false }) } })
  const { READ_ONLY } = await import('./composio.js')
  await s.ing.poll()
  assert.ok(s.connectors.calls.every((c) => READ_ONLY.has(c.slug)))
  assert.deepEqual(jobs(s).map((j) => j.external_id).sort(), ['e1|2026-11-27T10:00:00Z', 'p1|2026-11-27T11:55:00.000Z'])
})

test('backfill: first time only, bounded by hard caps', async () => {
  const s = setup({ tables: { connector_accounts: [account({ last_sync_at: null })] }, script: { GMAIL_FETCH_EMAILS: ({ max_results, page_token }) => ({ messages: msgs(max_results, page_token ? 100 : 0), nextPageToken: 'more' }) } })
  await s.ing.backfill(U, 'gmail')
  assert.equal(BACKFILL.gmailMax, 50)
  assert.equal(jobs(s).length, BACKFILL.gmailMax)
  assert.ok(jobs(s).every((j) => j.kind === 'backfill'))
  assert.ok(s.connectors.calls.length <= 3)
  const calls = s.connectors.calls.length
  await s.ing.backfill(U, 'gmail') // synced now: nothing more
  assert.equal(s.connectors.calls.length, calls)
})

test('backfill: calendar window and notion cap', async () => {
  const s = setup({ tables: { connector_accounts: [account({ toolkit: 'googlecalendar', last_sync_at: null }), account({ toolkit: 'notion', id: 'n', last_sync_at: null })] }, script: {
    GOOGLECALENDAR_EVENTS_LIST: () => ({ items: [] }),
    NOTION_SEARCH_NOTION_PAGE: ({ page_size }) => ({ results: Array.from({ length: page_size }, (_, i) => ({ id: `p${i}`, last_edited_time: '2026-01-01T00:00:00.000Z' })), has_more: true, next_cursor: 'c' }) } })
  await s.ing.poll() // never synced: the poller backfills
  const cal = s.connectors.calls.find((c) => c.slug === 'GOOGLECALENDAR_EVENTS_LIST').args
  assert.equal(Date.parse(cal.timeMin), NOW - 30 * 86400000)
  assert.equal(Date.parse(cal.timeMax), NOW + 14 * 86400000)
  assert.equal(jobs(s).filter((j) => j.toolkit === 'notion').length, BACKFILL.notionMax)
})

test('claim is exclusive: two workers, one job', async () => {
  const s = setup({ tables: { connector_jobs: [{ id: 'j1', user_id: U, toolkit: 'gmail', external_id: 'm1|1', kind: 'poll', status: 'queued', attempts: 0, run_after: '2026-11-27T11:00:00.000Z' }] } })
  const w2 = createWorker({ supabase: s.supabase, read: async () => ({}), breaker: s.ing.breaker, clock: s.clock })
  const [a, b] = await Promise.all([s.ing.worker.claim(), w2.claim()])
  assert.equal(a.length + b.length, 1)
  assert.equal(jobs(s)[0].status, 'running')
  assert.ok(jobs(s)[0].locked_at)
})

test('a job not yet due is not claimed', async () => {
  const s = setup({ tables: { connector_jobs: [{ id: 'j1', user_id: U, toolkit: 'gmail', external_id: 'm1|1', kind: 'poll', status: 'queued', attempts: 0, run_after: '2026-11-27T13:00:00.000Z' }] } })
  assert.equal((await s.ing.worker.claim()).length, 0)
})

test('a stale running job goes back to queued; out of attempts it fails', async () => {
  const old = new Date(NOW - STALE_LOCK_MS - 1000).toISOString()
  const row = (id, attempts, locked_at) => ({ id, user_id: U, toolkit: 'gmail', external_id: id, kind: 'poll', status: 'running', attempts, run_after: old, locked_at })
  const s = setup({ tables: { connector_jobs: [row('a', 1, old), row('b', MAX_ATTEMPTS, old), row('c', 1, new Date(NOW - 1000).toISOString())] } })
  await s.ing.worker.requeueStale()
  const by = Object.fromEntries(jobs(s).map((j) => [j.id, j.status]))
  assert.deepEqual(by, { a: 'queued', b: 'failed', c: 'running' })
})

test('a failing job retries with backoff, then dead-letters after 5 attempts', async () => {
  const s = setup({ tables: { connector_accounts: [account()], connector_jobs: [{ id: 'j1', user_id: U, toolkit: 'gmail', external_id: 'm1|1', kind: 'poll', status: 'queued', attempts: 0, run_after: new Date(NOW).toISOString() }] },
    script: { GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID: () => { throw new Error('upstream 500') } } })
  s.ing.breaker.success()
  const big = createBreaker({ clock: s.clock, threshold: 1000 })
  const w = createWorker({ supabase: s.supabase, read: async () => { throw Object.assign(new Error('composio'), { code: 'composio' }) }, breaker: big, clock: s.clock, log: () => {} })
  let last = 0
  for (let i = 1; i <= MAX_ATTEMPTS; i += 1) {
    assert.equal(await w.run(), 1, `attempt ${i}`)
    const j = jobs(s)[0]
    assert.equal(j.attempts, i)
    if (i < MAX_ATTEMPTS) {
      assert.equal(j.status, 'queued')
      assert.ok(Date.parse(j.run_after) > last)
      assert.equal(await w.run(), 0) // backoff: not due yet
      last = Date.parse(j.run_after)
      s.clock.set(last)
    }
  }
  assert.equal(jobs(s)[0].status, 'failed')
  assert.equal(await w.run(), 0)
})

test('an auth error marks the account needs_reconnect and drops the job', async () => {
  const s = setup({ tables: { connector_accounts: [account()], connector_jobs: [{ id: 'j1', user_id: U, toolkit: 'gmail', external_id: 'm1|1', kind: 'poll', status: 'queued', attempts: 0, run_after: new Date(NOW).toISOString() }] },
    script: { GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID: () => { throw Object.assign(new Error('invalid_grant'), {}) } } })
  await s.ing.worker.run()
  assert.equal(s.supabase.rows('connector_accounts')[0].status, 'needs_reconnect')
  assert.equal(s.supabase.rows('connector_accounts')[0].last_error_code, 'auth')
  assert.equal(jobs(s)[0].status, 'dropped')
  assert.equal(s.ing.breaker.isOpen(), false) // a founder's login says nothing about Composio
})

test('a poll auth error marks needs_reconnect; a Composio error sets last_error_code', async () => {
  const s = setup({ tables: { connector_accounts: [account(), account({ toolkit: 'notion', id: 'n' })] }, script: {
    GMAIL_FETCH_EMAILS: () => { throw Object.assign(new Error('x'), { status: 401 }) },
    NOTION_SEARCH_NOTION_PAGE: () => { throw new Error('boom') } } })
  await s.ing.poll()
  const rows = Object.fromEntries(s.supabase.rows('connector_accounts').map((a) => [a.toolkit, a]))
  assert.equal(rows.gmail.status, 'needs_reconnect')
  assert.equal(rows.notion.last_error_code, 'composio')
  assert.equal(rows.notion.status, 'active')
})

test('the breaker opens after N failures in a row, pauses polling, and closes after the pause or a success', async () => {
  const clock = createFakeClock(NOW)
  const b = createBreaker({ clock, threshold: 3, pauseMs: 60000 })
  b.failure(); b.failure(); assert.equal(b.isOpen(), false)
  b.success(); b.failure(); b.failure(); assert.equal(b.isOpen(), false) // not in a row
  b.failure(); assert.equal(b.isOpen(), true)
  clock.advance(59000); assert.equal(b.isOpen(), true)
  clock.advance(2000); assert.equal(b.isOpen(), false)

  const s = setup({ tables: { connector_accounts: Array.from({ length: 8 }, (_, i) => account({ id: `a${i}`, user_id: `u${i}` })) }, script: { GMAIL_FETCH_EMAILS: () => { throw new Error('down') } } })
  await s.ing.poll()
  assert.equal(s.ing.breaker.isOpen(), true)
  assert.equal(s.connectors.calls.length, 5) // stopped calling Composio at the threshold
  const calls = s.connectors.calls.length
  await s.ing.poll()
  assert.equal(s.connectors.calls.length, calls)
})

test('a kept item reaches handleItem, a dropped one is marked dropped; content is never stored', async () => {
  const job = (id, ext) => ({ id, user_id: U, toolkit: 'gmail', external_id: ext, kind: 'poll', status: 'queued', attempts: 0, run_after: new Date(NOW).toISOString() })
  const msg = (f) => ({ threadId: 't', labelIds: f.labels, sender: f.from, subject: f.subject, messageText: f.body })
  const byId = { keepme: msg({ labels: ['INBOX'], from: FIXTURES.cofounder.item.from, subject: FIXTURES.cofounder.item.subject, body: FIXTURES.cofounder.item.body }), dropme: msg({ labels: ['CATEGORY_PROMOTIONS'], from: FIXTURES.promo.item.from, subject: FIXTURES.promo.item.subject, body: FIXTURES.promo.item.body }) }
  const logs = []
  const s = setup({ logs, tables: { connector_accounts: [account()], connector_jobs: [job('j1', 'keepme|1'), job('j2', 'dropme|1')] }, script: { GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID: ({ message_id }) => byId[message_id], GOOGLECALENDAR_EVENTS_LIST: () => ({ items: [] }) } })
  assert.equal(await s.ing.worker.run(), 2)
  const by = Object.fromEntries(jobs(s).map((j) => [j.id, j]))
  assert.equal(by.j1.status, 'done')
  assert.equal(by.j2.status, 'dropped')
  assert.equal(by.j2.last_error_code, 'label_category_promotions')
  assert.equal(s.handled.length, 1)
  const stored = JSON.stringify([jobs(s), s.supabase.rows('connector_accounts')])
  for (const secret of SECRETS) assert.ok(!stored.includes(secret), secret)
})

test('an overridable drop is kept when the founder sent the thread', async () => {
  const f = FIXTURES.investorReply.item
  const s = setup({ tables: { connector_accounts: [account()], connector_jobs: [{ id: 'j1', user_id: U, toolkit: 'gmail', external_id: 'inv|1', kind: 'poll', status: 'queued', attempts: 0, run_after: new Date(NOW).toISOString() }] }, script: {
    GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID: () => ({ threadId: f.threadId, labelIds: f.labels, sender: f.from, subject: f.subject, messageText: f.body }),
    GMAIL_FETCH_MESSAGE_BY_THREAD_ID: () => ({ messages: [{ labelIds: ['SENT'] }, { labelIds: ['INBOX'] }] }), GOOGLECALENDAR_EVENTS_LIST: () => ({ items: [] }) } })
  await s.ing.worker.run()
  assert.equal(jobs(s)[0].status, 'done')
})

test('no content in logs, even when everything fails', async () => {
  const logs = []
  const f = FIXTURES.injection.item
  const s = setup({ logs, tables: { connector_accounts: [account()], connector_jobs: [{ id: 'j1', user_id: U, toolkit: 'gmail', external_id: 'inj|1', kind: 'poll', status: 'queued', attempts: 0, run_after: new Date(NOW).toISOString() }] }, script: {
    GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID: () => ({ labelIds: [], sender: f.from, subject: f.subject, messageText: f.body }) } })
  const w = createWorker({ supabase: s.supabase, read: s.connectors.run.bind(null, U) && (async (u, slug, a) => (await s.connectors.run(u, slug, a)).data), breaker: s.ing.breaker, clock: s.clock,
    handleItem: async () => { throw new Error(`${f.subject} ${f.body}`) }, log: (what, info) => logs.push(`${what} ${info ?? ''}`) })
  await w.run()
  assert.ok(logs.length > 0)
  const out = logs.join('\n') + JSON.stringify(jobs(s))
  for (const secret of [...SECRETS, f.subject, f.from]) assert.ok(!out.includes(secret), secret)
})

for (const [name, { toolkit, item, expect, ctx }] of Object.entries(FIXTURES)) {
  test(`filter fixture: ${name}`, () => {
    const r = filterItem(toolkit, item, ctx)
    assert.equal(r.keep, expect.keep, JSON.stringify(r))
    if (expect.reason) assert.equal(r.reason, expect.reason)
    assert.equal(Boolean(r.injection), Boolean(expect.injection))
  })
}

test('filter: a meeting person is kept, a sensitive one is not; only label drops are overridable', () => {
  const promo = FIXTURES.promo.item
  const person = { ...promo, bulk: false, subject: 'Hello', body: 'About Thursday', from: 'Dana <dana@brightloop.example>' }
  assert.equal(filterItem('gmail', person).keep, false)
  assert.equal(filterItem('gmail', person, { meetingPeople: new Set(['dana@brightloop.example']) }).reason, 'meeting_person')
  assert.equal(overridable('gmail', filterItem('gmail', person)), true)
  assert.equal(overridable('gmail', filterItem('gmail', FIXTURES.bankOtp.item)), false)
  const sensitiveFromPerson = { ...person, subject: 'Tax return docs' }
  assert.equal(filterItem('gmail', sensitiveFromPerson, { repliedTo: true }).keep, false)
  assert.equal(filterItem('gmail', { ...person, labels: ['INBOX'], from: 'x <noreply@a.example>' }).reason, 'no_reply')
  assert.equal(filterItem('notion', { title: 'Password reset notes' }).keep, false)
})

// ---- S1 audit fixes ----
const queued = (id, ext, o = {}) => ({ id, user_id: U, toolkit: 'gmail', external_id: ext, kind: 'poll', status: 'queued', attempts: 0, run_after: new Date(NOW).toISOString(), ...o })
const b64 = (t) => Buffer.from(t).toString('base64url')

test('notion poll stops at the first page older than the last sync and caps the pages', async () => {
  let calls = 0
  const s = setup({ tables: { connector_accounts: [account({ toolkit: 'notion' })] }, script: { NOTION_SEARCH_NOTION_PAGE: () => {
    calls += 1
    return { results: [{ id: `new${calls}`, last_edited_time: '2026-11-27T11:55:00.000Z' }, { id: `old${calls}`, last_edited_time: '2026-11-01T00:00:00.000Z' }], has_more: true, next_cursor: 'c' } } } })
  await s.ing.poll()
  assert.equal(calls, 1)
  assert.deepEqual(jobs(s).map((j) => j.external_id), ['new1|2026-11-27T11:55:00.000Z'])
  calls = 0
  const s2 = setup({ tables: { connector_accounts: [account({ toolkit: 'notion' })] }, script: { NOTION_SEARCH_NOTION_PAGE: () => { calls += 1; return { results: [{ id: `n${calls}`, last_edited_time: '2026-11-27T11:55:00.000Z' }], has_more: true, next_cursor: 'c' } } } })
  await s2.ing.poll()
  assert.ok(calls <= 5)
})

test('a hung Composio call times out, counts for the breaker, and frees the run', async () => {
  const { createReader } = await import('./read.js')
  const breaker = createBreaker({ clock: createFakeClock(NOW), threshold: 1 })
  const read = createReader({ connectors: { run: () => new Promise(() => {}) }, breaker, timeoutMs: 20 })
  await assert.rejects(read(U, 'GMAIL_FETCH_EMAILS', {}), { code: 'composio' })
  assert.equal(breaker.isOpen(), true)
})

test('a job that keeps hanging is requeued as stale and still dead-letters (attempt counted at claim)', async () => {
  const s = setup({ tables: { connector_jobs: [queued('j1', 'm1|1')] } })
  for (let i = 1; i <= MAX_ATTEMPTS; i += 1) {
    s.clock.advance(STALE_LOCK_MS + 1000)
    await s.ing.worker.requeueStale()
    const claimed = await s.ing.worker.claim()
    assert.equal(claimed.length, 1, `claim ${i}`)
    assert.equal(claimed[0].attempts, i)
  }
  s.clock.advance(STALE_LOCK_MS + 1000)
  await s.ing.worker.requeueStale()
  assert.equal(jobs(s)[0].status, 'failed')
})

test('a late finish of a requeued job cannot overwrite the newer run', async () => {
  const gate = {}
  const s = setup({ tables: { connector_accounts: [account()], connector_jobs: [queued('j1', 'm1|1')] }, script: { GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID: () => ({ labelIds: ['CATEGORY_PROMOTIONS'], sender: 'x@y.example', subject: 's', messageText: 'b' }) } })
  const w = createWorker({ supabase: s.supabase, breaker: s.ing.breaker, clock: s.clock, log: () => {},
    read: async () => { await new Promise((r) => { gate.release = r }); return { labelIds: [], sender: 'a@b.example', subject: 's', messageText: 'hello' } } })
  const first = w.run()
  await new Promise((r) => setTimeout(r, 10))
  s.clock.advance(STALE_LOCK_MS + 1000)
  await s.ing.worker.requeueStale() // the first run is presumed dead
  const second = (await s.ing.worker.claim())[0]
  assert.equal(second.attempts, 2)
  gate.release()
  await first // the late finish
  assert.equal(jobs(s)[0].status, 'running')
  assert.equal(jobs(s)[0].locked_at, second.locked_at)
})

test('sensitive text is found in payload.parts, past 4000 characters, and in Notion bodies; unreadable text fails closed', async () => {
  const run = async (toolkit, ext, script) => {
    const s = setup({ tables: { connector_accounts: [account({ toolkit })], connector_jobs: [queued('j1', ext, { toolkit })] }, script })
    await s.ing.worker.run()
    return { j: jobs(s)[0], s }
  }
  const labels = { labelIds: [], sender: 'Dana <dana@brightloop.example>', subject: 'Hi' }
  const parts = { ...labels, payload: { mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/html', body: { data: b64('<p>your <b>one-time code</b> is 123456</p>') } }] } }
  assert.equal((await run('gmail', 'm|1', { GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID: () => parts })).j.last_error_code, 'sensitive_text')
  const late = { ...labels, messageText: `${'hello there. '.repeat(500)} please send your passport copy` }
  assert.equal((await run('gmail', 'm|1', { GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID: () => late })).j.last_error_code, 'sensitive_text')
  const unreadable = { ...labels, payload: { parts: [{ mimeType: 'application/pdf', body: { size: 900 } }] } }
  assert.equal((await run('gmail', 'm|1', { GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID: () => unreadable })).j.last_error_code, 'sensitive_unknown')
  const huge = { ...labels, messageText: 'x '.repeat(150000) }
  assert.equal((await run('gmail', 'm|1', { GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID: () => huge })).j.last_error_code, 'sensitive_unknown')
  const notion = (md) => ({ NOTION_RETRIEVE_PAGE: () => ({ title: 'Plans' }), NOTION_GET_PAGE_MARKDOWN: () => md })
  assert.equal((await run('notion', 'p1|1', notion({ markdown: 'Notes from the clinic about my prescription' }))).j.last_error_code, 'sensitive_text')
  assert.equal((await run('notion', 'p1|1', notion({}))).j.last_error_code, 'sensitive_unknown')
  const ok1 = await run('notion', 'p1|1', notion({ markdown: 'Goals for Q1' }))
  assert.equal(ok1.j.status, 'done')
})

test('a deleted item is dropped as item_gone, never retried, and does not feed the breaker', async () => {
  const s = setup({ tables: { connector_accounts: [account()], connector_jobs: [queued('j1', 'm1|1')] }, script: { GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID: () => { throw Object.assign(new Error('Requested entity was not found'), { status: 404 }) } } })
  for (let i = 0; i < 8; i += 1) { s.clock.advance(1); await s.ing.worker.run() }
  assert.equal(jobs(s)[0].status, 'dropped')
  assert.equal(jobs(s)[0].last_error_code, 'item_gone')
  assert.equal(jobs(s)[0].attempts, 1)
  assert.equal(s.ing.breaker.isOpen(), false)
})

test('calendar fetch uses the read-only get tool, so a busy calendar is never "gone"', async () => {
  const { READ_ONLY } = await import('./composio.js')
  assert.ok(READ_ONLY.has('GOOGLECALENDAR_EVENTS_GET'))
  const s = setup({ tables: { connector_accounts: [account({ toolkit: 'googlecalendar' })], connector_jobs: [queued('j1', 'ev99|2026-11-27T10:00:00Z', { toolkit: 'googlecalendar' })] }, script: {
    GOOGLECALENDAR_EVENTS_GET: ({ event_id }) => ({ id: event_id, summary: 'Review', attendees: [{ self: true }, { email: 'd@e.example' }] }) } })
  await s.ing.worker.run()
  assert.equal(jobs(s)[0].status, 'done')
  assert.deepEqual(s.connectors.calls.map((c) => c.slug), ['GOOGLECALENDAR_EVENTS_GET'])
})

test('founders with a deletion request or an open care event are skipped by poll and worker', async () => {
  const blocked = async (id) => id === 'u-blocked'
  const supabase = db({ connector_accounts: [account({ user_id: 'u-blocked' }), account({ user_id: 'u-ok', id: 'a2' })], connector_jobs: [queued('j1', 'm1|1', { user_id: 'u-blocked' })] })
  const clock = createFakeClock(NOW)
  const connectors = fakeConnectors({ GMAIL_FETCH_EMAILS: () => ({ messages: msgs(1) }), GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID: () => ({}) })
  const ing = createIngestion({ supabase, connectors, clock, blocked, log: () => {} })
  await ing.poll()
  assert.deepEqual(supabase.rows('connector_jobs').map((j) => j.user_id).sort(), ['u-blocked', 'u-ok']) // the seeded one, plus u-ok's new one
  await supabase.from('connector_jobs').update({ status: 'queued', attempts: 0 }).is('status', null).select('id') // the fake has no column defaults
  await ing.worker.run()
  const mine = supabase.rows('connector_jobs').find((j) => j.id === 'j1')
  assert.equal(mine.status, 'queued')
  assert.equal(mine.attempts, 0)
  assert.equal(connectors.calls.filter((c) => c.slug === 'GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID').length, 1) // u-ok's only
})

test('a database error while saving a failure does not stop the other founders', async () => {
  const s = setup({ tables: { connector_accounts: [account({ id: 'a1', user_id: 'u1' }), account({ id: 'a2', user_id: 'u2' })] }, script: { GMAIL_FETCH_EMAILS: ({ query }) => ({ messages: msgs(1) }) } })
  const real = s.supabase.from
  // The first founder's enqueue fails, and then saving that failure fails too.
  s.supabase.from = (t) => {
    if (t === 'connector_jobs' && !s.supabase.rows('connector_jobs').length && !s.failed) { s.failed = true; return { insert: () => Promise.resolve({ error: { code: '57014' } }) } }
    if (t === 'connector_accounts' && s.failed && !s.saveFailed) { s.saveFailed = true; return { update: () => ({ eq: () => ({ select: () => Promise.resolve({ data: null, error: { code: 'XX000' } }) }) }) } }
    return real(t)
  }
  await s.ing.poll()
  assert.equal(jobs(s).length, 1) // the second founder was still polled
})

test('the worker does not call handleItem when the tool was disconnected meanwhile', async () => {
  const s = setup({ tables: { connector_accounts: [account()], connector_jobs: [queued('j1', 'm1|1')] }, script: { GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID: () => {
    s.supabase.rows('connector_accounts') // read while "disconnecting"
    return { labelIds: [], sender: 'Dana <dana@brightloop.example>', subject: 'Hi', messageText: 'hello' } } } })
  const real = s.connectors.run
  s.connectors.run = async (...a) => { const out = await real(...a); await s.supabase.from('connector_accounts').update({ status: 'needs_reconnect' }).eq('user_id', U).select('id'); return out }
  await s.ing.worker.run()
  assert.equal(s.handled.length, 0)
  assert.equal(jobs(s)[0].status, 'dropped')
})

test('the daily clearing deletes done and dropped jobs after 7 days, not queued ones', async () => {
  const { clearActionContent, JOB_KEEP_MS } = await import('./connectorService.js')
  const old = new Date(NOW - JOB_KEEP_MS - 1000).toISOString()
  const fresh = new Date(NOW - 1000).toISOString()
  const supabase = db({ connector_jobs: [queued('a', 'a', { status: 'done', updated_at: old }), queued('b', 'b', { status: 'dropped', updated_at: old }), queued('c', 'c', { status: 'done', updated_at: fresh }), queued('d', 'd', { updated_at: old }), queued('e', 'e', { status: 'failed', updated_at: old })] })
  await clearActionContent({ supabase, clock: createFakeClock(NOW) })
  assert.deepEqual(supabase.rows('connector_jobs').map((j) => j.id).sort(), ['c', 'd', 'e'])
})
