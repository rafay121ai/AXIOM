// The loading-screen hint: one verified short quote from the library, shown
// with the BOOK NAME ONLY (no author, no page). Chosen without a model and
// without reading files: the lessons come from an injected provider.
// Pure given the provider.
import { verifyQuote } from './quotes.js'

export const MAX_HINT_WORDS = 40

// provider: { lessons({ tags }) -> [{ lesson_id, source_title, short_quote, paragraphs?: [{text}], text?, evidence?, pillars? }] }
// seed: any string or number (for example the message id); same seed, same pick.
// tags: optional pillars; only lessons sharing one are used. None match => null.
// exclude: lesson ids not to use (the one the lesson itself uses).
// Returns { lesson_id, book, quote } or null.
export function pickLoadingHint({ provider, seed, tags = [], exclude = [] }) {
  const skip = new Set(exclude)
  const wanted = new Set(tags)
  const lessons = (provider?.lessons?.({ tags }) ?? [])
    .filter((l) => l?.lesson_id && !skip.has(l.lesson_id) && l.source_title && l.short_quote)
    .filter((l) => wanted.size === 0 || (l.pillars ?? []).some((p) => wanted.has(p)))

  const verified = []
  for (const l of lessons) {
    const passage = l.paragraphs?.length ? l.paragraphs.map((p) => p.text).join(' ') : (l.text ?? l.evidence ?? '')
    const v = verifyQuote(l.short_quote, passage)
    if (v.ok && v.display.split(/\s+/).length <= MAX_HINT_WORDS) verified.push({ lesson_id: l.lesson_id, book: l.source_title, quote: v.display })
  }
  if (verified.length === 0) return null
  verified.sort((a, b) => (a.lesson_id < b.lesson_id ? -1 : 1))
  return verified[hash(String(seed)) % verified.length]
}

// FNV-1a, 32 bit.
function hash(s) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}
