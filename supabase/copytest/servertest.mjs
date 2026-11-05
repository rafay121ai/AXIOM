// Drives the REAL server account code against PGlite (live main structure + fix). Run: WITH_FIX=1 node servertest.mjs
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { load } from './load.mjs'
const S = new URL('../../server/journey/home/', import.meta.url).href
const { createAccount, GRACE_MS } = await import(S + 'accountService.js')

// ---- adapter: just the supabase-js chains accountService/accountDelete use ----
function adapter(db, o) {
  const calls = o.calls
  const err = (e) => ({ code: e.code, message: e.message, status: undefined })
  function from(table) {
    const st = { op: 'select', cols: '*', set: null, row: null, where: [], order: null, limit: null, ret: false }
    const run = async () => {
      const p = []; const add = (v) => { p.push(v); return `$${p.length}` }
      const w = st.where.map(([k, c, v]) => k === 'eq' ? `${c} = ${add(v)}` : k === 'lte' ? `${c} <= ${add(v)}` : `${c} = any(${add(v)})`)
      const wh = w.length ? ' where ' + w.join(' and ') : ''
      let sql, returning = st.op === 'select' || st.ret
      if (st.op === 'select') sql = `select ${st.cols} from public.${table}${wh}${st.order ? ` order by ${st.order}` : ''}${st.limit ? ` limit ${st.limit}` : ''}`
      else if (st.op === 'update') { const ks = Object.keys(st.row); sql = `update public.${table} set ${ks.map((k) => `${k} = ${add(st.row[k])}`).join(', ')}${wh} returning ${st.cols}` }
      else { const ks = Object.keys(st.row); sql = `insert into public.${table} (${ks.join(', ')}) values (${ks.map((k) => add(st.row[k])).join(', ')}) returning ${st.cols}` }
      if (!returning) sql = sql.replace(/ returning .*$/, '')
      try { const r = await db.query(sql, p); return { data: returning ? r.rows : null, error: null } } catch (e) { return { data: null, error: err(e) } }
    }
    const b = {
      select(cols = '*') { if (st.op === 'select') st.cols = cols; else { st.cols = cols; st.ret = true } return b },
      insert(row) { st.op = 'insert'; st.row = row; return b },
      update(row) { st.op = 'update'; st.row = row; return b },
      eq(c, v) { st.where.push(['eq', c, v]); return b }, in(c, v) { st.where.push(['in', c, v]); return b },
      lte(c, v) { st.where.push(['lte', c, v]); return b },
      order(c) { st.order = c; return b }, limit(n) { st.limit = n; return b },
      then(res, rej) {
        const go = async () => { if (st.op === 'update' && st.row.status === 'deleting' && o.beforeClaim) { const f = o.beforeClaim; o.beforeClaim = null; await f() } return run() }
        return go().then(res, rej)
      },
    }
    return b
  }
  return {
    from,
    async rpc(fn, args) {
      calls.push(['rpc', fn])
      if (o.rpcFail) return { error: { code: 'XX000', message: `boom for ${args.p_user_id}` } }
      try { await db.query(`select public.${fn}($1)`, [args.p_user_id]); return { error: null } } catch (e) { return { error: err(e) } }
    },
    auth: { admin: {
      async updateUserById(id, attrs) {
        calls.push(['ban', id, (await db.query(`select (select count(*)::int from public.situations where user_id=$1) n`, [id])).rows[0].n])
        assert.equal(attrs.ban_duration, '876000h')
        await db.query(`update auth.users set banned_until = 'infinity' where id = $1`, [id]); return { error: null }
      },
      async deleteUser(id) {
        calls.push(['deleteUser', id])
        if (o.deleteFail) return { error: { status: 500, code: 'unexpected_failure', message: `x ${id}` } }
        await db.query('delete from auth.users where id = $1', [id]); return { error: null }
      },
    } },
  }
}

async function world() {
const db = await load()
const q = (sql, params) => db.query(sql, params)
const A = randomUUID(), B = randomUUID()
const EMAIL = { [A]: 'founder-a@example.test', [B]: 'founder-b@example.test' }
let seq = 0 // live fills seq itself (identity); the copy does not carry that over
const mine = { [A]: new Set(), [B]: new Set() } // every seeded row id, per founder

const HAS_ID = new Set((await q(`select table_name from information_schema.columns where table_schema = 'public' and column_name = 'id'`)).rows.map((r) => r.table_name))
async function ins(who, table, row) {
  const id = HAS_ID.has(table) ? row.id ?? randomUUID() : `${table}:${randomUUID()}` // a counting key when the table has no id
  const full = HAS_ID.has(table) ? { id, ...row } : row
  const cols = Object.keys(full)
  await q(`insert into public.${table} (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
    cols.map((c) => (full[c] !== null && typeof full[c] === 'object' && !Array.isArray(full[c]) ? JSON.stringify(full[c]) : full[c])))
  mine[who].add(id)
  return id
}

async function seed(u) {
  await q('insert into auth.users (id, email) values ($1, $2)', [u, EMAIL[u]])
  await q('insert into public.users (id, email) values ($1, $2)', [u, EMAIL[u]]); mine[u].add(u)
  await q(`insert into public.founder_profiles (user_id, stage, business_model, signup_answers, open_answers, first_reading)
           values ($1, 'validating', 'b2b', '{"building":"a tool"}', '[]', '{"headline":"x"}')`, [u])
  await q(`insert into public.user_settings (user_id, mentor_style) values ($1, 'direct')`, [u])
  await ins(u, 'account_requests', { user_id: u, kind: 'delete' })
  await ins(u, 'account_requests', { user_id: u, kind: 'export' })
  await ins(u, 'care_events', { user_id: u, level: 'clear' })
  await ins(u, 'push_tokens', { user_id: u, token: `tok-${u}`, platform: 'ios' })
  await ins(u, 'founder_lesson_log', { user_id: u, source_key: 'book:1' })
  await ins(u, 'product_events', { user_id: u, event: 'chat_started' })

  // Old web app.
  const session = await ins(u, 'sessions', { user_id: u })
  await ins(u, 'app_sessions', { user_id: u })
  const thread = await ins(u, 'conversation_threads', { user_id: u, session_id: session })
  const message = await ins(u, 'messages', { session_id: session, thread_id: thread })
  await ins(u, 'experiments', { session_id: session, user_id: u, description: 'old experiment', source_message_id: message })
  await ins(u, 'personal_memories', { session_id: session, user_id: u, type: 'fact', content: 'remembers this', embedding: [0.1, 0.2] })
  await ins(u, 'model_usage_logs', { user_id: u, model: 'm', call_type: 'read', session_id: session, message_id: message })

  // Journey.
  const situation = await ins(u, 'situations', { user_id: u })
  await ins(u, 'situation_turns', { seq: ++seq, situation_id: situation, role: 'founder', text: 'my situation' })
  await ins(u, 'reads', { situation_id: situation })
  const learn = await ins(u, 'learn_conversations', { situation_id: situation, user_id: u })
  const turn = await ins(u, 'learn_turns', { seq: ++seq, conversation_id: learn, role: 'axiom', text: 'lesson' })
  await ins(u, 'learn_turns', { seq: ++seq, conversation_id: learn, role: 'founder', text: 'reply', parent_turn_id: turn })
  await ins(u, 'lesson_citations', { learn_turn_id: turn, chunk_ids: [randomUUID()], author: 'An Author', book_title: 'A Book' })
  const move = { user_id: u, situation_id: situation, learn_id: learn, title: 't', mission: 'm', success_condition: 's',
    checklist: JSON.stringify(['a', 'b']), prediction: 'p', start_minutes: 5, hypothesis: 'h', validation: '{}' }
  const first = await ins(u, 'moves', { ...move, status: 'swapped' })
  const moveId = await ins(u, 'moves', { ...move, status: 'reported', swapped_from: first })
  await ins(u, 'notification_log', { user_id: u, kind: 'evening', dedupe_key: `k-${u}`, local_day: '2026-11-03', slot: 'evening', status: 'sent', move_id: moveId, situation_id: situation })
  const report = await ins(u, 'reports', { user_id: u, move_id: moveId, situation_id: situation, outcome: 'done', client_turn_id: randomUUID(),
    prediction: 'p', prediction_check: 'right', reply: 'r', share_state: 'shared' })
  await ins(u, 'consent_log', { user_id: u, action: 'share', wording_version: 'v1', report_id: report })
  await ins(u, 'peer_unlocks', { user_id: u, granted_by_report_id: report, kind: 'share', used_on_situation_id: situation })

  // One shared outcome in every review state, each with its private author link.
  const stories = {}
  for (const status of ['approved', 'pending_review', 'rejected', 'withdrawn']) {
    stories[status] = await ins(u, 'peer_outcomes', { status, outcome: 'done', story: status === 'approved' ? `story of ${status}` : null })
    await ins(u, 'outcome_author_links', { peer_outcome_id: stories[status], user_id: u, report_id: report })
  }
  return stories
}

const storiesA = await seed(A)
const storiesB = await seed(B)

// Every row of every public table, as text, keyed by table.
async function snapshot() {
  const tables = (await q(`select tablename from pg_tables where schemaname = 'public' order by 1`)).rows.map((r) => r.tablename)
  const out = {}
  for (const t of tables) out[t] = (await q(`select t::text as r from public.${t} t order by 1`)).rows.map((r) => r.r)
  return out
}
// Any column, any public table, that still holds the id or the email.
async function traces(id, email) {
  const hits = []
  const cols = (await q(`select table_name, column_name from information_schema.columns where table_schema = 'public'`)).rows
  for (const { table_name: t, column_name: c } of cols) {
    const n = (await q(`select count(*)::int n from public.${t} where ${c}::text like $1 or ${c}::text like $2`, [`%${id}%`, `%${email}%`])).rows[0].n
    if (n) hits.push(`${t}.${c}: ${n}`)
  }
  return hits
}

  return { db, q, A, B, EMAIL, snapshot, traces, storiesA }
}

const T0 = Date.parse('2026-11-05T09:00:00Z')
async function setup(opts = {}) {
  const w = await world()
  const o = { calls: [], ...opts }
  const logs = []; const errs = []
  const origErr = console.error; console.error = (...a) => errs.push(a.join(' '))
  w.restore = () => { console.error = origErr }
  const clock = { t: T0, now: () => clock.t }
  const account = createAccount({ supabase: adapter(w.db, o), clock, deleteOn: true, log: (m) => logs.push(m) })
  return { ...w, o, logs, errs, clock, account }
}
const reqRows = (w, u, st) => w.q(`select * from public.account_requests where user_id=$1 and kind='delete' and status=$2`, [u, st]).then((r) => r.rows)
const authRow = (w, u) => w.q('select banned_until from auth.users where id=$1', [u]).then((r) => r.rows)
const pastDue = (w) => w.q(`update public.account_requests set delete_after = $1 where kind='delete' and status='pending'`, [new Date(T0 - 1000).toISOString()])
const results = []
const ok = (n, t) => results.push(`PASS ${n}: ${t}`)

// 1 + 2
{
  const w = await setup(); const before = await w.snapshot()
  const r = await w.account.requestDelete(w.A, { confirm: 'DELETE' }, false)
  assert.equal(r.status, 'pending_deletion')
  const [row] = await reqRows(w, w.A, 'pending')
  assert.equal(new Date(row.delete_after).getTime() - T0, 7 * 864e5)
  const mid = await w.snapshot(); delete before.account_requests; delete mid.account_requests
  assert.deepEqual(mid, before); assert.equal(w.o.calls.length, 0)
  ok(1, 'pending, delete_after +7d, nothing removed')
  const c = await w.account.requestDelete(w.A, { cancel: true })
  assert.equal(c.status, 'cancelled'); assert.equal((await reqRows(w, w.A, 'pending')).length, 0)
  assert.equal(await w.account.deleteDue(), 0)
  const after = await w.snapshot(); delete after.account_requests
  assert.deepEqual(after, before); assert.equal((await authRow(w, w.A)).length, 1); assert.equal(w.o.calls.length, 0)
  ok(2, 'cancel in grace, founder intact')
  w.restore()
}

// 3 + 4
{
  const w = await setup(); const fullB = await w.snapshot()
  await w.account.requestDelete(w.A, { confirm: 'DELETE' }, false)
  await w.account.requestDelete(w.B, { confirm: 'DELETE' }, false) // B asks too, but is not due
  w.clock.t = T0 + 3 * 864e5
  await w.q(`update public.account_requests set delete_after = $1 where user_id = $2 and status='pending'`, [new Date(T0 - 1000).toISOString(), w.A])
  const bBefore = await w.snapshot()
  assert.equal(await w.account.deleteDue(), 1)
  const names = w.o.calls.map((c) => c[0]); assert.deepEqual(names, ['ban', 'rpc', 'deleteUser'])
  assert.ok(w.o.calls[0][2] > 0, 'A data still present at ban time')
  assert.deepEqual(await w.traces(w.A, w.EMAIL[w.A]), [])
  assert.equal((await authRow(w, w.A)).length, 0)
  assert.equal((await w.q('select count(*)::int n from public.peer_outcomes where id=$1', [w.storiesA.approved])).rows[0].n, 1)
  assert.equal((await w.q('select count(*)::int n from public.outcome_author_links where peer_outcome_id=$1', [w.storiesA.approved])).rows[0].n, 0)
  const after = await w.snapshot()
  for (const t of Object.keys(bBefore)) for (const r of bBefore[t]) if (r.includes(w.B)) assert.ok(after[t].includes(r), `B changed in ${t}`)
  assert.equal((await authRow(w, w.B)).length, 1)
  assert.equal((await authRow(w, w.B))[0].banned_until, null)
  ok(3, 'ban -> rpc -> deleteUser; A gone, no trace, approved story kept unlinked, auth row gone, B intact')
  const n = w.o.calls.length
  assert.equal(await w.account.deleteDue(), 0)
  assert.deepEqual(await w.snapshot(), after); assert.equal(w.o.calls.length, n)
  ok(4, 'second run: no error, no change')
  w.restore()
}

// 5 cancel lands between the read and the claim
{
  const w = await setup()
  await w.account.requestDelete(w.A, { confirm: 'DELETE' }, false); await pastDue(w)
  const before = await w.snapshot(); delete before.account_requests
  w.o.beforeClaim = () => w.account.requestDelete(w.A, { cancel: true })
  assert.equal(await w.account.deleteDue(), 0)
  assert.equal(w.o.calls.length, 0)
  const after = await w.snapshot(); delete after.account_requests
  assert.deepEqual(after, before); assert.equal((await reqRows(w, w.A, 'cancelled')).length, 1); assert.equal((await authRow(w, w.A)).length, 1)
  ok(5, 'cancel during the run: skipped, nothing touched')
  w.restore()
}

// 6 auth delete fails
{
  const w = await setup({ deleteFail: true })
  await w.account.requestDelete(w.A, { confirm: 'DELETE' }, false); await pastDue(w)
  assert.equal(await w.account.deleteDue(), 0)
  assert.equal(w.o.calls.filter((c) => c[0] === 'deleteUser').length, 3)
  assert.deepEqual(await w.traces(w.A, w.EMAIL[w.A]), [])
  assert.ok((await authRow(w, w.A))[0].banned_until, 'ban stays')
  const n = w.o.calls.length
  assert.equal(w.logs.length, 1)
  for (const s of [...w.logs, ...w.errs]) assert.ok(!s.includes(w.A) && !s.includes(w.EMAIL[w.A]), 'log leak: ' + s)
  assert.equal(n, 5); // ban, rpc, 3 deletes: no loop
  ok(6, `data gone, ban stays, 3 tries, no loop; log: "${w.logs[0]}"`)
  w.restore()
}

// 7 rpc fails
{
  const w = await setup({ rpcFail: true })
  await w.account.requestDelete(w.A, { confirm: 'DELETE' }, false); await pastDue(w)
  const before = await w.snapshot(); delete before.account_requests
  assert.equal(await w.account.deleteDue(), 0)
  const after = await w.snapshot(); delete after.account_requests
  assert.deepEqual(after, before)
  assert.equal((await reqRows(w, w.A, 'deleting')).length, 1)
  assert.equal(w.o.calls.filter((c) => c[0] === 'deleteUser').length, 0)
  for (const s of [...w.logs, ...w.errs]) assert.ok(!s.includes(w.A), 'log leak: ' + s)
  w.o.rpcFail = false
  assert.equal(await w.account.deleteDue(), 1)
  assert.deepEqual(await w.traces(w.A, w.EMAIL[w.A]), [])
  ok(7, 'rpc failure: nothing removed, request row stays (deleting), next run completes')
  w.restore()
}
console.log(results.join('\n'))
