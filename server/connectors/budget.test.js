// Connector spend has its own daily budget; a spent budget requeues or drops a job; backfill is newest first;
// a changed calendar event or page is a new signal; calendar jobs are kept past the poll window.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createApp } from '../app.js'
import { createFakeClock, createFakeOpenAI, createFakeSupabase } from '../testing/fakes.js'
import { createBudget } from './budget.js'
import { clearActionContent } from './connectorService.js'
import { createIngestion } from './ingest.js'
import { createSignalHandler } from './signal.js'
import { createWorker } from './worker.js'
import { createBreaker } from './read.js'

const U = '11111111-1111-4111-8111-111111111111'
const NOW = Date.parse('2026-11-27T12:00:00.000Z')
const HOUR = 3600000
const DAY = 24 * HOUR
const iso = (ms) => new Date(ms).toISOString()
const usage = (cost, call_type = 'signal', at = NOW - HOUR) => ({ id: `u${Math.random()}`, user_id: U, call_type, estimated_cost_usd: cost, created_at: iso(at) })

test('the connector budget counts only signal rows since the founder\'s local midnight', async () => {
  const supabase = createFakeSupabase({ tables: { founder_profiles: [{ user_id: U, timezone: 'Asia/Karachi' }], model_usage_logs: [usage(0.2), usage(5, 'chat'), usage(0.2, 'signal', NOW - 30 * HOUR)] } })
  const over = createBudget({ supabase, clock: createFakeClock(NOW), limitUsd: 0.3 })
  assert.equal(await over(U), null)
  await supabase.from('model_usage_logs').insert(usage(0.15))
  // Karachi is UTC+5: local midnight after 2026-11-27 17:00 is 2026-11-27 19:00 UTC.
  assert.deepEqual(await over(U), { retryAt: Date.parse('2026-11-27T19:00:00.000Z') })
})

test('signal spend is not counted in the founder\'s own daily cap', async () => {
  const supabase = createFakeSupabase({ tables: { model_usage_logs: [usage(2), usage(0.5, 'chat')] } })
  const app = createApp({ env: { FRONTEND_URL: 'https://app.example.com' }, supabase, openai: createFakeOpenAI([]), clock: createFakeClock(NOW) })
  assert.equal(await app.locals.isOverCap(U), false)
  await supabase.from('model_usage_logs').insert(usage(0.6, 'chat'))
  assert.equal(await app.locals.isOverCap(U), true)
})

const mail = { id: 'm1', from: 'Dana Okafor <dana@x.example>', subject: 'Call', body: 'Can you take the Thursday call?' }
const handlerWith = (overBudget, tables = {}) => {
  const supabase = createFakeSupabase({ tables: { connector_accounts: [{ user_id: U, toolkit: 'gmail', status: 'active' }, { user_id: U, toolkit: 'googlecalendar', status: 'active' }], ...tables }, unique: { signals: [{ cols: ['user_id', 'external_ref_hash'] }] } })
  const calls = []
  const handle = createSignalHandler({ supabase, clock: createFakeClock(NOW), log: () => {}, loadBrief: async () => '', overBudget, callStructured: async () => { calls.push(1); throw new Error('no model') } })
  return { handle, calls, supabase }
}
const thrown = async (p) => p.then(() => null, (e) => e)

test('over the connector budget: requeue for the next day, or drop when the item would be stale; no model call', async () => {
  const retryAt = NOW + 8 * HOUR
  const s = handlerWith(async () => ({ retryAt }))
  const queued = await thrown(s.handle(U, 'gmail', mail, { createdAt: NOW - HOUR }))
  assert.deepEqual([queued.code, queued.retryAt], ['over_budget', retryAt])
  const old = await thrown(s.handle(U, 'gmail', mail, { createdAt: NOW - 3 * DAY }))
  assert.equal(old.retryAt, null)
  const meeting = { id: 'e1', summary: 'Call', start: { dateTime: iso(NOW + 4 * HOUR) }, end: { dateTime: iso(NOW + 5 * HOUR) }, attendees: [{ email: 'a@x.example', displayName: 'Sam Ortega' }] }
  assert.equal((await thrown(s.handle(U, 'googlecalendar', meeting))).retryAt, null, 'the meeting will have started')
  assert.equal(s.calls.length, 0)
})

test('the worker requeues an over-budget job without spending an attempt, and drops a stale one', async () => {
  const run = async (retryAt) => {
    const supabase = createFakeSupabase({ tables: { connector_accounts: [{ id: 'a', user_id: U, toolkit: 'gmail', status: 'active' }], connector_jobs: [{ id: 'j1', user_id: U, toolkit: 'gmail', external_id: 'm1|1', kind: 'poll', status: 'queued', attempts: 0, run_after: iso(NOW), created_at: iso(NOW - HOUR) }] } })
    const clock = createFakeClock(NOW)
    const read = async () => ({ messageText: 'hello there, can you call me on Thursday about the pilot', sender: 'Dana <dana@x.example>', subject: 'Pilot', labelIds: ['INBOX'], threadId: 't' })
    const w = createWorker({ supabase, read, breaker: createBreaker({ clock }), clock, log: () => {}, handleItem: async () => { throw Object.assign(new Error('over_budget'), { code: 'over_budget', retryAt }) } })
    await w.run()
    return supabase.rows('connector_jobs')[0]
  }
  const queued = await run(NOW + 8 * HOUR)
  assert.deepEqual([queued.status, queued.attempts, queued.run_after, queued.last_error_code], ['queued', 0, iso(NOW + 8 * HOUR), 'over_budget'])
  const dropped = await run(null)
  assert.deepEqual([dropped.status, dropped.last_error_code], ['dropped', 'over_budget'])
})

test('a backfill is queued newest first', async () => {
  const supabase = createFakeSupabase({ tables: { connector_accounts: [{ id: 'a', user_id: U, toolkit: 'googlecalendar', status: 'active', last_sync_at: null }] }, unique: { connector_jobs: [{ cols: ['user_id', 'toolkit', 'external_id'] }] } })
  const items = [{ id: 'old', updated: iso(NOW - 20 * DAY) }, { id: 'new', updated: iso(NOW - DAY) }, { id: 'mid', updated: iso(NOW - 10 * DAY) }]
  const connectors = { run: async () => ({ data: { items } }) }
  const ing = createIngestion({ supabase, connectors, clock: createFakeClock(NOW), log: () => {} })
  await ing.backfill(U, 'googlecalendar')
  const order = supabase.rows('connector_jobs').sort((a, b) => a.run_after.localeCompare(b.run_after)).map((j) => j.external_id.split('|')[0])
  assert.deepEqual(order, ['new', 'mid', 'old'])
})

test('a moved meeting or edited page is a new signal and the old one for the same item expires', async () => {
  const reply = { worth_telling: true, lane: 'time', source_name: 'Google Calendar', urgency: 1, related_situation_id: null, expires_in_hours: 24, what_happened: 'Google Calendar shows a Call with Sam Ortega.', impact: 'Sam is new to you.' }
  const supabase = createFakeSupabase({ tables: { connector_accounts: [{ user_id: U, toolkit: 'googlecalendar', status: 'active' }], situations: [], founder_world: [] }, unique: { signals: [{ cols: ['user_id', 'external_ref_hash'] }] } })
  const handle = createSignalHandler({ supabase, clock: createFakeClock(NOW), log: () => {}, loadBrief: async () => '', callStructured: async () => ({ data: reply }) })
  const event = (updated, start) => ({ id: 'e1', summary: 'Call', updated, start: { dateTime: start }, end: { dateTime: iso(Date.parse(start) + HOUR) }, attendees: [{ email: 'me@x', self: true }, { email: 'sam@h.example', displayName: 'Sam Ortega' }] })
  await handle(U, 'googlecalendar', event('2026-11-27T09:00:00Z', iso(NOW + 5 * HOUR)))
  await handle(U, 'googlecalendar', event('2026-11-27T09:00:00Z', iso(NOW + 5 * HOUR)))
  assert.equal(supabase.rows('signals').length, 1, 'unchanged: one signal')
  await handle(U, 'googlecalendar', event('2026-11-27T11:00:00Z', iso(NOW + 6 * HOUR)))
  const rows = supabase.rows('signals')
  assert.deepEqual(rows.map((r) => r.status), ['expired', 'new'])
})

test('finished calendar jobs are kept 21 days, other jobs 7', async () => {
  const job = (id, toolkit, age) => ({ id, user_id: U, toolkit, external_id: id, status: 'done', updated_at: iso(NOW - age * DAY) })
  const supabase = createFakeSupabase({ tables: { connector_jobs: [job('mail', 'gmail', 10), job('cal10', 'googlecalendar', 10), job('cal25', 'googlecalendar', 25)], connector_actions: [], signals: [] } })
  await clearActionContent({ supabase, clock: createFakeClock(NOW) })
  assert.deepEqual(supabase.rows('connector_jobs').map((j) => j.id), ['cal10'])
})
