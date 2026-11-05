// Account export and delete, against the in-memory fakes only.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createApp } from '../../app.js'
import { createFakeClock, createFakeOpenAI, createFakeSupabase } from '../../testing/fakes.js'
import { FULL_ANSWERS } from '../fixtures.js'
import { createAccount, GRACE_MS, startDeletionLoop } from './accountService.js'
import { createAccountExport } from './accountExport.js'
import { ACCOUNT_COPY, DELETION_PLAN } from './wording.js'

const A = { id: '11111111-1111-4111-8111-111111111111', email: 'a@example.com' }
const B = { id: '22222222-2222-4222-8222-222222222222', email: 'b@example.com' }
const NOW = Date.parse('2026-10-26T16:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000
const at = (ms) => new Date(ms).toISOString()
const UNIQUE = {
  account_requests: [{ cols: ['user_id', 'kind'], where: (r) => r.status === 'queued' }, { cols: ['user_id'], where: (r) => r.kind === 'delete' && r.status === 'pending' }],
}

// One id space per founder: n * 10 + slot.
const id = (who, n) => `00000000-0000-4000-8000-${String((who === A ? 1000 : 2000) + n).padStart(12, '0')}`

// A founder with something in every table the deletion and export know about.
function seedFounder(who, tag) {
  const u = who.id
  const secret = `${tag} secret words`
  return {
    users: [{ id: u, email: who.email, first_name: tag }],
    founder_profiles: [{ user_id: u, signup_answers: FULL_ANSWERS, timezone: 'Asia/Karachi', country: 'Pakistan', goal: secret, first_reading: { x: 1 } }],
    user_settings: [{ user_id: u, share_auto: false, keep_items: true }],
    situations: [{ id: id(who, 1), user_id: u, title: secret, status: 'open', created_at: at(NOW), last_activity_at: at(NOW) }],
    situation_turns: [{ id: id(who, 2), situation_id: id(who, 1), role: 'founder', text: secret, created_at: at(NOW) }],
    reads: [{ id: id(who, 3), situation_id: id(who, 1), headline: secret, body: 'b', created_at: at(NOW), result: 'internal' }],
    learn_conversations: [{ id: id(who, 4), situation_id: id(who, 1), user_id: u, created_at: at(NOW) }],
    learn_turns: [{ id: id(who, 5), conversation_id: id(who, 4), role: 'axiom', kind: 'lesson', text: secret, evidence: { chunk_ids: ['CHUNK'] }, validation: ['INTERNAL'], sources: [{ chunk_id: 'CHUNK' }], created_at: at(NOW) }],
    lesson_citations: [{ id: id(who, 6), learn_turn_id: id(who, 5), chunk_ids: ['CHUNK'] }],
    moves: [{ id: id(who, 7), user_id: u, situation_id: id(who, 1), learn_id: id(who, 4), status: 'reported', title: secret, mission: 'm', success_condition: 's', words: '', checklist: ['a', 'b'], prediction: 'p', hypothesis: 'HYPOTHESIS', validation: { INTERNAL: 1 }, created_at: at(NOW) }],
    reports: [{ id: id(who, 8), user_id: u, move_id: id(who, 7), situation_id: id(who, 1), outcome: 'done', note: secret, prediction: 'p', prediction_check: 'right', reply: 'r', share_state: 'shared', created_at: at(NOW) }],
    consent_log: [{ id: id(who, 9), user_id: u, report_id: id(who, 8), action: 'share', wording_version: 'v1', decided_at: at(NOW) }],
    care_events: [{ id: id(who, 10), user_id: u, level: 'unclear', scope_id: id(who, 1), created_at: at(NOW), resolved_at: at(NOW) }],
    push_tokens: [{ id: id(who, 11), user_id: u, token: `ExponentPushToken[${tag}]`, platform: 'ios', created_at: at(NOW), updated_at: at(NOW) }],
    notification_log: [{ id: id(who, 12), user_id: u, dedupe_key: `DEDUPE-${tag}`, kind: 'morning', status: 'sent' }],
    founder_lesson_log: [{ id: id(who, 13), user_id: u, source_key: tag }],
    peer_unlocks: [{ id: id(who, 14), user_id: u, granted_by_report_id: id(who, 8), kind: 'share' }],
    peer_outcomes: [
      { id: id(who, 15), status: 'approved', story: `${tag} published story` },
      { id: id(who, 16), status: 'pending_review', draft: { note: `${tag} draft` } },
      { id: id(who, 17), status: 'withdrawn', draft: null },
    ],
    outcome_author_links: [15, 16, 17].map((n) => ({ peer_outcome_id: id(who, n), user_id: u, report_id: id(who, 8), created_at: at(NOW) })),
    sessions: [{ id: id(who, 18), user_id: u, session_token: `SESSTOK-${tag}`, session_notes: secret, created_at: at(NOW) }],
    messages: [{ id: id(who, 19), session_id: id(who, 18), content: secret }],
    personal_memories: [{ id: id(who, 20), user_id: u, content: secret, embedding: [0.123456] }],
    model_usage_logs: [{ id: id(who, 21), user_id: u }],
    app_sessions: [{ id: id(who, 22), user_id: u, entry_point: 'direct', started_at: at(NOW) }],
    conversation_threads: [{ id: id(who, 23), user_id: u, session_id: id(who, 18), title: `${tag} thread`, status: 'active' }],
    experiments: [{ id: id(who, 24), user_id: u, session_id: id(who, 18), description: `${tag} experiment`, metadata: { m: 'METADATA' } }],
    product_events: [{ id: id(who, 25), user_id: u, event: 'message_sent', properties: { p: 'PROPS' }, created_at: at(NOW) }],
  }
}

// Stands in for the SQL function delete_account (the real one is tested on a copy of the database).
function installDeleteAccount(base) {
  base.rpc = async (name, { p_user_id: u }) => {
    assert.equal(name, 'delete_account')
    const del = (t, col, vals) => base.from(t).delete().in(col, vals)
    const ids = async (t, col, val, pick = 'id') => (await base.from(t).select(pick).eq(col, val)).data.map((r) => r[pick])
    const linked = await ids('outcome_author_links', 'user_id', u, 'peer_outcome_id')
    const unpublished = (await base.from('peer_outcomes').select('id').in('id', linked).neq('status', 'approved')).data.map((r) => r.id)
    await del('peer_outcomes', 'id', unpublished)
    for (const t of ['outcome_author_links', 'peer_unlocks', 'consent_log', 'notification_log', 'reports', 'moves']) await base.from(t).delete().eq('user_id', u)
    const convs = await ids('learn_conversations', 'user_id', u)
    const turns = (await base.from('learn_turns').select('id').in('conversation_id', convs)).data.map((r) => r.id)
    await del('lesson_citations', 'learn_turn_id', turns); await del('learn_turns', 'conversation_id', convs)
    await base.from('learn_conversations').delete().eq('user_id', u)
    const sits = await ids('situations', 'user_id', u)
    await del('situation_turns', 'situation_id', sits); await del('reads', 'situation_id', sits)
    await base.from('situations').delete().eq('user_id', u)
    await del('messages', 'session_id', await ids('sessions', 'user_id', u))
    for (const t of ['founder_lesson_log', 'care_events', 'push_tokens', 'user_settings', 'app_sessions', 'conversation_threads', 'experiments', 'personal_memories', 'model_usage_logs', 'product_events', 'sessions', 'founder_profiles', 'account_requests']) await base.from(t).delete().eq('user_id', u)
    await base.from('users').delete().eq('id', u)
    return { data: null, error: null }
  }
  return base
}

const ENV = { FRONTEND_URL: 'https://app.example.com' }

async function setup({ deleteOn = false, tables = {}, wrap = (b) => b } = {}) {
  const base = createFakeSupabase({
    users: { tokA: A, tokB: B },
    tables: { ...seedFounder(A, 'Alpha'), ...mergeSeed(seedFounder(B, 'Bravo')), ...tables },
    unique: UNIQUE,
  })
  installDeleteAccount(base)
  const clock = createFakeClock(NOW)
  const app = createApp({ env: { ...ENV, ...(deleteOn ? { ACCOUNT_DELETE: 'on' } : {}) }, supabase: wrap(base), openai: createFakeOpenAI([]), clock })
  const server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  const url = `http://127.0.0.1:${server.address().port}`
  const as = (token) => async (method, path, body) => {
    const res = await fetch(`${url}${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await res.text()
    return { status: res.status, headers: res.headers, text, body: text.startsWith('{') ? JSON.parse(text) : text }
  }
  const account = createAccount({ supabase: base, clock, deleteOn })
  return { base, clock, account, a: as('tokA'), b: as('tokB'), close: () => new Promise((r) => server.close(r)) }
}

// B's rows are added to A's tables (both founders live in the same tables).
function mergeSeed(b) {
  const a = seedFounder(A, 'Alpha')
  return Object.fromEntries(Object.entries(b).map(([t, rows]) => [t, [...a[t], ...rows]]))
}

const everyRow = (base) => base.tableNames().flatMap((t) => base.rows(t).map((r) => [t, r]))
const mentions = (base, who) => everyRow(base).filter(([, r]) => Object.values(r).some((v) => JSON.stringify(v)?.includes(who.id)))

// ── Export ───────────────────────────────────────────────────────────────────

test('export: A gets A only, as an attachment, with nothing internal and no user id', async () => {
  const { a, b, close } = await setup()
  try {
    const res = await a('POST', '/api/account/export', {})
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-disposition'), /^attachment; filename=/)
    assert.equal(res.body.message, ACCOUNT_COPY.exportReady)
    assert.equal(res.body.account.email, 'a@example.com')
    assert.deepEqual(Object.keys(res.body).sort(), ['account', 'app_sessions', 'care_events', 'consent_log', 'conversation_threads', 'devices', 'experiments', 'exported_at', 'founder_lesson_log', 'learn_conversations', 'learn_turns', 'message', 'messages', 'moves', 'notification_log', 'peer_unlocks', 'personal_memories', 'product_events', 'profile', 'reads', 'reports', 'sessions', 'settings', 'situation_turns', 'situations'])
    for (const key of ['situations', 'situation_turns', 'reads', 'learn_conversations', 'learn_turns', 'moves', 'reports', 'consent_log', 'care_events', 'devices', 'messages', 'personal_memories', 'sessions', 'conversation_threads', 'app_sessions', 'experiments', 'founder_lesson_log', 'notification_log', 'peer_unlocks', 'product_events']) assert.equal(res.body[key].length, 1, key)
    assert.equal(res.body.reports[0].share_state, 'shared')
    assert.deepEqual(res.body.devices[0].token, 'redacted')
    for (const leak of [A.id, B.id, 'b@example.com', 'Bravo', 'ExponentPushToken', 'CHUNK', 'HYPOTHESIS', 'INTERNAL', 'user_id', 'peer_outcome', 'published story', 'draft', 'evidence', 'scope_id', 'session_token', 'SESSTOK', 'embedding', '0.123456', 'METADATA', 'PROPS', 'DEDUPE', 'Bravo thread', 'Bravo experiment']) {
      assert.ok(!res.text.includes(leak), `export holds ${leak}`)
    }
    assert.ok(res.text.includes('Alpha secret words'))
    // And the other way round.
    const other = await b('POST', '/api/account/export', {})
    assert.ok(!other.text.includes('Alpha') && !other.text.includes(A.id) && other.text.includes('Bravo secret words'))
  } finally { await close() }
})

test('export: pages past one response and refuses a file over the size cap', async () => {
  const many = Array.from({ length: 1200 }, (_, n) => ({ id: `00000000-0000-4000-8000-${String(5000 + n).padStart(12, '0')}`, user_id: A.id, title: `s${n}`, status: 'open', created_at: at(NOW), last_activity_at: at(NOW) }))
  const base = createFakeSupabase({ tables: { situations: many }, maxRows: 1000 })
  const doc = await createAccountExport({ supabase: base, clock: createFakeClock(NOW) }).build(A.id)
  assert.equal(doc.situations.length, 1200)
  const huge = createFakeSupabase({ tables: { situations: [{ id: id(A, 1), user_id: A.id, title: 'x'.repeat(11 * 1024 * 1024) }] } })
  await assert.rejects(createAccountExport({ supabase: huge, clock: createFakeClock(NOW) }).build(A.id), (e) => e.status === 413 && e.body.error === ACCOUNT_COPY.exportTooLarge)
})

test('export: a database error fails the whole export, never a partial file', async () => {
  const failing = createFakeSupabase({})
  failing.from = () => { throw new Error('db down') }
  await assert.rejects(createAccountExport({ supabase: failing, clock: createFakeClock(NOW) }).build(A.id))
})

// ── Delete: asking, grace period, cancel ─────────────────────────────────────

test('delete (switch on): 7 days of grace, same answer when repeated, cancel works, nothing removed', async () => {
  const { a, base, clock, close } = await setup({ deleteOn: true })
  try {
    const before = JSON.stringify(everyRow(base).filter(([t]) => t !== 'account_requests'))
    const first = await a('DELETE', '/api/account', { confirm: 'DELETE' })
    assert.deepEqual([first.status, first.body.status, first.body.deleted, first.body.delete_after], [200, 'pending_deletion', false, at(NOW + GRACE_MS)])
    assert.match(first.body.message, /On 2 November 2026 I will delete everything/)
    clock.advance(DAY)
    const again = await a('DELETE', '/api/account', { confirm: 'DELETE' })
    assert.equal(again.body.delete_after, first.body.delete_after)
    assert.equal(base.rows('account_requests').length, 1)
    assert.equal(JSON.stringify(everyRow(base).filter(([t]) => t !== 'account_requests')), before)
    const cancelled = await a('DELETE', '/api/account', { cancel: true })
    assert.deepEqual([cancelled.body.status, cancelled.body.message], ['cancelled', ACCOUNT_COPY.deleteCancelled])
    assert.deepEqual((await a('DELETE', '/api/account', { cancel: true })).body.status, 'none')
    // Cancelled means the hourly check deletes nothing, even after the date.
    clock.advance(10 * DAY)
    await createAccount({ supabase: base, clock, deleteOn: true }).deleteDue()
    assert.equal(JSON.stringify(everyRow(base).filter(([t]) => t !== 'account_requests')), before)
    // A new request after a cancel starts a fresh grace period.
    assert.equal((await a('DELETE', '/api/account', { confirm: 'DELETE' })).body.delete_after, at(clock.now() + GRACE_MS))
  } finally { await close() }
})

test('settings: shows a pending deletion (day and sentence only), null when cancelled, none, switch off, or another founder', async () => {
  const on = await setup({ deleteOn: true })
  try {
    assert.equal((await on.a('GET', '/api/settings')).body.pending_deletion, null)
    await on.b('DELETE', '/api/account', { confirm: 'DELETE' })
    assert.equal((await on.a('GET', '/api/settings')).body.pending_deletion, null)
    await on.a('DELETE', '/api/account', { confirm: 'DELETE' })
    const shown = (await on.a('GET', '/api/settings')).body.pending_deletion
    assert.deepEqual(shown, { delete_after: at(NOW + GRACE_MS), message: ACCOUNT_COPY.deleteWaiting.replace('{date}', '2 November 2026') })
    assert.deepEqual((await on.a('PUT', '/api/settings', { keep_items: true })).body.pending_deletion, shown)
    await on.a('DELETE', '/api/account', { cancel: true })
    assert.equal((await on.a('GET', '/api/settings')).body.pending_deletion, null)
  } finally { await on.close() }
  const off = await setup({ deleteOn: false })
  try {
    await off.a('DELETE', '/api/account', { confirm: 'DELETE' })
    assert.equal((await off.a('GET', '/api/settings')).body.pending_deletion, null)
  } finally { await off.close() }
})

test('delete: an open care event still deletes, with the care tone and nothing added', async () => {
  const care = { care_events: [{ id: id(A, 99), user_id: A.id, level: 'clear', created_at: at(NOW), resolved_at: null }] }
  const on = await setup({ deleteOn: true, tables: { care_events: [...seedFounder(A, 'x').care_events, ...care.care_events] } })
  try {
    const res = await on.a('DELETE', '/api/account', { confirm: 'DELETE' })
    assert.equal(res.status, 200)
    assert.equal(res.body.status, 'pending_deletion')
    assert.equal(res.body.message, ACCOUNT_COPY.deletePendingCare.replace('{date}', '2 November 2026'))
  } finally { await on.close() }
  const off = await setup({ tables: { care_events: care.care_events } })
  try {
    assert.equal((await off.a('DELETE', '/api/account', { confirm: 'DELETE' })).body.message, ACCOUNT_COPY.deleteRecordedCare)
  } finally { await off.close() }
})

// ── Delete: the deletion itself ──────────────────────────────────────────────

test('deletion: after the grace period A is gone everywhere, B is untouched', async () => {
  const { a, base, clock, account, close } = await setup({ deleteOn: true })
  try {
    const bBefore = JSON.stringify(everyRow(base).filter(([, r]) => JSON.stringify(r).includes(B.id)))
    await a('DELETE', '/api/account', { confirm: 'DELETE' })
    assert.equal(await account.deleteDue(), 0, 'not before the date')
    assert.ok(mentions(base, A).length > 0)
    clock.advance(GRACE_MS + 1000)
    assert.equal(await account.deleteDue(), 1)

    // Nothing in any table the fake knows holds A's id.
    assert.deepEqual(mentions(base, A).map(([t]) => t), [])
    assert.ok(base.tableNames().length > 20)
    // Nothing is left under A's situations, conversations or turns either.
    for (const t of ['situation_turns', 'reads', 'learn_turns', 'lesson_citations', 'messages']) {
      assert.deepEqual(base.rows(t).filter((r) => String(Object.values(r)).includes('Alpha') || Object.values(r).some((v) => typeof v === 'string' && v.startsWith('00000000-0000-4000-8000-0000000010'))), [], t)
    }
    assert.deepEqual(base.deletedUsers, [A.id])
    // B: every row mentioning B is exactly as it was.
    assert.equal(JSON.stringify(everyRow(base).filter(([, r]) => JSON.stringify(r).includes(B.id))), bBefore)
    assert.equal(base.rows('situations').length, 1)
    assert.equal(base.rows('peer_outcomes').length, 3 + 1)
    // Shared outcomes: A's published story stays without a link; the pending and withdrawn ones are gone.
    assert.deepEqual(base.rows('peer_outcomes').map((o) => o.id).sort(), [id(A, 15), id(B, 15), id(B, 16), id(B, 17)])
    assert.deepEqual(base.rows('outcome_author_links').map((l) => l.user_id), [B.id, B.id, B.id])
    assert.equal(base.rows('peer_outcomes').find((o) => o.id === id(A, 15)).story, 'Alpha published story')
  } finally { await close() }
})

test('deletion: repeated and concurrent runs do not error or half-delete', async () => {
  const { base, clock, account, close } = await setup({ deleteOn: true })
  try {
    await account.requestDelete(A.id, { confirm: 'DELETE' }, false)
    clock.advance(GRACE_MS + 1000)
    const results = await Promise.all([account.deleteDue(), account.deleteDue()])
    assert.ok(results.every((n) => n <= 1))
    assert.deepEqual(mentions(base, A), [])
    assert.equal(await account.deleteDue(), 0)
    assert.ok(mentions(base, B).length > 0)
  } finally { await close() }
})

// A due deletion of A on a fresh fake. `tweak` changes the fake before the run.
async function dueSetup(tweak = () => {}) {
  const { base, clock, close } = await setup({ deleteOn: true })
  const logged = []
  tweak(base)
  const account = createAccount({ supabase: base, clock, deleteOn: true, log: (what, err) => logged.push(`${what} ${err?.message ?? ''}`) })
  await account.requestDelete(A.id, { confirm: 'DELETE' }, false)
  clock.advance(GRACE_MS + 1000)
  return { base, clock, account, logged, close }
}
const requestsOf = (base) => base.rows('account_requests').filter((r) => r.user_id === A.id)

test('deletion: the data step fails: banned, nothing removed, request kept, logged without ids, next run finishes it', async () => {
  let down = true
  const { base, account, logged, close } = await dueSetup((b) => {
    const rpc = b.rpc
    b.rpc = async (...args) => (down ? { error: { code: '23503', message: `FK violated, key (user_id)=(${A.id}) is still referenced` } } : rpc(...args))
  })
  try {
    assert.equal(await account.deleteDue(), 0)
    assert.deepEqual(base.bannedUsers, [A.id])
    assert.deepEqual(base.deletedUsers, [])
    assert.equal(requestsOf(base)[0].status, 'deleting')
    assert.equal(logged.length, 1)
    assert.ok(!logged[0].includes(A.id) && !logged[0].includes('a@example.com'), logged[0])
    assert.match(logged[0], /data step failed, code 23503/)
    down = false
    assert.equal(await account.deleteDue(), 1)
    assert.deepEqual(mentions(base, A), [])
  } finally { await close() }
})

test('deletion: the ban fails: the data function never runs and nothing is removed', async () => {
  let ran = false
  const { base, account, logged, close } = await dueSetup((b) => {
    b.auth.admin.updateUserById = async () => ({ error: { status: 500, message: `auth down for ${A.id}` } })
    const rpc = b.rpc
    b.rpc = async (...args) => { ran = true; return rpc(...args) }
  })
  try {
    assert.equal(await account.deleteDue(), 0)
    assert.equal(ran, false)
    assert.ok(mentions(base, A).length > 20)
    assert.ok(!logged[0].includes(A.id), logged[0])
  } finally { await close() }
})

test('deletion: removing the sign-in fails once: tried again at once, and a banned empty sign-in is left if it keeps failing', async () => {
  let fails = 1
  const t = await dueSetup((b) => {
    const del = b.auth.admin.deleteUser
    b.auth.admin.deleteUser = async (id) => (fails-- > 0 ? { error: { status: 500, message: `boom ${id}` } } : del(id))
  })
  try {
    assert.equal(await t.account.deleteDue(), 1)
    assert.deepEqual(t.base.deletedUsers, [A.id])
  } finally { await t.close() }
  const stuck = await dueSetup((b) => { b.auth.admin.deleteUser = async (id) => ({ error: { status: 500, message: `boom ${id}` } }) })
  try {
    assert.equal(await stuck.account.deleteDue(), 0)
    assert.deepEqual(mentions(stuck.base, A), [], 'founder data is gone')
    assert.deepEqual(stuck.base.bannedUsers, [A.id], 'and the sign-in cannot be used')
    assert.match(stuck.logged[0], /sign-in removal failed, code 500/)
    assert.ok(!stuck.logged[0].includes(A.id), stuck.logged[0])
  } finally { await stuck.close() }
})

test('deletion: a missing database function fails closed, loudly, and removes nothing', async () => {
  const errors = []
  const original = console.error
  console.error = (...a) => errors.push(a.join(' '))
  const t = await dueSetup((b) => { b.rpc = async () => ({ error: { code: 'PGRST202', message: 'Could not find the function' } }) })
  try {
    assert.equal(await t.account.deleteDue(), 0)
    assert.ok(mentions(t.base, A).length > 20)
    assert.deepEqual(t.base.deletedUsers, [])
    assert.ok(errors.some((e) => /delete_account is missing/.test(e)))
    assert.match(t.logged[0], /data function missing/)
  } finally { console.error = original; await t.close() }
})

test('deletion: a founder who cancels between the read and the claim is not deleted', async () => {
  const t = await dueSetup((b) => {
    const from = b.from.bind(b)
    b.from = (table) => {
      const q = from(table)
      if (table !== 'account_requests') return q
      const limit = q.limit
      q.limit = (n) => { // the cancel lands right after the due rows were read
        const read = limit(n)
        const then = read.then.bind(read)
        read.then = (ok, bad) => then(async (v) => { await from('account_requests').update({ status: 'cancelled' }).eq('user_id', A.id); return ok(v) }, bad)
        return read
      }
      return q
    }
  })
  try {
    assert.equal(await t.account.deleteDue(), 0)
    assert.deepEqual(t.base.deletedUsers, [])
    assert.deepEqual(t.base.bannedUsers, [])
    assert.ok(mentions(t.base, A).length > 20)
  } finally { await t.close() }
})

test('deletion: due rows are read oldest first', async () => {
  const t = await dueSetup()
  try {
    const seen = []
    const from = t.base.from.bind(t.base)
    t.base.from = (table) => { const q = from(table); const o = q.order; q.order = (...a) => { seen.push(a[0]); return o(...a) }; return q }
    await t.account.deleteDue()
    assert.ok(seen.includes('delete_after'))
  } finally { await t.close() }
})

test('delete: asking while already being deleted returns that request, not a second one', async () => {
  const t = await dueSetup()
  try {
    const [row] = requestsOf(t.base)
    t.base.rpc = async () => ({ error: { code: 'XX000', message: 'down' } })
    await t.account.deleteDue()
    assert.equal(requestsOf(t.base)[0].status, 'deleting')
    const again = await t.account.requestDelete(A.id, { confirm: 'DELETE' }, false)
    assert.equal(again.delete_after, row.delete_after)
    assert.equal(requestsOf(t.base).length, 1)
  } finally { await t.close() }
})

test('delete (switch on): the answer carries the existing note that published stories stay', async () => {
  const { a, close } = await setup({ deleteOn: true })
  try {
    const res = await a('DELETE', '/api/account', { confirm: 'DELETE' })
    assert.deepEqual(res.body.plan, DELETION_PLAN)
    assert.match(res.body.plan.shared_outcomes, /Stories already published stay/)
  } finally { await close() }
})

test('deletion: uses the database function when it exists, and then removes the sign-in account', async () => {
  const calls = []
  const base = createFakeSupabase({ users: { tokA: A }, tables: seedFounder(A, 'Alpha') })
  base.rpc = async (name, params) => { calls.push([name, params]); return { data: null, error: null } }
  const clock = createFakeClock(NOW)
  const account = createAccount({ supabase: base, clock, deleteOn: true })
  await account.requestDelete(A.id, { confirm: 'DELETE' }, false)
  clock.advance(GRACE_MS + 1000)
  await account.deleteDue()
  assert.deepEqual(calls, [['delete_account', { p_user_id: A.id }]])
  assert.deepEqual(base.deletedUsers, [A.id])
  assert.equal(base.rows('situations').length, 1, 'the steps did not run as well')
})

test('deletion: with the switch off nothing is ever deleted, and the loop is not needed', async () => {
  const { base, clock, account, close } = await setup()
  try {
    await account.requestDelete(A.id, { confirm: 'DELETE' }, false)
    clock.advance(30 * DAY)
    assert.equal(await account.deleteDue(), 0)
    assert.ok(mentions(base, A).length > 20)
    assert.equal(base.rows('account_requests')[0].status, 'queued')
  } finally { await close() }
})

test('deletion loop: runs the check, never overlaps, and logs failures without ids', async () => {
  let runs = 0
  let release
  const account = { deleteDue: () => { runs += 1; return new Promise((r) => { release = r }) } }
  const loop = startDeletionLoop({ account, intervalMs: 1e9 })
  const first = loop.run()
  await loop.run()
  assert.equal(runs, 1)
  release(0)
  await first
  const logged = []
  const bad = startDeletionLoop({ account: { deleteDue: async () => { throw new Error(`boom ${A.id}`) } }, intervalMs: 1e9, log: (what) => logged.push(what) })
  await bad.run()
  assert.deepEqual(logged, ['deletion check failed'])
  loop.stop(); bad.stop()
})
