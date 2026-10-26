import assert from 'node:assert/strict'
import test from 'node:test'
import { createApp } from '../app.js'
import { createFakeClock, createFakeOpenAI, createFakeSupabase } from '../testing/fakes.js'
import { FULL_ANSWERS } from './fixtures.js'
import { checkRead } from './theRead.js'
import { buildEvidence } from './firstReading.js'
import { MAX_NEW_SITUATIONS_PER_DAY } from './situations.js'

const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'founder@example.com' }
const OTHER = { id: '22222222-2222-4222-8222-222222222222', email: 'other@example.com' }
const ENV = { FRONTEND_URL: 'https://app.example.com' }
const NOW = Date.parse('2026-10-26T09:00:00.000Z')
const FIRST = 'I have a demo ready but I have not emailed the clinics that asked for pricing three weeks ago.'
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

// The real database refuses a repeated (situation_id, client_turn_id) and a
// repeated (user_id, create_turn_id) and a second read per situation. The
// in-memory fake does not, so this wrapper does it at insert time.
function withUniqueKeys(supabase) {
  const keys = {
    situation_turns: (r) => (r.client_turn_id ? `${r.situation_id}|${r.client_turn_id}` : null),
    situations: (r) => (r.create_turn_id ? `${r.user_id}|${r.create_turn_id}` : null),
    reads: (r) => r.situation_id,
  }
  return {
    ...supabase,
    from(table) {
      const builder = supabase.from(table)
      if (!keys[table]) return builder
      const insert = builder.insert.bind(builder)
      builder.insert = (row) => {
        const key = keys[table](row)
        if (key && supabase.rows(table).some((r) => keys[table](r) === key)) {
          const failed = { data: null, error: { code: '23505', message: 'duplicate key' } }
          const chain = { select: () => chain, single: () => chain, maybeSingle: () => chain, then: (res, rej) => Promise.resolve(failed).then(res, rej) }
          return chain
        }
        return insert(row)
      }
      return builder
    },
  }
}

async function setup(script = [], { signedUp = true } = {}) {
  const base = createFakeSupabase({
    users: { tok: USER, tok2: OTHER },
    tables: signedUp ? { founder_profiles: [{ user_id: USER.id, signup_answers: FULL_ANSWERS }] } : {},
  })
  const supabase = withUniqueKeys(base)
  const openai = createFakeOpenAI(script)
  const app = createApp({ env: ENV, supabase, openai, clock: createFakeClock(NOW) })
  const server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  const url = `http://127.0.0.1:${server.address().port}`
  const as = (token) => async (method, path, body) => {
    const res = await fetch(`${url}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    return { status: res.status, body: text.startsWith('{') ? JSON.parse(text) : text }
  }
  const rows = (t) => base.rows(t)
  const close = () => new Promise((r) => server.close(r))
  return { url, call: as('tok'), callOther: as('tok2'), openai, rows, close }
}

const verdict = (over = {}) => JSON.stringify({
  topic: 'same', has_situation: true, has_detail: false, missing: 'number',
  question: 'How many of the clinics asked for pricing?', title: 'Pricing emails to clinics', ...over,
})
const enough = () => verdict({ has_detail: true, missing: 'none', question: '' })
const readReply = (over = {}) => JSON.stringify({
  headline: 'You have not sent the price the clinics asked for.',
  body: 'You wrote "I have a demo ready". You also wrote that the clinics asked for pricing three weeks ago. Nobody has had an answer since then. That is the open gap.',
  underlines: [],
  closing_question: 'Have you gone back to either of those clinics since the demo?',
  ...over,
})

const create = (call, n, text = FIRST) => call('POST', '/api/situations', { text, client_turn_id: uuid(n) })

// ── Create and turn ──────────────────────────────────────────────────────────

test('create: asks one related follow-up, counts it, writes a usage row', async () => {
  const { call, openai, rows, close } = await setup([verdict()])
  try {
    const res = await create(call, 1)
    assert.equal(res.status, 200)
    assert.equal(res.body.status, 'follow_up')
    assert.equal(res.body.reply, 'How many of the clinics asked for pricing?')
    assert.equal(res.body.follow_up_count, 1)
    assert.equal(res.body.follow_ups_left, 1)
    assert.equal(res.body.title, 'Pricing emails to clinics')
    assert.equal(openai.calls[0].payload.model, 'gpt-4.1-mini')
    const usage = rows('model_usage_logs')
    assert.equal(usage.length, 1)
    assert.equal(usage[0].user_id, USER.id)
    assert.deepEqual(rows('situation_turns').map((t) => t.role), ['founder', 'axiom'])
  } finally { await close() }
})

test('create: when the first message is enough, nothing is asked and no follow-up is used', async () => {
  const { call, rows, close } = await setup([enough()])
  try {
    const res = await create(call, 1)
    assert.equal(res.body.status, 'ready')
    assert.equal(res.body.reply, null)
    assert.equal(res.body.follow_up_count, 0)
    assert.equal(rows('situations')[0].follow_up_count, 0)
  } finally { await close() }
})

test('a one-word or filler reply gets "Say a bit more." and uses no follow-up and no model call', async () => {
  const { call, openai, rows, close } = await setup([verdict()])
  try {
    const first = await create(call, 1)
    const id = first.body.situation_id
    const res = await call('POST', `/api/situations/${id}/turn`, { text: 'ok', client_turn_id: uuid(2) })
    assert.equal(res.body.status, 'say_more')
    assert.equal(res.body.reply, 'Say a bit more.')
    assert.equal(res.body.follow_up_count, 1)
    assert.equal(openai.calls.length, 1)
    assert.equal(rows('situations')[0].follow_up_count, 1)
    const opener = await create(call, 3, 'ok')
    assert.equal(opener.body.status, 'say_more')
    assert.equal(opener.body.situation_id, null)
    assert.equal(rows('situations').length, 1)
  } finally { await close() }
})

test('follow-ups stop at 2: a third request from the model ends in ready', async () => {
  const { call, rows, close } = await setup([verdict(), verdict(), verdict()])
  try {
    const id = (await create(call, 1)).body.situation_id
    const second = await call('POST', `/api/situations/${id}/turn`, { text: 'Two clinics, both in Karachi.', client_turn_id: uuid(2) })
    assert.equal(second.body.status, 'follow_up')
    assert.equal(second.body.follow_ups_left, 0)
    const third = await call('POST', `/api/situations/${id}/turn`, { text: 'One of the clinics is Dr Ali, and the other is a small group.', client_turn_id: uuid(3) })
    assert.equal(third.body.status, 'ready')
    assert.equal(third.body.follow_up_count, 2)
    assert.equal(rows('situations')[0].follow_up_count, 2)
    assert.equal(rows('situation_turns').filter((t) => t.role === 'axiom').length, 2)
  } finally { await close() }
})

test('follow-ups never exceed 2 under concurrent turns', async () => {
  const N = 8
  const { call, rows, close } = await setup([enough(), ...Array.from({ length: N }, () => verdict())])
  try {
    const id = (await create(call, 1)).body.situation_id
    const results = await Promise.all(Array.from({ length: N }, (_, i) =>
      call('POST', `/api/situations/${id}/turn`, { text: `Message ${i}: the clinics still have not heard about pricing.`, client_turn_id: uuid(10 + i) })))
    assert.ok(results.every((r) => r.status === 200))
    assert.equal(results.filter((r) => r.body.status === 'follow_up').length, 2)
    assert.equal(results.filter((r) => r.body.status === 'ready').length, N - 2)
    assert.equal(rows('situations')[0].follow_up_count, 2)
    assert.equal(rows('situation_turns').filter((t) => t.role === 'axiom').length, 2)
  } finally { await close() }
})

test('a repeated client turn id returns the first answer: one model call, one follow-up', async () => {
  const { call, openai, rows, close } = await setup([enough(), verdict()])
  try {
    const id = (await create(call, 1)).body.situation_id
    const body = { text: 'I emailed nobody, the clinics are waiting for pricing.', client_turn_id: uuid(2) }
    const a = await call('POST', `/api/situations/${id}/turn`, body)
    const b = await call('POST', `/api/situations/${id}/turn`, body)
    assert.equal(a.body.status, 'follow_up')
    assert.deepEqual(b.body, a.body)
    assert.equal(openai.calls.length, 2)
    assert.equal(rows('situations')[0].follow_up_count, 1)
    assert.equal(rows('situation_turns').filter((t) => t.role === 'founder').length, 2)
  } finally { await close() }
})

test('two identical requests at once take one follow-up between them', async () => {
  const { call, rows, close } = await setup([enough(), verdict(), verdict()])
  try {
    const id = (await create(call, 1)).body.situation_id
    const body = { text: 'I emailed nobody, the clinics are waiting for pricing.', client_turn_id: uuid(2) }
    const [a, b] = await Promise.all([call('POST', `/api/situations/${id}/turn`, body), call('POST', `/api/situations/${id}/turn`, body)])
    assert.ok([a.status, b.status].every((s) => s === 200 || s === 409))
    assert.ok([a.status, b.status].includes(200))
    assert.equal(rows('situations')[0].follow_up_count, 1)
  } finally { await close() }
})

test('creating twice with the same client turn id gives one situation', async () => {
  const { call, openai, rows, close } = await setup([verdict()])
  try {
    const a = await create(call, 1)
    const b = await create(call, 1)
    assert.deepEqual(b.body, a.body)
    assert.equal(rows('situations').length, 1)
    assert.equal(openai.calls.length, 1)
  } finally { await close() }
})

test('Axiom\'s question is stripped of filler before it is shown and stored', async () => {
  const { call, rows, close } = await setup([verdict({ question: 'Great, how many of the clinics asked for pricing?' })])
  try {
    const res = await create(call, 1)
    assert.equal(res.body.reply, 'How many of the clinics asked for pricing?')
    assert.equal(rows('situation_turns').find((t) => t.role === 'axiom').text, res.body.reply)
  } finally { await close() }
})

test('a teaser or off-topic question is retried with the problem named, then dropped: ready, no follow-up used', async () => {
  const teaser = verdict({ question: 'Want to see why the clinics went quiet?' })
  const offTopic = verdict({ question: 'What is your biggest fear?' })
  const { call, openai, rows, close } = await setup([teaser, offTopic])
  try {
    const res = await create(call, 1)
    assert.equal(res.body.status, 'ready')
    assert.equal(res.body.follow_up_count, 0)
    assert.equal(openai.calls.length, 2)
    assert.match(openai.calls[1].payload.messages.at(-1).content, /teaser question/)
    assert.equal(rows('situation_turns').filter((t) => t.role === 'axiom').length, 0)
  } finally { await close() }
})

test('a failing model never stalls the founder: the situation is ready', async () => {
  const { call, close } = await setup([new Error('boom')])
  try {
    const res = await create(call, 1)
    assert.equal(res.status, 200)
    assert.equal(res.body.status, 'ready')
  } finally { await close() }
})

test('a new topic mid-situation starts a new situation and leaves the old one open', async () => {
  const { call, rows, close } = await setup([verdict(), verdict({ topic: 'new', title: 'Hiring a developer' }), enough()])
  try {
    const first = (await create(call, 1)).body
    const res = await call('POST', `/api/situations/${first.situation_id}/turn`, { text: 'Separate thing: I need to hire a developer by December.', client_turn_id: uuid(2) })
    assert.equal(res.body.started_new, true)
    assert.equal(res.body.previous_situation_id, first.situation_id)
    assert.notEqual(res.body.situation_id, first.situation_id)
    assert.equal(res.body.follow_up_count, 0)
    const open = (await call('GET', '/api/situations/open')).body.situations
    assert.equal(open.length, 2)
    assert.equal(rows('situations').find((s) => s.id === first.situation_id).follow_up_count, 1)
    const again = await call('POST', `/api/situations/${first.situation_id}/turn`, { text: 'Separate thing: I need to hire a developer by December.', client_turn_id: uuid(2) })
    assert.deepEqual(again.body, res.body)
    assert.equal(rows('situations').length, 2)
  } finally { await close() }
})

test('a daily limit on new situations, with the open ones offered', async () => {
  const { call, close } = await setup(Array.from({ length: MAX_NEW_SITUATIONS_PER_DAY }, () => enough()))
  try {
    for (let i = 1; i <= MAX_NEW_SITUATIONS_PER_DAY; i += 1) assert.equal((await create(call, i)).status, 200)
    const res = await create(call, 99)
    assert.equal(res.status, 429)
    assert.equal(res.body.error, 'daily_limit')
    assert.equal(res.body.open.length, MAX_NEW_SITUATIONS_PER_DAY)
  } finally { await close() }
})

// ── Ownership, care, validation ──────────────────────────────────────────────

test('another founder\'s situation is a 404 on every route', async () => {
  const { call, callOther, openai, close } = await setup([verdict(), readReply()])
  try {
    const id = (await create(call, 1)).body.situation_id
    const n = openai.calls.length
    assert.equal((await callOther('GET', `/api/situations/${id}`)).status, 404)
    assert.equal((await callOther('POST', `/api/situations/${id}/turn`, { text: 'I want to add something about pricing.', client_turn_id: uuid(2) })).status, 404)
    assert.equal((await callOther('POST', `/api/situations/${id}/read`)).status, 404)
    assert.equal((await callOther('POST', `/api/situations/${id}/read/answer`, { skip: true })).status, 404)
    assert.equal((await callOther('GET', `/api/situations/${uuid(7)}`)).status, 404)
    assert.equal((await callOther('GET', '/api/situations/not-a-uuid')).status, 404)
    assert.deepEqual((await callOther('GET', '/api/situations/open')).body.situations, [])
    assert.equal(openai.calls.length, n)
  } finally { await close() }
})

test('care gate: a clear signal stops the step; nothing is stored, no model asked about the situation', async () => {
  const { call, openai, rows, close } = await setup([])
  try {
    const res = await create(call, 1, 'I want to kill myself and nothing about the company matters now.')
    assert.equal(res.status, 200)
    assert.equal(res.body.care, 'clear')
    assert.ok(Array.isArray(res.body.help) || res.body.help)
    assert.equal(rows('situations').length, 0)
    assert.equal(rows('situation_turns').length, 0)
    assert.equal(openai.calls.length, 0)
  } finally { await close() }
})

test('care gate also stops a turn and a Read reply', async () => {
  const { call, rows, close } = await setup([verdict(), readReply()])
  try {
    const id = (await create(call, 1)).body.situation_id
    const turn = await call('POST', `/api/situations/${id}/turn`, { text: 'I want to kill myself.', client_turn_id: uuid(2) })
    assert.equal(turn.body.care, 'clear')
    assert.equal(rows('situation_turns').filter((t) => t.role === 'founder').length, 1)
    await call('POST', `/api/situations/${id}/read`)
    const answer = await call('POST', `/api/situations/${id}/read/answer`, { text: 'I want to kill myself.' })
    assert.equal(answer.body.care, 'clear')
    assert.equal(rows('reads')[0].answered_at, null)
  } finally { await close() }
})

test('bad input is a 400', async () => {
  const { call, close } = await setup([])
  try {
    assert.equal((await call('POST', '/api/situations', { text: FIRST })).status, 400)
    assert.equal((await call('POST', '/api/situations', { text: '', client_turn_id: uuid(1) })).status, 400)
    assert.equal((await call('POST', '/api/situations', { text: 'x'.repeat(2001), client_turn_id: uuid(1) })).status, 400)
  } finally { await close() }
})

test('routes need sign-in', async () => {
  const { url, close } = await setup([])
  try {
    for (const [method, path] of [['GET', '/api/situations/open'], ['POST', '/api/situations'], ['GET', `/api/situations/${uuid(1)}`], ['POST', `/api/situations/${uuid(1)}/read`]]) {
      assert.equal((await fetch(`${url}${path}`, { method })).status, 401, path)
    }
  } finally { await close() }
})

// ── The Read ─────────────────────────────────────────────────────────────────

test('the Read: shape, usage row on the read step, stored once, no feedback endpoint', async () => {
  const { call, openai, rows, close } = await setup([enough(), readReply()])
  try {
    const id = (await create(call, 1)).body.situation_id
    const res = await call('POST', `/api/situations/${id}/read`)
    assert.equal(res.status, 200)
    assert.deepEqual(Object.keys(res.body).sort(), ['answered', 'body', 'closing_question', 'headline', 'situation_id', 'skipped', 'underlines'])
    assert.deepEqual(res.body.underlines, [])
    assert.equal(openai.calls[1].payload.model, 'gpt-5.2-2025-12-11')
    const usage = rows('model_usage_logs')
    assert.equal(usage.length, 2)
    assert.equal(usage[1].user_id, USER.id)
    const again = await call('POST', `/api/situations/${id}/read`)
    assert.deepEqual(again.body, res.body)
    assert.equal(openai.calls.length, 2)
    assert.equal(rows('reads').length, 1)
    assert.equal((await call('POST', `/api/situations/${id}/read/feedback`, {})).status, 404)
    assert.equal((await call('POST', `/api/situations/${id}/rating`, {})).status, 404)
    const detail = await call('GET', `/api/situations/${id}`)
    assert.equal(detail.body.read.headline, res.body.headline)
  } finally { await close() }
})

test('the Read: an invented quote is retried once with the problem named, then accepted', async () => {
  const bad = readReply({ body: 'You wrote "the clinics love my demo". That is not what you wrote. The clinics asked for pricing three weeks ago and heard nothing.' })
  const { call, openai, rows, close } = await setup([enough(), bad, readReply()])
  try {
    const id = (await create(call, 1)).body.situation_id
    const res = await call('POST', `/api/situations/${id}/read`)
    assert.equal(res.status, 200)
    assert.match(res.body.body, /I have a demo ready/)
    assert.match(openai.calls[2].payload.messages.at(-1).content, /quoted words are not in the answers/)
    assert.equal(rows('model_usage_logs').length, 3)
    assert.equal(rows('reads')[0].source, 'model')
  } finally { await close() }
})

test('the Read: an invented number is retried with the problem named', async () => {
  const bad = readReply({ body: 'You wrote that 40 clinics asked for pricing three weeks ago. Nobody has had an answer since then. That is the open gap in your week.' })
  const { call, openai, close } = await setup([enough(), bad, readReply()])
  try {
    const id = (await create(call, 1)).body.situation_id
    await call('POST', `/api/situations/${id}/read`)
    assert.match(openai.calls[2].payload.messages.at(-1).content, /number is not in the answers: 40/)
  } finally { await close() }
})

test('the Read check: banned phrase, teaser and a closing line that is not a question all fail', () => {
  const answerTexts = [...buildEvidence(FULL_ANSWERS).answerTexts, FIRST]
  const cases = [
    [readReply({ headline: 'Great, the clinics are waiting for you today.' }), /banned phrase: great/],
    [readReply({ closing_question: 'Want to see why the clinics went quiet?' }), /teaser question/],
    [readReply({ closing_question: 'The clinics asked for pricing three weeks ago.' }), /not a question/],
    [readReply({ closing_question: 'What is your biggest fear right now?' }), /no thread from the founder/],
  ]
  for (const [raw, rx] of cases) {
    const out = checkRead({ read: JSON.parse(raw), answerTexts })
    assert.equal(out.ok, false)
    assert.match(out.problems.join(), rx)
  }
  assert.equal(checkRead({ read: JSON.parse(readReply()), answerTexts }).ok, true)
})

test('the Read: two failures give the plain fallback, which quotes the founder and passes its own checker', async () => {
  const bad = readReply({ body: 'You wrote "the clinics love my demo" and want 40 customers. That is not what you wrote. Send the price today.' })
  const { call, openai, rows, close } = await setup([enough(), bad, bad])
  try {
    const id = (await create(call, 1)).body.situation_id
    const res = await call('POST', `/api/situations/${id}/read`)
    assert.equal(res.status, 200)
    assert.equal(openai.calls.length, 3)
    assert.deepEqual(res.body.underlines, [])
    assert.match(res.body.body, /You wrote: "I have a demo ready but I have not emailed the clinics that asked for pricing three weeks ago"/)
    assert.equal(rows('reads')[0].source, 'fallback')
    assert.equal(rows('model_usage_logs').length, 3)
    const answerTexts = [...buildEvidence(FULL_ANSWERS).answerTexts, FIRST]
    assert.equal(checkRead({ read: res.body, answerTexts }).ok, true)
  } finally { await close() }
})

test('the Read: model errors and unparseable replies also end in the fallback', async () => {
  const { call, close } = await setup([enough(), new Error('boom'), 'not json', 'still not json'])
  try {
    const id = (await create(call, 1)).body.situation_id
    const res = await call('POST', `/api/situations/${id}/read`)
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.underlines, [])
  } finally { await close() }
})

test('the Read needs something the founder wrote, and closes the situation to more turns', async () => {
  const { call, close } = await setup([enough(), readReply()])
  try {
    const id = (await create(call, 1)).body.situation_id
    const early = await call('POST', `/api/situations/${uuid(5)}/read`)
    assert.equal(early.status, 404)
    await call('POST', `/api/situations/${id}/read`)
    const late = await call('POST', `/api/situations/${id}/turn`, { text: 'One more thing about the clinics and pricing.', client_turn_id: uuid(2) })
    assert.equal(late.status, 409)
  } finally { await close() }
})

test('the reply to the closing question is stored with the situation; the first answer wins', async () => {
  const { call, rows, close } = await setup([enough(), readReply()])
  try {
    const id = (await create(call, 1)).body.situation_id
    assert.equal((await call('POST', `/api/situations/${id}/read/answer`, { text: 'No, not since the demo.' })).status, 409)
    await call('POST', `/api/situations/${id}/read`)
    const say = await call('POST', `/api/situations/${id}/read/answer`, { text: 'ok' })
    assert.equal(say.body.status, 'say_more')
    assert.equal(rows('reads')[0].answered_at, null)
    const done = await call('POST', `/api/situations/${id}/read/answer`, { text: 'No, I have not contacted them since the demo three weeks ago.' })
    assert.deepEqual(done.body, { status: 'stored', situation_id: id, skipped: false, next: 'learn' })
    assert.equal(rows('reads')[0].closing_answer, 'No, I have not contacted them since the demo three weeks ago.')
    const later = await call('POST', `/api/situations/${id}/read/answer`, { skip: true })
    assert.equal(later.body.status, 'stored')
    assert.equal(rows('reads')[0].skipped, false)
    assert.equal((await call('GET', `/api/situations/${id}`)).body.read.answered, true)
  } finally { await close() }
})

test('skipping the closing question is stored as a skip', async () => {
  const { call, rows, close } = await setup([enough(), readReply()])
  try {
    const id = (await create(call, 1)).body.situation_id
    await call('POST', `/api/situations/${id}/read`)
    const res = await call('POST', `/api/situations/${id}/read/answer`, { skip: true })
    assert.equal(res.body.skipped, true)
    assert.equal(rows('reads')[0].closing_answer, null)
    assert.equal(rows('reads')[0].skipped, true)
  } finally { await close() }
})
