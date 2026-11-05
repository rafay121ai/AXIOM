// Small validators shared by the routes.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value)
}

// Accepts HH:MM or HH:MM:SS, returns HH:MM or null.
export function normalizeReportTime(value) {
  if (typeof value !== 'string') return null
  const m = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/.exec(value)
  return m ? `${m[1]}:${m[2]}` : null
}
