// Quote verification against a retrieved passage. Pure: no model, no I/O.
// A quote is real only if it is a contiguous piece of the passage after
// normalising quote marks, dashes, whitespace and case. "…" or "..." inside a
// quote splits it into pieces that must each match, in order.

export const MIN_QUOTE_WORDS = 3

const wordCount = (s) => (s.match(/[\p{L}\p{N}]+/gu) || []).length

// One character at a time, so every normalised character maps back to its
// place in the original and the quote can be shown exactly as printed.
function normalised(text) {
  const out = []
  const map = []
  let pendingSpace = false
  let index = 0
  for (const ch of String(text ?? '')) {
    const start = index
    index += ch.length
    const n = ch
      .normalize('NFKC')
      .replace(/[“”„‟]/g, '"')
      .replace(/[‘’‚‛`´]/g, "'")
      .replace(/[‐-―]/g, '-')
      .toLowerCase()
    for (const c of n) {
      if (/\s/.test(c)) { pendingSpace = out.length > 0; continue }
      if (pendingSpace) { out.push(' '); map.push(start); pendingSpace = false }
      out.push(c)
      map.push(start)
    }
  }
  return { text: out.join(''), map, end: index }
}

const trimEdges = (s) => s.replace(/^[\s,;:]+|[\s,;:]+$/g, '')
const SENTENCE_START = /(?:^|[.!?]["')”’]*\s+|\n\s*)$/

// Returns { ok, display }. `display` is the quote exactly as printed in the
// passage (pieces joined with " … "), with a leading "…" when the first piece
// starts mid-sentence. Nothing is tidied.
export function verifyQuote(quote, passage) {
  const q = normalised(quote).text
  const pieces = q.split(/…|\.{3}/).map(trimEdges).filter(Boolean)
  if (pieces.length === 0 || wordCount(pieces.join(' ')) < MIN_QUOTE_WORDS) return { ok: false, display: null }

  const p = normalised(passage)
  const printed = []
  let from = 0
  let firstStart = -1
  for (const piece of pieces) {
    const at = p.text.indexOf(piece, from)
    if (at === -1) return { ok: false, display: null }
    if (firstStart === -1) firstStart = at
    const lastChar = at + piece.length - 1
    const origStart = p.map[at]
    const origEnd = lastChar + 1 < p.map.length ? p.map[lastChar + 1] : p.end
    printed.push(String(passage).slice(origStart, origEnd).trim())
    from = at + piece.length
  }
  const before = String(passage).slice(0, p.map[firstStart])
  const midSentence = before.trim() !== '' && !SENTENCE_START.test(before)
  return { ok: true, display: `${midSentence ? '… ' : ''}${printed.join(' … ')}`.replace(/^… /, '…') }
}
