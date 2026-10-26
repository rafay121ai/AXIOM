import assert from 'node:assert/strict'
import test from 'node:test'
import { asksWhatNext, decideMoveOffer, isRealReply, MOVE_NOTICE, AXIOM_LINES } from './moveOffer.js'

const ASKS = [
  'what should I do next', 'So what now?', 'ok but what do i do', 'What do I do?', "what's next", 'What is next', 'next step?',
  'give me the move', 'Tell me what to do', 'where do I start', 'how should I begin?', "what's my move", 'what now', 'what should we do now',
]
const NOT_ASKS = [
  'ok', 'makes sense', 'I will do it next week', 'the clinics did nothing next', 'what do clinics pay', 'I started the pricing page',
  'What does the book say about price', 'next to the door', '',
]

test('intent matcher: asking what to do next, in many wordings', () => {
  for (const t of ASKS) assert.equal(asksWhatNext(t), true, t)
})
test('intent matcher: ordinary sentences do not match', () => {
  for (const t of NOT_ASKS) assert.equal(asksWhatNext(t), false, t)
})

test('filler and one-word replies are not real replies', () => {
  for (const t of ['ok', 'Makes sense', 'yes', 'k', '   ']) assert.equal(isRealReply(t), false, t)
  assert.equal(isRealReply('I want a yes from both clinics this week'), true)
  assert.equal(isRealReply('what now'), true)
})

const REAL1 = 'I want them to say yes to the pilot'
const REAL2 = 'The one in Leeds is the easier one to close'

test('no offer after one real reply', () => {
  assert.deepEqual(decideMoveOffer({ replies: [REAL1] }), { offer: 'none', reason: null, realReplyCount: 1 })
})
test('filler does not count toward the two replies', () => {
  assert.equal(decideMoveOffer({ replies: [REAL1, 'ok'] }).offer, 'none')
  assert.equal(decideMoveOffer({ replies: ['ok', 'makes sense', REAL1] }).offer, 'none')
  assert.equal(decideMoveOffer({ replies: [REAL1, 'ok', REAL2] }).offer, 'first')
})
test('first offer on the second real reply', () => {
  assert.deepEqual(decideMoveOffer({ replies: [REAL1, REAL2] }), { offer: 'first', reason: 'replies', realReplyCount: 2 })
})
test('intent offers at once, even as the very first message', () => {
  assert.deepEqual(decideMoveOffer({ replies: ['ok but what do i do'] }), { offer: 'first', reason: 'intent', realReplyCount: 1 })
})
test('second offer needs a new real reply after the first, or intent', () => {
  const offers = [2]
  assert.equal(decideMoveOffer({ replies: [REAL1, REAL2, 'ok'], offers }).offer, 'none')
  assert.deepEqual(decideMoveOffer({ replies: [REAL1, REAL2, 'I will ask both clinics today'], offers }), { offer: 'second', reason: 'replies', realReplyCount: 3 })
  assert.equal(decideMoveOffer({ replies: [REAL1, REAL2, 'so what now'], offers }).reason, 'intent')
})
test('never more than two offers', () => {
  assert.deepEqual(decideMoveOffer({ replies: [REAL1, REAL2, REAL1, REAL2, 'what now'], offers: [2, 3] }), { offer: 'none', reason: 'cap', realReplyCount: 5 })
})

test('notice wording uses only the slots it is given', () => {
  assert.equal(MOVE_NOTICE.first.text({ subject: 'the two clinics' }), 'Your move for the two clinics is ready.')
  assert.equal(MOVE_NOTICE.first.text(), 'Your move is ready.')
  assert.equal(
    MOVE_NOTICE.second.text({ name: 'Rafay', fact: 'The two clinics have heard nothing from you for three weeks.' }),
    'It takes 10 minutes, Rafay. The two clinics have heard nothing from you for three weeks.',
  )
  assert.equal(MOVE_NOTICE.second.text({ name: 'Rafay' }), 'It takes 10 minutes, Rafay.')
  assert.equal(MOVE_NOTICE.second.kicker, 'Still waiting')
  assert.match(AXIOM_LINES.after_cap, /home screen/)
})
