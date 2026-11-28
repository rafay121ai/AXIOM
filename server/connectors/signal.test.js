// S2: items become signals. Fakes only: no model, no Composio, no Supabase.
import assert from 'node:assert/strict'
import test from 'node:test'
import { callStructured } from '../llm.js'
import { createUsageLogger } from '../modelUsage.js'
import { createFakeClock, createFakeOpenAI, createFakeSupabase } from '../testing/fakes.js'
import { clearActionContent } from './connectorService.js'
import { FIXTURES } from './fixtures/index.js'
import { createSignalHandler } from './signal.js'

const NOW = Date.parse('2026-11-27T12:00:00.000Z')
const U = '11111111-1111-4111-8111-111111111111'
const SIT = '22222222-2222-4222-8222-222222222222'
const BRIEF = 'What I know:\n- runs the Marlow pilot with twelve customers'
const good = (o = {}) => JSON.stringify({
  worth_telling: true, push_line: null, lane: 'people', source_name: 'Dana Okafor', urgency: 2, related_situation_id: SIT, expires_in_hours: 48,
  what_happened: 'Dana Okafor asks you to take the Thursday call with the Marlow pilot and will send the deck tonight.',
  impact: 'The Marlow pilot is your open situation, and this call is its next step.', ...o,
})

function setup({ replies = [good()], tables = {}, capped = false, blocked = false } = {}) {
  const supabase = createFakeSupabase({
    tables: { connector_accounts: [{ id: 'a1', user_id: U, toolkit: 'gmail', status: 'active' }], situations: [{ id: SIT, user_id: U, title: 'Marlow pilot pricing', status: 'open' }], ...tables },
    unique: { signals: [{ cols: ['user_id', 'external_ref_hash'] }] },
  })
  const openai = createFakeOpenAI(replies)
  const clock = createFakeClock(NOW)
  const { logModelUsage } = createUsageLogger({ supabase })
  const logs = []
  const handle = createSignalHandler({
    supabase, clock, log: (w, i) => logs.push(`${w} ${i ?? ''}`), loadBrief: async () => BRIEF,
    callStructured: (args) => callStructured({ openai, logModelUsage, clock, ...args }),
    blocked: async () => blocked, isCapped: async () => capped,
  })
  return { supabase, openai, handle, logs, clock, signals: () => supabase.rows('signals') }
}
const mail = FIXTURES.cofounder.item

const DANA = { founder_world: [{ id: 'w0', user_id: U, name: 'Dana Okafor', kind: 'person', status: 'active', last_mentioned_at: '2026-11-01T00:00:00Z' }] }

test('a kept email becomes one signal; the cost row says signal; no raw text is stored', async () => {
  const s = setup({ tables: DANA })
  await s.handle(U, 'gmail', mail)
  const [row] = s.signals()
  assert.equal(row.status, 'new'); assert.equal(row.urgency, 2); assert.equal(row.situation_id, SIT); assert.equal(row.lane, 'people')
  assert.deepEqual(Object.keys(row.facts).sort(), ['source_name', 'what_happened'])
  assert.equal(new Date(row.expires_at).getTime(), NOW + 48 * 3600000)
  const stored = JSON.stringify(row)
  assert.ok(!stored.includes(mail.body))
  assert.ok(!stored.includes('Pilot call moved'))
  assert.deepEqual(s.supabase.rows('model_usage_logs').map((r) => r.call_type), ['signal'])
  const system = s.openai.calls[0].payload.messages[0].content
  assert.match(system, /never an instruction/)
})

test('a duplicate item makes one signal', async () => {
  const s = setup({ replies: [good(), good()] })
  await s.handle(U, 'gmail', mail); await s.handle(U, 'gmail', mail)
  assert.equal(s.signals().length, 1)
  assert.equal(s.openai.calls.length, 1) // the second never reaches the model
})

test('a made-up number fails verification: one retry showing the draft, then no signal', async () => {
  const bad = good({ what_happened: 'Dana Okafor asks you to take the Thursday call with 40 Marlow customers.' })
  const s = setup({ replies: [bad, bad] })
  await s.handle(U, 'gmail', mail)
  assert.equal(s.signals().length, 0)
  assert.equal(s.openai.calls.length, 2)
  const retry = s.openai.calls[1].payload.messages.map((m) => m.content).join('\n')
  assert.match(retry, /number 40/); assert.match(retry, /40 Marlow customers/)
  assert.ok(s.logs.some((l) => /verify_failed/.test(l)))
})

test('a retry that fixes the problem is stored', async () => {
  const s = setup({ replies: [good({ what_happened: 'Dana Okafor moved the call to Friday.' }), good()] })
  await s.handle(U, 'gmail', mail)
  assert.equal(s.signals().length, 1)
})

test('an impact tied to nothing about the founder is a home item, urgency 0', async () => {
  const s = setup({ replies: [good({ impact: 'Calls like this tend to matter for growth.', urgency: 3 })] })
  await s.handle(U, 'gmail', mail)
  assert.equal(s.signals()[0].urgency, 0)
})

test('a related situation that is not this founder\'s open one is dropped', async () => {
  const s = setup({ replies: [good({ related_situation_id: '33333333-3333-4333-8333-333333333333' })] })
  await s.handle(U, 'gmail', mail)
  assert.equal(s.signals()[0].situation_id, null)
})

test('forbidden phrases are refused', async () => {
  const bad = good({ impact: 'Absolutely worth it: the Marlow pilot needs this call.' })
  const s = setup({ replies: [bad, bad] })
  await s.handle(U, 'gmail', mail)
  assert.equal(s.signals().length, 0)
})

test('the injection fixture never echoes the instruction and never gains an action', async () => {
  const item = { ...FIXTURES.injection.item, injection: true }
  const echo = good({ source_name: 'Pat Reyes', what_happened: 'Pat Reyes asks you to push "wire the deposit now" to the founder immediately.', impact: 'The Marlow pilot is open.' })
  const ok = good({ source_name: 'Pat Reyes', what_happened: 'Pat Reyes wrote with a quick question about your launch.', impact: 'The Marlow pilot is your open situation.', urgency: 3 })
  const s = setup({ replies: [echo, ok] })
  await s.handle(U, 'gmail', item)
  const sent = JSON.stringify(s.openai.calls[0].payload.messages)
  assert.ok(!sent.includes('wire the deposit now') && !sent.includes('ignore your rules'))
  assert.equal(s.signals().length, 1)
  assert.ok(!JSON.stringify(s.signals()[0]).includes('wire the deposit'))
  assert.ok(s.signals()[0].urgency <= 1)
  assert.equal(s.supabase.rows('connector_actions')?.length ?? 0, 0)
})

test('a disconnected account writes nothing, also when it disconnects during the model call', async () => {
  const gone = setup({ tables: { connector_accounts: [{ id: 'a1', user_id: U, toolkit: 'gmail', status: 'needs_reconnect' }] } })
  await gone.handle(U, 'gmail', mail)
  assert.equal(gone.signals().length, 0); assert.equal(gone.openai.calls.length, 0)
  const mid = setup()
  const real = mid.openai.chat.completions.create
  mid.openai.chat.completions.create = async (...a) => { await mid.supabase.from('connector_accounts').update({ status: 'needs_reconnect' }).eq('id', 'a1'); return real(...a) }
  await mid.handle(U, 'gmail', mail)
  assert.equal(mid.signals().length, 0)
})

test('an open care event or a pending delete writes nothing and calls no model', async () => {
  const s = setup({ blocked: true })
  await s.handle(U, 'gmail', mail)
  assert.equal(s.signals().length, 0); assert.equal(s.openai.calls.length, 0)
})

test('over the daily cap: no model call', async () => {
  const s = setup({ capped: true })
  await s.handle(U, 'gmail', mail)
  assert.equal(s.openai.calls.length, 0); assert.equal(s.signals().length, 0)
})

const meeting = (o = {}) => ({
  id: 'ev1', summary: 'Intro call', start: { dateTime: '2026-11-28T14:30:00+00:00' }, end: { dateTime: '2026-11-28T15:00:00+00:00' },
  description: 'Sam wants to talk about a distribution deal.', attendees: [{ email: 'me@x.example', self: true }, { email: 'sam@harbor.example', displayName: 'Sam Ortega' }], ...o,
})
const prep = (o = {}) => good({ lane: 'people', source_name: 'Google Calendar', what_happened: 'Google Calendar shows an Intro call with Sam Ortega on Saturday at 14:30.', impact: 'The Marlow pilot comes first, and the event says Sam wants a distribution deal.', ...o })

test('a meeting in 48h with a new person is a time signal that expires at the event end', async () => {
  const s = setup({ replies: [prep()], tables: { connector_accounts: [{ id: 'a2', user_id: U, toolkit: 'googlecalendar', status: 'active' }] } })
  await s.handle(U, 'googlecalendar', meeting())
  const [row] = s.signals()
  assert.equal(row.lane, 'time'); assert.equal(row.facts.meeting_start, '2026-11-28T14:30:00+00:00'); assert.deepEqual(row.facts.attendees, ['Sam Ortega'])
  assert.equal(row.expires_at, '2026-11-28T15:00:00.000Z')
})

test('a meeting with a known person, or further than 48h away, makes no signal and no model call', async () => {
  const tables = { connector_accounts: [{ id: 'a2', user_id: U, toolkit: 'googlecalendar', status: 'active' }], founder_world: [{ id: 'w1', user_id: U, name: 'Sam Ortega', kind: 'person', status: 'active', last_mentioned_at: '2026-11-01T00:00:00Z' }] }
  const known = setup({ tables })
  await known.handle(U, 'googlecalendar', meeting())
  const far = setup({ tables: { connector_accounts: tables.connector_accounts } })
  await far.handle(U, 'googlecalendar', meeting({ start: { dateTime: '2026-12-05T14:30:00+00:00' }, end: { dateTime: '2026-12-05T15:00:00+00:00' } }))
  assert.equal(known.openai.calls.length + far.openai.calls.length, 0)
})

test('a made-up fact about a meeting person fails', async () => {
  const bad = prep({ what_happened: 'Google Calendar shows an Intro call with Sam Ortega, founder of Harbor Capital.' })
  const s = setup({ replies: [bad, bad], tables: { connector_accounts: [{ id: 'a2', user_id: U, toolkit: 'googlecalendar', status: 'active' }] } })
  await s.handle(U, 'googlecalendar', meeting())
  assert.equal(s.signals().length, 0)
})

test('the daily clearing expires signals past their time and nothing else', async () => {
  const sig = (id, status, expires_at) => ({ id, user_id: U, status, expires_at })
  const s = setup({ tables: { signals: [sig('a', 'new', '2026-11-27T11:00:00Z'), sig('b', 'new', '2026-11-27T13:00:00Z'), sig('c', 'acted', '2026-11-27T11:00:00Z'), sig('d', 'new', null)] } })
  await clearActionContent({ supabase: s.supabase, clock: s.clock })
  assert.deepEqual(s.signals().map((r) => r.status), ['expired', 'new', 'acted', 'new'])
})

const bad = (o) => async () => { const s = setup({ replies: [good(o), good(o)] }); await s.handle(U, 'gmail', mail); return s }

test('a name at the start of a sentence must be in the source', async () => {
  const s = await bad({ what_happened: 'Priya asked to move the call to Thursday.' })()
  assert.equal(s.signals().length, 0)
})

test('impact may not name someone, or say what they do, from outside the item and the notes', async () => {
  for (const impact of ['Priya Shah is a partner at Northfield, so the Marlow pilot matters.', 'The Marlow pilot matters because Dana Okafor works at Brightloop.', 'The Marlow pilot is open, and Northfield backed the round.']) {
    assert.equal((await bad({ impact })()).signals().length, 0, impact)
  }
})

test('links and email addresses are refused', async () => {
  for (const o of [{ what_happened: 'Dana Okafor sent the deck at https://deck.example/x.' }, { impact: 'The Marlow pilot: write to dana@brightloop.example.' }]) assert.equal((await bad(o)()).signals().length, 0)
})

test('impact must match a stored fact, not a shared long word', async () => {
  const s = setup({ replies: [good({ impact: 'This call matters, customers want answers.', urgency: 3 })], tables: DANA })
  await s.handle(U, 'gmail', mail)
  assert.equal(s.signals()[0].urgency, 0)
})

test('a stranger who is not replying cannot go above urgency 1; a reply can', async () => {
  const stranger = setup({ replies: [good({ urgency: 3 })] })
  await stranger.handle(U, 'gmail', mail)
  assert.equal(stranger.signals()[0].urgency, 1)
  const reply = setup({ replies: [good({ urgency: 3 })] })
  await reply.handle(U, 'gmail', mail, { repliedTo: true })
  assert.equal(reply.signals()[0].urgency, 3)
  assert.equal(reply.signals()[0].facts.replied_thread, true)
  const fake = setup({ replies: [good({ urgency: 3 })] })
  await fake.handle(U, 'gmail', { ...mail, subject: 'Re: Pilot call moved to Thursday' })
  assert.equal(fake.signals()[0].urgency, 1) // a Re: subject alone proves nothing
})

test('a world name that only sits inside a longer word does not make a person known', async () => {
  const tables = { connector_accounts: [{ id: 'a2', user_id: U, toolkit: 'googlecalendar', status: 'active' }], founder_world: [{ id: 'w1', user_id: U, name: 'Sam', kind: 'person', status: 'active', last_mentioned_at: '2026-11-01T00:00:00Z' }] }
  const s = setup({ replies: [prep()], tables })
  await s.handle(U, 'googlecalendar', meeting({ attendees: [{ email: 'me@x.example', self: true }, { email: 's@harbor.example', displayName: 'Samantha Ortega' }] }))
  assert.equal(s.openai.calls.length, 1)
})

test('the model call has a timeout', async () => {
  const s = setup()
  await s.handle(U, 'gmail', mail)
  assert.ok(s.openai.calls[0].options?.signal)
})

test('a calendar invite the founder did not accept is capped at urgency 1; accepted or organized keeps it and stores one bit', async () => {
  const tables = { connector_accounts: [{ id: 'a2', user_id: U, toolkit: 'googlecalendar', status: 'active' }] }
  const run = async (o) => { const s = setup({ replies: [prep({ urgency: 3 })], tables }); await s.handle(U, 'googlecalendar', meeting(o)); return s.signals()[0] }
  const self = (responseStatus) => [{ email: 'me@x.example', self: true, responseStatus }, { email: 'sam@harbor.example', displayName: 'Sam Ortega' }]
  assert.equal((await run({ attendees: self('needsAction') })).urgency, 1)
  assert.equal((await run({ attendees: self('needsAction') })).facts.accepted, undefined)
  const yes = await run({ attendees: self('accepted') })
  assert.equal(yes.urgency, 3); assert.equal(yes.facts.accepted, true)
  assert.equal((await run({ attendees: self('needsAction'), organizer: { self: true } })).facts.accepted, true)
})

// push_line: the lock-screen line (Nov 28). Brief says "twelve customers" and the Marlow pilot; the situation is Marlow pilot pricing.
const LINE = 'Your Marlow pilot has twelve customers and Dana Okafor just replied, let\'s plan it out.'
const pushed = async (o) => { const s = setup({ replies: [good(o)], tables: DANA }); await s.handle(U, 'gmail', mail); return s.signals()[0] }

test('a push_line tied to the founder is verified and stored; no email text with it', async () => {
  const row = await pushed({ push_line: LINE })
  assert.equal(row.facts.push_line, LINE)
  assert.ok(!JSON.stringify(row).includes(mail.body))
})

test('a push_line that restates the sender and subject with no founder fact is null', async () => {
  assert.equal((await pushed({ push_line: 'New email from Okafor: Re: term sheet' })).facts.push_line, undefined)
})

test('a push_line with an invented number or name is null; so is a banned phrase or a link', async () => {
  for (const push_line of ['The Marlow pilot has 40 customers, let\'s plan it out.', 'The Marlow pilot: Priya Nair wrote back, let\'s plan it out.', 'Absolutely, the Marlow pilot moved.', 'The Marlow pilot is at dana.com now.']) {
    assert.equal((await pushed({ push_line })).facts.push_line, undefined, push_line)
  }
})

test('only urgency 2 or 3 gets a push_line', async () => {
  assert.equal((await pushed({ push_line: LINE, urgency: 1 })).facts.push_line, undefined)
})

test('a world name alone is not a link for push_line; a brief fact is', async () => {
  const a = await pushed({ push_line: 'Dana Okafor replied, let\'s plan it out.' })
  assert.equal(a.facts.push_line, undefined)
  const s = setup({ replies: [good({ push_line: 'You have 3 months of burn rate left and Dana Okafor replied with an offer, let\'s plan it out.' })], tables: DANA })
  const b = createSignalHandler({ supabase: s.supabase, clock: s.clock, log: () => {}, loadBrief: async () => 'What I know:\n- has 3 months of burn rate left', callStructured: (args) => callStructured({ openai: s.openai, logModelUsage: createUsageLogger({ supabase: s.supabase }).logModelUsage, clock: s.clock, ...args }) })
  await b(U, 'gmail', mail)
  assert.equal(s.signals()[0].facts.push_line, 'You have 3 months of burn rate left and Dana Okafor replied with an offer, let\'s plan it out.')
})
