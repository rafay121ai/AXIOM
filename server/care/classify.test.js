import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyCare, CARE_SCHEMA } from './classify.js'
import { callStructured, withoutLengths } from '../llm.js'
import { createFakeOpenAI } from '../testing/fakes.js'

const noModel = () => { throw new Error('model must not be called') }
const modelSays = (level) => async () => ({ data: { level, reason: 'test' } })
const modelFails = async () => { throw new Error('down') }
const run = (text, callStructuredFn = noModel) => classifyCare({ text, deps: { callStructured: callStructuredFn } })

test('business idioms are not distress and never reach the model', async () => {
  for (const text of [
    'We should kill the feature before launch',
    'Our burn rate is $42k a month',
    'We are killing it this quarter',
    'The pilot is dead in the water',
    "I'll die on this hill: pricing stays",
    'I want to die on this hill, honestly',
    'If we ship late we crash and burn',
    'We need to murder the competition on onboarding',
    'Cutting the price is commercial suicide',
    'The deadline is Friday',
    'Burning through cash faster than planned',
    'I am dying to ship this',
    'Dead code everywhere in the repo',
    'Plan the next 90 days for my SaaS',
  ]) {
    assert.equal((await run(text)).level, 'none', text)
  }
})

test('explicit words are clear without asking the model', async () => {
  for (const text of [
    'I want to kill myself', 'thinking about suicide', 'I am suicidal', 'I want to end my life', 'I want to die',
    'I want to take my own life', 'self harm', 'self-harm again', 'I keep hurting myself', 'kms', 'better off dead',
    'I wish I was dead', "I don't want to be alive anymore", 'quiero morir', 'ich will mich umbringen',
  ]) {
    assert.equal((await run(text)).level, 'clear', text)
  }
})

test('stretched letters, spacing and leetspeak are caught', async () => {
  assert.equal((await run('i want to kiiiiill myyyyself')).level, 'clear')
  assert.equal((await run('suiciiiide')).level, 'clear')
  assert.equal((await run('su1c1de')).level, 'clear')
  assert.equal((await run('k1ll mys3lf')).level, 'clear')
  assert.equal((await run('s.u.i.c.i.d.e')).level, 'clear')
  assert.equal((await run('SUICIDE')).level, 'clear')
})

test('slang and ambiguous text is unclear and the model may raise it', async () => {
  for (const text of ['i wanna dieee', 'dieee', "can't do this anymore", 'I just want to disappear', 'this is killing me']) {
    assert.equal((await run(text, modelSays('none'))).level, 'unclear', text)
  }
  assert.equal((await run('i wanna dieee', modelSays('clear'))).level, 'clear')
})

test('the model can only raise: never lowers a rule clear or unclear', async () => {
  assert.equal((await run('I want to kill myself', noModel)).level, 'clear')
  assert.equal((await run("can't do this anymore", modelSays('none'))).level, 'unclear')
})

test('weak signals go to the model, which may raise from none', async () => {
  assert.equal((await run('everything feels hopeless', modelSays('none'))).level, 'none')
  assert.equal((await run('everything feels hopeless', modelSays('unclear'))).level, 'unclear')
  assert.equal((await run('everything feels hopeless', modelSays('clear'))).level, 'clear')
})

test('model failure fails safe to unclear for ambiguous text, never none', async () => {
  const out = await run('everything feels hopeless', modelFails)
  assert.equal(out.level, 'unclear')
  assert.equal(out.reason, 'model_failed')
  assert.equal((await classifyCare({ text: 'nothing matters', deps: {} })).level, 'unclear')
  assert.equal((await run("can't do this anymore", modelFails)).level, 'unclear')
})

test('plain text does not call the model', async () => {
  assert.equal((await run('Here is my pricing page and three customer emails')).level, 'none')
  assert.equal((await run('')).level, 'none')
})

test('real callStructured path: step is care, schema is strict, usage is logged', async () => {
  const openai = createFakeOpenAI([JSON.stringify({ level: 'unclear', reason: 'could be distress' })])
  const usage = []
  const deps = {
    userId: 'u1',
    callStructured: (args) => callStructured({ openai, logModelUsage: async (r) => usage.push(r), ...args }),
  }
  const out = await classifyCare({ text: 'what is the point of any of it, i feel hopeless', context: ['earlier message'], deps })
  assert.equal(out.level, 'unclear')
  assert.equal(openai.calls.length, 1)
  assert.equal(openai.calls[0].payload.response_format.json_schema.strict, true)
  assert.deepEqual(openai.calls[0].payload.response_format.json_schema.schema, withoutLengths(CARE_SCHEMA))
  assert.equal(usage.length, 1)
})

test('invalid model output twice fails safe', async () => {
  const openai = createFakeOpenAI(['{"level":"maybe"}', 'nope'])
  const deps = { callStructured: (args) => callStructured({ openai, logModelUsage: async () => {}, ...args }) }
  assert.equal((await classifyCare({ text: 'i feel hopeless', deps })).level, 'unclear')
})
