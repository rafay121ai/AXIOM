// Daily cap parsing shared by the OpenAI client and its tests. No browser imports.
const SERVER_RESET_PHRASE = 'midnight UTC'

// "5:00 AM" in the founder's local time, or null if resetsAt is missing/invalid.
export function formatLocalResetTime(resetsAt, locale) {
  if (!resetsAt) return null
  const date = new Date(resetsAt)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
}

// Swaps the server's "midnight UTC" for the founder's local reset time.
// Falls back to the server string untouched.
export function localizeCapMessage(message, resetsAt, locale) {
  const time = formatLocalResetTime(resetsAt, locale)
  if (!time || typeof message !== 'string' || !message.includes(SERVER_RESET_PHRASE)) return message
  return message.replace(SERVER_RESET_PHRASE, time)
}

// Thrown when the server reports the founder's daily AI cost cap is reached.
export class DailyCapError extends Error {
  constructor(body) {
    const resetsAt = body?.resets_at || null
    super(localizeCapMessage(body?.message || 'Daily limit reached.', resetsAt))
    this.name = 'DailyCapError'
    this.isDailyCap = true
    this.resetsAt = resetsAt
  }
}

export function isDailyCapError(error) {
  return Boolean(error?.isDailyCap)
}

export function isCappedBody(data) {
  return data?.capped === true
}
