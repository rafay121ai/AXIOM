import assert from 'node:assert/strict'
import test from 'node:test'
import { checkReply } from './reply.js'

const evidence = [{ handle: 'E1', chunk_id: 'c1', author: 'Reid Hoffman', source_title: 'Blitzscaling', text: 'Distribution is a core link in the chain.', similarity: 0.4 }]

// Rafay, Nov 2: a live lesson said "The evidence says ...", the internal name for the passages.
test('a sentence that calls the passages "the evidence" never reaches the founder', () => {
  const data = { reply: 'You have a prototype and no customers yet. The evidence says distribution is a core link. Who will you ask first?', citations: [{ handle: 'E1' }] }
  const { reply, problems } = checkReply({ data, mode: 'lesson', evidence, founderTexts: ['I have a prototype and no customers yet'] })
  assert.ok(problems.includes('a banned phrase'))
  assert.doesNotMatch(JSON.stringify(reply), /evidence/i)
})

// Rafay, Nov 2: a follow-up with six passages cited none and read the same for any founder.
test('a follow-up that cites none of its passages is sent back once', () => {
  const data = { reply: 'You have a prototype and no customers yet. Ask three people who would use it to try it this week.', citations: [] }
  const { problems } = checkReply({ data, mode: 'followup', evidence, founderTexts: ['I have a prototype and no customers yet'] })
  assert.ok(problems.some((p) => p.includes('citations')))
})

test('a follow-up with no passages to use is not asked to cite', () => {
  const data = { reply: 'You have a prototype and no customers yet. Ask three people who would use it to try it this week.', citations: [] }
  const { problems } = checkReply({ data, mode: 'followup', evidence: [], founderTexts: ['I have a prototype and no customers yet'] })
  assert.ok(!problems.some((p) => p.includes('citations')))
})

// Rafay, Nov 2: lessons read like a chatbot with sources pinned below. A cited author may be named; others may not.
const two = [...evidence, { handle: 'E2', chunk_id: 'c2', author: 'Paul Graham', source_title: "Do Things That Don't Scale", text: 'Do things that do not scale at the start.', similarity: 0.4 }]
const founder = ['I have a prototype and no customers yet']

test('a sentence naming the author it cites stays', () => {
  const data = { reply: "You have a prototype and no customers yet. Paul Graham's point in Do Things That Don't Scale is to do the slow work by hand first. Who will you call today?", citations: [{ handle: 'E2' }] }
  const { reply, problems } = checkReply({ data, mode: 'lesson', evidence: two, founderTexts: founder })
  assert.ok(!problems.some((p) => p.includes('did not cite')), problems.join('; '))
  assert.match(reply.text, /Paul Graham/)
})

test('a sentence naming an author it did not cite is dropped', () => {
  const data = { reply: 'You have a prototype and no customers yet. Reid Hoffman thinks distribution is the core link. Who will you call today?', citations: [{ handle: 'E2' }] }
  const { reply, problems } = checkReply({ data, mode: 'lesson', evidence: two, founderTexts: founder })
  assert.ok(problems.includes('names an author or book it did not cite'))
  assert.doesNotMatch(reply.text, /Hoffman/)
})

// Rafay, Nov 2: "How I Built This" is Guy Raz's show; the words were Brian Chesky's. The guest gets the credit.
test('the guest named in an interview title may be credited', () => {
  const show = [{ handle: 'E1', chunk_id: 'c3', author: 'Guy Raz', source_title: 'How I Built This — Airbnb Brian Chesky', text: 'The final thing was payments.', similarity: 0.4 }]
  const data = { reply: 'You have a prototype and no customers yet. Brian Chesky says the final thing they built was payments. Who will you ask first?', citations: [{ handle: 'E1' }] }
  const { reply, problems } = checkReply({ data, mode: 'lesson', evidence: show, founderTexts: founder })
  assert.ok(!problems.some((p) => p.includes('author')), problems.join('; '))
  assert.match(reply.text, /Brian Chesky/)
})

// Rafay, Nov 2: a live lesson cited Eric Ries but never named him in the text.
test('a lesson that cites a passage but never names its author is sent back', () => {
  const data = { reply: 'You have a prototype and no customers yet. Do the slow work by hand first. Who will you call today?', citations: [{ handle: 'E2' }] }
  const { problems } = checkReply({ data, mode: 'lesson', evidence: two, founderTexts: founder })
  assert.ok(problems.includes('name the author of the passage you cite in the sentence that uses it'))
})

test('naming the author of a cited passage stays when another passage from the same book was not cited', () => {
  const sameBook = [...two, { handle: 'E3', chunk_id: 'c4', author: 'Paul Graham', source_title: "Do Things That Don't Scale", text: 'Recruit users by hand.', similarity: 0.39 }]
  const data = { reply: "You have a prototype and no customers yet. Paul Graham's point is to recruit them by hand. Who will you call today?", citations: [{ handle: 'E2' }] }
  const { reply, problems } = checkReply({ data, mode: 'lesson', evidence: sameBook, founderTexts: founder })
  assert.ok(!problems.some((p) => p.includes('did not cite')), problems.join('; '))
  assert.match(reply.text, /Paul Graham/)
})
