// S3: signals on the home screen and in memory. A signal item is a left-off item like the others (a gold dot and plain words on the phone).
// A tap opens a situation whose first line is Axiom's: it never writes the founder's message (DESIGN.md).
import { HttpError } from '../journey/situations.js'
import { cleanStoredText, isBlocked } from '../journey/memory/beliefRules.js'
import { applyExtraction, isCorrected } from '../journey/memory/extractBeliefs.js'
import { createMemoryStore } from '../journey/memory/memoryStore.js'
import { careOpen, connectorsOn } from './worldContext.js'

// Founder-facing wording, awaiting Rafay (tasks/wording_to_approve.md section H).
export const SIGNAL_ASK = 'What do you want to do about it?'
const LABEL_MAX = 90
const TOOLS = new Set(['gmail', 'google calendar', 'googlecalendar', 'notion'])
const COMPANY = /\b(inc|llc|ltd|limited|corp|co|company|labs|capital|ventures|group|bank|studio|agency)\b\.?/i

const ok = ({ data, error }) => {
  if (error) throw error
  return data ?? []
}
const brief = (text, max) => {
  const t = String(text).replace(/\s+/g, ' ').trim()
  return t.length <= max ? t : `${t.slice(0, max).replace(/\s+\S*$/, '')}...`
}

export const signalItem = (f) => ({
  kind: 'signal', label: brief(f.what_happened, LABEL_MAX), title: null, stays: false, target: { stage: 'signal', signal_id: f.id },
})

// The signals the founder was just shown become 'shown' (only new or pushed ones move).
export async function markShown(supabase, userId, ids, nowMs) {
  if (ids.length === 0) return
  ok(await supabase.from('signals').update({ status: 'shown', updated_at: new Date(nowMs).toISOString() })
    .eq('user_id', userId).in('id', ids).in('status', ['new', 'pushed']).select('id'))
}

// Tap on a signal item: a situation with one Axiom line (the signal, then the ask), linked, signal 'acted'. Never a founder turn.
export async function openSignal({ supabase, userId, signalId, clock, env = process.env }) {
  const gone = () => new HttpError(404, { error: 'Not found' })
  if (!connectorsOn(env) || await careOpen(supabase, userId)) throw gone()
  const signal = ok(await supabase.from('signals').select('id, facts, status, situation_id').eq('user_id', userId).eq('id', signalId).limit(1))[0]
  if (!signal) throw gone()
  if (signal.situation_id && signal.status === 'acted') return { situation_id: signal.situation_id, stage: 'situation' }
  if (!['new', 'pushed', 'shown'].includes(signal.status) || !signal.facts?.what_happened) throw gone()
  const at = new Date(clock.now()).toISOString()
  const created = await supabase.from('situations').insert({
    user_id: userId, title: null, status: 'open', follow_up_count: 0, created_at: at, last_activity_at: at,
  }).select().single()
  if (created.error) throw created.error
  const situationId = created.data.id
  ok(await supabase.from('situation_turns').insert({ situation_id: situationId, role: 'axiom', text: `${signal.facts.what_happened} ${SIGNAL_ASK}`, filler: false, result: null, created_at: at }).select('id'))
  ok(await supabase.from('signals').update({ status: 'acted', situation_id: situationId, updated_at: at })
    .eq('user_id', userId).eq('id', signal.id).in('status', ['new', 'pushed', 'shown']).select('id'))
  return { situation_id: situationId, stage: 'situation' }
}

// A signal that names a person or company becomes a founder_world row through the memory layer (source 'connector'), with the
// signal's own sentence as the receipt. The memory rules decide: sensitive text, a name not in the sentence and a corrected name are all dropped.
// shortcut: a company is told from a person by its name ("Acme Ltd"), so a plain-looking company is stored as a person, upgrade with a real entity check.
export async function learnFromSignals({ supabase, userId, facts, clock, log = () => {} }) {
  try {
    if (await careOpen(supabase, userId)) return 0
    const store = createMemoryStore({ supabase, clock })
    const corrections = await store.corrections(userId)
    let learned = 0
    for (const f of facts) {
      const name = cleanStoredText(f.source_name)
      if (f.lane === 'world' || isBlocked(f.what_happened) || !name || TOOLS.has(name.toLowerCase()) || isCorrected(corrections, 'founder_world', name) || await store.hasEvidenceFrom(userId, f.id)) continue
      const sentence = [f.what_happened, ...f.what_happened.split(/(?<=[.!?])\s+/).filter((s) => s.includes(name))].find((s) => s.length <= 200)
      if (!sentence) continue
      const done = await applyExtraction({
        store, userId, mode: 'facts_only', founderTexts: [f.what_happened], corrections, nowMs: clock.now(), log,
        data: { world: [{ name, kind: COMPANY.test(name) ? 'company' : 'person', role: null, snippet: sentence }] },
        receipt: () => ({ sourceKind: 'connector', sourceId: f.id }), beliefSource: 'connector',
      })
      learned += done?.world ?? 0
    }
    return learned
  } catch (err) {
    log('connector memory skipped', err)
    return 0
  }
}
