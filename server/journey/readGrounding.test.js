// The grounding check on a Read (Rafay, Nov 19): one cheap call after the code checks; a claim the founder never made is sent back;
// the check fails open and is skipped at the daily cap. Fakes only, anonymised fixture.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createRead } from './theRead.js'

const CONVERSATION = [
  { role: 'founder', text: 'I run a small clinic scheduling tool and two clinics asked for pricing three weeks ago.' },
  { role: 'axiom', text: 'What happened after they asked?' },
  { role: 'founder', text: 'I have not sent the price yet.' },
]
const GOOD = {
  headline: 'The price is the only thing between you and two answers.',
  body: 'Two clinics asked for it three weeks ago and nothing has gone back to them. Every day without a price makes their silence look like a no.',
  closing_question: 'What stops you sending the clinics a price today?',
}
const INVENTED = { ...GOOD, body: 'Two clinics asked for it three weeks ago, and you are avoiding the price because you fear rejection. Every day makes it harder to send.' }

function run({ reads, grounding = { unsupported: [] }, groundingError = false, capped = false, off = false }) {
  const calls = []
  const queue = [...reads]
  const callStructured = async (call) => {
    calls.push(call)
    if (call.schemaName === 'read_grounding') {
      if (groundingError) throw new Error('boom')
      return { data: grounding }
    }
    return { data: queue.shift() }
  }
  const result = createRead({
    conversation: CONVERSATION, situationId: 's1', deps: { callStructured, userId: 'u1', log: () => {} },
    grounding: off ? null : { isCapped: async () => capped },
  })
  return { calls, result }
}

test('a supported Read passes after one cheap grounding call on the beliefs model step', async () => {
  const { calls, result } = run({ reads: [GOOD] })
  const out = await result
  assert.equal(out.source, 'model')
  assert.deepEqual(calls.map((c) => c.schemaName), ['read', 'read_grounding'])
  const judge = calls[1]
  assert.equal(judge.step, 'beliefs')
  assert.equal(judge.maxCompletionTokens, 300)
  assert.equal(judge.usageContext.kind, 'read_grounding')
  assert.deepEqual(Object.keys(JSON.parse(judge.messages.at(-1).content)), ['conversation', 'brief', 'read'])
})

test('a Read with an invented motive is rejected, retried with the claim named, then accepted', async () => {
  const claims = ['you are avoiding the price because you fear rejection']
  const queue = [{ unsupported: claims }, { unsupported: [] }]
  const calls = []
  const reads = [INVENTED, GOOD]
  const out = await createRead({
    conversation: CONVERSATION, situationId: 's1', deps: { userId: 'u1', callStructured: async (c) => { calls.push(c); return { data: c.schemaName === 'read_grounding' ? queue.shift() : reads.shift() } } },
    grounding: { isCapped: async () => false },
  })
  assert.equal(out.source, 'model')
  assert.equal(out.read.body, GOOD.body)
  assert.deepEqual(calls.map((c) => c.schemaName), ['read', 'read_grounding', 'read', 'read_grounding'])
  assert.match(calls[2].messages.at(-1).content, /fear rejection/)
})

test('a Read still unsupported on the second try ends in the plain fallback', async () => {
  const { result } = run({ reads: [INVENTED, INVENTED], grounding: { unsupported: ['fear rejection'] } })
  assert.equal((await result).source, 'fallback')
})

test('the check fails open: an error, a bad output, or the daily cap lets the Read through', async () => {
  for (const [name, args] of [['error', { groundingError: true }], ['bad output', { grounding: { nope: 1 } }], ['not an array', { grounding: { unsupported: 'x' } }]]) {
    const { result } = run({ reads: [GOOD], ...args })
    assert.equal((await result).source, 'model', name)
  }
  const capped = run({ reads: [GOOD], capped: true, grounding: { unsupported: ['anything'] } })
  assert.equal((await capped.result).source, 'model')
  assert.deepEqual(capped.calls.map((c) => c.schemaName), ['read']) // no paid call at the cap
})

test('switched off: no grounding call at all', async () => {
  const { calls, result } = run({ reads: [GOOD], off: true })
  await result
  assert.deepEqual(calls.map((c) => c.schemaName), ['read'])
})
