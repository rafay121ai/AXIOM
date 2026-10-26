// Repeated unclear signals in one conversation become clear. Pure.
// priorEvents: [{ level, scope_id, created_at }] already stored for this
// founder. With a scopeId (thread or situation) any earlier unclear in that
// scope counts. Without one, an earlier unclear within windowMs counts.
export const ESCALATION_WINDOW_MS = 24 * 60 * 60 * 1000

export function escalateCare({ level, scopeId = null, priorEvents = [], now, windowMs = ESCALATION_WINDOW_MS }) {
  if (level !== 'unclear') return { level, escalated: false }
  const repeated = priorEvents.some((e) => {
    if (e.level !== 'unclear') return false
    if (scopeId) return e.scope_id === scopeId
    return now - Date.parse(e.created_at) <= windowMs
  })
  return repeated ? { level: 'clear', escalated: true } : { level, escalated: false }
}
