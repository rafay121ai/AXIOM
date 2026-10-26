import assert from 'node:assert/strict'
import test from 'node:test'
import { validateCitations } from './citations.js'
import { verifyQuote } from './quotes.js'

const E1 = {
  handle: 'E1',
  author: 'Hamilton Helmer',
  source_title: '7 Powers - The Foundations of Business Strategy',
  chapter: 'Introduction',
  page_start: 13,
  page_end: 13,
  text: 'This reality begs the question. After decades as a business advisor, my conclusion is yes. But with this caveat informed by Pasteur’s well-known dictum: “Chance only favors the prepared mind.” Strategy serves best not as an analytical redoubt, but rather in developing the “prepared mind” of those on the ground.',
  short_quote: 'Chance only favors the prepared mind.',
}
const E2 = { handle: 'E2', author: 'Chris Voss', source_title: 'Never Split the Difference', text: 'No is the start of the negotiation, not the end of it. Most people hear no and stop.' }
const run = (answer, evidence = [E1, E2]) => validateCitations({ answer, evidence })

test('golden: handle, verified quote, author and book from the row', () => {
  const r = run({
    text: 'Clinics that hear nothing stop answering. Helmer argues the prepared mind wins. [E1]',
    citations: [{ handle: 'E1', quote: 'chance only favors the prepared mind' }],
  })
  assert.equal(r.status, 'ok')
  assert.deepEqual(r.sources, [{ handle: 'E1', author: 'Hamilton Helmer', book: '7 Powers - The Foundations of Business Strategy', quote: '…Chance only favors the prepared mind' }])
  assert.equal(r.text, 'Clinics that hear nothing stop answering. Helmer argues the prepared mind wins.')
  assert.deepEqual(r.flags, [])
})

test('quote at the start of a sentence gets no leading ellipsis, and shows as printed', () => {
  const v = verifyQuote('No is the start of the negotiation, not the end of it.', E2.text)
  assert.deepEqual(v, { ok: true, display: 'No is the start of the negotiation, not the end of it.' })
})

test('fabricated quote is stripped, lesson stays', () => {
  const r = run({ text: 'Voss says a no is a start.', citations: [{ handle: 'E2', quote: 'A no is just a yes in disguise' }] })
  assert.equal(r.status, 'ok')
  assert.equal(r.sources[0].quote, undefined)
  assert.equal(r.flags[0].type, 'unverified_quote')
})

test('ellipsis quote: each piece must match, in order', () => {
  const ok = run({ text: 'x y z.', citations: [{ handle: 'E2', quote: 'No is the start … Most people hear no and stop.' }] })
  assert.equal(ok.sources[0].quote, 'No is the start … Most people hear no and stop.')
  const wrongOrder = run({ text: 'x y z.', citations: [{ handle: 'E2', quote: 'Most people hear no ... No is the start of the negotiation' }] })
  assert.equal(wrongOrder.sources[0].quote, undefined)
  const oneBad = run({ text: 'x y z.', citations: [{ handle: 'E2', quote: 'No is the start of the negotiation … and then you win' }] })
  assert.equal(oneBad.sources[0].quote, undefined)
})

test('a quote that is too short to mean anything is not verified', () => {
  assert.equal(verifyQuote('no is', E2.text).ok, false)
})

test('wrong author in prose removes the sentence', () => {
  const r = run({
    text: 'Peter Thiel argues monopolies win. Silence kills deals. [E2]',
    citations: [{ handle: 'E2' }],
  })
  assert.equal(r.text, 'Silence kills deals.')
  assert.equal(r.flags[0].type, 'author_not_in_evidence')
})

test('an evidence author who was not cited is also removed', () => {
  const r = run({ text: 'Hamilton Helmer argues price is power. Silence kills deals.', citations: [{ handle: 'E2' }] })
  assert.equal(r.text, 'Silence kills deals.')
})

test('model-claimed author or book on the citation is overridden by the row', () => {
  const r = run({ text: 'Silence kills deals.', citations: [{ handle: 'E2', author: 'Peter Thiel', book: 'Zero to One' }] })
  assert.equal(r.sources[0].author, 'Chris Voss')
  assert.equal(r.sources[0].book, 'Never Split the Difference')
  assert.deepEqual(r.flags.map((f) => f.type), ['wrong_author', 'wrong_book'])
})

test('book named in prose that is not in the evidence is removed', () => {
  const r = run({ text: 'In "Zero to One" the point is made. Silence kills deals.', citations: [{ handle: 'E2' }] })
  assert.equal(r.text, 'Silence kills deals.')
  assert.equal(r.flags[0].type, 'book_not_in_evidence')
})

test('the cited book by name is fine', () => {
  const r = run({ text: 'In "Never Split the Difference" Chris Voss says a no opens the talk.', citations: [{ handle: 'E2' }] })
  assert.equal(r.status, 'ok')
  assert.deepEqual(r.flags, [])
})

test('invented chapter and page are dropped; real ones come from the row', () => {
  const bad = run({ text: 'A line.', citations: [{ handle: 'E2', chapter: 'Chapter 4', page: 88 }] })
  assert.equal(bad.sources[0].chapter, undefined)
  assert.equal(bad.sources[0].page_start, undefined)
  assert.deepEqual(bad.flags.map((f) => f.type), ['invented_chapter', 'invented_page'])
  const invented = run({ text: 'A line.', citations: [{ handle: 'E1', chapter: 'Chapter 9' }] })
  assert.equal(invented.sources[0].chapter, undefined)
  const good = run({ text: 'A line.', citations: [{ handle: 'E1', chapter: 'introduction', page: 13 }] })
  assert.equal(good.sources[0].chapter, 'Introduction')
  assert.equal(good.sources[0].page_start, 13)
})

test('unknown handle in citations or prose: flagged and removed', () => {
  const r = run({ text: 'Silence kills deals [E2]. Everyone knows this [E7].', citations: [{ handle: 'E2' }, { handle: 'E9' }] })
  assert.equal(r.text, 'Silence kills deals.')
  assert.deepEqual(r.flags.map((f) => f.type), ['unknown_handle', 'unknown_handle'])
})

test('no surviving source says nothing', () => {
  assert.deepEqual(run({ text: 'Studies show silence kills deals.', citations: [] }), { status: 'no_source', text: '', sources: [], flags: [] })
  const onlyBad = run({ text: 'Silence kills deals.', citations: [{ handle: 'E9' }] })
  assert.equal(onlyBad.status, 'no_source')
  assert.equal(onlyBad.text, '')
  assert.equal(run({ text: 'x', citations: [{ handle: 'E1' }] }, []).status, 'no_source')
  assert.equal(run(null).status, 'no_source')
})
