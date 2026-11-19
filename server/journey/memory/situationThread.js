// One open thread per situation, built by code from the situation's title (replay 3 and 4: the model proposed none). The title is
// the founder's own topic; it passes the same checks as any thread the memory pass writes (length, banned words, numbers and names
// from their words, blocked topics, corrections) and is never stored for a care situation. Idempotent: the receipt (source_kind
// 'situation', source_id = the situation id) is the record, so a retry never makes a second. Background only; never throws.
import { createSharing } from '../report/sharing.js'
import { checkBeliefText } from './beliefRules.js'
import { isCorrected } from './extractBeliefs.js'
import { createMemoryStore } from './memoryStore.js'

const inflight = new Set()

export async function ensureSituationThread({ supabase, store, userId, situationId, log = () => {}, clock = { now: () => Date.now() } }) {
  const key = `${userId}:${situationId}`
  if (inflight.has(key)) return { status: 'skipped' }
  inflight.add(key)
  try {
    const mem = store ?? createMemoryStore({ supabase, clock, log })
    if (await mem.hasEvidenceFrom(userId, situationId)) return { status: 'skipped' }
    const { data: situation, error } = await supabase.from('situations').select().eq('id', situationId).eq('user_id', userId).maybeSingle()
    if (error) throw error
    const sharing = createSharing({ supabase, clock })
    if (!situation?.title || (await sharing.careTouched(userId, situation)) || (await sharing.careOpen(userId))) return { status: 'skipped_care' }
    const { data: turns, error: turnsError } = await supabase.from('situation_turns').select().eq('situation_id', situationId)
    if (turnsError) throw turnsError
    const founderTexts = turns.filter((t) => t.role === 'founder' && !t.filler).map((t) => t.text)
    const checked = checkBeliefText({ text: situation.title, sourceTexts: founderTexts, field: 'thread' })
    if (!checked.ok || isCorrected(await mem.corrections(userId), 'founder_threads', checked.text)) return { status: 'skipped' }
    const thread = await mem.insertThread({ userId, title: checked.text, kind: 'open_question' })
    await mem.addEvidence([{ userId, itemTable: 'founder_threads', itemId: thread.id, sourceKind: 'situation', sourceId: situationId, snippet: checked.text }])
    return { status: 'done' }
  } catch (err) {
    log('situation thread failed', err)
    return { status: 'failed' }
  } finally {
    inflight.delete(key)
  }
}
