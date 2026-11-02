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
