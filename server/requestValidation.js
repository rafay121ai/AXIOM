// Pure request validators for the OpenAI proxy routes.

export const CHAT_MAX_MESSAGES = 60
// The largest realistic turn is a ~80k char system prompt plus retrieved
// context, 12 history messages and the founder's message. 250k leaves headroom
// while still bounding spend per request (express.json already caps at 1mb).
export const CHAT_MAX_TOTAL_CHARS = 250_000
export const EMBEDDING_MAX_ITEMS = 16
export const EMBEDDING_MAX_CHARS = 8000

const CHAT_ROLES = new Set(['system', 'user', 'assistant'])

export function validateChatMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > CHAT_MAX_MESSAGES) {
    return false
  }
  let total = 0
  for (const message of messages) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) return false
    if (!CHAT_ROLES.has(message.role)) return false
    if (typeof message.content !== 'string') return false
    total += message.content.length
    if (total > CHAT_MAX_TOTAL_CHARS) return false
  }
  return true
}

export function isAllowedResponseFormat(responseFormat) {
  if (responseFormat === undefined || responseFormat === null) return true
  if (typeof responseFormat !== 'object' || Array.isArray(responseFormat)) return false
  const keys = Object.keys(responseFormat)
  return keys.length === 1 && keys[0] === 'type' && responseFormat.type === 'json_object'
}

export function validateEmbeddingInput(input) {
  if (typeof input === 'string') return input.length <= EMBEDDING_MAX_CHARS
  return (
    Array.isArray(input) &&
    input.length > 0 &&
    input.length <= EMBEDDING_MAX_ITEMS &&
    input.every((item) => typeof item === 'string' && item.length <= EMBEDDING_MAX_CHARS)
  )
}

export function parseBearerToken(header) {
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return null
  const token = header.slice('Bearer '.length).trim()
  return token || null
}

// Upstream OpenAI errors: pass rate limits through, everything else is a gateway error.
export function upstreamErrorStatus(err) {
  if (err?.status === 429) return 429
  return Number.isInteger(err?.status) ? 502 : 500
}
