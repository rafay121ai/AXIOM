// Test doubles. No network, no env. Each fake records what it was asked.
import { randomUUID } from 'node:crypto'

// Scripted OpenAI: pass replies in order. A reply is a string (message
// content), an Error (thrown), or { content, usage }.
export function createFakeOpenAI(script = []) {
  const queue = [...script]
  const calls = []
  return {
    calls,
    chat: {
      completions: {
        async create(payload, options) {
          calls.push({ payload, options })
          if (queue.length === 0) throw new Error('FakeOpenAI: script exhausted')
          const next = queue.shift()
          if (next instanceof Error) throw next
          const { content, usage } = typeof next === 'string' ? { content: next } : next
          return {
            id: `fake-${calls.length}`,
            model: payload.model,
            choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
            usage: usage || { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          }
        },
      },
    },
    embeddings: {
      async create(payload) {
        calls.push({ payload })
        return { data: [{ embedding: [0, 0, 0] }], usage: { prompt_tokens: 1, total_tokens: 1 } }
      },
    },
  }
}

export function createFakeClock(startMs = Date.parse('2026-10-26T09:00:00.000Z')) {
  let current = startMs
  return {
    now: () => current,
    advance(ms) { current += ms },
    set(ms) { current = ms },
  }
}

// Never reaches Expo. respond(message) => result (or throws); default ok.
// `sent` records every message the sender was asked to send.
export function createFakePushSender({ respond = () => ({ ok: true }) } = {}) {
  const sent = []
  return {
    sent,
    async send(message) {
      sent.push(message)
      return respond(message)
    },
  }
}

// In-memory Supabase. Supports the chain the server uses:
// from(t).select/insert/update/upsert/delete + eq/neq/gt/gte/lt/lte/in/is/not/ilike,
// order, limit, maybeSingle, single; awaiting the chain returns { data, error }.
// `.or(...)` is not interpreted and is recorded as-is. auth.getUser(token)
// resolves tokens registered with addUser.
// unique: { table: [{ cols: [...], where?: (row) => bool }] }, the database's
// unique (and partial unique) indexes; an insert or update that breaks one
// changes nothing and returns error 23505, as Postgres does. Upsert is not
// checked. maxRows: the most rows any one response holds (PostgREST max-rows).
export function createFakeSupabase({ tables = {}, users = {}, idFactory = randomUUID, unique = {}, maxRows = Infinity } = {}) {
  const store = new Map(Object.entries(tables).map(([name, rows]) => [name, rows.map((r) => ({ ...r }))]))
  const tokens = new Map(Object.entries(users))
  const deletedUsers = []
  const bannedUsers = []
  const rowsOf = (name) => {
    if (!store.has(name)) store.set(name, [])
    return store.get(name)
  }
  // Whether these rows, as the whole table, break a unique index of `table`.
  const breaksUnique = (table, rows) => (unique[table] ?? []).some(({ cols, where = () => true }) => {
    const seen = new Set()
    for (const r of rows.filter(where)) {
      const key = JSON.stringify(cols.map((c) => r[c] ?? null))
      if (cols.some((c) => r[c] === null || r[c] === undefined)) continue
      if (seen.has(key)) return true
      seen.add(key)
    }
    return false
  })
  const duplicate = { code: '23505', message: 'duplicate key value violates unique constraint' }
  // SQL ILIKE with backslash escapes; PostgREST also reads `*` as `%`.
  const likeRx = (pattern) => {
    let rx = ''
    const p = String(pattern)
    for (let i = 0; i < p.length; i += 1) {
      const c = p[i]
      if (c === '\\' && i + 1 < p.length) rx += p[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      else if (c === '%' || c === '*') rx += '[\\s\\S]*'
      else if (c === '_') rx += '[\\s\\S]'
      else rx += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }
    return new RegExp(`^${rx}$`, 'i')
  }

  function builder(table) {
    let action = 'select'
    let payload = null
    const filters = []
    let orderBy = []
    let max = Infinity
    let single = null

    // .not(col, operator, value): the operators the server uses with it.
    const negated = (v, { operator, value }) => {
      if (operator === 'in') return String(value).replace(/^\(|\)$/g, '').split(',').includes(String(v))
      if (operator === 'eq') return v === value
      if (operator === 'is') return v === value
      throw new Error(`FakeSupabase: .not(..., '${operator}', ...) is not supported`)
    }

    const matches = (row) => filters.every(([op, col, val]) => {
      const v = row[col]
      switch (op) {
        case 'eq': return v === val
        case 'neq': return v !== val
        case 'gt': return v > val
        case 'gte': return v >= val
        case 'lt': return v < val
        case 'lte': return v <= val
        case 'in': return val.includes(v)
        case 'is': return val === null ? v == null : v === val
        case 'not': return !negated(v, val)
        case 'ilike': return typeof v === 'string' && likeRx(val).test(v)
        default: return true
      }
    })

    function run() {
      const rows = rowsOf(table)
      if (action === 'insert' || action === 'upsert') {
        // Column defaults the database fills in.
        const defaults = table === 'situations' ? { started_by: 'founder', trigger_key: null } : {}
        const inserted = [].concat(payload).map((r) => ({ id: idFactory(), ...defaults, ...r }))
        if (action === 'insert' && breaksUnique(table, [...rows, ...inserted])) return { error: duplicate }
        rows.push(...inserted)
        return inserted
      }
      const hit = rows.filter(matches)
      if (action === 'update') {
        if (breaksUnique(table, rows.map((r) => (hit.includes(r) ? { ...r, ...payload } : r)))) return { error: duplicate }
        hit.forEach((r) => Object.assign(r, payload))
        return hit
      }
      if (action === 'delete') {
        store.set(table, rows.filter((r) => !hit.includes(r)))
        return hit
      }
      return hit
    }

    const api = {
      select() { return api },
      insert(p) { action = 'insert'; payload = p; return api },
      upsert(p) { action = 'upsert'; payload = p; return api },
      update(p) { action = 'update'; payload = p; return api },
      delete() { action = 'delete'; return api },
      or(expr) { filters.push(['or', null, expr]); return api },
      order(col, { ascending = true } = {}) { orderBy.push([col, ascending]); return api },
      limit(n) { max = n; return api },
      maybeSingle() { single = 'maybe'; return api },
      single() { single = 'one'; return api },
      then(resolve, reject) {
        let data = run()
        if (data.error) return Promise.resolve({ data: null, error: data.error }).then(resolve, reject)
        for (const [col, asc] of [...orderBy].reverse()) {
          data = [...data].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (asc ? 1 : -1))
        }
        data = data.slice(0, Math.min(max, maxRows)).map((r) => ({ ...r }))
        let result
        if (single === 'maybe') result = { data: data[0] ?? null, error: null }
        else if (single === 'one') {
          result = data.length === 1
            ? { data: data[0], error: null }
            : { data: null, error: { code: 'PGRST116', message: 'Expected one row' } }
        } else result = { data, error: null }
        return Promise.resolve(result).then(resolve, reject)
      },
    }
    api.not = (col, operator, value) => { filters.push(['not', col, { operator, value }]); return api }
    for (const op of ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'is', 'ilike']) {
      api[op] = (col, val) => { filters.push([op, col, val]); return api }
    }
    return api
  }

  return {
    from: builder,
    rows: (table) => rowsOf(table).map((r) => ({ ...r })),
    deletedUsers,
    bannedUsers,
    tableNames: () => [...store.keys()],
    addUser(token, user) { tokens.set(token, user) },
    auth: {
      // Removes the sign-in account (the Supabase admin API); a missing one is a 404 error.
      admin: {
        // Records bans (ban_duration) so a test can check who was locked out.
        async updateUserById(id, attrs) {
          if (![...tokens.values()].some((u) => u.id === id)) return { error: { status: 404, message: 'User not found' } }
          if (attrs?.ban_duration) bannedUsers.push(id)
          return { error: null }
        },
        async deleteUser(id) {
          const token = [...tokens].find(([, u]) => u.id === id)?.[0]
          if (token === undefined && !deletedUsers.includes(id)) return { error: { status: 404, message: 'User not found' } }
          if (token !== undefined) { tokens.delete(token); deletedUsers.push(id) }
          return { error: null }
        },
      },
      async getUser(token) {
        const user = tokens.get(token)
        return user ? { data: { user }, error: null } : { data: { user: null }, error: { message: 'invalid token' } }
      },
    },
  }
}
