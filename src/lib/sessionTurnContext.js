const STORAGE_KEY = 'axiom:session-turn-context:v1'
const TTL_MS = 45 * 60 * 1000
const MAX_ENTRIES = 24

const FOLLOW_UP_RE = /\b(what about|and what about|what if|also|then|so|okay|ok|continue|tell me more|go deeper|zoom in|zoom out|compare that|why|how so|explain that|what does that mean|which side|materials|tools|next|watch next)\b/i
const NEW_TOPIC_RE = /\b(new topic|different topic|switch to|now talk about|instead talk about)\b/i
const EXPLICIT_STRUCTURE_RE = /\b(signal map|table|comparison table|matrix|framework|diagram|chart|graph|watchlist|checklist|timeline|quadrant)\b/i

function canUseStorage() {
  return typeof window !== 'undefined' && !!window.sessionStorage
}

function readStore() {
  if (!canUseStorage()) return { entries: [], last: null }

  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) || '{}')
    return {
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      last: parsed.last && typeof parsed.last === 'object' ? parsed.last : null,
    }
  } catch {
    return { entries: [], last: null }
  }
}

function writeStore(store) {
  if (!canUseStorage()) return

  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // Session storage can fail in private/locked-down browsers. The app should
    // keep working; the cache is only a cost/latency optimization.
  }
}

function compactText(text = '') {
  return String(text || '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220)
}

function compactScope(scope = '') {
  return String(scope || '')
    .toLowerCase()
    .replace(/[^a-z0-9:_-]/g, '')
    .slice(0, 120)
}

function cacheKey(sessionId, text, scope = '') {
  return `${sessionId || 'unknown'}::${compactScope(scope)}::${compactText(text)}`
}

function isFresh(entry, now = Date.now()) {
  return entry?.createdAt && now - entry.createdAt < TTL_MS
}

function prune(entries, now = Date.now()) {
  return entries
    .filter((entry) => isFresh(entry, now))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_ENTRIES)
}

export function isLikelyFollowUpTurn(text = '') {
  const clean = compactText(text)
  if (!clean || NEW_TOPIC_RE.test(clean) || EXPLICIT_STRUCTURE_RE.test(clean)) return false
  return clean.length <= 90 || FOLLOW_UP_RE.test(clean)
}

export function getCachedTurnContext(sessionId, text, scope = '') {
  const now = Date.now()
  const key = cacheKey(sessionId, text, scope)
  const store = readStore()
  const entries = prune(store.entries, now)
  const exact = entries.find((entry) => entry.key === key)

  if (exact) {
    writeStore({ ...store, entries })
    return { ...exact.payload, cacheHit: 'exact' }
  }

  if (
    store.last &&
    store.last.sessionId === sessionId &&
    store.last.scope === compactScope(scope) &&
    isFresh(store.last, now) &&
    isLikelyFollowUpTurn(text)
  ) {
    writeStore({ ...store, entries })
    return { ...store.last.payload, cacheHit: 'follow_up' }
  }

  writeStore({ ...store, entries })
  return null
}

export function setCachedTurnContext(sessionId, text, payload, scope = '') {
  const now = Date.now()
  const normalizedScope = compactScope(scope)
  const key = cacheKey(sessionId, text, normalizedScope)
  const store = readStore()
  const entries = prune(store.entries, now).filter((entry) => entry.key !== key)
  const entry = {
    key,
    sessionId,
    scope: normalizedScope,
    query: compactText(text),
    createdAt: now,
    payload,
  }

  writeStore({
    entries: [entry, ...entries].slice(0, MAX_ENTRIES),
    last: entry,
  })
}

export function clearSessionTurnContext() {
  if (!canUseStorage()) return
  try {
    window.sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // no-op
  }
}
