import assert from 'node:assert/strict'
import test from 'node:test'
import { ABOUT_AXIOM, ABOUT_CLOSING, aboutAxiomText, asksAboutAxiom } from './aboutAxiom.js'
import { BANNED_PHRASES, wordRx, norm } from './ownWords.js'

test('questions about Axiom itself are caught; real situations are not', () => {
  for (const q of ['What is Axiom?', 'what is axiom', 'What can I use you for?', 'what can you do', 'How does this work?', 'Who are you?', 'How can you help me?', 'how does axiom work']) {
    assert.equal(asksAboutAxiom(q), true, q)
  }
  for (const q of [
    'I built a boxing coaching app and I cannot decide how to price it.',
    'What can I do about my cofounder leaving next week?',
    'My investor asked what Axiom-style coaching would cost us and I froze, now the deck is due Friday and I have not started.',
    'How do I tell my first customer the price is going up?',
  ]) assert.equal(asksAboutAxiom(q), false, q)
})

test('the answer is the approved wording, plus the founder\'s own last situation and open move when they have them', () => {
  const fresh = aboutAxiomText()
  assert.equal(fresh, [...ABOUT_AXIOM, ABOUT_CLOSING].join('\n\n'))
  const theirs = aboutAxiomText({ lastTitle: 'choosing payment plans for boxing app', openMove: 'Ask the 18 active users which billing plan they would pick.' })
  assert.match(theirs, /Last time it was "choosing payment plans for boxing app", and your move to ask the 18 active users which billing plan they would pick is still open\./)
  assert.match(aboutAxiomText({ lastTitle: 'hiring a designer' }), /Last time it was "hiring a designer"\./)
  for (const b of BANNED_PHRASES) assert.equal(wordRx(b).test(norm(theirs)), false, b)
})
