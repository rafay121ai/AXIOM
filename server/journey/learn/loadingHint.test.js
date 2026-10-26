import assert from 'node:assert/strict'
import test from 'node:test'
import { pickLoadingHint } from './loadingHint.js'

const lesson = (id, book, short_quote, text, pillars = ['how_companies_win']) => ({ lesson_id: id, source_title: book, author: 'Someone', page_start: 9, short_quote, paragraphs: [{ text }], pillars })
const GOOD_A = lesson('a_l00', '7 Powers', 'Chance only favors the prepared mind.', 'Pasteur’s dictum: “Chance only favors the prepared mind.” Strategy serves best.')
const GOOD_B = lesson('b_l00', 'Never Split the Difference', 'a negotiation, not the end of it', 'No is the start of a negotiation, not the end of it.', ['sales'])
const FAKE = lesson('c_l00', 'Play Bigger', 'Category kings take everything.', 'Categories matter a great deal to anyone building a company.')
const provider = (rows) => ({ lessons: () => rows })

test('returns the book name and the quote only', () => {
  const h = pickLoadingHint({ provider: provider([GOOD_A]), seed: 1 })
  assert.deepEqual(h, { lesson_id: 'a_l00', book: '7 Powers', quote: '…Chance only favors the prepared mind.' })
  assert.deepEqual(Object.keys(h).sort(), ['book', 'lesson_id', 'quote'])
})

test('a quote that is not in its lesson text is never picked', () => {
  assert.equal(pickLoadingHint({ provider: provider([FAKE]), seed: 1 }), null)
  assert.equal(pickLoadingHint({ provider: provider([FAKE, GOOD_A]), seed: 'x' }).lesson_id, 'a_l00')
})

test('deterministic for a seed, order of the provider does not matter', () => {
  const rows = [GOOD_A, GOOD_B]
  const a = pickLoadingHint({ provider: provider(rows), seed: 'msg-42' })
  const b = pickLoadingHint({ provider: provider([...rows].reverse()), seed: 'msg-42' })
  assert.deepEqual(a, b)
  const picks = new Set(Array.from({ length: 30 }, (_, i) => pickLoadingHint({ provider: provider(rows), seed: i }).lesson_id))
  assert.equal(picks.size, 2)
})

test('tags filter by pillar; no match means nothing', () => {
  assert.equal(pickLoadingHint({ provider: provider([GOOD_A, GOOD_B]), seed: 3, tags: ['sales'] }).lesson_id, 'b_l00')
  assert.equal(pickLoadingHint({ provider: provider([GOOD_A, GOOD_B]), seed: 3, tags: ['sleep'] }), null)
})

test('exclude keeps the hint away from the lesson quote', () => {
  assert.equal(pickLoadingHint({ provider: provider([GOOD_A, GOOD_B]), seed: 1, exclude: ['a_l00', 'b_l00'] }), null)
  assert.equal(pickLoadingHint({ provider: provider([GOOD_A, GOOD_B]), seed: 1, exclude: ['a_l00'] }).lesson_id, 'b_l00')
})

test('empty or missing provider returns null', () => {
  assert.equal(pickLoadingHint({ provider: provider([]), seed: 1 }), null)
  assert.equal(pickLoadingHint({ provider: undefined, seed: 1 }), null)
})
