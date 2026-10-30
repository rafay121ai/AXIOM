// Static checks on the journey migrations (supabase/migrations/20261101*).
// Reads SQL and server source as text: no database, no network, no env.
//
// 1. Safety: RLS on every new table, no client grants or policies, nothing
//    destructive, SECURITY INVOKER functions with a fixed search_path,
//    peer_outcomes holds nothing that points back to a founder, the sharing
//    functions hold the care check and their argument rules, and the checked
//    in rollback touches only what the journey files created.
// 2. Needed keys and checks: the follow-up cap, the move slots, one report per
//    move, push dedupe and the daily slot, one waiting account request.
// 3. Cross-check: every table, column and SQL function the new server code
//    (journey/, care/, push/) uses exists in the migrations.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { LIMITS, STEPS } from '../config.js'
import { MENTOR_STYLES } from '../journey/home/settingsService.js'
import { USAGE_CALL_TYPES } from '../modelUsage.js'
import { LOCK_SCREEN_MODES } from '../push/compose.js'
import { PUSH_KINDS } from '../push/policy.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const SERVER = join(HERE, '..')
const MIGRATIONS = join(SERVER, '..', 'supabase', 'migrations')
const ROLLBACK = join(SERVER, '..', 'supabase', 'rollback', '20261101_rollback.sql')
const FIRST_JOURNEY_MIGRATION = '20261101000001'

// ── SQL parsing ──────────────────────────────────────────────────────────────

const stripSqlComments = (sql) => sql.replace(/--[^\n]*/g, '')

// Index of the bracket that closes the one at `open`, skipping quoted text.
function closing(text, open) {
  const pairs = { '(': ')', '[': ']', '{': '}' }
  const stack = []
  for (let i = open; i < text.length; i++) {
    const c = text[i]
    if (c === "'" || c === '"' || c === '`') { i = skipString(text, i); continue }
    if (pairs[c]) stack.push(pairs[c])
    else if (c === ')' || c === ']' || c === '}') {
      stack.pop()
      if (stack.length === 0) return i
    }
  }
  return -1
}

// Index of the closing quote of the string starting at i.
function skipString(text, i) {
  const q = text[i]
  for (let j = i + 1; j < text.length; j++) {
    if (text[j] === '\\') { j++; continue }
    if (text[j] === q) return j
  }
  return text.length
}

// Split on commas that are not inside brackets or strings.
function splitTop(text) {
  const parts = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === "'" || c === '"' || c === '`') { i = skipString(text, i); continue }
    if ('([{'.includes(c)) depth++
    else if (')]}'.includes(c)) depth--
    else if (c === ',' && depth === 0) { parts.push(text.slice(start, i)); start = i + 1 }
  }
  parts.push(text.slice(start))
  return parts.map((p) => p.trim()).filter(Boolean)
}

const NOT_A_COLUMN = /^(constraint|primary|unique|check|foreign|exclude)\b/i

function readMigrations() {
  return readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort().map((name) => ({
    name,
    journey: name >= FIRST_JOURNEY_MIGRATION,
    sql: readFileSync(join(MIGRATIONS, name), 'utf8'),
  }))
}

// { table: { columns: Set, body: string|null } } from create table and add column.
function schemaOf(files) {
  const tables = {}
  const tableOf = (name) => (tables[name] ??= { columns: new Set(), body: null })
  for (const { sql: raw } of files) {
    const sql = stripSqlComments(raw)
    const create = /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.(\w+)\s*\(/gi
    let m
    while ((m = create.exec(sql))) {
      const open = m.index + m[0].length - 1
      const body = sql.slice(open + 1, closing(sql, open))
      const t = tableOf(m[1])
      t.body = (t.body ?? '') + body
      for (const part of splitTop(body)) {
        if (NOT_A_COLUMN.test(part)) continue
        t.columns.add(part.split(/\s+/)[0].replace(/"/g, ''))
      }
    }
    const add = /alter\s+table\s+(?:only\s+)?public\.(\w+)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?"?(\w+)"?/gi
    while ((m = add.exec(sql))) tableOf(m[1]).columns.add(m[2])
  }
  return tables
}

// { name: [param names] } for every function created in the files.
function functionsOf(files) {
  const fns = {}
  for (const { sql: raw } of files) {
    const sql = stripSqlComments(raw)
    const re = /create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)\s*\(/gi
    let m
    while ((m = re.exec(sql))) {
      const open = m.index + m[0].length - 1
      const params = splitTop(sql.slice(open + 1, closing(sql, open))).map((p) => p.split(/\s+/)[0])
      fns[m[1]] = params
    }
  }
  return fns
}

// The text of each journey function from `create` to its closing `$$;`.
function functionBodies(sql) {
  const out = {}
  const re = /create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)[\s\S]*?\$\$[\s\S]*?\$\$\s*;/gi
  let m
  while ((m = re.exec(sql))) out[m[1]] = m[0]
  return out
}

const all = readMigrations()
const journey = all.filter((f) => f.journey)
const journeySql = journey.map((f) => stripSqlComments(f.sql)).join('\n')
const journeyRaw = journey.map((f) => f.sql).join('\n')
const schema = schemaOf(all)
const journeyTables = Object.keys(schemaOf(journey)).filter((t) =>
  new RegExp(`create\\s+table\\s+if\\s+not\\s+exists\\s+public\\.${t}\\s*\\(`, 'i').test(journeySql))
const functions = functionsOf(all)
const sqlCompact = journeySql.replace(/\s+/g, ' ').toLowerCase()

const EXPECTED_NEW_TABLES = [
  'situations', 'situation_turns', 'reads', 'learn_conversations', 'learn_turns', 'lesson_citations',
  'moves', 'reports', 'consent_log', 'peer_outcomes', 'outcome_author_links', 'peer_unlocks',
  'care_events', 'user_settings', 'push_tokens', 'notification_log', 'account_requests',
]

// ── 1. Safety ────────────────────────────────────────────────────────────────

test('migrations: the journey files exist, in order, after every older migration', () => {
  assert.ok(journey.length >= 9, `expected the journey migrations, found ${journey.length}`)
  const names = all.map((f) => f.name)
  assert.deepEqual(names, [...names].sort())
  assert.deepEqual(journey.map((f) => f.name), names.slice(names.length - journey.length))
})

test('migrations: every new table is created idempotently', () => {
  for (const t of EXPECTED_NEW_TABLES) assert.ok(journeyTables.includes(t), `${t} is not created with create table if not exists`)
  assert.doesNotMatch(journeySql, /create\s+table\s+(?!if\s+not\s+exists)/i, 'create table without if not exists')
  assert.doesNotMatch(journeySql, /create\s+(unique\s+)?index\s+(?!if\s+not\s+exists)/i, 'create index without if not exists')
  assert.doesNotMatch(journeySql, /add\s+column\s+(?!if\s+not\s+exists)/i, 'add column without if not exists')
  assert.doesNotMatch(journeySql, /create\s+function/i, 'functions must be create or replace')
})

test('migrations: every new table has row level security enabled', () => {
  for (const t of journeyTables) {
    assert.match(journeySql, new RegExp(`alter\\s+table\\s+public\\.${t}\\s+enable\\s+row\\s+level\\s+security`, 'i'), `${t}: RLS not enabled`)
  }
})

test('migrations: every new table is server only (privileges revoked, service role granted)', () => {
  for (const t of journeyTables) {
    assert.ok(sqlCompact.includes(`revoke all on table public.${t} from public, anon, authenticated;`), `${t}: client privileges not revoked`)
    assert.ok(sqlCompact.includes(`grant all on table public.${t} to service_role;`), `${t}: service_role not granted`)
  }
})

test('migrations: nothing is granted to anon, authenticated or PUBLIC, and there are no client policies', () => {
  for (const stmt of journeySql.split(';')) {
    if (/\bgrant\b/i.test(stmt)) assert.doesNotMatch(stmt, /\bto\b[\s\S]*\b(anon|authenticated|public)\b/i, `client grant: ${stmt.trim()}`)
  }
  assert.doesNotMatch(journeySql, /create\s+policy/i, 'the new app reads nothing directly: no client policies')
})

test('migrations: nothing destructive (no drop table/column, no row removal, no truncation)', () => {
  const FORBIDDEN = [
    /drop\s+table/i, /drop\s+column/i, /drop\s+schema/i, /drop\s+view/i, /drop\s+function/i,
    /delete\s+from/i, /\btruncate\b/i, /rename\s+(column|to)\b/i, /alter\s+column\s+\w+\s+type/i,
  ]
  // Checked with comments included: no rollback note may suggest it either.
  for (const { name, sql } of journey) {
    for (const rx of FORBIDDEN) assert.doesNotMatch(sql, rx, `${name}: ${rx}`)
  }
})

test('migrations: peer_outcomes holds nothing that points back to a founder', () => {
  const cols = schema.peer_outcomes.columns
  for (const c of ['user_id', 'report_id', 'move_id', 'situation_id', 'author_id', 'founder_id']) {
    assert.ok(!cols.has(c), `peer_outcomes must not have ${c}`)
  }
  assert.doesNotMatch(schema.peer_outcomes.body, /references\s+auth\.users|references\s+public\.(reports|moves|situations|users)\b/i)
  // The only link is the private table, and reports never hold an outcome id.
  assert.ok(schema.outcome_author_links.columns.has('peer_outcome_id'))
  assert.ok(!schema.reports.columns.has('peer_outcome_id'))
  assert.doesNotMatch(sqlCompact, /alter table public\.peer_outcomes add column/)
})

test('migrations: no strike, warning or removal column on any new table', () => {
  for (const t of journeyTables) {
    for (const c of schema[t].columns) assert.doesNotMatch(c, /strike|warning|removal|removed/i, `${t}.${c}`)
  }
})

test('migrations: functions are SECURITY INVOKER with a fixed search_path, executable by service_role only', () => {
  const bodies = functionBodies(journeySql)
  // service_role already has the table grants and bypasses RLS: no definer.
  assert.doesNotMatch(journeySql, /security\s+definer/i, 'no journey function may be security definer')
  for (const name of ['share_outcome', 'unshare_outcome', 'take_follow_up', 'peer_outcomes_guard']) {
    assert.ok(bodies[name], `${name} is missing`)
    assert.match(bodies[name], /security\s+invoker/i, `${name}: not security invoker`)
    assert.match(bodies[name], /set\s+search_path\s*=\s*''/i, `${name}: search_path not fixed`)
  }
  for (const name of Object.keys(bodies)) {
    assert.match(bodies[name], /set\s+search_path\s*=/i, `${name}: search_path not set`)
    assert.ok(new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon, authenticated;`).test(sqlCompact), `${name}: execute not revoked from clients`)
    assert.ok(new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to service_role;`).test(sqlCompact), `${name}: not granted to service_role`)
    // search_path is empty, so every table must be schema-qualified.
    for (const t of journeyTables) {
      const bare = new RegExp(`\\b(from|into|update|join)\\s+${t}\\b`, 'i')
      assert.doesNotMatch(bodies[name], bare, `${name}: unqualified ${t}`)
    }
  }
})

const compactBody = (name) => (functionBodies(journeySql)[name] ?? '').replace(/\s+/g, ' ').toLowerCase()

test('migrations: share_outcome runs the care check under the report lock and fails closed', () => {
  const body = compactBody('share_outcome')
  const lock = body.indexOf('for update;')
  const write = body.indexOf('insert into public.consent_log')
  assert.ok(lock > 0 && write > lock, 'share_outcome must lock the report before writing')
  const care = body.slice(lock, write)
  // Same rule as server/journey/report/sharing.js careTouched.
  assert.match(care, /select \* into s from public\.situations where id = r\.situation_id; if not found or s\.care_flag then return; end if;/)
  assert.match(care, /if exists \( select 1 from public\.care_events e where e\.user_id = p_user_id and \(\(e\.level = 'clear' and e\.resolved_at is null\) or e\.scope_id = s\.id or e\.created_at >= s\.created_at\) \) then return; end if;/)
})

test('migrations: share_outcome refuses any action but share or auto_share, matched to p_automatic', () => {
  const body = compactBody('share_outcome')
  const lock = body.indexOf('for update;')
  const action = body.indexOf("if p_action is null or p_action not in ('share', 'auto_share') then raise exception")
  const automatic = body.indexOf("if p_automatic is distinct from (p_action = 'auto_share') then raise exception")
  assert.ok(action >= 0, 'share_outcome must raise on any other p_action')
  assert.ok(automatic >= 0, 'share_outcome must require p_automatic = (p_action = auto_share)')
  assert.ok(action < lock && automatic < lock, 'argument checks run before anything else')
})

test('migrations: unshare_outcome refuses an unknown target, and a founder decision without its consent action', () => {
  const body = compactBody('unshare_outcome')
  const lock = body.indexOf('for update;')
  const to = body.indexOf("if p_to is null or p_to not in ('private', 'withdrawn', 'not_offered') then raise exception")
  const action = body.indexOf("if (p_action is null) is distinct from (p_to = 'not_offered') then raise exception")
  assert.ok(to >= 0, 'unshare_outcome must raise on a null or unknown p_to')
  assert.ok(action >= 0, 'unshare_outcome: only not_offered may go without p_action')
  assert.ok(to < lock && action < lock, 'argument checks run before anything else')
  assert.match(body, /if p_action is not null then insert into public\.consent_log/)
})

test('migrations: peer_outcomes keeps a day-rounded created_at and drops the draft on review', () => {
  const body = compactBody('peer_outcomes_guard')
  assert.match(body, /returns trigger/)
  assert.match(body, /new\.created_at := date_trunc\('day', coalesce\(new\.created_at, now\(\)\), 'utc'\);/)
  assert.match(body, /if new\.status in \('approved', 'rejected'\) then new\.draft := null; end if;/)
  assert.match(sqlCompact, /create trigger peer_outcomes_guard before insert or update on public\.peer_outcomes for each row execute function public\.peer_outcomes_guard\(\);/)
  // Withdrawing clears the draft as well.
  assert.match(compactBody('unshare_outcome'), /set status = 'withdrawn', draft = null, story = null, lesson = null/)
})

test('migrations: user_settings checks are NOT VALID, so live rows with other values cannot abort the file', () => {
  const adds = sqlCompact.match(/alter table public\.user_settings add constraint [^;]*;/g) ?? []
  assert.ok(adds.length >= 3)
  for (const stmt of adds) assert.match(stmt, /\) not valid;$/, stmt)
  assert.match(sqlCompact, /add constraint user_settings_lock_screen_check check \(lock_screen in \([^)]*\)\) not valid;/)
})

test('migrations: the model_usage_logs constraint swap runs under a lock timeout', () => {
  const file = journey.find((f) => f.name.startsWith('20261101000009'))
  const sql = stripSqlComments(file.sql).replace(/\s+/g, ' ').toLowerCase()
  const set = sql.indexOf("set lock_timeout = '5s';")
  const drop = sql.indexOf('drop constraint if exists model_usage_logs_call_type_check')
  const add = sql.indexOf('add constraint model_usage_logs_call_type_check')
  const reset = sql.indexOf('reset lock_timeout;')
  assert.ok(set >= 0 && set < drop && drop < add && add < reset, 'set lock_timeout before the swap, reset after')
})

test('migrations: the plan records the founder_profiles client read decision', () => {
  const plan = readFileSync(join(SERVER, '..', 'supabase', 'MIGRATION_PLAN.md'), 'utf8')
  assert.match(plan, /founder_profiles client read/)
  assert.match(plan, /grant select on public\.founder_profiles to authenticated/)
  for (const c of ['signup_answers', 'first_reading']) assert.ok(plan.includes(c))
})

// ── Rollback (run by hand; excluded from the "nothing destructive" check) ────

test('rollback: drops only objects the journey files created, and every one of them', () => {
  const raw = readFileSync(ROLLBACK, 'utf8')
  assert.match(raw, /RUN BY HAND ONLY\. DESTRUCTIVE OF NEW DATA ONLY/)
  const sql = stripSqlComments(raw).replace(/\s+/g, ' ').toLowerCase()
  assert.doesNotMatch(sql, /\bcascade\b|delete from|\btruncate\b|\bupdate\b|\binsert\b|\brename\b/, 'drops only')

  const older = all.filter((f) => !f.journey)
  const olderSql = older.map((f) => stripSqlComments(f.sql)).join('\n')
  const olderSchema = schemaOf(older)
  const newTables = new Set(journeyTables)
  const newFunctions = new Set(Object.keys(functionBodies(journeySql)))
  const newColumns = new Set()
  for (const [t, { columns }] of Object.entries(schemaOf(journey))) {
    if (newTables.has(t)) continue
    for (const c of columns) if (!olderSchema[t]?.columns.has(c)) newColumns.add(`${t}.${c}`)
  }
  const constraintsIn = (text) => new Set([...text.matchAll(/add\s+constraint\s+(\w+)/gi)].map((m) => m[1].toLowerCase()))
  const olderConstraints = constraintsIn(olderSql)
  const newConstraints = new Set([...constraintsIn(journeySql)].filter((c) => !olderConstraints.has(c)))

  const statements = sql.split(';').map((x) => x.trim()).filter(Boolean)
  const dropped = { table: new Set(), function: new Set(), column: new Set() }
  for (const stmt of statements) {
    if (stmt === 'begin' || stmt === 'commit') continue
    let m
    if ((m = /^drop table if exists public\.(\w+)$/.exec(stmt))) {
      assert.ok(newTables.has(m[1]), `rollback drops ${m[1]}, not created by 20261101*`)
      dropped.table.add(m[1])
    } else if ((m = /^drop function if exists public\.(\w+)\([^)]*\)$/.exec(stmt))) {
      assert.ok(newFunctions.has(m[1]), `rollback drops function ${m[1]}, not created by 20261101*`)
      dropped.function.add(m[1])
    } else if ((m = /^alter table public\.(\w+) drop column if exists (\w+)$/.exec(stmt))) {
      assert.ok(newColumns.has(`${m[1]}.${m[2]}`), `rollback drops ${m[1]}.${m[2]}, not added by 20261101*`)
      dropped.column.add(`${m[1]}.${m[2]}`)
    } else if ((m = /^alter table public\.(\w+) drop constraint if exists (\w+)$/.exec(stmt))) {
      assert.ok(newConstraints.has(m[2]), `rollback drops constraint ${m[2]}, not created by 20261101*`)
    } else {
      assert.fail(`rollback statement not allowed: ${stmt}`)
    }
  }
  assert.deepEqual([...dropped.table].sort(), [...newTables].sort(), 'rollback must drop every new table')
  assert.deepEqual([...dropped.function].sort(), [...newFunctions].sort(), 'rollback must drop every new function')
  assert.deepEqual([...dropped.column].sort(), [...newColumns].sort(), 'rollback must drop every added column')
  assert.ok(!dropped.column.has('founder_profiles.report_time_local') && !dropped.column.has('founder_profiles.timezone'))
  // Reverse order: a table is dropped before any table it references.
  const order = statements.map((x) => /^drop table if exists public\.(\w+)$/.exec(x)?.[1]).filter(Boolean)
  for (const t of order) {
    const refs = [...(schema[t].body ?? '').matchAll(/references\s+public\.(\w+)/gi)].map((m) => m[1])
    for (const r of refs) if (r !== t && newTables.has(r)) assert.ok(order.indexOf(r) > order.indexOf(t), `${t} must be dropped before ${r}`)
  }
})

// ── 2. Needed keys and checks ────────────────────────────────────────────────

const hasUniqueIndex = (table, columns, where = null) => {
  const head = `create unique index if not exists \\w+ on public\\.${table} \\(${columns.join(', ')}\\)`
  const tail = where ? ` where ${where.replace(/[()]/g, '\\$&')};` : ';'
  return new RegExp(head + tail).test(sqlCompact)
}

test('migrations: situations caps follow-ups at the server limit', () => {
  assert.equal(LIMITS.MAX_FOLLOW_UPS, 2)
  assert.match(schema.situations.body, /follow_up_count\s+integer\s+not\s+null\s+default\s+0[\s\S]*?check\s*\(\s*follow_up_count\s+between\s+0\s+and\s+2\s*\)/i)
  assert.match(functions.take_follow_up ? sqlCompact : '', /follow_up_count < 2/)
})

test('migrations: the unique keys the server relies on exist', () => {
  const KEYS = [
    ['situations', ['user_id', 'create_turn_id'], 'create_turn_id is not null'],
    ['situation_turns', ['situation_id', 'client_turn_id'], 'client_turn_id is not null'],
    ['reads', ['situation_id']],
    ['learn_conversations', ['situation_id']],
    ['learn_turns', ['conversation_id', 'client_turn_id'], 'client_turn_id is not null'],
    ['learn_turns', ['parent_turn_id', 'followup_index'], 'parent_turn_id is not null and followup_index is not null'],
    ['moves', ['user_id', 'active_slot'], 'active_slot is not null'],
    ['moves', ['swapped_from'], 'swapped_from is not null'],
    ['moves', ['learn_id'], 'swapped_from is null'],
    ['reports', ['move_id']],
    ['peer_unlocks', ['granted_by_report_id', 'kind']],
    ['push_tokens', ['token']],
    ['notification_log', ['user_id', 'dedupe_key']],
    ['notification_log', ['user_id', 'local_day', 'slot'], "status in ('sending', 'sent')"],
    ['account_requests', ['user_id', 'kind'], "status = 'queued'"],
  ]
  for (const [table, cols, where] of KEYS) {
    assert.ok(hasUniqueIndex(table, cols, where), `missing unique (${cols.join(', ')}) on ${table}${where ? ` where ${where}` : ''}`)
  }
})

test('migrations: moves hold at most the server limit of active slots, and one swap', () => {
  assert.equal(LIMITS.MAX_ACTIVE_MOVES, 2)
  assert.match(schema.moves.body, /check\s*\(\s*active_slot\s+is\s+null\s+or\s+active_slot\s+in\s*\(\s*1,\s*2\s*\)\s*\)/i)
  assert.match(schema.moves.body, /check\s*\(\s*swap_count\s+between\s+0\s+and\s+1\s*\)/i)
  assert.match(schema.moves.body, /check\s*\(\s*status\s+in\s*\('draft', 'committed', 'report_due', 'reported', 'closed_no_report', 'swapped'\)\s*\)/i)
  assert.match(schema.moves.body, /check\s*\(\s*start_minutes\s+between\s+1\s+and\s+10\s*\)/i)
})

test('migrations: report outcomes are Done, Couldn\'t, Didn\'t only', () => {
  for (const t of ['reports', 'peer_outcomes']) {
    assert.match(schema[t].body, /check\s*\(\s*outcome\s+in\s*\('done', 'couldnt', 'didnt'\)\s*\)/i, t)
  }
})

const checkList = (sql, column) => {
  const m = new RegExp(`check\\s*\\(\\s*${column}\\s+in\\s*\\(([^)]*)\\)`, 'i').exec(sql)
  return m ? m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')) : null
}

test('migrations: CHECK lists match the values the server code uses', () => {
  assert.deepEqual(checkList(schema.notification_log.body, 'kind')?.sort(), [...PUSH_KINDS].sort())
  assert.deepEqual(checkList(schema.notification_log.body, 'slot')?.sort(), ['evening', 'morning'])
  assert.deepEqual(checkList(journeySql, 'lock_screen')?.sort(), [...LOCK_SCREEN_MODES].sort())
  assert.deepEqual(checkList(journeySql, 'mentor_style')?.sort(), [...MENTOR_STYLES].sort())
  const callTypes = checkList(journeySql, 'call_type')
  for (const t of [...USAGE_CALL_TYPES, ...STEPS]) assert.ok(callTypes?.includes(t), `call_type check lacks ${t}`)
  assert.match(sqlCompact, /check \(call_type in \([^)]*\)\) not valid;/, 'call_type check must stay NOT VALID')
})

test('migrations: user_settings columns all have defaults (rows are inserted with one column)', () => {
  const adds = journeySql.match(/alter\s+table\s+public\.user_settings\s+add\s+column[^;]*;/gi) ?? []
  assert.ok(adds.length >= 9)
  for (const stmt of adds) {
    if (/\bnot\s+null\b/i.test(stmt)) assert.match(stmt, /\bdefault\b/i, stmt)
  }
})

// ── 3. Cross-check: server code against the migrations ───────────────────────

const SCANNED_DIRS = ['journey', 'care', 'push']

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : sourceFiles(path)
    return name.endsWith('.js') && !name.endsWith('.test.js') ? [path] : []
  })
}

const sources = SCANNED_DIRS.flatMap((d) => sourceFiles(join(SERVER, d)))
  .map((path) => ({ path: relative(SERVER, path), src: readFileSync(path, 'utf8') }))

// Where a supabase-js chain that starts at `start` ends.
function chainEnd(src, start) {
  let depth = 0
  for (let i = start; i < src.length; i++) {
    const c = src[i]
    if (c === "'" || c === '"' || c === '`') { i = skipString(src, i); continue }
    if ('([{'.includes(c)) depth++
    else if (')]}'.includes(c)) { if (depth === 0) return i; depth-- }
    else if (depth === 0 && (c === ',' || c === ';')) return i
    else if (depth === 0 && c === '\n') {
      const rest = src.slice(i).match(/^\s*(\S)/)
      if (!rest || rest[1] !== '.') return i
    }
  }
  return src.length
}

// Top-level `.name(args)` calls of a chain.
function callsOf(chain) {
  const calls = []
  const re = /\.\s*(\w+)\s*\(/g
  let depth = 0
  for (let i = 0; i < chain.length; i++) {
    const c = chain[i]
    if (c === "'" || c === '"' || c === '`') { i = skipString(chain, i); continue }
    if (depth === 0 && c === '.') {
      re.lastIndex = i
      const m = re.exec(chain)
      if (m && m.index === i) {
        const open = i + m[0].length - 1
        const close = closing(chain, open)
        calls.push({ name: m[1], args: chain.slice(open + 1, close) })
        i = close
        continue
      }
    }
    if ('([{'.includes(c)) depth++
    else if (')]}'.includes(c)) depth--
  }
  return calls
}

const literal = (arg) => /^\s*'([^']*)'\s*$/.exec(arg ?? '')?.[1] ?? null

// The text of `const name = ...` nearest before `pos` (or exported anywhere).
function definitionOf(name, src, pos) {
  const re = new RegExp(`(?:const|let)\\s+${name}\\s*=\\s*`, 'g')
  let best = null
  let m
  while ((m = re.exec(src))) if (m.index < pos || best === null) best = m.index + m[0].length
  if (best !== null) return { src, at: best }
  for (const other of sources) {
    const e = new RegExp(`export\\s+const\\s+${name}\\s*=\\s*`).exec(other.src)
    if (e) return { src: other.src, at: e.index + e[0].length }
  }
  return null
}

// Keys of the object an expression evaluates to, where they can be read.
// ctx: { src, pos, seen, bindings } (bindings: helper parameter -> argument text).
function keysOfExpression(expr, ctx) {
  const text = expr.trim()
  if (text.startsWith('{')) return keysOfObject(text, ctx)
  const freeze = /^Object\.freeze\(\s*\{/.exec(text)
  if (freeze) return keysOfObject(text.slice(freeze[0].length - 1), ctx)
  const mapped = /^[\w.]+\.map\(\s*\(?[\w\s,{}]*\)?\s*=>\s*\(\s*\{/.exec(text)
  if (mapped) return keysOfObject(text.slice(mapped[0].length - 1), ctx)
  const call = /^(\w+)\s*\(/.exec(text)
  if (call) {
    const args = splitTop(text.slice(call[0].length, closing(text, call[0].length - 1)))
    return keysOfHelper(call[1], args, ctx)
  }
  if (/^\w+$/.test(text)) {
    if (ctx.bindings?.[text]) return keysOfExpression(ctx.bindings[text], { ...ctx, bindings: ctx.outer })
    return keysOfConstant(text, ctx)
  }
  return [...text.matchAll(/\{/g)].flatMap((b) => keysOfObject(text.slice(b.index), ctx))
}

// `const name = { ... }` (or Object.freeze): its keys.
function keysOfConstant(name, ctx) {
  if (ctx.seen.has(name)) return []
  const def = definitionOf(name, ctx.src, ctx.pos)
  if (!def) return []
  const end = closing(def.src, def.at)
  return keysOfExpression(def.src.slice(def.at, end < 0 ? def.at : end + 1),
    { src: def.src, pos: def.at, seen: new Set([...ctx.seen, name]), bindings: null })
}

// `const helper = (params) => ({ ... })`: the keys of the row it returns,
// with a spread parameter resolved to the argument it was called with.
function keysOfHelper(name, args, ctx) {
  if (ctx.seen.has(name)) return []
  const def = definitionOf(name, ctx.src, ctx.pos)
  if (!def) return []
  const head = def.src.slice(def.at, def.at + 400)
  const arrow = /=>\s*\(\s*\{/.exec(head)
  if (!arrow) return []
  const params = head.startsWith('(') ? splitTop(head.slice(1, closing(head, 0))) : []
  const bindings = {}
  params.forEach((p, i) => { if (/^\w+$/.test(p) && args[i]) bindings[p] = args[i] })
  return keysOfObject(def.src.slice(def.at + arrow.index + arrow[0].length - 1),
    { src: def.src, pos: def.at, seen: new Set([...ctx.seen, name]), bindings, outer: ctx.bindings })
}

function keysOfObject(text, ctx) {
  const close = closing(text, 0)
  if (close < 0) return []
  const keys = []
  for (const part of splitTop(text.slice(1, close))) {
    if (part.startsWith('...')) { keys.push(...keysOfExpression(part.slice(3).replace(/^\(|\)$/g, ''), ctx)); continue }
    const named = /^['"]?([A-Za-z_]\w*)['"]?\s*:/.exec(part)
    if (named) keys.push(named[1])
    else if (/^[A-Za-z_]\w*$/.test(part)) keys.push(part)
  }
  return keys
}

const FILTERS = new Set(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'is', 'like', 'ilike', 'contains', 'order', 'not'])
const WRITES = new Set(['insert', 'update', 'upsert'])

function columnsOfCalls(calls, src, pos) {
  const cols = []
  for (const { name, args } of calls) {
    const [first, second] = splitTop(args)
    if (FILTERS.has(name)) { const c = literal(first); if (c) cols.push(c) }
    if (name === 'select') {
      for (const piece of (literal(first) ?? '').split(',')) {
        const col = piece.trim().split(':').pop().trim()
        if (col && col !== '*' && !col.includes('(')) cols.push(col)
      }
    }
    if (WRITES.has(name) && first) cols.push(...keysOfExpression(first, { src, pos, seen: new Set(), bindings: null }))
    const conflict = /onConflict:\s*'([^']*)'/.exec(second ?? '')
    if (conflict) cols.push(...conflict[1].split(',').map((s) => s.trim()))
  }
  return cols
}

// [{ file, table, column }] for every literal .from('table') chain.
function usedColumns() {
  const used = []
  for (const { path, src } of sources) {
    const re = /\.from\(\s*'(\w+)'\s*\)/g
    let m
    while ((m = re.exec(src))) {
      const start = m.index + m[0].length
      const chain = src.slice(start, chainEnd(src, start))
      const cols = columnsOfCalls(callsOf(chain), src, m.index)
      // A chain kept in a variable and filtered later: `const q = supabase.from(..)`.
      const bound = /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?[\w.]+$/.exec(src.slice(Math.max(0, m.index - 80), m.index))
      if (bound) {
        const later = src.slice(start, start + 1500)
        const more = new RegExp(`\\b${bound[1]}((?:\\s*\\.\\s*\\w+\\([^()]*(?:\\([^()]*\\)[^()]*)*\\))+)`, 'g')
        for (const x of later.matchAll(more)) cols.push(...columnsOfCalls(callsOf(x[1]), src, m.index))
      }
      for (const column of cols) used.push({ file: path, table: m[1], column })
    }
  }
  return used
}

// Writes the scan cannot follow (the table name or the fields are built at run
// time). Listed by hand from push/settings.js saveOwnRow, journey/signup.js and
// journey/report/sharing.js.
const DYNAMIC_WRITES = {
  user_settings: ['user_id', 'morning_on', 'evening_on', 'lock_screen', 'quiet_start', 'quiet_end', 'updated_at', 'share_auto', 'mentor_style', 'keep_items', 'last_greeting'],
  founder_profiles: ['user_id', 'report_time_local', 'updated_at', 'signup_answers', 'stage', 'business_model', 'country', 'goal', 'deadline', 'timezone'],
  // journey/report/sharing.js peerOf, written by share_outcome or shareDb.js publish.
  peer_outcomes: ['status', 'stage', 'customer_market', 'business_model', 'outcome', 'draft', 'story', 'lesson', 'reviewed_by', 'reviewed_at'],
}

test('cross-check: the scan finds the server\'s database calls', () => {
  const used = usedColumns()
  const tables = new Set(used.map((u) => u.table))
  for (const t of EXPECTED_NEW_TABLES) assert.ok(tables.has(t), `no server code reads or writes ${t}: is the scan broken?`)
  // A few columns that only appear inside insert payloads or helpers.
  const seen = new Set(used.map((u) => `${u.table}.${u.column}`))
  for (const c of ['moves.success_condition', 'moves.hypothesis', 'consent_log.wording_version', 'learn_turns.evidence',
    'lesson_citations.book_title', 'notification_log.dedupe_key', 'peer_outcomes.withdrawn_at', 'push_tokens.platform',
    'reports.consent_wording_version', 'care_events.scope_id', 'learn_conversations.move_subject']) {
    assert.ok(seen.has(c), `the scan missed ${c}`)
  }
})

test('cross-check: every table and column the new server code uses exists in the migrations', () => {
  const missing = []
  const used = [
    ...usedColumns(),
    ...Object.entries(DYNAMIC_WRITES).flatMap(([table, cols]) => cols.map((column) => ({ file: '(dynamic)', table, column }))),
  ]
  for (const { file, table, column } of used) {
    if (!schema[table]) missing.push(`${file}: table ${table}`)
    else if (!schema[table].columns.has(column)) missing.push(`${file}: ${table}.${column}`)
  }
  assert.deepEqual([...new Set(missing)], [])
})

test('cross-check: every SQL function the server calls exists with the same parameter names', () => {
  const calls = []
  for (const { path, src } of sources) {
    const re = /(?:\bsupabase\.rpc|\bviaFunction)\(\s*'(\w+)'\s*,\s*\{/g
    let m
    while ((m = re.exec(src))) {
      const obj = src.slice(m.index + m[0].length - 1)
      calls.push({ path, name: m[1], params: keysOfObject(obj, { src, pos: m.index, seen: new Set(), bindings: null }) })
    }
  }
  const names = calls.map((c) => c.name)
  for (const n of ['share_outcome', 'unshare_outcome']) assert.ok(names.includes(n), `server no longer calls ${n}: update this test`)
  for (const { path, name, params } of calls) {
    assert.ok(functions[name], `${path}: function ${name} is not in the migrations`)
    assert.deepEqual([...params].sort(), [...functions[name]].sort(), `${path}: ${name} parameters`)
  }
})

test('cross-check: every new table is used by the server or documented in the plan', () => {
  const plan = readFileSync(join(SERVER, '..', 'supabase', 'MIGRATION_PLAN.md'), 'utf8')
  for (const t of journeyTables) assert.ok(plan.includes(`\`${t}\``), `${t} is not described in MIGRATION_PLAN.md`)
  for (const f of journey) assert.ok(plan.includes(f.name), `${f.name} is not in MIGRATION_PLAN.md`)
  assert.ok(journeyRaw.length > 0)
})
