// The newsletter picker and the World lane. Fakes only: no Composio, no model, no Supabase.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createApp } from '../app.js'
import { callStructured } from '../llm.js'
import { createUsageLogger } from '../modelUsage.js'
import { createFakeClock, createFakeOpenAI, createFakeSupabase } from '../testing/fakes.js'
import { filterItem } from './filter.js'
import { FIXTURES } from './fixtures/index.js'
import { createIngestion } from './ingest.js'
import { CACHE_MS, COPY, groupSenders, MAX_WATCHING, TOP } from './newsletters.js'
import { createSignalHandler, NEWSLETTER_TEXT, sameStory, sourceOf } from './signal.js'

const A = { id: '11111111-1111-4111-8111-111111111111', email: 'a@example.com' }
const NOW = Date.parse('2026-11-28T12:00:00.000Z')
const HOUR = 3600000
const ENV = { FRONTEND_URL: 'https://app.example.com', CONNECTORS: 'on' }
const mail = (i, sender, labelIds = ['INBOX', 'CATEGORY_PROMOTIONS'], subject = 'SUBJECT-SECRET-9921') => ({ messageId: `m${i}`, sender, subject, labelIds, messageTimestamp: String(NOW - i * HOUR) })
const many = (n, sender, labelIds) => Array.from({ length: n }, (_, i) => mail(`${sender}${i}`, sender, labelIds))

function setup({ messages = [], tables = {}, gmail = true } = {}) {
  const calls = []
  const composio = {
    create: async (userId) => ({
      toolkits: async () => ({ items: gmail ? [{ slug: 'gmail', connection: { isActive: true, connectedAccount: { id: 'ca1' } } }] : [] }),
      execute: async (slug, args) => { calls.push({ slug, args }); return { successful: true, data: { data: { messages: typeof messages === 'function' ? messages(args) : messages } } } },
    }),
    connectedAccounts: {},
  }
  const base = createFakeSupabase({ users: { tokA: A }, tables })
  const clock = createFakeClock(NOW)
  return import('./composio.js').then(({ createConnectors }) => {
    const app = createApp({ env: ENV, supabase: base, openai: createFakeOpenAI([]), clock, connectors: createConnectors({ composio }) })
    const server = app.listen(0)
    return new Promise((r) => server.once('listening', r)).then(() => ({
      base, clock, calls, close: () => new Promise((r) => server.close(r)),
      call: async (method, body) => {
        const res = await fetch(`http://127.0.0.1:${server.address().port}/api/connectors/gmail/newsletters`, { method, headers: { authorization: 'Bearer tokA', ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
        return { status: res.status, body: await res.json() }
      },
    }))
  })
}

test('GET groups senders by address; per_week and opens are computed; no content is stored', async () => {
  // 12 in 30 days = about 3 a week; 9 of 12 read. A second sender: 2 mails, none read. A third: 3 mails, 1 read (some).
  const messages = [
    ...Array.from({ length: 12 }, (_, i) => mail(`a${i}`, i % 2 ? '"Lenny" <Hello@Lenny.example>' : 'Lenny <hello@lenny.example>', i < 9 ? ['INBOX'] : ['INBOX', 'UNREAD'])),
    ...many(2, 'No Name <promo@deals.example>', ['UNREAD']),
    ...Array.from({ length: 3 }, (_, i) => mail(`c${i}`, 'bare@bare.example', i ? ['UNREAD'] : ['INBOX'])),
  ]
  const t = await setup({ messages })
  try {
    const res = await t.call('GET')
    assert.equal(res.status, 200)
    assert.deepEqual(Object.keys(res.body), ['newsletters'])
    const by = Object.fromEntries(res.body.newsletters.map((n) => [n.id, n]))
    assert.deepEqual(by['hello@lenny.example'], { id: 'hello@lenny.example', name: 'Lenny', per_week: 3, opens: 'most', watching: false })
    assert.deepEqual([by['promo@deals.example'].per_week, by['promo@deals.example'].opens, by['promo@deals.example'].name], [1, 'rarely', 'No Name'])
    assert.deepEqual([by['bare@bare.example'].name, by['bare@bare.example'].opens], ['bare.example', 'some'])
    assert.deepEqual(res.body.newsletters.map((n) => n.id)[0], 'hello@lenny.example') // ranked by frequency and opens
    const [call] = t.calls
    assert.equal(call.slug, 'GMAIL_FETCH_EMAILS')
    assert.equal(call.args.include_payload, false)
    assert.equal(call.args.max_results, 100)
    assert.match(call.args.query, /newer_than:30d/)
    const stored = t.base.rows('watch_sources')
    assert.equal(stored.length, 3)
    assert.ok(stored.every((r) => r.kind === 'newsletter' && r.status === 'suggested' && r.user_id === A.id && typeof r.rank_score === 'number'))
    assert.ok(!JSON.stringify(stored).includes('SUBJECT-SECRET-9921'))
  } finally { await t.close() }
})

test('GET: at most 8 ranked, plus watched ones outside the top 8; a bank sender is never offered; 3 pages at most', async () => {
  const senders = Array.from({ length: 10 }, (_, i) => `s${i}@news.example`)
  const messages = [...senders.flatMap((s, i) => many(10 - i, s)), ...many(5, 'Chase <alerts@chase.com>')]
  const tables = { watch_sources: [{ id: 'w1', user_id: A.id, kind: 'newsletter', identifier: 's9@news.example', display_name: 'Nine', status: 'watching' }] }
  const t = await setup({ messages, tables })
  try {
    const { body } = await t.call('GET')
    assert.equal(body.newsletters.length, TOP + 1)
    assert.deepEqual(body.newsletters.slice(0, TOP).map((n) => n.id), senders.slice(0, TOP))
    assert.deepEqual(body.newsletters.at(-1), { id: 's9@news.example', name: 'news.example', per_week: 1, opens: 'most', watching: true })
    assert.ok(!body.newsletters.some((n) => /chase/.test(n.id)))
    assert.equal(body.newsletters.at(-1).watching, true)
    assert.ok(t.calls.length <= 3)
  } finally { await t.close() }
})

test('GET is cached for 6 hours (no Composio call), then scans again', async () => {
  const t = await setup({ messages: many(3, 'A <a@x.example>') })
  try {
    await t.call('GET')
    t.clock.advance(CACHE_MS - 1000)
    assert.equal((await t.call('GET')).status, 200)
    assert.equal(t.calls.length, 1)
    t.clock.advance(2000)
    await t.call('GET')
    assert.equal(t.calls.length, 2)
  } finally { await t.close() }
})

test('PUT: ticked ids watch, unticked watching ids mute, others untouched; GET never overwrites a choice', async () => {
  const t = await setup({ messages: [...many(4, 'A <a@x.example>'), ...many(3, 'B <b@x.example>'), ...many(2, 'C <c@x.example>')] })
  try {
    await t.call('GET')
    const status = () => Object.fromEntries(t.base.rows('watch_sources').map((r) => [r.identifier, r.status]))
    let res = await t.call('PUT', { watching: ['a@x.example', 'B@X.example'] })
    assert.deepEqual(status(), { 'a@x.example': 'watching', 'b@x.example': 'watching', 'c@x.example': 'suggested' })
    assert.deepEqual(res.body.newsletters.map((n) => [n.id, n.watching]), [['a@x.example', true], ['b@x.example', true], ['c@x.example', false]])
    assert.ok(t.base.rows('watch_sources').filter((r) => r.status === 'watching').every((r) => r.decided_at === new Date(NOW).toISOString()))
    res = await t.call('PUT', { watching: ['b@x.example'] })
    assert.deepEqual(status(), { 'a@x.example': 'muted', 'b@x.example': 'watching', 'c@x.example': 'suggested' })
    t.clock.advance(CACHE_MS + 1000)
    await t.call('GET') // a refresh keeps the founder's choices
    assert.deepEqual(status(), { 'a@x.example': 'muted', 'b@x.example': 'watching', 'c@x.example': 'suggested' })
    assert.equal((await t.call('PUT', { watching: [] })).status, 200)
    assert.deepEqual(status(), { 'a@x.example': 'muted', 'b@x.example': 'muted', 'c@x.example': 'suggested' })
  } finally { await t.close() }
})

test('PUT validation: a list of known ids, at most 20', async () => {
  const t = await setup({ messages: many(3, 'A <a@x.example>') })
  try {
    await t.call('GET')
    for (const watching of [undefined, 'a@x.example', [1], Array.from({ length: MAX_WATCHING + 1 }, (_, i) => `a${i}@x.example`)]) assert.equal((await t.call('PUT', { watching })).status, 400)
    const unknown = await t.call('PUT', { watching: ['nobody@x.example'] })
    assert.deepEqual([unknown.status, unknown.body.error], [400, 'unknown_newsletter'])
    assert.ok(t.base.rows('watch_sources').every((r) => r.status === 'suggested'))
  } finally { await t.close() }
})

test('another founder\'s row is not an id for this founder', async () => {
  const t = await setup({ messages: [], tables: { watch_sources: [{ id: 'w', user_id: 'someone-else', kind: 'newsletter', identifier: 'z@z.example', status: 'suggested' }] } })
  try {
    assert.equal((await t.call('PUT', { watching: ['z@z.example'] })).body.error, 'unknown_newsletter')
    assert.equal(t.base.rows('watch_sources')[0].status, 'suggested')
  } finally { await t.close() }
})

test('Gmail not connected: 409 not_connected; care open or a pending delete: 409, nothing changes', async () => {
  const off = await setup({ gmail: false })
  try {
    for (const res of [await off.call('GET'), await off.call('PUT', { watching: [] })]) assert.deepEqual([res.status, res.body], [409, { error: 'not_connected', line: COPY.notConnected }])
    assert.equal(off.calls.length, 0)
  } finally { await off.close() }
  const care = await setup({ messages: many(3, 'A <a@x.example>'), tables: { care_events: [{ id: 'c', user_id: A.id, level: 'clear', resolved_at: null }], watch_sources: [{ id: 'w', user_id: A.id, kind: 'newsletter', identifier: 'a@x.example', status: 'watching' }] } })
  try {
    assert.deepEqual([(await care.call('GET')).status, (await care.call('GET')).body.error], [409, 'care_open'])
    assert.equal((await care.call('PUT', { watching: [] })).status, 409)
    assert.equal(care.base.rows('watch_sources')[0].status, 'watching')
    assert.equal(care.calls.length, 0)
  } finally { await care.close() }
})

test('groupSenders: a sender with no readable address is skipped; opens bands', () => {
  const g = groupSenders([{ sender: 'nobody' }, ...Array.from({ length: 10 }, (_, i) => ({ sender: 'X <x@y.example>', labelIds: i < 2 ? [] : ['UNREAD'] }))])
  assert.deepEqual([...g.keys()], ['x@y.example'])
  assert.equal(g.get('x@y.example').opens, 'some') // 20% read
})

// --- the filter and the worker ---

const news = FIXTURES.newsletter.item
test('filter: a watched newsletter is kept past the bulk rules; an unwatched one is not; sensitive is still dropped', () => {
  const watched = new Set(['hello@weeklyfounder.example'])
  assert.equal(filterItem('gmail', news).keep, false)
  assert.equal(filterItem('gmail', news, { watched: new Set(['other@x.example']) }).keep, false)
  assert.deepEqual(filterItem('gmail', news, { watched }), { keep: true, reason: 'watched_newsletter' })
  const promo = { ...news, labels: ['INBOX', 'CATEGORY_PROMOTIONS'], from: 'Weekly <Hello@WeeklyFounder.example>' }
  assert.equal(filterItem('gmail', promo, { watched }).keep, true)
  assert.equal(filterItem('gmail', { ...promo, body: 'Your lab results from the clinic are in.' }, { watched }).reason, 'sensitive_text')
  const bank = { ...promo, from: 'Chase <alerts@chase.com>' }
  assert.equal(filterItem('gmail', bank, { watched: new Set(['alerts@chase.com']) }).reason, 'sensitive_sender')
})

test('worker: a watched newsletter reaches handleItem as a newsletter; the same mail unwatched is dropped', async () => {
  const U = A.id
  const job = (id) => ({ id, user_id: U, toolkit: 'gmail', external_id: `${id}|1`, kind: 'poll', status: 'queued', attempts: 0, run_after: new Date(NOW).toISOString() })
  const run = async (watching) => {
    const supabase = createFakeSupabase({ tables: {
      connector_accounts: [{ id: 'a', user_id: U, toolkit: 'gmail', status: 'active', last_sync_at: new Date(NOW).toISOString() }], connector_jobs: [job('j1')],
      watch_sources: watching ? [{ id: 'w', user_id: U, kind: 'newsletter', identifier: 'hello@weeklyfounder.example', status: 'watching' }] : [],
    }, unique: {} })
    const handled = []
    const connectors = { run: async () => ({ data: { labelIds: ['INBOX', 'CATEGORY_PROMOTIONS'], sender: news.from, subject: news.subject, messageText: news.body, payload: { headers: [{ name: 'List-Unsubscribe', value: '<x>' }] } } }) }
    const ing = createIngestion({ supabase, connectors, clock: createFakeClock(NOW), handleItem: async (u, t, i, o) => handled.push(o) })
    await ing.worker.run()
    return { handled, status: supabase.rows('connector_jobs')[0] }
  }
  const on = await run(true)
  assert.equal(on.handled.length, 1)
  assert.equal(on.handled[0].newsletter, true)
  const off = await run(false)
  assert.deepEqual([off.handled.length, off.status.last_error_code], [0, 'label_category_promotions'])
})

// --- the signal step: world lane ---

const SIT = '22222222-2222-4222-8222-222222222222'
const BRIEF = 'What I know:\n- sells payroll software to restaurants in Texas'
const issue = (body, over = {}) => ({ id: 'n1', labels: ['INBOX', 'CATEGORY_PROMOTIONS'], from: 'The Weekly Founder <hello@weeklyfounder.example>', subject: 'Issue 41', body, bulk: true, ...over })
const reply = (o = {}) => JSON.stringify({
  worth_telling: true, push_line: null, lane: 'world', source_name: 'The Weekly Founder', urgency: 3, related_situation_id: SIT, expires_in_hours: 72,
  what_happened: 'Texas passed a new payroll tax rule that starts on 1 March 2027.',
  impact: 'You sell payroll software to restaurants in Texas, so your pricing page will need this rule before March.', ...o,
})
function signalSetup(replies, tables = {}) {
  const supabase = createFakeSupabase({
    tables: { connector_accounts: [{ id: 'a1', user_id: A.id, toolkit: 'gmail', status: 'active' }], situations: [{ id: SIT, user_id: A.id, title: 'Texas pricing page', status: 'open' }], ...tables },
    unique: { signals: [{ cols: ['user_id', 'external_ref_hash'] }] },
  })
  const openai = createFakeOpenAI(replies)
  const clock = createFakeClock(NOW)
  const { logModelUsage } = createUsageLogger({ supabase })
  const logs = []
  const handle = createSignalHandler({ supabase, clock, log: (w, i) => logs.push(`${w} ${i ?? ''}`), loadBrief: async () => BRIEF, callStructured: (a) => callStructured({ openai, logModelUsage, clock, ...a }) })
  return { supabase, openai, handle, logs, signals: () => supabase.rows('signals') }
}
const TEXAS = 'This week in startups. Texas passed a new payroll tax rule that starts on 1 March 2027. Other news follows.'

test('a watched newsletter that touches the founder becomes a world signal, capped at urgency 1, no push line, text trimmed', async () => {
  const s = signalSetup([reply({ push_line: 'Texas payroll rule lands 1 March, update your pricing page.' })])
  await s.handle(A.id, 'gmail', issue(TEXAS), { newsletter: true })
  const [row] = s.signals()
  assert.deepEqual([row.lane, row.urgency, row.toolkit], ['world', 1, 'gmail'])
  assert.ok(!('push_line' in row.facts))
  const sent = JSON.parse(s.openai.calls[0].payload.messages[1].content)
  assert.equal(sent.forced_lane, 'world')
  assert.match(s.openai.calls[0].payload.messages[0].content, /never summarise/i)
  assert.ok(!JSON.stringify(s.signals()).includes('Other news follows'))
  const long = sourceOf('gmail', issue(`${'word  \n\n\n\n '.repeat(5000)}END`), { newsletter: true }).text
  assert.ok(long.length < NEWSLETTER_TEXT + 200 && !long.includes('END'))
})

test('a newsletter that touches nothing of the founder makes no signal: the model says no, or the impact links to nothing', async () => {
  const no = signalSetup([JSON.stringify({ worth_telling: false, push_line: null, lane: 'world', source_name: 'The Weekly Founder', urgency: 0, related_situation_id: null, expires_in_hours: 24, what_happened: '', impact: '' })])
  await no.handle(A.id, 'gmail', issue(TEXAS), { newsletter: true })
  assert.equal(no.signals().length, 0)
  const loose = signalSetup([reply({ impact: 'This is a big shift for the whole startup market.' })])
  await loose.handle(A.id, 'gmail', issue(TEXAS), { newsletter: true })
  assert.equal(loose.signals().length, 0)
  assert.match(loose.logs.join('\n'), /not_linked/)
  // A stored world name alone is not a link for a world signal.
  const named = signalSetup([reply({ impact: 'Your pilot is something you track, and that is all.' })], { founder_world: [{ id: 'w', user_id: A.id, name: 'pilot', kind: 'project', status: 'active', last_mentioned_at: '2026-11-01T00:00:00Z' }] })
  await named.handle(A.id, 'gmail', issue(TEXAS), { newsletter: true })
  assert.equal(named.signals().length, 0)
})

test('an invented number still fails verification for a newsletter', async () => {
  const s = signalSetup([reply({ what_happened: 'Texas passed a new payroll tax rule that starts on 1 March 2031.' }), reply({ what_happened: 'Texas passed a new payroll tax rule that starts on 1 March 2031.' })])
  await s.handle(A.id, 'gmail', issue(TEXAS), { newsletter: true })
  assert.equal(s.signals().length, 0)
})

test('the same story from a second newsletter is skipped; a different story and a story older than 3 days are not', async () => {
  const s = signalSetup([reply(), reply({ source_name: 'Founder Weekly' }), reply({ source_name: 'Founder Weekly' })])
  await s.handle(A.id, 'gmail', issue(TEXAS), { newsletter: true })
  const setAge = (h) => s.supabase.from('signals').update({ created_at: new Date(NOW - h * HOUR).toISOString() }).eq('lane', 'world').select('id') // the database sets it
  await setAge(1)
  const other = issue(TEXAS.replace('Other news', 'More'), { id: 'n2', from: 'Founder Weekly <news@founderweekly.example>' })
  await s.handle(A.id, 'gmail', other, { newsletter: true })
  assert.equal(s.signals().length, 1)
  assert.match(s.logs.join('\n'), /duplicate_story/)
  // Past 3 days it is news again.
  await setAge(96)
  await s.handle(A.id, 'gmail', { ...other, id: 'n3' }, { newsletter: true })
  assert.equal(s.signals().length, 2)
})

test('sameStory: shared names and numbers, not the newsletter\'s own name', () => {
  assert.equal(sameStory('Texas passed a payroll rule from 1 March 2027.', 'Texas will start a payroll rule on 1 March 2027.'), true)
  assert.equal(sameStory('Texas passed a payroll rule from 1 March 2027.', 'Ohio banned tips on 9 June 2028.'), false)
  assert.equal(sameStory('The Weekly Founder says Texas fell.', 'The Weekly Founder says Ohio rose.', 'The Weekly Founder', 'The Weekly Founder'), false)
})
