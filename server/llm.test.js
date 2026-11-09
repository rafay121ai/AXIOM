import assert from 'node:assert/strict'
import test from 'node:test'
import { callStructured, StructuredOutputError, validateAgainstSchema } from './llm.js'
import { createUsageLogger } from './modelUsage.js'
import { modelForStep, LIMITS } from './config.js'
import { createFakeOpenAI, createFakeSupabase } from './testing/fakes.js'

const SCHEMA = {
  type: 'object',
  properties: { headline: { type: 'string', minLength: 1 }, steps: { type: 'array', items: { type: 'string' }, maxItems: 2 } },
  required: ['headline'],
  additionalProperties: false,
}
const USER_ID = '11111111-1111-4111-8111-111111111111'
const messages = [{ role: 'user', content: 'situation' }]

function setup(script, env = {}) {
  const openai = createFakeOpenAI(script)
  const supabase = createFakeSupabase()
  const { logModelUsage } = createUsageLogger({ supabase, log: { log() {}, error() {} } })
  const run = (extra = {}) => callStructured({ openai, logModelUsage, step: 'read', schema: SCHEMA, messages, userId: USER_ID, env, ...extra })
  return { openai, supabase, run }
}

test('validateAgainstSchema reports type, missing, extra and bound problems', () => {
  assert.deepEqual(validateAgainstSchema({ headline: 'x' }, SCHEMA), [])
  assert.ok(validateAgainstSchema({}, SCHEMA).some((p) => /headline: missing/.test(p)))
  assert.ok(validateAgainstSchema({ headline: 1 }, SCHEMA).some((p) => /expected string/.test(p)))
  assert.ok(validateAgainstSchema({ headline: 'x', extra: 1 }, SCHEMA).some((p) => /extra: not allowed/.test(p)))
  assert.ok(validateAgainstSchema({ headline: 'x', steps: ['a', 'b', 'c'] }, SCHEMA).some((p) => /too many/.test(p)))
})

test('callStructured returns valid output on the first try', async () => {
  const { run, openai } = setup(['{"headline":"Rent is due"}'])
  const out = await run()
  assert.deepEqual(out.data, { headline: 'Rent is due' })
  assert.equal(out.attempts, 1)
  assert.equal(openai.calls.length, 1)
  assert.equal(openai.calls[0].payload.response_format.type, 'json_schema')
})

test('string lengths are not sent to the model but still enforced (a cut-off live Read, Nov 9)', async () => {
  const schema = { type: 'object', properties: { body: { type: 'string', minLength: 2, maxLength: 5 } }, required: ['body'], additionalProperties: false }
  const { openai, supabase } = setup(['{"body":"far too long"}', '{"body":"short"}'])
  const { logModelUsage } = createUsageLogger({ supabase, log: { log() {}, error() {} } })
  const out = await callStructured({ openai, logModelUsage, step: 'read', schema, messages, userId: USER_ID })
  assert.deepEqual(out.data, { body: 'short' })
  assert.equal(out.attempts, 2)
  const sent = openai.calls[0].payload.response_format.json_schema.schema
  assert.deepEqual(sent.properties.body, { type: 'string' })
  assert.deepEqual(sent.required, ['body'])
  assert.match(openai.calls[1].payload.messages.at(-1).content, /body: too long/)
})

test('callStructured retries once on invalid JSON, then succeeds', async () => {
  const { run, openai, supabase } = setup(['not json', '{"headline":"ok"}'])
  const out = await run()
  assert.equal(out.attempts, 2)
  assert.equal(openai.calls.length, 2)
  assert.equal(supabase.rows('model_usage_logs').length, 2)
})

test('callStructured retries once on a schema violation and then throws', async () => {
  const { run, openai } = setup(['{"nope":1}', '{"headline":5}', '{"headline":"never reached"}'])
  await assert.rejects(run(), (err) => err instanceof StructuredOutputError && err.step === 'read')
  assert.equal(openai.calls.length, 2)
})

test('callStructured takes the model from config, not from the caller', async () => {
  const { run, openai } = setup(['{"headline":"a"}'], { MODEL_READ: 'gpt-5.4-mini' })
  await run({ model: 'attacker-model' })
  assert.equal(openai.calls[0].payload.model, 'gpt-5.4-mini')
})

test('callStructured writes a usage row with tokens and cost', async () => {
  const { run, supabase } = setup([{ content: '{"headline":"a"}', usage: { prompt_tokens: 1_000_000, completion_tokens: 0, total_tokens: 1_000_000 } }])
  await run()
  const [row] = supabase.rows('model_usage_logs')
  assert.equal(row.user_id, USER_ID)
  assert.equal(row.model, modelForStep('read', {}))
  assert.equal(row.total_tokens, 1_000_000)
  assert.equal(row.estimated_cost_usd, 1.75)
})

test('callStructured logs a failed call and rethrows', async () => {
  const { run, supabase } = setup([new Error('upstream down')])
  await assert.rejects(run(), /upstream down/)
  const [row] = supabase.rows('model_usage_logs')
  assert.equal(row.error, true)
})

test('config: unknown step throws, limits are fixed', () => {
  assert.throws(() => modelForStep('nope', {}), /Unknown model step/)
  assert.equal(LIMITS.MAX_FOLLOW_UPS, 2)
  assert.equal(LIMITS.MAX_ACTIVE_MOVES, 2)
  assert.equal(LIMITS.MAX_PUSH_PER_DAY, 2)
})
