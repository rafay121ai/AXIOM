// Copy test for public.delete_account, on the live main structure (read Nov 4) in PGlite.
// Two made-up founders, A and B, with a row in every table that holds founder data.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { load } from './load.mjs'

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

const before = await snapshot()
assert.ok((await traces(A, EMAIL[A])).length > 15, 'seed reaches the tables')

// 1. Atomic: if any step fails, nothing is removed. A stray row of B pointing at A's situation blocks the delete.
const stray = await ins(B, 'peer_unlocks', { user_id: B, granted_by_report_id: (await q(`select id from public.reports where user_id = $1`, [B])).rows[0].id,
  kind: 'report', used_on_situation_id: (await q(`select id from public.situations where user_id = $1`, [A])).rows[0].id })
await assert.rejects(q('select public.delete_account($1)', [A]))
const blocked = await snapshot()
await q('delete from public.peer_unlocks where id = $1', [stray]); mine[B].delete(stray)
assert.deepEqual(await snapshot(), before, 'a failed delete leaves everything as it was')
assert.ok(blocked.situations.length === before.situations.length)

// 2. Delete A.
await q('select public.delete_account($1)', [A])
const after = await snapshot()

// 3. Nothing of A is left anywhere, by id or by email.
assert.deepEqual(await traces(A, EMAIL[A]), [], 'no trace of founder A')

// 4. Every row that is left was there before, unchanged; every removed row was A's.
for (const [t, rows] of Object.entries(after)) for (const r of rows) assert.ok(before[t].includes(r), `${t} row changed: ${r}`)
const removed = Object.values(before).flat().length - Object.values(after).flat().length
const aRows = [...mine[A]].length + 2 // + founder_profiles and user_settings (keyed by user_id)
assert.equal(removed, aRows - 1, 'removed exactly A\'s rows, except the approved story') // minus the approved story, which stays

// 5. B is untouched: every one of B's rows is still there.
for (const t of Object.keys(before)) {
  const bBefore = before[t].filter((r) => [...mine[B]].some((id) => r.includes(id)) || r.includes(B))
  for (const r of bBefore) assert.ok(after[t].includes(r), `B lost a ${t} row`)
}
for (const s of Object.values(storiesB)) assert.equal((await q('select count(*)::int n from public.outcome_author_links where peer_outcome_id = $1', [s])).rows[0].n, 1)

// 6. A's approved story stays, with no link; the others are gone.
const left = (await q('select id, status, story from public.peer_outcomes where id = any($1)', [Object.values(storiesA)])).rows
assert.deepEqual(left.map((r) => [r.id, r.status, r.story]), [[storiesA.approved, 'approved', 'story of approved']])

// 7. Twice: no error, no change.
await q('select public.delete_account($1)', [A])
assert.deepEqual(await snapshot(), after, 'second run changes nothing')

// 8. The server's last step, removing the sign-in, is not blocked by any reference.
await q('delete from auth.users where id = $1', [A])
assert.deepEqual(await snapshot(), after, 'removing the sign-in removes nothing else')

console.log(`PASS: ${aRows - 1} rows of founder A removed across ${Object.keys(before).filter((t) => before[t].length !== after[t].length).length} tables; ` +
  `founder B's ${[...mine[B]].length + 2} rows unchanged; approved story kept with no link; second run and sign-in removal clean; failed run rolled back.`)
