// The grounding check on a Read (Rafay, Nov 19): one cheap call after the code checks; a claim the founder never made is sent back;
// the check fails open and is skipped at the daily cap. Fakes only, anonymised fixture.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createFirstReading } from './firstReading.js'
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

function run({ reads, grounding = { unsupported: [] }, groundingError = false, capped = false, off = false, log = () => {} }) {
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
    conversation: CONVERSATION, situationId: 's1', deps: { callStructured, userId: 'u1', log },
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
  assert.equal(judge.timeoutMs, 8000) // slowness fails open
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
  assert.deepEqual(calls.map((c) => c.schemaName), ['read', 'read_grounding', 'read', 'read_grounding']) // every draft that could ship is checked
  assert.match(calls[2].messages.at(-1).content, /fear rejection/)
})

test('a draft the grounding check objects to never ships, on any attempt: the fallback is used', async () => {
  const logs = []
  const { result, calls } = run({ reads: [INVENTED, INVENTED, INVENTED], grounding: { unsupported: ['fear rejection'] }, log: (...a) => logs.push(a) })
  assert.equal((await result).source, 'fallback')
  assert.equal(calls.filter((c) => c.schemaName === 'read_grounding').length, 3)
  assert.deepEqual(logs.find((l) => l[0] === 'grounding objected')?.[1], { claims: ['fear rejection'] })
})

// Style-only drafts (a closing question with no thread of theirs) used to ship without grounding ever running on them.
const STYLE_ONLY = { ...GOOD, closing_question: 'What is your biggest fear?' }
function scriptedGrounding(verdicts) {
  const calls = []
  const reads = [INVENTED, STYLE_ONLY, STYLE_ONLY]
  const result = createRead({
    conversation: CONVERSATION, situationId: 's1', grounding: { isCapped: async () => false },
    deps: { userId: 'u1', callStructured: async (c) => { calls.push(c.schemaName); return { data: c.schemaName === 'read_grounding' ? verdicts.shift() : reads.shift() } } },
  })
  return { calls, result }
}

test('a style-only draft ships only after grounding ran on it and found nothing', async () => {
  const ok = scriptedGrounding([{ unsupported: ['fear rejection'] }, { unsupported: [] }])
  const out = await ok.result
  assert.equal(out.source, 'model')
  assert.equal(out.read.closing_question, STYLE_ONLY.closing_question)
  assert.deepEqual(ok.calls, ['read', 'read_grounding', 'read', 'read', 'read_grounding'])
})

test('a style-only draft the grounding check objects to is not eligible: the fallback is used', async () => {
  const bad = scriptedGrounding([{ unsupported: ['fear rejection'] }, { unsupported: ['they want to quit'] }, { unsupported: ['they want to quit'] }])
  assert.equal((await bad.result).source, 'fallback')
  assert.equal(bad.calls.filter((c) => c === 'read_grounding').length, 3)
})

test('a code-rule failure on the last attempt still falls back, and the fallback is logged', async () => {
  const logs = []
  const { result } = run({ reads: [{ ...INVENTED, body: 'Too short.' }, { ...INVENTED, body: 'Too short.' }], log: (...a) => logs.push(a) })
  assert.equal((await result).source, 'fallback')
  assert.ok(logs.some((l) => l[0] === 'read fell back'))
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

// The first reading uses the same check, with the sign-up answers as what the founder said.
const ANSWERS = { stage: { value: 'Someone is paying me' }, commitment: { value: 'Evenings and weekends, under 15 hours' } }
const SUPPORTED = { headline: 'Someone pays you, and the week is short.', body: 'Someone is paying you while you give it evenings and weekends. Which part of the week could the paying customer have more of?', underlines: [] }
const MOTIVE = { ...SUPPORTED, body: 'Someone is paying you while you give it evenings and weekends, protecting your freedom by avoiding commitment. Which part of the week could the paying customer have more of?' }

function first({ readings, judge, capped = false, off = false, log = () => {} }) {
  const calls = []
  const queue = [...readings]
  const verdicts = [...judge]
  const callStructured = async (call) => {
    calls.push(call.schemaName)
    if (call.schemaName === 'read_grounding') {
      const v = verdicts.shift()
      if (v instanceof Error) throw v
      return { data: v }
    }
    return { data: queue.shift() }
  }
  return { calls, result: createFirstReading({ answers: ANSWERS, deps: { callStructured, userId: 'u1', log }, grounding: off ? null : { isCapped: async () => capped } }) }
}

test('first reading: a supported reading passes after one grounding call', async () => {
  const { calls, result } = first({ readings: [SUPPORTED], judge: [{ unsupported: [] }] })
  assert.equal((await result).source, 'model')
  assert.deepEqual(calls, ['first_reading', 'read_grounding'])
})

test('first reading: an invented motive is rejected, then retried with the claim named', async () => {
  const sent = []
  const queue = [MOTIVE, SUPPORTED]
  const verdicts = [{ unsupported: ['protecting your freedom by avoiding commitment'] }, { unsupported: [] }]
  const out = await createFirstReading({
    answers: ANSWERS, grounding: { isCapped: async () => false },
    deps: { userId: 'u1', callStructured: async (c) => { sent.push(c); return { data: c.schemaName === 'read_grounding' ? verdicts.shift() : queue.shift() } } },
  })
  assert.equal(out.source, 'model')
  assert.equal(out.reading.body, SUPPORTED.body)
  assert.match(sent[2].messages.at(-1).content, /avoiding commitment/)
})

test('first reading: the judge runs once, and a fresh objection on the last attempt uses the plain reading', async () => {
  const logs = []
  const { calls, result } = first({ readings: [MOTIVE, MOTIVE], judge: [{ unsupported: ['avoiding commitment'] }], log: (...a) => logs.push(a) })
  assert.equal((await result).source, 'model')
  assert.deepEqual(calls, ['first_reading', 'read_grounding', 'first_reading'])
  assert.ok(logs.some((l) => l[0] === 'grounding objected, shipped'))
  const last = first({ readings: [{ ...SUPPORTED, body: 'You give it 99 hours a week.' }, MOTIVE], judge: [{ unsupported: ['avoiding commitment'] }], log: (...a) => logs.push(a) })
  // Changed in replay 4: a fresh objection on the last attempt of the FIRST reading is not shipped; the plain reading is used and logged.
  assert.equal((await last.result).source, 'fallback')
  assert.deepEqual(last.calls, ['first_reading', 'first_reading', 'read_grounding'])
  assert.ok(logs.some((l) => l[0] === 'grounding objected on the last attempt, plain reading used'))
})

test('first reading: a failed judge, the cap and the kill switch all let the reading through', async () => {
  for (const args of [{ judge: [new Error('boom')] }, { judge: [], capped: true }, { judge: [], off: true }]) {
    const { calls, result } = first({ readings: [SUPPORTED], ...args })
    assert.equal((await result).source, 'model')
    assert.equal(calls.includes('read_grounding'), args.judge.length > 0)
  }
})
