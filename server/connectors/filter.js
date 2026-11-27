// Code-only filter, before any model sees an item (connectors-plan Phase 4). Returns { keep, reason, injection? }.
// Item shapes (normalised by worker.js):
//   gmail { labels[], from, subject, body, bulk }, googlecalendar { summary, description, visibility, attendees[{email,self}] },
//   notion { title, body (the page text) }.
// textUnavailable: true when the text could not be read; it is dropped as sensitive_unknown.
// ctx: { repliedTo: founder sent something in this thread, meetingPeople: Set of lowercase emails on upcoming meetings }.
const DROP_LABELS = ['SPAM', 'CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_UPDATES', 'CATEGORY_FORUMS']
const NO_REPLY = /(^|[<\s"])(no[-_.]?reply|do[-_.]?not[-_.]?reply|donotreply|mailer-daemon|notifications?)@/i
// Unknown sensitive = drop, so these are deliberately broad.
const SENSITIVE_WORDS = [
  /\b(diagnos|prescription|patient|medical|medication|clinic|hospital|therapy|therapist|lab results?|health insurance)/i,
  /\b(attorney|lawyer|lawsuit|subpoena|legal (notice|counsel|advice)|court|settlement|privileged|confidential)\b/i,
  /\b(bank|account number|routing number|iban|swift|credit card|debit card|card ending|statement balance|wire transfer|overdraft)\b/i,
  /\b(tax|irs|hmrc|w-?2|1099|vat return|tax return)\b/i,
  /\b(passport|driver'?s licen[cs]e|social security|ssn|national id|visa application)\b/i,
  /\b(reset your password|password reset|forgot your password|verify your (email|identity|account))\b/i,
  /\b(one[- ]time (code|password)|verification code|security code|your code is|otp|2fa|two-factor|\d{6} is your)\b/i,
  /\b(security alert|new sign-?in|suspicious (activity|sign)|unusual (activity|sign)|was this you)\b/i,
]
const SENSITIVE_DOMAINS = /@([\w-]+\.)*(chase|bankofamerica|wellsfargo|citi|hsbc|barclays|capitalone|americanexpress|amex|paypal|irs\.gov|hmrc\.gov\.uk|mychart|kaiserpermanente|accounts\.google)\./i
const INJECTION = /(ignore|disregard|forget)\s+(all\s+|any\s+|your\s+|the\s+|previous\s+|prior\s+)*(rules|instructions|guidelines|prompt)|system prompt|you are now\b|new instructions:/i

// Scanned whole. Past this size we cannot vouch for it, so it is dropped (fail closed).
export const MAX_SCAN = 200000
const text = (item) => [item.subject, item.summary, item.title, item.description, item.body].filter(Boolean).join('\n')
const emailOf = (s) => (String(s ?? '').match(/[^\s<>"']+@[^\s<>"']+/)?.[0] ?? '').toLowerCase()

function sensitive(item) {
  if (item.textUnavailable || text(item).length > MAX_SCAN) return 'sensitive_unknown'
  if (SENSITIVE_DOMAINS.test(String(item.from ?? ''))) return 'sensitive_sender'
  const t = text(item)
  return SENSITIVE_WORDS.some((rx) => rx.test(t)) ? 'sensitive_text' : null
}

export function filterItem(toolkit, item, ctx = {}) {
  const sens = sensitive(item)
  if (sens) return { keep: false, reason: sens }
  const keep = (reason) => ({ keep: true, reason, ...(INJECTION.test(text(item)) ? { injection: true } : {}) })
  if (toolkit === 'gmail') {
    if (ctx.repliedTo) return keep('reply_to_founder')
    if (ctx.meetingPeople?.has(emailOf(item.from))) return keep('meeting_person')
    const label = (item.labels ?? []).find((l) => DROP_LABELS.includes(l))
    if (label) return { keep: false, reason: `label_${label.toLowerCase()}` }
    if (item.bulk) return { keep: false, reason: 'bulk' }
    if (NO_REPLY.test(String(item.from ?? ''))) return { keep: false, reason: 'no_reply' }
    return keep('person')
  }
  if (toolkit === 'googlecalendar') {
    if (['private', 'confidential'].includes(item.visibility)) return { keep: false, reason: 'private_event' }
    if (!(item.attendees ?? []).some((a) => !a.self)) return { keep: false, reason: 'no_other_attendees' }
    return keep('meeting')
  }
  return keep('page')
}

// Whether the worker should fetch context (thread, meetings) and filter again: only a drop that a reply or a meeting person overrides.
export const overridable = (toolkit, result) => toolkit === 'gmail' && !result.keep && result.reason.startsWith('label_')
export { emailOf }
