import assert from 'node:assert/strict'
import test from 'node:test'
import { createApp } from '../app.js'
import { createFakeClock, createFakeOpenAI, createFakeSupabase } from '../testing/fakes.js'
import { QUESTIONS, QUESTION_KEYS, validateAnswer, questionByKey, answerStrings, typedStrings } from './questions.js'
import { FULL_ANSWERS, LEGACY_ANSWERS } from './fixtures.js'
import { fallbackReading, buildEvidence } from './firstReading.js'
import { EMPTY_BELIEFS } from '../e2e/harness.js'

const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'founder@example.com' }
const ENV = { FRONTEND_URL: 'https://app.example.com' }
const NOW = Date.parse('2026-10-26T09:00:00.000Z')

async function setup(script = [], tables = {}) {
  const supabase = createFakeSupabase({ users: { tok: USER }, tables })
  const openai = createFakeOpenAI(script)
  // Memory is seeded in the background after the first reading; these tests count the journey's own calls.
  const create = openai.chat.completions.create
  openai.chat.completions.create = (payload, options) => (payload.response_format?.json_schema?.name?.startsWith('beliefs')
    ? { choices: [{ message: { content: JSON.stringify(EMPTY_BELIEFS) } }], usage: {} }
    : create(payload, options))
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

test('there are 14 questions in order, 7 business then 7 personal, none with more than 5 options', () => {
  assert.deepEqual(QUESTION_KEYS, ['stage', 'commitment', 'business_model', 'where', 'goal', 'building', 'why', 'strengths',
    'decision', 'drop_plan', 'hard_truth', 'contrarian', 'people', 'stuck'])
  const personal = ['why', 'strengths', 'decision', 'drop_plan', 'hard_truth', 'contrarian', 'people']
  assert.equal(QUESTION_KEYS.filter((k) => personal.includes(k)).length, 7)
  assert.equal(QUESTION_KEYS.filter((k) => !personal.includes(k)).length, 7)
  assert.equal(QUESTIONS.length, 14)
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
  assert.equal(v('hard_truth', { value: 'Straight' }).ok, true)
  assert.equal(v('hard_truth', { value: 'Straight', other: 'x' }).ok, false)
  assert.equal(v('decision', { value: 'Wait and collect more' }).ok, true)
  assert.equal(v('drop_plan', { value: 'I rarely drop plans' }).ok, true)
  assert.equal(v('drop_plan', { value: 'Other', other: 'x' }).ok, false)
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
  assert.equal(v('goal', { goal: 'Ship it', when: 'Pick a date', date: '2026-10-24' }).ok, false)
  // 02:00 UTC is still the evening before in the Americas: their today is accepted, the day before it is not.
  const at = { now: Date.parse('2026-11-05T02:00:00.000Z') }
  const picked = (date) => validateAnswer(questionByKey('goal'), { goal: 'Ship it', when: 'Pick a date', date }, at).ok
  assert.equal(picked('2026-11-04'), true)
  assert.equal(picked('2026-11-03'), false)
  assert.equal(v('goal', { goal: 'Ship it', when: 'Pick a date', date: '2027-03-01' }).ok, true)
  assert.equal(v('goal', { goal: 'Ship it', when: 'This month', date: '2027-03-01' }).ok, false)
})

test('Q10: multi-select from each group, no duplicates, no foreign options', () => {
  assert.equal(v('strengths', { a: [], b: [] }).ok, true)
  assert.equal(v('strengths', { a: ['Selling', 'Selling'], b: [] }).ok, false)
  assert.equal(v('strengths', { a: ['Pricing'], b: [] }).ok, false)
  assert.equal(v('strengths', { a: ['Selling', 'Building the product', 'Numbers and planning', 'Leading people', 'Not quitting', 'Selling'], b: [] }).ok, false)
})

test('optional text: a skip or a typed answer, never an empty one; a skip has no strings', () => {
  for (const key of ['contrarian', 'people']) {
    const q = questionByKey(key)
    assert.equal(q.optional, true)
    assert.deepEqual(v(key, { skipped: true }), { ok: true, value: { skipped: true } })
    assert.equal(v(key, { skipped: false }).ok, false)
    assert.equal(v(key, { skipped: true, x: 1 }).ok, false)
    assert.equal(v(key, '').ok, false)
    assert.equal(v(key, 'ab').ok, false)
    assert.equal(v(key, '  Most people think it is too niche.  ').value, 'Most people think it is too niche.')
    assert.deepEqual(answerStrings(q, { skipped: true }), [])
    assert.deepEqual(typedStrings(q, { skipped: true }), [])
    assert.deepEqual(typedStrings(q, 'Sam does sales'), ['Sam does sales'])
  }
  // a required text question cannot be skipped
  assert.equal(v('stuck', { skipped: true }).ok, false)
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
    assert.equal(first.body.questions.length, 14)
    assert.equal(first.body.next, 'stage')
    assert.equal(first.body.complete, false)

    await put('stage', FULL_ANSWERS.stage)
    const saved = await put('commitment', FULL_ANSWERS.commitment)
    assert.equal(saved.body.next, 'business_model')
    assert.equal(saved.body.total, 14)

    const resumed = await call('GET', '/api/signup')
    assert.deepEqual(Object.keys(resumed.body.answers), ['stage', 'commitment'])
    assert.equal(resumed.body.next, 'business_model')
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
    assert.equal((await call('GET', '/api/signup')).body.next, 'commitment')
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
    assert.equal(Object.keys(row.signup_answers).length, 14)
  } finally { await close() }
})

test('bad key is 404, bad answer is 400 and stores nothing', async () => {
  const { supabase, put, close } = await setup()
  try {
    assert.equal((await put('nope', { value: 'x' })).status, 404)
    assert.equal((await put('stage', { value: 'Moonlighting' })).status, 400)
    assert.equal((await put('hard_truth', { value: 'Politely' })).status, 400)
    for (const gone of ['months_in', 'team', 'tried', 'background']) assert.equal((await put(gone, { value: 'x' })).status, 404, gone)
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
    // typed text of an optional question is read too
    const wrote = await put('people', 'Sam. I want to end my life.')
    assert.equal(wrote.body.care, 'clear')
    const skipped = await put('contrarian', { skipped: true })
    assert.equal(skipped.status, 200)
    assert.equal(skipped.body.care, undefined)
  } finally { await close() }
})

// ── First reading ────────────────────────────────────────────────────────────

const reading = (over = {}) => JSON.stringify({
  headline: 'The clinics asked for pricing and have heard nothing since.',
  body: 'You wrote that you have a demo ready. You also wrote "I have not emailed the 2 clinics that asked for pricing three weeks ago". Nobody pays yet, and you are working evenings and weekends. Sending the price is the gap. We start there.',
  underlines: ['asked for pricing'],
  ...over,
})

test('first reading needs every required answer', async () => {
  const { call, put, openai, close } = await setup()
  try {
    await put('stage', FULL_ANSWERS.stage)
    const res = await call('POST', '/api/first-reading')
    assert.equal(res.status, 409)
    assert.equal(res.body.next, 'commitment')
    assert.equal(openai.calls.length, 0)
  } finally { await close() }
})

test('first reading: built once, stored, and the same reading comes back on every later call', async () => {
  const { call, put, openai, supabase, close } = await setup([reading()])
  try {
    await saveAll(put)
    const [a, b] = await Promise.all([call('POST', '/api/first-reading'), call('POST', '/api/first-reading')])
    const c = await call('POST', '/api/first-reading')
    assert.equal(a.status, 200)
    assert.deepEqual(b.body, a.body)
    assert.deepEqual(c.body, a.body)
    assert.equal(openai.calls.length, 1)
    assert.deepEqual(supabase.rows('founder_profiles')[0].first_reading, a.body)
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
    // 14 questions less the skipped one; "where" and the strengths question each become two items, their labels in the question.
    assert.equal(evidence.answers.length, 15)
    assert.ok(evidence.answers.some((a) => a.question.startsWith('When someone tells you') && a.answer === 'Straight'))
    assert.ok(!evidence.answers.some((a) => a.question.startsWith('What do you believe')))
    assert.ok(!evidence.answers.some((a) => /Avoids most|Based in|Better than most/.test(a.answer)))
    const usage = supabase.rows('model_usage_logs').filter((r) => r.call_type !== 'beliefs')
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
    assert.equal(supabase.rows('model_usage_logs').filter((r) => r.call_type !== 'beliefs').length, 2)
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
    assert.match(res.body.headline, /nobody pays yet/)
    assert.equal(supabase.rows('model_usage_logs').length, 2)
  } finally { await close() }
})

test('first reading: a fallback is shown but not stored, so the next open tries the model again', async () => {
  const bad = reading({ body: 'You wrote "the clinics love my demo" and want 40 customers. That is not what you wrote. Send the price today.' })
  const { call, put, openai, supabase, close } = await setup([bad, bad, reading()])
  try {
    await saveAll(put)
    const first = await call('POST', '/api/first-reading')
    assert.equal(first.status, 200)
    assert.equal(supabase.rows('founder_profiles')[0].first_reading ?? null, null)
    const second = await call('POST', '/api/first-reading')
    assert.equal(openai.calls.length, 3)
    assert.notDeepEqual(second.body, first.body)
    assert.deepEqual(supabase.rows('founder_profiles')[0].first_reading, second.body)
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

// ── Completion, hard_truth, name, birthday, fallback ─────────────────────────

test('a brand new founder needs every required answer; skipping the optional ones counts', async () => {
  const { call, put, close } = await setup()
  try {
    for (const key of QUESTION_KEYS.filter((k) => k !== 'contrarian' && k !== 'people')) await put(key, FULL_ANSWERS[key])
    const mid = await call('GET', '/api/signup')
    assert.equal(mid.body.complete, false)
    assert.equal(mid.body.next, 'contrarian')
    await put('contrarian', { skipped: true })
    assert.equal((await put('people', { skipped: true })).body.complete, true)
  } finally { await close() }
})

test('a founder who finished the old 13 is complete and is not asked again', async () => {
  const reading = { headline: 'h', body: 'b', underlines: [] }
  const seed = (signup_answers, first_reading) => [{ user_id: USER.id, signup_answers, first_reading }]
  for (const withReading of [true, false]) {
    const { call, close } = await setup([], { founder_profiles: seed({ ...LEGACY_ANSWERS }, withReading ? reading : null) })
    try {
      const res = await call('GET', '/api/signup')
      assert.equal(res.body.complete, true, `reading stored: ${withReading}`)
      assert.equal(res.body.next, null)
      assert.equal(res.body.total, 14)
      assert.deepEqual(Object.keys(res.body.answers), Object.keys(LEGACY_ANSWERS))
    } finally { await close() }
  }
  // a stored first reading alone is enough
  const { call, close } = await setup([], { founder_profiles: seed({ stage: LEGACY_ANSWERS.stage }, reading) })
  try {
    assert.equal((await call('GET', '/api/signup')).body.complete, true)
  } finally { await close() }
})

test('hard_truth sets the Settings style, once, when it is saved; other answers do not', async () => {
  const { supabase, put, close } = await setup()
  try {
    await put('stage', FULL_ANSWERS.stage)
    assert.equal(supabase.rows('user_settings').length, 0)
    for (const [value, style] of [['Gently', 'calm'], ['Straight', 'direct'], ['Blunt, no padding', 'hard']]) {
      assert.equal((await put('hard_truth', { value })).status, 200)
      assert.equal(supabase.rows('user_settings').length, 1)
      assert.equal(supabase.rows('user_settings')[0].mentor_style, style)
    }
  } finally { await close() }
})

test('a hard_truth re-save after sign-up is complete leaves mentor_style alone', async () => {
  const { supabase, put, close } = await setup()
  try {
    await saveAll(put)
    const style = supabase.rows('user_settings')[0].mentor_style
    assert.equal((await put('hard_truth', { value: style === 'hard' ? 'Gently' : 'Blunt, no padding' })).status, 200)
    assert.equal(supabase.rows('user_settings')[0].mentor_style, style)
  } finally { await close() }
})

test('name: saves one first name to users.first_name, creating the row if needed; junk is refused', async () => {
  const { supabase, call, close } = await setup()
  try {
    assert.equal((await call('PUT', '/api/signup/name', { name: '  Samira Khan ' })).body.name, 'Samira')
    assert.equal(supabase.rows('users').find((u) => u.id === USER.id).first_name, 'Samira')
    assert.equal((await call('PUT', '/api/signup/name', { name: 'Sam' })).status, 200)
    assert.equal(supabase.rows('users').filter((u) => u.id === USER.id).length, 1)
    for (const name of ['', '123', 42, undefined, 'x'.repeat(40)]) assert.equal((await call('PUT', '/api/signup/name', { name })).status, 400, String(name))
  } finally { await close() }
})

test('birthday: month and day only; Feb 29 yes, Feb 30 no, month 13 no, one of the two no', async () => {
  const { supabase, call, close } = await setup()
  try {
    const put = (body) => call('PUT', '/api/signup/birthday', body)
    assert.equal((await put({ month: 2, day: 30 })).status, 400)
    assert.equal((await put({ month: 4, day: 31 })).status, 400)
    assert.equal((await put({ month: 13, day: 1 })).status, 400)
    assert.equal((await put({ month: 0, day: 1 })).status, 400)
    assert.equal((await put({ month: 5 })).status, 400)
    assert.equal((await put({ day: 5 })).status, 400)
    assert.equal((await put({ month: '5', day: 5 })).status, 400)
    assert.equal((await put({ month: 5, day: 5, year: 1990 })).status, 400)
    assert.equal(supabase.rows('founder_profiles').length, 0)
    assert.equal((await put({ month: 2, day: 29 })).status, 200)
    const row = supabase.rows('founder_profiles')[0]
    assert.deepEqual([row.birth_month, row.birth_day], [2, 29])
    assert.equal((await put({ month: 12, day: 31 })).status, 200)
    assert.equal(supabase.rows('founder_profiles').length, 1)
    assert.equal((await call('PUT', '/api/signup/birthday', undefined)).status, 400)
  } finally { await close() }
})

test('first reading evidence shows the new answers with the question apart from the answer', () => {
  const { evidence, answerTexts } = buildEvidence(FULL_ANSWERS)
  const by = (start) => evidence.find((e) => e.question.startsWith(start))
  assert.deepEqual(by('You have a big decision'), { question: 'You have a big decision and not enough information. What do you usually do?', answer: 'Wait and collect more' })
  assert.equal(by('When you drop a plan').answer, 'Nobody was checking on me')
  assert.equal(by('Who else is part of this').answer, 'Sam, my cofounder, does sales.')
  assert.ok(!by('What do you believe'))
  assert.ok(answerTexts.includes('Straight'))
})

test('fallback reading: works for the new set, and still uses legacy answers when they exist', () => {
  const fresh = fallbackReading(FULL_ANSWERS)
  assert.match(fresh.body, /Evenings and weekends/i)
  assert.doesNotMatch(fresh.body, /So far you have|You have been on it for/)
  assert.doesNotThrow(() => fallbackReading({ stage: { value: 'Just an idea' } }))
  const legacy = fallbackReading(LEGACY_ANSWERS)
  assert.match(legacy.body, /for 3 to 6 months/)
  assert.match(legacy.body, /built a prototype/)
  for (const r of [fresh, legacy]) assert.deepEqual(r.underlines, [])
})
