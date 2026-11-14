// Memory extraction after a report (mode 'full') or when a situation ends with
// no report (mode 'facts_only'). One cheap model call proposes; this file
// decides. Every item is checked in code against the founder's own words, and
// the whole output is checked before anything is written (applyExtraction
// plans first, writes second), so one bad item never discards the good ones.
// A failed model call or an unusable output writes nothing and records the run
// as failed; it is tried again only when the same source triggers again (and
// not after MAX_FAILED_RUNS failures). Once the run is claimed as done, each
// item is written on its own: a database error skips that item, never the pass
// and never an earlier write twice. Confidence arithmetic lives in
// beliefRules.js. Never throws (memory plan, Revision 2).
import { isFillerReply, stripFiller } from '../filler.js'
import { norm, wordRx } from '../ownWords.js'
import { createSharing } from '../report/sharing.js'
import {
  LIMITS, MAX_NEW_PER_RUN, NEW_FACT_CONFIDENCE, NEW_PATTERN_CONFIDENCE, checkBeliefText, cleanStoredText, decayFact, isBlocked, isTraitValue,
  reinforce, snippetInSource, weaken,
} from './beliefRules.js'
import { createMemoryStore } from './memoryStore.js'
import { BELIEFS_SCHEMA, FACTS_ONLY_SCHEMA, beliefsMessages } from './prompts/beliefs.js'

const MAX_NEW_THREADS = 2
const VOCAB_CONFIDENCE = 0.5

const squash = (t) => norm(t).replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
// A reworded belief is the same belief: most of the content words (crudely stemmed) of the shorter text are in the other.
const FUNCTION_WORDS = new Set(['a', 'an', 'the', 'is', 'are', 'to', 'of', 'in', 'on', 'at', 'and', 'or', 'they', 'them', 'their', 'says', 'say', 'wants', 'want', 'with', 'for', 'when', 'that', 'it'])
const contentWords = (s) => new Set(s.split(' ').filter((w) => w && !FUNCTION_WORDS.has(w)).map((w) => w.replace(/(es|s)$/, '')))
const rewordedFrom = (a, b) => {
  const [x, y] = [contentWords(a), contentWords(b)].sort((p, q) => p.size - q.size)
  return x.size >= 3 && [...x].filter((w) => y.has(w)).length / x.size >= 0.8
}
// True when the founder marked this item wrong or outdated. Compared only inside the same table (a trait is "dimension value").
// Names, terms and traits match as a whole; "outdated" blocks only the same text, so the updated fact can still be learned;
// "wrong" on a belief or thread also blocks a rewording.
export const isCorrected = (corrections, table, text) => {
  const s = squash(text)
  return s.length > 0 && corrections.some((c) => {
    if (c.item_table !== table) return false
    const old = squash(c.item_text)
    if (s === old) return true
    return c.reason === 'wrong' && (table === 'founder_beliefs' || table === 'founder_threads') && rewordedFrom(s, old)
  })
}
const typedBy = (text, sources) => sources.some((s) => wordRx(norm(text)).test(norm(s)))

// ── Running in the background ───────────────────────────────────────────────

// The founder's response never waits for memory. Production ignores the
// returned promise; tests and the e2e harness await it (memoryIdle).
const memoryPending = new Set()
export function scheduleMemory(job, log = () => {}) {
  const p = Promise.resolve().then(job).catch((err) => log('memory job failed', err)).finally(() => memoryPending.delete(p))
  memoryPending.add(p)
  return p
}
export async function memoryIdle() {
  while (memoryPending.size > 0) await Promise.allSettled([...memoryPending])
}


// Quietly false when the lookup fails: the cap must never break memory, only stop a paid call.
export const overCap = async (isCapped, userId) => {
  try {
    return Boolean(await isCapped(userId))
  } catch {
    return false
  }
}

// ── Check and write what the model proposed ─────────────────────────────────

const rows = (x) => (Array.isArray(x) ? x.filter((i) => i && typeof i === 'object') : [])

// data: the model's output. founderTexts: what the founder wrote. moveTexts:
// the move record (receipts for behaviour only, never names). receipt(snippet):
// where the snippet came from, { sourceKind, sourceId?, sourceKey? }. cap: the
// most a new belief may start at (the sign-up pass uses the self-report cap).
// claim(): called once, after everything is checked and before the first write;
// false (the run was already recorded by someone else) writes nothing.
// Returns counts of what was written, or null when the claim was refused.
export async function applyExtraction({ store, userId, data, mode, founderTexts, moveTexts = [], moveId = null, receipt, beliefSource, nowMs, corrections = [], cap = 1, claim = null, log = () => {} }) {
  const full = mode === 'full'
  const sourcesFor = (kind) => (kind === 'fact' ? founderTexts : [...founderTexts, ...moveTexts])
  const corrected = (table, text) => isCorrected(corrections, table, text)
  // The cleaned snippet, or null: words the founder wrote, short enough for the database, nothing blocked.
  const snippetOf = (raw, sources) => {
    const snippet = cleanStoredText(raw)
    const [min, max] = LIMITS.snippet
    const ok = typeof raw === 'string' && snippet.length >= min && snippet.length <= max && !isFillerReply(snippet, { minWords: 2 })
      && stripFiller(snippet).text !== '' && snippetInSource(snippet, sources) && !isBlocked(snippet)
    return ok ? snippet : null
  }
  // The cleaned text to store, or null. Names must be the founder's own words, never Axiom's.
  const textOf = (field, raw, sources) => {
    if (typeof raw !== 'string') return null
    const checked = checkBeliefText({ text: raw, sourceTexts: sources, ownTexts: founderTexts, field })
    return checked.ok ? checked.text : null
  }

  // Reads first: a failed read throws here, before anything is written.
  const beliefs = await store.activeBeliefs(userId)
  const byId = new Map(beliefs.map((b) => [b.id, b]))
  const counts = { ...(await store.evidenceCounts(userId, 'founder_beliefs')), ...(await store.evidenceCounts(userId, 'founder_traits')) }
  const traits = full ? await store.activeTraits(userId) : []
  const open = new Set((await store.openThreads(userId)).map((t) => squash(t.title)))

  // Checking is pure: it decides what to write and changes nothing. `ops` are the writes, in order.
  const ops = []
  const touched = new Set()
  const taken = new Set(beliefs.map((b) => squash(b.belief)))
  const done = { beliefs: 0, traits: 0, world: 0, vocabulary: 0, threads: 0 }
  let created = 0
  // A snippet only in the move record is the move's, not the founder's words.
  const proof = (itemTable, itemId, snippet) => store.addEvidence([{
    userId, itemTable, itemId, snippet,
    ...(moveId && !snippetInSource(snippet, founderTexts) ? { sourceKind: 'move', sourceId: moveId } : receipt(snippet)),
  }])

  // A row the model may touch: this founder's, active, and a fact when facts only.
  const usable = (id) => {
    const row = byId.get(id)
    return row && row.status === 'active' && !touched.has(row.id) && (full || row.kind === 'fact') ? row : null
  }
  // A new belief that passed every check, as a function that writes it (null when it did not pass).
  const planBelief = ({ belief, kind, snippet: rawSnippet }) => {
    if (created >= MAX_NEW_PER_RUN || !['fact', 'pattern', 'preference'].includes(kind) || (!full && kind !== 'fact')) return null
    const text = textOf('belief', belief, sourcesFor(kind))
    const snippet = snippetOf(rawSnippet, sourcesFor(kind))
    if (!text || !snippet || corrected('founder_beliefs', text) || taken.has(squash(text))) return null
    taken.add(squash(text))
    created += 1
    return async () => {
      const row = await store.insertBelief({ userId, belief: text, kind, source: beliefSource, confidence: Math.min(cap, kind === 'fact' ? NEW_FACT_CONFIDENCE : NEW_PATTERN_CONFIDENCE) })
      done.beliefs += 1
      await proof('founder_beliefs', row.id, snippet)
      return row
    }
  }

  for (const s of rows(data.supersede)) {
    const old = usable(s.id)
    if (!old || old.kind !== 'fact' || !snippetOf(s.replacement?.snippet, founderTexts)) continue
    const write = planBelief({ belief: s.replacement.belief, kind: 'fact', snippet: s.replacement.snippet })
    if (!write) continue
    touched.add(old.id)
    ops.push(async () => {
      const next = await write()
      await store.supersedeBelief(userId, old.id, next.id)
    })
  }

  for (const r of rows(data.reinforce)) {
    const row = usable(r.id)
    const snippet = row && snippetOf(r.snippet, sourcesFor(row.kind))
    if (!snippet) continue
    touched.add(row.id)
    ops.push(async () => {
      const hit = await store.updateBelief(userId, row.id, (cur) => ({
        confidence: reinforce({ ...cur, origin: cur.source === 'signup' ? 'self_report' : 'observed' }, (counts[cur.id]?.rows ?? 0) + 1),
      }))
      if (hit) await proof('founder_beliefs', row.id, snippet)
    })
  }

  for (const w of rows(data.weaken)) {
    const row = usable(w.id)
    const snippet = row && snippetOf(w.snippet, sourcesFor(row.kind))
    if (!snippet) continue
    touched.add(row.id)
    ops.push(async () => {
      const hit = await store.updateBelief(userId, row.id, (cur) => {
        const next = weaken(cur)
        return { confidence: next.confidence, ...(next.superseded ? { status: 'superseded' } : {}) }
      })
      if (hit) await proof('founder_beliefs', row.id, snippet)
    })
  }

  for (const b of rows(data.new_beliefs)) {
    const write = planBelief(b)
    if (write) ops.push(write)
  }

  if (full) {
    const seen = new Set()
    for (const t of rows(data.traits)) {
      const snippet = snippetOf(t.snippet, sourcesFor('pattern'))
      if (!isTraitValue(t.dimension, t.value) || seen.has(t.dimension) || !snippet || corrected('founder_traits', `${t.dimension} ${t.value}`.replace(/_/g, ' '))) continue
      seen.add(t.dimension)
      const old = traits.find((x) => x.dimension === t.dimension)
      const same = old?.value === t.value
      ops.push(async () => {
        const row = await store.upsertTrait({
          userId, dimension: t.dimension, value: t.value,
          confidence: same ? reinforce(old, (counts[old.id]?.rows ?? 0) + 1) : NEW_PATTERN_CONFIDENCE,
          origin: same ? old.origin : 'observed',
        })
        if (!row) return
        done.traits += 1
        await proof('founder_traits', row.id, snippet)
      })
    }
  }

  for (const w of rows(data.world)) {
    const name = textOf('world', w.name, founderTexts)
    const snippet = snippetOf(w.snippet, founderTexts)
    if (!name || !snippet || !['person', 'company', 'product', 'channel'].includes(w.kind) || !typedBy(name, founderTexts) || corrected('founder_world', name)) continue
    const role = w.role ? textOf('role', w.role, founderTexts) : null // a bad role is dropped, the person stays
    ops.push(async () => {
      const row = await store.upsertWorld({ userId, name, kind: w.kind, role })
      if (!row) return
      done.world += 1
      await proof('founder_world', row.id, snippet)
    })
  }

  for (const v of rows(data.vocabulary)) {
    const term = textOf('term', v.term, founderTexts)
    const meaning = textOf('meaning', v.meaning, founderTexts)
    const snippet = snippetOf(v.snippet, founderTexts)
    if (!term || !meaning || !snippet || !typedBy(term, founderTexts) || corrected('founder_vocabulary', term)) continue
    ops.push(async () => {
      const row = await store.upsertVocabulary({ userId, term, meaning, confidence: VOCAB_CONFIDENCE })
      if (!row) return
      done.vocabulary += 1
      await proof('founder_vocabulary', row.id, snippet)
    })
  }

  // A thread has no snippet, so its limits are tighter: two a run, numbers and names only from the founder's words.
  let threads = 0
  for (const t of rows(data.threads)) {
    const title = textOf('thread', t.title, founderTexts)
    if (threads >= MAX_NEW_THREADS || !title || !['goal', 'bet', 'open_question'].includes(t.kind) || corrected('founder_threads', title) || open.has(squash(title))) continue
    open.add(squash(title))
    threads += 1
    ops.push(async () => {
      await store.insertThread({ userId, title, kind: t.kind })
      done.threads += 1
    })
  }

  // Facts nobody touched for 90 days lose a little. updated_at stays, so the next run decays again.
  for (const b of beliefs) {
    if (touched.has(b.id) || decayFact(b, nowMs) >= b.confidence) continue
    ops.push(() => store.updateBelief(userId, b.id, (cur) => ({ confidence: decayFact(cur, nowMs) }), { touch: false }))
  }

  if (claim && !(await claim())) return null
  for (const op of ops) {
    try {
      await op()
    } catch (err) {
      log('memory item skipped', err)
    }
  }
  return done
}

// ── One pass for one source ─────────────────────────────────────────────────

const one = async (query) => {
  const { data, error } = await query
  if (error) throw error
  return data
}
const inflight = new Set()

// sourceKind: 'report' (mode full), 'move' or 'situation' (mode facts_only).
// isCapped(userId): true when the founder is over the daily cost cap; the model is then not called and nothing is recorded.
// Returns { status: 'done' | 'skipped' | 'skipped_care' | 'failed' }. Never throws.
export async function runMemoryPass({
  supabase, store, callStructured, userId, sourceKind, sourceId, mode = 'full', log = () => {}, clock = { now: () => Date.now() }, isCapped = async () => false,
}) {
  const mem = store ?? createMemoryStore({ supabase, clock, log })
  const key = `${userId}:${sourceKind}:${sourceId}:${mode}`
  if (inflight.has(key)) return { status: 'skipped' }
  inflight.add(key)
  try {
    return await pass({ supabase, store: mem, callStructured, userId, sourceKind, sourceId, mode, log, clock, isCapped })
  } catch (err) {
    log('memory pass failed', err)
    await mem.recordRun({ userId, sourceKind, sourceId, mode, status: 'failed' }).catch(() => {})
    return { status: 'failed' }
  } finally {
    inflight.delete(key)
  }
}

async function sourceRows({ supabase, userId, sourceKind, sourceId }) {
  const own = (table, id) => one(supabase.from(table).select().eq('id', id).eq('user_id', userId).maybeSingle())
  const report = sourceKind === 'report' ? await own('reports', sourceId) : null
  const move = sourceKind === 'situation' ? null : await own('moves', report ? report.move_id : sourceId)
  const situationId = sourceKind === 'situation' ? sourceId : (report ?? move)?.situation_id
  const situation = situationId ? await own('situations', situationId) : null
  return { report, move, situation }
}

async function pass({ supabase, store, callStructured, userId, sourceKind, sourceId, mode, log, clock, isCapped }) {
  if (await store.hasRun(userId, sourceKind, sourceId, mode)) return { status: 'skipped' }
  const { report, move, situation } = await sourceRows({ supabase, userId, sourceKind, sourceId })
  if (!situation || (sourceKind === 'report' && !report)) return { status: 'skipped' }
  const run = (status, model = null) => store.recordRun({ userId, sourceKind, sourceId, mode, status, model })

  const sharing = createSharing({ supabase, clock })
  if ((await sharing.careTouched(userId, situation)) || (await sharing.careOpen(userId))) {
    await run('skipped_care')
    return { status: 'skipped_care' }
  }

  const full = mode === 'full'
  const outcome = full ? report?.outcome ?? null : null
  const note = full ? report?.note ?? null : null
  const turns = await one(supabase.from('situation_turns').select().eq('situation_id', situation.id).order('seq', { ascending: true }))
  const read = await one(supabase.from('reads').select().eq('situation_id', situation.id).maybeSingle())
  const said = turns.filter((t) => t.role === 'founder' && !t.filler).map((t) => t.text)
  const founderTexts = [...said, ...(read?.closing_answer ? [read.closing_answer] : []), ...(note ? [note] : [])]
  const moveRecord = full && move ? { title: move.title, mission: move.mission, success: move.success_condition, prediction: move.prediction } : null

  // Nothing the founder said, or a move not done with no note: nothing to learn, no call.
  if (founderTexts.length === 0 || (full && !note && outcome !== 'done')) {
    await run('done')
    return { status: 'skipped' }
  }

  const [beliefs, traits, world, vocabulary, corrections] = await Promise.all([
    store.activeBeliefs(userId), store.activeTraits(userId), store.activeWorld(userId), store.activeVocabulary(userId), store.corrections(userId),
  ])
  const input = {
    situation: { title: situation.title ?? null, founder_said: said },
    read: { headline: read?.headline ?? null, body: read?.body ?? null, founder_answer: read?.closing_answer ?? null },
    ...(full ? { move: moveRecord, outcome, note } : {}),
    memory: {
      beliefs: beliefs.filter((b) => full || b.kind === 'fact').map((b) => ({ id: b.id, belief: b.belief, kind: b.kind })),
      ...(full ? { traits: traits.map((t) => ({ dimension: t.dimension, value: t.value })) } : {}),
      world: world.map((w) => ({ name: w.name, kind: w.kind, role: w.role })),
      vocabulary: vocabulary.map((v) => ({ term: v.term, meaning: v.meaning })),
    },
    corrections: corrections.map((c) => ({ item_text: c.item_text })),
  }
  // Over the daily cost cap: no paid call, and nothing recorded, so a later trigger can still learn from this source.
  if (await overCap(isCapped, userId)) return { status: 'skipped' }
  // A failed call or an output that is not an object throws: runMemoryPass records the failed run and writes nothing.
  const { data, model } = await callStructured({
    step: 'beliefs',
    schema: full ? BELIEFS_SCHEMA : FACTS_ONLY_SCHEMA,
    schemaName: full ? 'beliefs' : 'beliefs_facts_only',
    maxCompletionTokens: 1200,
    userId,
    usageContext: { step: 'beliefs', mode, source_kind: sourceKind, situation_id: situation.id },
    messages: beliefsMessages({ mode, input }),
  })
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('memory output is not an object')
  const written = await applyExtraction({
    store, userId, data, mode, founderTexts, moveTexts: full && moveRecord ? Object.values(moveRecord).filter(Boolean) : [], moveId: full && move ? move.id : null,
    receipt: () => ({ sourceKind, sourceId }), beliefSource: full ? 'report' : 'conversation', nowMs: clock.now(), corrections, log,
    // The run is recorded as done right before the first write: a duplicate (another pass got there first) writes nothing.
    claim: async () => !(await store.hasRun(userId, sourceKind, sourceId, mode)) && (await run('done', model)) !== null,
  })
  return written ? { status: 'done', written } : { status: 'skipped' }
}
