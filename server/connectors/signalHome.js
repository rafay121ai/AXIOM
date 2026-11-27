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

// "Dr Hamid: Dr Hamid wrote ..." would say the name twice, so the source is put in front only when the sentence does not already name it.
const named = (f) => (!f.source_name || f.what_happened.toLowerCase().includes(f.source_name.toLowerCase()) ? f.what_happened : `${f.source_name}: ${f.what_happened}`)

export const signalItem = (f, { keepAll = false } = {}) => ({
  kind: 'signal', label: brief(named(f), LABEL_MAX), title: null, stays: keepAll, target: { stage: 'signal', signal_id: f.id },
})

// The signals the founder was just shown become 'shown' (only new or pushed ones move).
export async function markShown(supabase, userId, ids, nowMs) {
  if (ids.length === 0) return
  ok(await supabase.from('signals').update({ status: 'shown', updated_at: new Date(nowMs).toISOString() })
    .eq('user_id', userId).in('id', ids).in('status', ['new', 'pushed']).select('id'))
}

const LIVE = ['new', 'pushed', 'shown']
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// Tap on a signal item: a situation that starts with Axiom's line (source, the signal, then the ask), linked, signal 'acted'. Never a founder turn.
// The signal is claimed first by a conditional update, so two quick taps make one situation: the loser waits for the winner's link.
// beginSituation({ userId, line }): the situations service (same daily cap, cleans up after itself).
export async function openSignal({ supabase, userId, signalId, beginSituation, clock, env = process.env }) {
  const gone = () => new HttpError(404, { error: 'Not found' })
  if (!connectorsOn(env) || await careOpen(supabase, userId)) throw gone()
  const find = async () => ok(await supabase.from('signals').select('id, facts, status, situation_id').eq('user_id', userId).eq('id', signalId).limit(1))[0]
  const signal = await find()
  if (!signal || !signal.facts?.what_happened) throw gone()
  const result = (id) => ({ situation_id: id, stage: 'situation' })
  if (signal.situation_id) return result(signal.situation_id)
  const claimed = ok(await supabase.from('signals').update({ status: 'acted' }).eq('user_id', userId).eq('id', signalId).in('status', LIVE).is('situation_id', null).select('id'))
  if (claimed.length === 0) {
    for (let i = 0; i < 20; i += 1) {
      const now = await find()
      if (now?.situation_id) return result(now.situation_id)
      if (!now || !LIVE.includes(now.status) && now.status !== 'acted') throw gone()
      await wait(50)
    }
    throw new HttpError(409, { error: 'This is still being opened. Try again in a moment.', code: 'turn_busy' })
  }
  try {
    const situation = await beginSituation({ userId, line: `${named({ ...signal.facts })} ${SIGNAL_ASK}` })
    ok(await supabase.from('signals').update({ situation_id: situation.id, updated_at: new Date(clock.now()).toISOString() }).eq('user_id', userId).eq('id', signalId).select('id'))
    return result(situation.id)
  } catch (err) {
    // The situation cleans up after itself; the signal goes back to what it was, so the founder can try again.
    await supabase.from('signals').update({ status: signal.status }).eq('user_id', userId).eq('id', signalId).eq('status', 'acted').is('situation_id', null)
    throw err
  }
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
