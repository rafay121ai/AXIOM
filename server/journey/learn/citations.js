// Citation validation for a Learn answer. The model may only point at evidence
// handles (E1, E2 ...). Author, book, chapter and page always come from the
// evidence row; a quote is shown only if it is verified word for word in the
// row's retrieved text. Anything else is stripped. With no surviving verified
// source the answer says nothing (status "no_source"). Pure: no model, no I/O.
import { norm } from '../ownWords.js'
import { verifyQuote } from './quotes.js'

const HANDLE = /\[?\bE\d+\b\]?/g
const sameText = (a, b) => norm(a).replace(/[^\p{L}\p{N} ]/gu, '').replace(/\s+/g, ' ').trim()

const CAP = "[A-Z][\\p{L}'’.-]+"
const NAME = `${CAP}(?:\\s+(?:de|van|von|der|di|da|la|le)?\\s*${CAP}){1,3}`
const SAID = '(?:argues?|writes?|wrote|says?|said|notes?|noted|calls?|called|explains?|explained|claims?|claimed|describes?|described|found|shows?|showed|warns?|warned|suggests?|suggested|observes?|observed|tells?|told|insists?|puts it)'
const AUTHOR_BEFORE_VERB = new RegExp(`(?<![\\p{L}])(${NAME})\\s+${SAID}\\b`, 'gu')
const AUTHOR_AFTER_CUE = new RegExp(`(?:according to|written by|a book by)\\s+(${CAP}(?:\\s+(?:de|van|von|der|di|da|la|le)?\\s*${CAP}){0,3})`, 'gu')
const BOOK_QUOTED = /(?:\bin|\bfrom|\bbook|\btitled|\bcalled|\bread)\s+(?:the book\s+|his book\s+|her book\s+|their book\s+)?["“]([^"”]{3,80})["”]/gi
const BOOK_BARE = new RegExp(`(?:the book|his book|her book|their book|a book called|book called|titled)\\s+(${CAP}(?:\\s+(?:of|the|and|to|for|in|a)?\\s*${CAP}){0,6})`, 'gu')

const nameMatches = (found, author) => {
  const f = sameText(found)
  const a = sameText(author)
  if (!f || !a) return false
  if (a.includes(f) || f.includes(a)) return true
  const fl = f.split(' ').pop()
  return fl.length > 2 && a.split(' ').pop() === fl
}
const titleMatches = (found, title) => {
  const f = sameText(found)
  const t = sameText(title)
  return f.length >= 3 && t.length >= 3 && (t.includes(f) || f.includes(t))
}

const sentencesOf = (text) => String(text ?? '').split(/(?<=[.!?])\s+/).filter((s) => s.trim())

// Names of authors and books claimed in a sentence.
function claimsIn(sentence) {
  const authors = []
  const books = []
  for (const m of sentence.matchAll(AUTHOR_BEFORE_VERB)) authors.push(m[1])
  for (const m of sentence.matchAll(AUTHOR_AFTER_CUE)) authors.push(m[1])
  for (const m of sentence.matchAll(BOOK_QUOTED)) books.push(m[1])
  for (const m of sentence.matchAll(BOOK_BARE)) books.push(m[1])
  return { authors, books }
}

// answer: { text, citations: [{ handle, quote?, chapter?, page?, author?, book? }] }
//   (author, book, chapter, page on a citation are the model's claims, only
//   checked against the row, never shown.)
// evidence: [{ handle, author, source_title, page_start?, page_end?, chapter?, text, short_quote? }]
// Returns { status: 'ok' | 'no_source', text, sources, flags }.
//   sources: [{ handle, author, book, chapter?, page_start?, page_end?, quote? }]
//   flags: [{ type, detail }]  (for logging; never shown to the founder)
export function validateCitations({ answer, evidence }) {
  const flags = []
  const rows = new Map((evidence ?? []).filter((r) => r?.handle).map((r) => [r.handle, r]))
  const sources = []
  const seen = new Set()

  for (const c of Array.isArray(answer?.citations) ? answer.citations : []) {
    const row = rows.get(c?.handle)
    if (!row) { flags.push({ type: 'unknown_handle', detail: String(c?.handle) }); continue }
    if (!row.author || !row.source_title) { flags.push({ type: 'incomplete_evidence', detail: c.handle }); continue }
    if (seen.has(row.handle)) continue
    seen.add(row.handle)

    if (c.author && !nameMatches(c.author, row.author)) flags.push({ type: 'wrong_author', detail: `${c.handle}: ${c.author}` })
    if (c.book && !titleMatches(c.book, row.source_title)) flags.push({ type: 'wrong_book', detail: `${c.handle}: ${c.book}` })

    const source = { handle: row.handle, author: row.author, book: row.source_title }
    if (c.chapter != null && c.chapter !== '') {
      if (row.chapter && sameText(c.chapter) === sameText(row.chapter)) source.chapter = row.chapter
      else flags.push({ type: 'invented_chapter', detail: `${c.handle}: ${c.chapter}` })
    }
    if (c.page != null && c.page !== '') {
      const claimed = Number(c.page)
      const lo = row.page_start
      const hi = row.page_end ?? row.page_start
      if (Number.isFinite(lo) && claimed >= lo && claimed <= hi) { source.page_start = lo; if (hi !== lo) source.page_end = hi }
      else flags.push({ type: 'invented_page', detail: `${c.handle}: ${c.page}` })
    }
    if (c.quote) {
      const v = verifyQuote(c.quote, row.text)
      if (v.ok) source.quote = v.display
      else flags.push({ type: 'unverified_quote', detail: `${c.handle}: ${String(c.quote).slice(0, 80)}` })
    }
    sources.push(source)
  }

  const prose = cleanProse({ text: answer?.text, sources, handles: rows })
  flags.push(...prose.flags)
  if (sources.length === 0 || !prose.text) return { status: 'no_source', text: '', sources: [], flags }
  return { status: 'ok', text: prose.text, sources, flags }
}

// Prose: only the given sources' authors and books may be named; unknown
// handles and any other named author or book remove the sentence. With no
// sources, every sentence that names an author or book goes (the no-source
// reply says nothing about books). handles: the evidence handles that exist.
// Returns { text, flags }.
export function cleanProse({ text, sources = [], handles = new Map() }) {
  const flags = []
  const kept = []
  for (const sentence of sentencesOf(text)) {
    const found = sentence.match(HANDLE) ?? []
    const unknown = found.map((h) => h.replace(/[[\]]/g, '')).filter((h) => !handles.has(h))
    if (unknown.length) { flags.push({ type: 'unknown_handle', detail: unknown.join(',') }); continue }

    const { authors, books } = claimsIn(sentence)
    const badAuthor = authors.find((a) => !sources.some((s) => nameMatches(a, s.author)))
    const badBook = books.find((b) => !sources.some((s) => titleMatches(b, s.book)))
    if (badAuthor) { flags.push({ type: 'author_not_in_evidence', detail: badAuthor }); continue }
    if (badBook) { flags.push({ type: 'book_not_in_evidence', detail: badBook }); continue }

    const clean = sentence.replace(HANDLE, '').replace(/\s{2,}/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim()
    if (clean) kept.push(clean)
  }
  return { text: kept.join(' '), flags }
}
