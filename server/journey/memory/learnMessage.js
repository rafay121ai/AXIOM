// Memory from one founder message, on any screen, in the background. It does not
// wait for a Report: a founder who never reports still teaches Axiom (Rafay,
// Nov 19). One cheap model call proposes facts, people, shorthand, plans and
// changes; applyExtraction checks every item against the NEW message only (the
// earlier turns are context, never a source for a snippet). A changed fact keeps
// the old one and adds a shift ("said under 15, then 16"), so the next prompt can
// name both. No memory_runs row: that table is once per source and mode. A source
// already holding receipts is not run again, so a retried turn never counts twice.
// Never throws, never delays the reply (scheduleMemory).
import { isFillerReply, stripFiller } from '../filler.js'
import { createSharing } from '../report/sharing.js'
import { applyExtraction, overCap, scheduleMemory } from './extractBeliefs.js'
import { createMemoryStore } from './memoryStore.js'
import { MESSAGE_SCHEMA, beliefsMessages } from './prompts/beliefs.js'

export const MIN_MESSAGE_WORDS = 4
export const CONTEXT_TURNS = 6
const inflight = new Set()

// sourceKind: situation | read | learn | swap | move. sourceId: the turn id (read id for the closing answer, move id for a swap).
// context: async () => [{ role, text }], read only after the cheap checks pass.
// Returns { status: 'done' | 'skipped' | 'skipped_care' | 'failed' }.
export async function learnFromMessage({
  supabase, store, callStructured, userId, sourceKind, sourceId, situationId, text, context = async () => [], log = () => {}, clock = { now: () => Date.now() }, isCapped = async () => false,
}) {
  const key = `${userId}:${sourceKind}:${sourceId}`
  if (inflight.has(key)) return { status: 'skipped' }
  inflight.add(key)
  try {
    const typed = String(text ?? '')
    if (isFillerReply(typed, { minWords: MIN_MESSAGE_WORDS }) || stripFiller(typed).text.split(/\s+/).filter(Boolean).length < MIN_MESSAGE_WORDS) return { status: 'skipped' }
    const mem = store ?? createMemoryStore({ supabase, clock, log })
    if (await mem.hasEvidenceFrom(userId, sourceId)) return { status: 'skipped' }

    const { data: situation, error } = await supabase.from('situations').select().eq('id', situationId).eq('user_id', userId).maybeSingle()
    if (error) throw error
    const sharing = createSharing({ supabase, clock })
    if (!situation || (await sharing.careTouched(userId, situation)) || (await sharing.careOpen(userId))) return { status: 'skipped_care' }
    if (await overCap(isCapped, userId)) return { status: 'skipped' }

    const [beliefs, world, vocabulary, corrections, turns] = await Promise.all([
      mem.activeBeliefs(userId), mem.activeWorld(userId), mem.activeVocabulary(userId), mem.corrections(userId), context(),
    ])
    const input = {
      message: typed,
      context: turns.slice(-CONTEXT_TURNS).map((t) => ({ role: t.role, text: t.text })),
      memory: {
        beliefs: beliefs.filter((b) => b.kind === 'fact').map((b) => ({ id: b.id, belief: b.belief, kind: b.kind })),
        world: world.map((w) => ({ name: w.name, kind: w.kind, role: w.role })),
        vocabulary: vocabulary.map((v) => ({ term: v.term, meaning: v.meaning })),
      },
      corrections: corrections.map((c) => ({ item_text: c.item_text })),
    }
    // A failed call or an output that is not an object throws: nothing is written.
    const { data } = await callStructured({
      step: 'beliefs',
      schema: MESSAGE_SCHEMA,
      schemaName: 'beliefs_message',
      maxCompletionTokens: 1200,
      userId,
      usageContext: { step: 'beliefs', mode: 'message', source_kind: sourceKind, situation_id: situation.id },
      messages: beliefsMessages({ mode: 'message', input }),
    })
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('memory output is not an object')
    const written = await applyExtraction({
      store: mem, userId, data, mode: 'message', founderTexts: [typed], receipt: () => ({ sourceKind, sourceId }),
      beliefSource: 'conversation', nowMs: clock.now(), corrections, log,
    })
    return { status: 'done', written }
  } catch (err) {
    log('message memory failed', err)
    return { status: 'failed' }
  } finally {
    inflight.delete(key)
  }
}

// The function a screen calls after it accepted a founder message: scheduled, never awaited.
export const createMessageLearner = (deps) => (args) => scheduleMemory(() => learnFromMessage({ ...deps, ...args }), deps.log)
