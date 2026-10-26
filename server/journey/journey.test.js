import assert from 'node:assert/strict'
import test from 'node:test'
import { createApp } from '../app.js'
import { createFakeClock, createFakeOpenAI, createFakeSupabase } from '../testing/fakes.js'
import { QUESTIONS, validateAnswer, questionByKey } from './questions.js'
import { FULL_ANSWERS } from './fixtures.js'

const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'founder@example.com' }
const ENV = { FRONTEND_URL: 'https://app.example.com' }
const NOW = Date.parse('2026-10-26T09:00:00.000Z')

async function setup(script = []) {
  const supabase = createFakeSupabase({ users: { tok: USER } })
  const openai = createFakeOpenAI(script)
  const app = createApp({ env: ENV, supabase, openai, clock: createFakeClock(NOW) })
  const server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  const base = `http://127.0.0.1:${server.address().port}`
  const call = async (method, path, body) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    return { status: res.status, body: text.startsWith('{') ? JSON.parse(text) : text }
  }
  const put = (key, answer) => call('PUT', `/api/signup/answers/${key}`, { answer })
  const raw = (path, init) => fetch(`${base}${path}`, init)
  const close = () => new Promise((r) => server.close(r))
  return { supabase, openai, call, put, raw, close }
}

const saveAll = async (put, answers = FULL_ANSWERS) => {
  for (const [key, answer] of Object.entries(answers)) assert.equal((await put(key, answer)).status, 200, key)
}

// ── Validation (pure) ────────────────────────────────────────────────────────

const v = (key, raw) => validateAnswer(questionByKey(key), raw, { now: NOW })

test('there are 13 questions and none has more than 5 options', () => {
  assert.equal(QUESTIONS.length, 13)
  for (const q of QUESTIONS) {
    const lists = [q.options, q.goals, q.whens, q.customers, ...(q.groups?.map((g) => g.options) ?? [])].filter(Boolean)
    for (const l of lists) assert.ok(l.length <= 5, q.key)
  }
})

test('every fixture answer is valid', () => {
  for (const [key, answer] of Object.entries(FULL_ANSWERS)) assert.deepEqual(v(key, answer), { ok: true, value: answer }, key)
})

test('single choice: only listed options, write-in only on Other', () => {
  assert.equal(v('stage', { value: 'Whatever' }).ok, false)
  assert.equal(v('stage', 'Just an idea').ok, false)
  assert.equal(v('stage', { value: 'Just an idea', other: 'x' }).ok, false)
  assert.equal(v('background', { value: 'Other' }).ok, true)
  assert.equal(v('background', { value: 'Other', other: 'x'.repeat(81) }).ok, false)
  assert.equal(v('background', { value: 'Other', other: '  ran a farm ' }).value.other, 'ran a farm')
})

test('where: country required, customers from the list', () => {
  assert.equal(v('where', { country: '', customers: 'Both' }).ok, false)
  assert.equal(v('where', { country: 'Kenya', customers: 'Nowhere' }).ok, false)
  assert.equal(v('where', { country: 'x'.repeat(81), customers: 'Both' }).ok, false)
  assert.equal(v('where', { country: 'Kenya' }).ok, false)
})

test('goal: a date is needed with "Pick a date", and must be real and not in the past', () => {
  assert.equal(v('goal', { goal: 'Ship it', when: 'Pick a date' }).ok, false)
  assert.equal(v('goal', { goal: 'Ship it', when: 'Pick a date', date: '2026-02-30' }).ok, false)
  assert.equal(v('goal', { goal: 'Ship it', when: 'Pick a date', date: '2026-10-25' }).ok, false)
  assert.equal(v('goal', { goal: 'Ship it', when: 'Pick a date', date: '2027-03-01' }).ok, true)
  assert.equal(v('goal', { goal: 'Ship it', when: 'This month', date: '2027-03-01' }).ok, false)
})

test('Q10: multi-select from each group, no duplicates, no foreign options', () => {
  assert.equal(v('strengths', { a: [], b: [] }).ok, true)
  assert.equal(v('strengths', { a: ['Selling', 'Selling'], b: [] }).ok, false)
  assert.equal(v('strengths', { a: ['Pricing'], b: [] }).ok, false)
  assert.equal(v('strengths', { a: ['Selling', 'Building the product', 'Numbers and planning', 'Leading people', 'Not quitting', 'Selling'], b: [] }).ok, false)
})

test('Q11: none of it yet is exclusive, and at least one pick', () => {
  assert.equal(v('tried', ['None of it yet']).ok, true)
  assert.equal(v('tried', ['None of it yet', 'Launched it']).ok, false)
  assert.equal(v('tried', []).ok, false)
  assert.equal(v('tried', ['Launched it', 'Built a prototype']).ok, true)
})

test('text answers: minimum and maximum length', () => {
  assert.equal(v('building', 'too short').ok, false)
  assert.equal(v('stuck', 'x'.repeat(19)).ok, false)
  assert.equal(v('stuck', 'x'.repeat(2001)).ok, false)
  assert.equal(v('stuck', 12345).ok, false)
  assert.equal(v('building', '  a real sentence here  ').value, 'a real sentence here')
})

// ── API: save, resume, idempotent ────────────────────────────────────────────

test('every journey route needs a token', async () => {
  const { raw, close } = await setup()
  try {
    assert.equal((await raw('/api/signup')).status, 401)
    assert.equal((await raw('/api/signup/answers/stage', { method: 'PUT' })).status, 401)
    assert.equal((await raw('/api/first-reading', { method: 'POST' })).status, 401)
  } finally { await close() }
})

test('GET starts at question 1; saving moves next on; GET resumes where it stopped', async () => {
  const { call, put, close } = await setup()
  try {
    const first = await call('GET', '/api/signup')
    assert.equal(first.status, 200)
    assert.equal(first.body.questions.length, 13)
    assert.equal(first.body.next, 'stage')
    assert.equal(first.body.complete, false)

    await put('stage', FULL_ANSWERS.stage)
    const saved = await put('months_in', FULL_ANSWERS.months_in)
    assert.equal(saved.body.next, 'commitment')

    const resumed = await call('GET', '/api/signup')
    assert.deepEqual(Object.keys(resumed.body.answers), ['stage', 'months_in'])
    assert.equal(resumed.body.next, 'commitment')
  } finally { await close() }
})

test('saving the same answer twice leaves one row with one answer; changing it replaces it', async () => {
  const { supabase, put, call, close } = await setup()
  try {
    await put('stage', FULL_ANSWERS.stage)
    await put('stage', FULL_ANSWERS.stage)
    assert.equal(supabase.rows('founder_profiles').length, 1)
    await put('stage', { value: 'Just an idea' })
    const rows = supabase.rows('founder_profiles')
    assert.equal(rows.length, 1)
    assert.deepEqual(rows[0].signup_answers, { stage: { value: 'Just an idea' } })
    assert.equal(rows[0].stage, 'idea')
    assert.equal((await call('GET', '/api/signup')).body.next, 'months_in')
  } finally { await close() }
})

test('mirrors fill the existing columns', async () => {
  const { supabase, put, close } = await setup()
  try {
    await saveAll(put)
    const row = supabase.rows('founder_profiles')[0]
    assert.equal(row.stage, 'validating')
    assert.equal(row.business_model, 'b2b')
    assert.equal(row.country, 'Pakistan')
    assert.equal(row.goal, 'My first 10 customers, in 3 months')
    assert.equal(row.deadline, '2027-01-26')
    assert.equal(Object.keys(row.signup_answers).length, 13)
  } finally { await close() }
})

test('bad key is 404, bad answer is 400 and stores nothing', async () => {
  const { supabase, put, close } = await setup()
  try {
    assert.equal((await put('nope', { value: 'x' })).status, 404)
    assert.equal((await put('stage', { value: 'Moonlighting' })).status, 400)
    assert.equal((await put('tried', ['None of it yet', 'Launched it'])).status, 400)
    assert.equal(supabase.rows('founder_profiles').length, 0)
  } finally { await close() }
})

test('care gate: a clear signal in a free-text answer returns the care payload and saves nothing', async () => {
  const { supabase, openai, put, close } = await setup()
  try {
    const res = await put('stuck', 'Honestly I want to kill myself, the clinics never answered me.')
    assert.equal(res.status, 200)
    assert.equal(res.body.care, 'clear')
    assert.equal(supabase.rows('founder_profiles').length, 0)
    assert.equal(supabase.rows('care_events').length, 1)
    assert.equal(openai.calls.length, 0)
    const wrote = await put('background', { value: 'Other', other: 'I want to end my life' })
    assert.equal(wrote.body.care, 'clear')
  } finally { await close() }
})

// ── First reading ────────────────────────────────────────────────────────────

const reading = (over = {}) => JSON.stringify({
  headline: 'The clinics asked for pricing and have heard nothing since.',
  body: 'You wrote that you have a demo ready. You also wrote "I have not emailed the 2 clinics that asked for pricing three weeks ago". Nobody pays yet, and you are working evenings and weekends. Sending the price is the gap. We start there.',
  underlines: ['asked for pricing'],
  ...over,
})

test('first reading needs all 13 answers', async () => {
  const { call, put, openai, close } = await setup()
  try {
    await put('stage', FULL_ANSWERS.stage)
    const res = await call('POST', '/api/first-reading')
    assert.equal(res.status, 409)
    assert.equal(res.body.next, 'months_in')
    assert.equal(openai.calls.length, 0)
  } finally { await close() }
})

test('first reading: model output that passes the checker is returned, with a usage row and no rating field', async () => {
  const { call, put, openai, supabase, close } = await setup([reading()])
  try {
    await saveAll(put)
    const res = await call('POST', '/api/first-reading')
    assert.equal(res.status, 200)
    assert.deepEqual(Object.keys(res.body).sort(), ['body', 'headline', 'underlines'])
    assert.deepEqual(res.body.underlines, ['asked for pricing'])
    assert.equal(openai.calls.length, 1)
    assert.equal(openai.calls[0].payload.model, 'gpt-5.2-2025-12-11')
    const evidence = JSON.parse(openai.calls[0].payload.messages[1].content)
    assert.equal(evidence.answers.length, 13)
    const usage = supabase.rows('model_usage_logs')
    assert.equal(usage.length, 1)
    assert.equal(usage[0].user_id, USER.id)
    assert.equal((await call('POST', '/api/first-reading/feedback', {})).status, 404)
  } finally { await close() }
})

test('first reading: an invented quote is retried once with the problem named, then accepted', async () => {
  const bad = reading({ body: 'You wrote "the clinics love my demo". That is not what you wrote, and it is not what happened. Send the price today and tell them.' })
  const { call, put, openai, supabase, close } = await setup([bad, reading()])
  try {
    await saveAll(put)
    const res = await call('POST', '/api/first-reading')
    assert.equal(res.status, 200)
    assert.match(res.body.body, /2 clinics/)
    assert.equal(openai.calls.length, 2)
    const retryMessages = openai.calls[1].payload.messages
    assert.match(retryMessages.at(-1).content, /quoted words are not in the answers/)
    assert.equal(supabase.rows('model_usage_logs').length, 2)
  } finally { await close() }
})

test('first reading: two failures give the plain fallback, with no quote and no underline', async () => {
  const bad = reading({ body: 'You wrote "the clinics love my demo" and want 40 customers. That is not what you wrote. Send the price today.' })
  const { call, put, openai, supabase, close } = await setup([bad, bad])
  try {
    await saveAll(put)
    const res = await call('POST', '/api/first-reading')
    assert.equal(res.status, 200)
    assert.equal(openai.calls.length, 2)
    assert.deepEqual(res.body.underlines, [])
    assert.ok(!res.body.body.includes('"'))
    assert.match(res.body.body, /nobody pays yet/)
    assert.equal(supabase.rows('model_usage_logs').length, 2)
  } finally { await close() }
})

test('first reading: model errors and unparseable replies also end in the fallback', async () => {
  const { call, put, close } = await setup([new Error('boom'), 'not json', 'still not json'])
  try {
    await saveAll(put)
    const res = await call('POST', '/api/first-reading')
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.underlines, [])
  } finally { await close() }
})
