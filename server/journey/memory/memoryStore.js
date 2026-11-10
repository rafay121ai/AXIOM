// All access to the eight memory tables, always scoped to one founder. Plain
// data in and out; throws only on a real database error. Never deletes: what
// is wrong or old is marked superseded, so the receipt stays.
import { isTraitValue, MAX_ACTIVE_BELIEFS, MAX_FAILED_RUNS } from './beliefRules.js'

const CAS_TRIES = 3
const DUPLICATE = '23505'
// The most receipts read for the brief. Newest first, so only the oldest drop off a very long history.
const EVIDENCE_READ_LIMIT = 1000

export function createMemoryStore({ supabase, clock = { now: () => Date.now() }, log = () => {} }) {
  const iso = () => new Date(clock.now()).toISOString()
  const ok = ({ data, error }) => {
    if (error) throw error
    return data ?? []
  }
  const q = (table, userId) => supabase.from(table).select('*').eq('user_id', userId)
  const one = async (table, userId, id) => ok(await q(table, userId).eq('id', id).limit(1))[0] ?? null
  const insert = async (table, row) => {
    const { data, error } = await supabase.from(table).insert({ created_at: iso(), updated_at: iso(), ...row }).select().single()
    if (error) throw error
    return data
  }
  const patch = async (table, userId, id, fields) => ok(await supabase.from(table).update({ updated_at: iso(), ...fields }).eq('user_id', userId).eq('id', id).select())[0] ?? null
  const active = async (table, userId, order = 'created_at') => ok(await q(table, userId).eq('status', 'active').order(order, { ascending: false }))

  // Compare-and-swap on updated_at: a second writer makes this one re-read and
  // try again, three times, then skip (null). change: fields, or (row) => fields.
  // touch: false keeps updated_at (the 90-day decay must not reset its own clock).
  async function swap(table, userId, id, change, touch) {
    for (let i = 0; i < CAS_TRIES; i += 1) {
      const row = await one(table, userId, id)
      if (!row || row.status !== 'active') return null
      const fields = typeof change === 'function' ? change(row) : change
      const stamp = touch ? { updated_at: iso() } : {}
      const hit = ok(await supabase.from(table).update({ ...fields, ...stamp }).eq('user_id', userId).eq('id', id).eq('updated_at', row.updated_at).select())
      if (hit.length > 0) return hit[0]
    }
    log('memory update skipped after 3 tries', table)
    return null
  }

  // Select, then insert or update: upsert cannot target the lower() partial indexes.
  async function bump(table, userId, key, text, onNew, onSeen) {
    const value = String(text ?? '').trim()
    if (!value) return null
    for (let i = 0; i < 2; i += 1) {
      const seen = (await active(table, userId)).find((r) => r[key].toLowerCase() === value.toLowerCase())
      if (seen) return patch(table, userId, seen.id, onSeen(seen))
      try {
        return await insert(table, { user_id: userId, [key]: value, ...onNew })
      } catch (err) {
        if (err.code !== DUPLICATE) throw err // lost a race: read again and bump instead
      }
    }
    return null
  }

  return {
    activeBeliefs: (userId) => active('founder_beliefs', userId),

    // At the 50-active cap the weakest belief is superseded to make room.
    async insertBelief({ userId, belief, kind, confidence, source }) {
      const current = await active('founder_beliefs', userId)
      if (current.length >= MAX_ACTIVE_BELIEFS) {
        const weakest = current.reduce((a, b) => (b.confidence < a.confidence ? b : a))
        await patch('founder_beliefs', userId, weakest.id, { status: 'superseded' })
      }
      return insert('founder_beliefs', { user_id: userId, belief, kind, confidence, source, status: 'active' })
    },

    updateBelief: (userId, id, change, { touch = true } = {}) => swap('founder_beliefs', userId, id, change, touch),

    // A contradicted fact points to the fact that replaced it. Both rows must be
    // this founder's and the old one an active fact: a link across founders would block account deletion.
    async supersedeBelief(userId, oldId, newId) {
      const [old, next] = await Promise.all([one('founder_beliefs', userId, oldId), one('founder_beliefs', userId, newId)])
      if (!old || !next || old.id === next.id || old.kind !== 'fact' || old.status !== 'active') return false
      return (await patch('founder_beliefs', userId, oldId, { status: 'superseded', superseded_by: newId })) !== null
    },

    activeTraits: (userId) => active('founder_traits', userId),

    // One active row per dimension: a different value supersedes the old row. A lost
    // race on the unique index (23505) re-reads and updates instead of failing.
    async upsertTrait({ userId, dimension, value, confidence, origin }) {
      if (!isTraitValue(dimension, value)) return null
      for (let i = 0; i < 2; i += 1) {
        const old = (await active('founder_traits', userId)).find((t) => t.dimension === dimension)
        if (old?.value === value) return patch('founder_traits', userId, old.id, { confidence, origin })
        if (old) await patch('founder_traits', userId, old.id, { status: 'superseded' })
        try {
          const row = await insert('founder_traits', { user_id: userId, dimension, value, confidence, origin, status: 'active' })
          if (old) await patch('founder_traits', userId, old.id, { superseded_by: row.id })
          return row
        } catch (err) {
          if (old) await patch('founder_traits', userId, old.id, { status: 'active' }).catch(() => {}) // the old trait stays until a new one is stored
          if (err.code !== DUPLICATE) throw err
        }
      }
      return null
    },

    activeWorld: (userId) => active('founder_world', userId, 'last_mentioned_at'),
    upsertWorld: ({ userId, name, kind, role = null }) => bump('founder_world', userId, 'name', String(name ?? '').trim().slice(0, 80),
      { kind, role, mention_count: 1, last_mentioned_at: iso(), status: 'active' },
      (w) => ({ mention_count: w.mention_count + 1, last_mentioned_at: iso(), ...(role && !w.role ? { role } : {}) })),

    activeVocabulary: (userId) => active('founder_vocabulary', userId),
    upsertVocabulary: ({ userId, term, meaning, confidence }) => bump('founder_vocabulary', userId, 'term', String(term ?? '').trim().slice(0, 60),
      { meaning, confidence, mention_count: 1, status: 'active' },
      (v) => ({ mention_count: v.mention_count + 1 })),

    async openThreads(userId) {
      return ok(await q('founder_threads', userId).eq('status', 'open').order('updated_at', { ascending: false }))
    },
    insertThread: ({ userId, title, kind }) => insert('founder_threads', { user_id: userId, title, kind, status: 'open' }),

    // rows: [{ userId, itemTable, itemId, sourceKind, sourceId?, sourceKey?, snippet }]
    async addEvidence(rows) {
      if (rows.length === 0) return []
      return ok(await supabase.from('memory_evidence').insert(rows.map((r) => ({
        user_id: r.userId, item_table: r.itemTable, item_id: r.itemId, source_kind: r.sourceKind,
        source_id: r.sourceId ?? null, source_key: r.sourceKey ?? null, snippet: String(r.snippet).slice(0, 200), created_at: iso(),
      }))).select())
    },
    // { [itemId]: { rows, sources } }: how many receipts, from how many different sources,
    // for the items of one table. Only the three columns it needs, bounded.
    async evidenceCounts(userId, itemTable) {
      const by = {}
      const rows = ok(await supabase.from('memory_evidence').select('item_id, source_id, source_key')
        .eq('user_id', userId).eq('item_table', itemTable).order('created_at', { ascending: false }).limit(EVIDENCE_READ_LIMIT))
      for (const e of rows) {
        const c = (by[e.item_id] ??= { rows: 0, ids: new Set() })
        c.rows += 1
        c.ids.add(e.source_id ?? e.source_key)
      }
      return Object.fromEntries(Object.entries(by).map(([id, c]) => [id, { rows: c.rows, sources: c.ids.size }]))
    },

    // null when this source and mode already has a done or skipped run.
    async recordRun({ userId, sourceKind, sourceId, mode, status, model = null }) {
      const { data, error } = await supabase.from('memory_runs').insert({ user_id: userId, source_kind: sourceKind, source_id: sourceId, mode, status, model, created_at: iso() }).select().single()
      if (error?.code === DUPLICATE) return null
      if (error) throw error
      return data
    },
    // True when this source and mode is done or skipped, or has already failed MAX_FAILED_RUNS times.
    async hasRun(userId, sourceKind, sourceId, mode) {
      const rows = ok(await q('memory_runs', userId).eq('source_kind', sourceKind).eq('source_id', sourceId).eq('mode', mode).limit(MAX_FAILED_RUNS + 3))
      return rows.some((r) => r.status !== 'failed') || rows.length >= MAX_FAILED_RUNS
    },

    corrections: async (userId) => ok(await q('founder_corrections', userId)),
  }
}
