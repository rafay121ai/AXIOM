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

export function createFakePushSender() {
  const sent = []
  return {
    sent,
    async send(message) {
      sent.push(message)
      return { ok: true }
    },
  }
}

// In-memory Supabase. Supports the chain the server uses:
// from(t).select/insert/update/upsert/delete + eq/neq/gt/gte/lt/lte/in/is,
// order, limit, maybeSingle, single; awaiting the chain returns { data, error }.
// `.or(...)` is not interpreted and is recorded as-is. auth.getUser(token)
// resolves tokens registered with addUser.
export function createFakeSupabase({ tables = {}, users = {}, idFactory = randomUUID } = {}) {
  const store = new Map(Object.entries(tables).map(([name, rows]) => [name, rows.map((r) => ({ ...r }))]))
  const tokens = new Map(Object.entries(users))
  const rowsOf = (name) => {
    if (!store.has(name)) store.set(name, [])
    return store.get(name)
  }

  function builder(table) {
    let action = 'select'
    let payload = null
    const filters = []
    let orderBy = []
    let max = Infinity
    let single = null

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
        case 'is': return v === val
        default: return true
      }
    })

    function run() {
      const rows = rowsOf(table)
      if (action === 'insert' || action === 'upsert') {
        const inserted = [].concat(payload).map((r) => ({ id: idFactory(), ...r }))
        rows.push(...inserted)
        return inserted
      }
      const hit = rows.filter(matches)
      if (action === 'update') {
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
        for (const [col, asc] of [...orderBy].reverse()) {
          data = [...data].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (asc ? 1 : -1))
        }
        data = data.slice(0, max).map((r) => ({ ...r }))
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
    for (const op of ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'is']) {
      api[op] = (col, val) => { filters.push([op, col, val]); return api }
    }
    return api
  }

  return {
    from: builder,
    rows: (table) => rowsOf(table).map((r) => ({ ...r })),
    addUser(token, user) { tokens.set(token, user) },
    auth: {
      async getUser(token) {
        const user = tokens.get(token)
        return user ? { data: { user }, error: null } : { data: { user: null }, error: { message: 'invalid token' } }
      },
    },
  }
}
