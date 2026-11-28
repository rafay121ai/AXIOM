// Past calendar meetings teach Axiom who the founder's regular people are (Rafay, Nov 28). No model, no signal, no push:
// each other attendee with a display name becomes a founder_world person (connector: the mention count is not touched), and each
// meeting is one receipt (source_kind 'connector', source_key 'googlecalendar', created_at = the meeting's start, snippet = its title).
// Disconnect keeps them; "delete what Axiom learned from Calendar" removes them (connectorService.forget, by source_key).
import { createHash } from 'node:crypto'
import { cleanStoredText, isBlocked } from '../journey/memory/beliefRules.js'
import { isCorrected } from '../journey/memory/extractBeliefs.js'
import { createMemoryStore } from '../journey/memory/memoryStore.js'
import { CALENDAR_KEY } from '../journey/memory/rhythm.js'
import { careOpen } from './worldContext.js'

// source_id is a uuid column: one stable id per event and person, so the same event is learned once.
const uuidOf = (...parts) => { const h = createHash('sha256').update(parts.join('|')).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}` }

export function createMeetingLearner({ supabase, clock, log = () => {} }) {
  const store = createMemoryStore({ supabase, clock })
  // Never throws: a failure here must not fail the job.
  return async function learnMeetingPeople(userId, event) {
    try {
      const start = Date.parse(event.start?.dateTime ?? event.start?.date ?? '')
      if (!event.id || !(start <= clock.now()) || await careOpen(supabase, userId)) return 0 // only meetings that happened
      const raw = cleanStoredText(event.summary).slice(0, 200)
      const title = raw && !isBlocked(raw) ? raw : 'a meeting'
      const corrections = await store.corrections(userId)
      let learned = 0
      for (const a of event.attendees ?? []) {
        const name = cleanStoredText(a.displayName).slice(0, 80)
        if (a.self || a.resource || name.length < 2 || name.includes('@') || isBlocked(name) || isCorrected(corrections, 'founder_world', name)) continue
        const sourceId = uuidOf(userId, event.id, name.toLowerCase())
        if (await store.hasEvidenceFrom(userId, sourceId)) continue
        const row = await store.upsertWorld({ userId, name, kind: 'person', connector: true })
        if (!row) continue
        await store.addEvidence([{ userId, itemTable: 'founder_world', itemId: row.id, sourceKind: 'connector', sourceId, sourceKey: CALENDAR_KEY, snippet: title, at: new Date(start).toISOString() }])
        learned += 1
      }
      return learned
    } catch (err) {
      log('meeting people skipped', err?.code ?? err?.message)
      return 0
    }
  }
}
