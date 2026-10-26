import assert from 'node:assert/strict'
import test from 'node:test'
import { checkPicture, numbersIn, PICTURE_TYPES } from './pictures.js'

const FOUNDER = [
  'I have 2 clinics that asked for pricing three weeks ago',
  'We sell at $5k a year and I need 20 clinics, so 100k',
  'Last quarter 12 demos, 3 closed',
]
const check = (picture, extra = {}) => checkPicture({ picture, founderTexts: FOUNDER, ...extra })

test('the five picture types', () => {
  assert.deepEqual(PICTURE_TYPES, ['split_bar', 'before_after_bars', 'side_by_side_table', 'timeline', 'two_by_two'])
})

test('number reading: digits, commas, k, words', () => {
  assert.deepEqual(numbersIn('$5k, 1,200 and two clinics, 3.5 weeks'), [5000, 1200, 3.5, 2])
  assert.deepEqual(numbersIn('B2B and Q3'), [])
})

test('golden split bar: founder numbers only', () => {
  const r = check({ type: 'split_bar', data: { parts: [{ label: 'Closed', value: 3 }, { label: 'Did not close', value: 9 }] }, derived: [{ rule: 'difference', inputs: [12, 3], value: 9 }] })
  assert.equal(r.ok, true, r.problems.join())
  assert.equal(r.picture.type, 'split_bar')
})

test('a number the founder never gave is rejected', () => {
  const r = check({ type: 'split_bar', data: { parts: [{ label: 'Closed', value: 3 }, { label: 'Open', value: 40 }] } })
  assert.equal(r.ok, false)
  assert.match(r.problems.join(), /number is not from the founder.*40/)
})

test('a derived number needs a stated rule that recomputes', () => {
  const picture = (value) => ({
    type: 'before_after_bars',
    data: { unit: '%', items: [{ label: 'Close rate', before: 3, after: value }] },
    derived: [{ rule: 'percent_of', inputs: [3, 12], value }],
  })
  assert.equal(check(picture(25)).ok, true)
  const wrong = check(picture(30))
  assert.equal(wrong.ok, false)
  assert.match(wrong.problems.join(), /does not give 30/)
})

test('rule inputs must themselves come from the founder', () => {
  const r = check({ type: 'split_bar', data: { parts: [{ label: 'A', value: 4 }, { label: 'B', value: 3 }] }, derived: [{ rule: 'sum', inputs: [2, 2], value: 4 }] })
  assert.equal(r.ok, true)
  const r2 = check({ type: 'split_bar', data: { parts: [{ label: 'A', value: 14 }, { label: 'B', value: 3 }] }, derived: [{ rule: 'sum', inputs: [7, 7], value: 14 }] })
  assert.equal(r2.ok, false)
  assert.match(r2.problems.join(), /rule input is not from the founder/)
})

test('"5k" and "5,000" are the same number; 20 x 5k = 100k', () => {
  const r = check({
    type: 'side_by_side_table',
    data: { columns: ['Now', 'Goal'], rows: [{ label: 'Price', cells: ['5,000', '5,000'] }, { label: 'Yearly', cells: ['5,000', '100,000'] }] },
    derived: [{ rule: 'product', inputs: [20, 5000], value: 100000 }],
  })
  assert.equal(r.ok, true, r.problems.join())
})

test('a number from a verified passage is allowed', () => {
  const picture = { type: 'timeline', data: { events: [{ when: 'Day 1', label: 'Send the price' }, { when: 'Day 7', label: 'Follow up' }] } }
  assert.equal(check(picture).ok, false)
  assert.equal(check(picture, { passageTexts: ['Follow up within 7 days. Day 1 matters most.'] }).ok, true)
})

test('timeline and two_by_two golden', () => {
  assert.equal(check({ type: 'timeline', data: { events: [{ when: 'Three weeks ago', label: 'Asked for pricing' }, { when: 'Today', label: 'Send it' }] } }).ok, true)
  const box = check({
    type: 'two_by_two',
    data: { x: { low: 'Cheap', high: 'Costly' }, y: { low: 'Slow', high: 'Fast' }, quadrants: [{ label: 'Send now' }, { label: 'Wait' }, { label: 'Skip' }, { label: 'Ask' }] },
    interactive: true,
  })
  assert.equal(box.ok, true)
  assert.equal(box.picture.interactive, true)
})

test('bad shapes and unknown types are rejected; extra keys are dropped', () => {
  assert.equal(check({ type: 'pie_chart', data: {} }).ok, false)
  assert.equal(check({ type: 'split_bar', data: { parts: [{ label: 'One', value: 2 }] } }).ok, false)
  assert.equal(check({ type: 'timeline', data: { events: [{ when: 'Today', label: 'x'.repeat(61) }, { when: 'Today', label: 'y' }] } }).ok, false)
  assert.equal(check({ type: 'split_bar', data: { parts: [{ label: 'A', value: -2 }, { label: 'B', value: 3 }] } }).ok, false)
  const r = check({ type: 'timeline', data: { events: [{ when: 'Today', label: 'Send it', svg: '<svg/>' }, { when: 'Soon', label: 'Follow up' }], art: 'x' } })
  assert.equal(r.ok, true)
  assert.deepEqual(Object.keys(r.picture.data), ['events'])
  assert.deepEqual(Object.keys(r.picture.data.events[0]), ['when', 'label'])
})

test('a number hidden in a label counts too', () => {
  const r = check({ type: 'timeline', data: { events: [{ when: 'Today', label: 'Send 7 emails' }, { when: 'Soon', label: 'Follow up' }] } })
  assert.equal(r.ok, false)
  assert.match(r.problems.join(), /7/)
})
