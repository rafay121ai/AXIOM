// Connector routes, disconnect, 30-day clearing and deletion order, against a fake Composio and the fake Supabase.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createApp } from '../app.js'
import { createFakeClock, createFakeOpenAI, createFakeSupabase } from '../testing/fakes.js'
import { createFounderDeletion } from '../journey/home/accountDelete.js'
import { createAccountExport } from '../journey/home/accountExport.js'
import { createConnectors } from './composio.js'
import { ACTION_KEEP_MS, clearActionContent, COPY, LEARN_VERSION } from './connectorService.js'

const A = { id: '11111111-1111-4111-8111-111111111111', email: 'a@example.com' }
const B = { id: '22222222-2222-4222-8222-222222222222', email: 'b@example.com' }
const NOW = Date.parse('2026-11-27T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000
const at = (ms) => new Date(ms).toISOString()
const ENV = { FRONTEND_URL: 'https://app.example.com', CONNECTORS: 'on' }

// A fake Composio SDK: per founder, which toolkits are connected (accountId, active) and what was deleted.
function fakeComposio(state = {}) {
  const deleted = []
  const composio = {
    create: async (userId) => ({
      toolkits: async () => ({ items: Object.entries(state[userId] ?? {}).filter(([k]) => k !== 'old').map(([slug, c]) => ({ slug, connection: { isActive: c.active, connectedAccount: { id: c.id, status: c.active ? 'ACTIVE' : 'EXPIRED' } } })) }),
      authorize: async (toolkit) => ({ redirectUrl: `https://connect.example/${toolkit}/${userId}` }),
    }),
    connectedAccounts: {
      // state[user].old = [{ toolkit, id }]: accounts a reconnect left behind. Two per page, to exercise the cursor.
      list: async ({ userIds, toolkitSlugs, cursor }) => {
        assert.equal(userIds.length, 1)
        const mine = state[userIds[0]] ?? {}
        const all = [...Object.entries(mine).filter(([k]) => k !== 'old').map(([toolkit, c]) => ({ toolkit, id: c.id })), ...(mine.old ?? [])].filter((a) => toolkitSlugs.includes(a.toolkit))
        const from = Number(cursor ?? 0)
        return { items: all.slice(from, from + 2).map((a) => ({ id: a.id, toolkit: { slug: a.toolkit } })), nextCursor: from + 2 < all.length ? String(from + 2) : null }
      },
      delete: async (id) => { if (composio.failDelete) throw new Error('boom'); deleted.push(id) },
    },
  }
  return { composio, deleted }
}

async function setup({ composioState = {}, tables = {}, env = ENV, failDelete = false } = {}) {
  const fake = fakeComposio(composioState)
  fake.composio.failDelete = failDelete
  const connectors = createConnectors({ composio: fake.composio })
  const base = createFakeSupabase({ users: { tokA: A, tokB: B }, tables })
  const clock = createFakeClock(NOW)
  const app = createApp({ env, supabase: base, openai: createFakeOpenAI([]), clock, connectors })
  const server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  const url = `http://127.0.0.1:${server.address().port}`
  const call = async (method, path, token = 'tokA', body) => {
    const res = await fetch(`${url}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
    const text = await res.text()
    return { status: res.status, body: text.startsWith('{') ? JSON.parse(text) : text }
  }
  return { base, clock, call, deleted: fake.deleted, connectors, close: () => new Promise((r) => server.close(r)) }
}

test('routes do not exist (404) when CONNECTORS is off, even without a token', async () => {
  const t = await setup({ env: { FRONTEND_URL: ENV.FRONTEND_URL } })
  try {
    for (const [m, p] of [['GET', '/api/connectors'], ['POST', '/api/connectors/gmail/connect'], ['DELETE', '/api/connectors/gmail'], ['PUT', '/api/connectors/learn'], ['POST', '/api/connectors/gmail/forget']]) assert.equal((await t.call(m, p)).status, 404, p)
  } finally { await t.close() }
})

test('routes stay 404 with a Composio client present when CONNECTORS is off (client exists for account deletion)', async () => {
  const fake = fakeComposio({})
  const app = createApp({ env: { FRONTEND_URL: ENV.FRONTEND_URL }, supabase: createFakeSupabase({}), openai: createFakeOpenAI([]), clock: createFakeClock(NOW), connectors: createConnectors({ composio: fake.composio }) })
  const server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  try { assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/connectors`)).status, 404) } finally { await new Promise((r) => server.close(r)) }
})

test('routes need a signed-in founder', async () => {
  const t = await setup()
  try { assert.equal((await t.call('GET', '/api/connectors', 'nope')).status, 401) } finally { await t.close() }
})

test('connect returns the Composio link for that founder; unknown toolkit is refused', async () => {
  const t = await setup()
  try {
    const res = await t.call('POST', '/api/connectors/gmail/connect')
    assert.deepEqual([res.status, res.body], [200, { url: `https://connect.example/gmail/${A.id}` }])
    assert.equal((await t.call('POST', '/api/connectors/slack/connect')).status, 404)
    assert.equal((await t.call('DELETE', '/api/connectors/slack')).status, 404)
  } finally { await t.close() }
})

test('connect is refused during an open care event and during a pending delete request', async () => {
  const care = await setup({ tables: { care_events: [{ id: 'c1', user_id: A.id, level: 'clear', resolved_at: null }] } })
  try {
    const res = await care.call('POST', '/api/connectors/gmail/connect')
    assert.deepEqual([res.status, res.body.error], [409, COPY.care])
    assert.equal((await care.call('POST', '/api/connectors/gmail/connect', 'tokB')).status, 200, 'another founder is not blocked')
  } finally { await care.close() }
  const del = await setup({ env: { ...ENV, ACCOUNT_DELETE: 'on' }, tables: { account_requests: [{ id: 'r1', user_id: A.id, kind: 'delete', status: 'pending', created_at: at(NOW), delete_after: at(NOW + 7 * DAY) }] } })
  try {
    const res = await del.call('POST', '/api/connectors/gmail/connect')
    assert.deepEqual([res.status, res.body.error], [409, COPY.deleting])
  } finally { await del.close() }
})

test('list: active at Composio gets a row; expired or gone becomes needs_reconnect; nothing connected stays not_connected', async () => {
  const t = await setup({
    composioState: { [A.id]: { gmail: { id: 'ca_gmail', active: true }, googlecalendar: { id: 'ca_cal', active: false } } },
    tables: { connector_accounts: [
      { id: 'x1', user_id: A.id, toolkit: 'googlecalendar', composio_account_id: 'ca_cal', status: 'active' },
      { id: 'x2', user_id: A.id, toolkit: 'notion', composio_account_id: 'ca_notion', status: 'active' },
    ] },
  })
  try {
    const res = await t.call('GET', '/api/connectors')
    assert.deepEqual(res.body.connectors, [
      { toolkit: 'googlecalendar', connected: false, status: 'needs_reconnect' },
      { toolkit: 'gmail', connected: true, status: 'active' },
      { toolkit: 'notion', connected: false, status: 'needs_reconnect' },
    ])
    const rows = Object.fromEntries(t.base.rows('connector_accounts').map((r) => [r.toolkit, r]))
    assert.deepEqual([rows.gmail.composio_account_id, rows.gmail.status, rows.gmail.user_id], ['ca_gmail', 'active', A.id])
    assert.equal(rows.googlecalendar.status, 'needs_reconnect')
    assert.equal(rows.notion.status, 'needs_reconnect')
    // Reconnect: the same row goes back to active with the new id, no second row.
    const t2 = await setup({ composioState: { [A.id]: { notion: { id: 'ca_new', active: true } } }, tables: { connector_accounts: [{ id: 'x2', user_id: A.id, toolkit: 'notion', composio_account_id: 'old', status: 'needs_reconnect' }] } })
    try {
      await t2.call('GET', '/api/connectors')
      assert.deepEqual(t2.base.rows('connector_accounts').map((r) => [r.composio_account_id, r.status]), [['ca_new', 'active']])
    } finally { await t2.close() }
  } finally { await t.close() }
})

const seedConnected = () => ({
  composioState: { [A.id]: { gmail: { id: 'ca_a_gmail', active: true } }, [B.id]: { gmail: { id: 'ca_b_gmail', active: true } } },
  tables: {
    connector_accounts: [A, B].flatMap((u) => ['gmail', 'notion'].map((toolkit) => ({ id: `${u.id}-${toolkit}`, user_id: u.id, toolkit, composio_account_id: `ca_${toolkit}`, status: 'active' }))),
    watch_sources: [A, B].map((u) => ({ id: `w-${u.id}`, user_id: u.id, kind: 'sender', identifier: 'x@y.com' })),
    signals: [A, B].flatMap((u) => ['gmail', 'notion'].map((toolkit) => ({ id: `s-${u.id}-${toolkit}`, user_id: u.id, toolkit, lane: 'people' }))),
    connector_actions: [{ id: 'act1', user_id: A.id, toolkit: 'gmail', status: 'done', args: { body: 'hi' }, composio_log_id: 'log_x' }],
    founder_beliefs: [{ id: 'b1', user_id: A.id, belief: 'learned from gmail', status: 'active' }],
  },
})

test('disconnect revokes at Composio, then deletes only that founder\'s rows for that toolkit; learned facts stay', async () => {
  const t = await setup(seedConnected())
  try {
    const res = await t.call('DELETE', '/api/connectors/gmail')
    assert.deepEqual([res.status, res.body.status], [200, 'not_connected'])
    assert.deepEqual(t.deleted, ['ca_a_gmail'])
    const left = (table) => t.base.rows(table).map((r) => r.id).sort()
    assert.deepEqual(left('connector_accounts'), [`${A.id}-notion`, `${B.id}-gmail`, `${B.id}-notion`].sort())
    assert.deepEqual(left('signals'), [`s-${A.id}-notion`, `s-${B.id}-gmail`, `s-${B.id}-notion`].sort())
    assert.deepEqual(left('watch_sources'), [`w-${B.id}`])
    assert.equal(t.base.rows('founder_beliefs').length, 1)
    assert.equal(t.base.rows('connector_actions').length, 1)
    // A non-gmail disconnect leaves watch sources alone.
    await t.call('DELETE', '/api/connectors/notion', 'tokB')
    assert.deepEqual(left('watch_sources'), [`w-${B.id}`])
  } finally { await t.close() }
})

test('disconnect: if Composio fails, nothing is deleted and the founder is told', async () => {
  const t = await setup({ ...seedConnected(), failDelete: true })
  try {
    const before = JSON.stringify([t.base.rows('connector_accounts'), t.base.rows('signals'), t.base.rows('watch_sources')])
    const res = await t.call('DELETE', '/api/connectors/gmail')
    assert.deepEqual([res.status, res.body.error], [502, COPY.revokeFailed])
    assert.equal(JSON.stringify([t.base.rows('connector_accounts'), t.base.rows('signals'), t.base.rows('watch_sources')]), before)
  } finally { await t.close() }
})

test('account deletion revokes the Composio connections before the data function runs; a Composio failure never blocks it', async () => {
  const order = []
  const base = createFakeSupabase({})
  base.rpc = async () => { order.push('delete_account'); return { data: null, error: null } }
  const quiet = console.error
  const logged = []
  console.error = (m) => logged.push(m)
  try {
    await createFounderDeletion({ supabase: base, revokeConnections: async (id) => { order.push(`revoke ${id}`); return [] } }).deleteFounder(A.id)
    assert.deepEqual(order, [`revoke ${A.id}`, 'delete_account'])
    order.length = 0
    await createFounderDeletion({ supabase: base, revokeConnections: async () => ['gmail ca_old1'] }).deleteFounder(A.id)
    await createFounderDeletion({ supabase: base, revokeConnections: async () => { throw new Error(`down ${A.id}`) } }).deleteFounder(A.id)
    assert.deepEqual(order, ['delete_account', 'delete_account'])
    assert.equal(logged.length, 2)
    assert.ok(logged[0].includes('gmail ca_old1') && !logged.join().includes(A.id))
  } finally { console.error = quiet }
})

test('revokeAll deletes every account of the founder (older ones too, across pages), continues past a failure and names it', async () => {
  const { composio } = fakeComposio({ [A.id]: { gmail: { id: 'g', active: true }, notion: { id: 'n', active: true }, old: [{ toolkit: 'gmail', id: 'g_old' }, { toolkit: 'notion', id: 'n_old' }, { toolkit: 'gmail', id: 'g_old2' }] }, [B.id]: { gmail: { id: 'b', active: true } } })
  const seen = []
  composio.connectedAccounts.delete = async (id) => { seen.push(id); if (id === 'g_old') throw new Error('x') }
  assert.deepEqual(await createConnectors({ composio }).revokeAll(A.id), ['gmail g_old'])
  assert.deepEqual(seen.sort(), ['g', 'g_old', 'g_old2', 'n', 'n_old'])
})

test('disconnect deletes the older connected accounts a reconnect left, for that toolkit only', async () => {
  const state = seedConnected()
  state.composioState[A.id].old = [{ toolkit: 'gmail', id: 'ca_a_gmail_old' }, { toolkit: 'notion', id: 'ca_a_notion_old' }]
  const t = await setup(state)
  try {
    await t.call('DELETE', '/api/connectors/gmail')
    assert.deepEqual(t.deleted.sort(), ['ca_a_gmail', 'ca_a_gmail_old'])
  } finally { await t.close() }
})

test('disconnect deletes that toolkit\'s queued jobs and expires open actions, so an old approval cannot run after a reconnect', async () => {
  const s = seedConnected()
  const act = (id, user, toolkit, status) => ({ id, user_id: user, toolkit, status, args: {} })
  s.tables.connector_jobs = [{ id: 'j1', user_id: A.id, toolkit: 'gmail' }, { id: 'j2', user_id: A.id, toolkit: 'notion' }, { id: 'j3', user_id: B.id, toolkit: 'gmail' }]
  s.tables.connector_actions = [act('p', A.id, 'gmail', 'proposed'), act('ap', A.id, 'gmail', 'approved'), act('d', A.id, 'gmail', 'done'), act('n', A.id, 'notion', 'proposed'), act('b', B.id, 'gmail', 'approved')]
  const t = await setup(s)
  try {
    await t.call('DELETE', '/api/connectors/gmail')
    assert.deepEqual(t.base.rows('connector_jobs').map((r) => r.id).sort(), ['j2', 'j3'])
    assert.deepEqual(Object.fromEntries(t.base.rows('connector_actions').map((r) => [r.id, r.status])), { p: 'expired', ap: 'expired', d: 'done', n: 'proposed', b: 'approved' })
  } finally { await t.close() }
})

test('list writes only when something changed, and never duplicates a row', async () => {
  const t = await setup({ composioState: { [A.id]: { gmail: { id: 'ca_g', active: true } } } })
  try {
    await Promise.all([t.call('GET', '/api/connectors'), t.call('GET', '/api/connectors')])
    assert.equal(t.base.rows('connector_accounts').length, 1)
    const stamp = JSON.stringify(t.base.rows('connector_accounts'))
    await t.call('GET', '/api/connectors')
    assert.equal(JSON.stringify(t.base.rows('connector_accounts')), stamp, 'an unchanged connection is not rewritten')
  } finally { await t.close() }
})

test('export includes the connector tables for this founder only, without Composio ids or hashes of signals', async () => {
  const { tables } = seedConnected()
  const base = createFakeSupabase({ tables: { ...tables, signals: tables.signals.map((s) => ({ ...s, external_ref_hash: 'SECRETHASH' })) } })
  const doc = await createAccountExport({ supabase: base, clock: createFakeClock(NOW) }).build(A.id)
  assert.equal(doc.connector_accounts.length, 2)
  assert.equal(doc.signals.length, 2)
  assert.equal(doc.watch_sources.length, 1)
  assert.equal(doc.connector_actions.length, 1)
  assert.deepEqual(doc.connector_actions[0].args, { body: 'hi' })
  const text = JSON.stringify(doc)
  assert.ok(!text.includes('SECRETHASH') && !text.includes('composio_account_id') && !text.includes(B.id))
  assert.equal('connector_jobs' in doc, false)
  assert.ok(!text.includes('composio_log_id'))
})

test('30-day clearing: only ended actions older than 30 days lose args; preview and hash stay', async () => {
  const old = at(NOW - ACTION_KEEP_MS - DAY)
  const fresh = at(NOW - ACTION_KEEP_MS + DAY)
  const row = (id, status, extra) => ({ id, user_id: A.id, status, args: { body: id }, preview: `p-${id}`, content_hash: 'h', done_at: null, updated_at: fresh, ...extra })
  const base = createFakeSupabase({ tables: { connector_actions: [
    row('done-old', 'done', { done_at: old, updated_at: fresh }),
    row('done-fresh', 'done', { done_at: fresh, updated_at: old }),
    row('failed-old', 'failed', { updated_at: old }),
    row('rejected-old', 'rejected', { updated_at: old }),
    row('expired-old', 'expired', { updated_at: old }),
    row('expired-fresh', 'expired', { updated_at: fresh }),
    row('proposed-old', 'proposed', { updated_at: old }),
    row('approved-old', 'approved', { updated_at: old }),
    row('cleared-old', 'done', { done_at: old, args: {} }),
  ] } })
  assert.equal(await clearActionContent({ supabase: base, clock: createFakeClock(NOW) }), 4)
  assert.equal(await clearActionContent({ supabase: base, clock: createFakeClock(NOW) }), 0, 'rows already cleared are skipped')
  const by = Object.fromEntries(base.rows('connector_actions').map((r) => [r.id, r]))
  for (const id of ['done-old', 'failed-old', 'rejected-old', 'expired-old']) assert.deepEqual(by[id].args, {}, id)
  for (const id of ['done-fresh', 'expired-fresh', 'proposed-old', 'approved-old']) assert.deepEqual(by[id].args, { body: id }, id)
  assert.ok(Object.values(by).every((r) => r.preview === `p-${r.id}` && r.content_hash === 'h'))
})

test('list includes learn_how_i_work (false by default); PUT saves it and logs consent with a wording version', async () => {
  const t = await setup()
  try {
    assert.equal((await t.call('GET', '/api/connectors')).body.learn_how_i_work, false)
    const on = await t.call('PUT', '/api/connectors/learn', 'tokA', { on: true })
    assert.deepEqual([on.status, on.body], [200, { learn_how_i_work: true }])
    assert.equal((await t.call('GET', '/api/connectors')).body.learn_how_i_work, true)
    assert.equal((await t.call('GET', '/api/connectors', 'tokB')).body.learn_how_i_work, false)
    await t.call('PUT', '/api/connectors/learn', 'tokA', { on: true }) // no change, no second row
    await t.call('PUT', '/api/connectors/learn', 'tokA', { on: false })
    const log = t.base.rows('consent_log')
    assert.deepEqual(log.map((r) => [r.user_id, r.action, r.report_id]), [[A.id, 'learn_on', null], [A.id, 'learn_off', null]])
    assert.ok(log.every((r) => r.wording_version === LEARN_VERSION))
    assert.equal((await t.call('PUT', '/api/connectors/learn', 'tokA', { on: 'yes' })).status, 400)
  } finally { await t.close() }
})

test('learn and forget are refused during care and pending delete', async () => {
  const care = await setup({ tables: { care_events: [{ id: 'c1', user_id: A.id, level: 'clear', resolved_at: null }] } })
  try {
    for (const [m, p, b] of [['PUT', '/api/connectors/learn', { on: true }], ['POST', '/api/connectors/gmail/forget']]) {
      const res = await care.call(m, p, 'tokA', b)
      assert.deepEqual([res.status, res.body.error], [409, COPY.care], p)
    }
    assert.equal(care.base.rows('consent_log').length, 0)
  } finally { await care.close() }
  const del = await setup({ env: { ...ENV, ACCOUNT_DELETE: 'on' }, tables: { account_requests: [{ id: 'r1', user_id: A.id, kind: 'delete', status: 'pending', created_at: at(NOW), delete_after: at(NOW + 7 * DAY) }] } })
  try { assert.equal((await del.call('POST', '/api/connectors/gmail/forget')).body.error, COPY.deleting) } finally { await del.close() }
})

test('forget deletes only that toolkit\'s connector evidence and the world rows left bare; founder-mentioned and other-tool rows stay', async () => {
  const ev = (id, item, extra) => ({ id, user_id: A.id, item_table: 'founder_world', item_id: item, snippet: 's', ...extra })
  const t = await setup({ tables: {
    founder_world: [{ id: 'w1', user_id: A.id, name: 'Dr Hamid' }, { id: 'w2', user_id: A.id, name: 'Sam' }, { id: 'w3', user_id: A.id, name: 'Ana' }, { id: 'w4', user_id: A.id, name: 'Lee' }, { id: 'w5', user_id: B.id, name: 'Zed' }],
    signals: [{ id: 's4', user_id: A.id, toolkit: 'gmail' }],
    memory_evidence: [
      ev('e1', 'w1', { source_kind: 'connector', source_id: 's1', source_key: 'gmail' }),
      ev('e2', 'w2', { source_kind: 'connector', source_id: 's2', source_key: 'gmail' }), ev('e3', 'w2', { source_kind: 'situation', source_id: 'x1' }),
      ev('e4', 'w3', { source_kind: 'connector', source_id: 's3', source_key: 'gmail' }), ev('e5', 'w3', { source_kind: 'connector', source_id: 's5', source_key: 'notion' }),
      ev('e6', 'w4', { source_kind: 'connector', source_id: 's4', source_key: null }),
      ev('e7', 'w5', { user_id: B.id, source_kind: 'connector', source_id: 's6', source_key: 'gmail' }),
    ],
  } })
  try {
    const res = await t.call('POST', '/api/connectors/gmail/forget')
    assert.deepEqual([res.status, res.body], [200, { forgotten: 2 }])
    assert.deepEqual(t.base.rows('founder_world').map((w) => w.id).sort(), ['w2', 'w3', 'w5'])
    assert.deepEqual(t.base.rows('memory_evidence').map((e) => e.id).sort(), ['e3', 'e5', 'e7'])
    assert.equal((await t.call('POST', '/api/connectors/slack/forget')).status, 404)
  } finally { await t.close() }
})
