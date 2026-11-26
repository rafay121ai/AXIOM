import assert from 'node:assert/strict'
import test from 'node:test'
import { createApp } from '../app.js'
import { createFakeClock, createFakeOpenAI, createFakeSupabase } from '../testing/fakes.js'
import { FULL_ANSWERS } from './fixtures.js'
import { EMPTY_MESSAGE } from '../e2e/harness.js'
import { memoryIdle } from './memory/extractBeliefs.js'
import { earlierLines, loadBrief } from './memory/brief.js'
import { checkRead } from './theRead.js'
import { buildEvidence } from './firstReading.js'
import { MAX_NEW_SITUATIONS_PER_DAY } from './situations.js'

const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'founder@example.com' }
const OTHER = { id: '22222222-2222-4222-8222-222222222222', email: 'other@example.com' }
const ENV = { FRONTEND_URL: 'https://app.example.com', LEARN_EVERY_MESSAGE: 'off', READ_GROUNDING: 'off' } // these tests count model calls; learnMessage.test.js covers memory, readGrounding.test.js the grounding check
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

async function setup(script = [], { signedUp = true, env = ENV, byName = {}, tables = {} } = {}) {
  const base = createFakeSupabase({
    users: { tok: USER, tok2: OTHER },
    tables: { ...(signedUp ? { founder_profiles: [{ user_id: USER.id, signup_answers: FULL_ANSWERS }] } : {}), ...tables },
  })
  const supabase = withUniqueKeys(base)
  const openai = createFakeOpenAI(script, { byName })
  const app = createApp({ env, supabase, openai, clock: createFakeClock(NOW) })
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
  return { url, call: as('tok'), callOther: as('tok2'), openai, rows, close, db: base }
}

const verdict = (over = {}) => JSON.stringify({
  topic: 'same',
  question: 'How many of the clinics asked for pricing?', title: 'Pricing emails to clinics', ...over,
})
// No question: the server asks for one once more, then lets the Read start (two replies, two model calls).
const enough = () => verdict({ question: '' })
const readReply = (over = {}) => JSON.stringify({
  headline: 'You have not sent the price the clinics asked for.',
  body: 'The clinics wanted a price three weeks back and have heard nothing. The demo is not what they are waiting on. Each week of silence makes the next email harder to write.',
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

// Rafay, Nov 9: Axiom always asks 2 questions, even when the first message looks complete.
test('create: a reply with no question is asked for again; the server never skips the 2 questions on its own', async () => {
  const { call, openai, close } = await setup([enough(), verdict()])
  try {
    const res = await create(call, 1)
    assert.equal(res.body.status, 'follow_up')
    assert.equal(res.body.follow_up_count, 1)
    assert.match(openai.calls[1].payload.messages.at(-1).content, /a question is required/)
  } finally { await close() }
})

test('create: if no usable question comes twice, the Read can start (never a stall)', async () => {
  const { call, rows, close } = await setup([enough(), enough()])
  try {
    const res = await create(call, 1)
    assert.equal(res.body.status, 'ready')
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
  const { call, rows, close } = await setup([enough(), enough(), ...Array.from({ length: N }, () => verdict())])
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

test('a repeated client turn id returns the first answer: one model call for it, one follow-up', async () => {
  const { call, openai, rows, close } = await setup([enough(), enough(), verdict()])
  try {
    const id = (await create(call, 1)).body.situation_id
    const body = { text: 'I emailed nobody, the clinics are waiting for pricing.', client_turn_id: uuid(2) }
    const a = await call('POST', `/api/situations/${id}/turn`, body)
    const b = await call('POST', `/api/situations/${id}/turn`, body)
    assert.equal(a.body.status, 'follow_up')
    assert.deepEqual(b.body, a.body)
    assert.equal(openai.calls.length, 3)
    assert.equal(rows('situations')[0].follow_up_count, 1)
    assert.equal(rows('situation_turns').filter((t) => t.role === 'founder').length, 2)
  } finally { await close() }
})

test('two identical requests at once take one follow-up between them', async () => {
  const { call, rows, close } = await setup([enough(), enough(), verdict(), verdict()])
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

test('a teaser question is retried with the problem named, then dropped: ready, no follow-up used', async () => {
  const teaser = verdict({ question: 'Want to see why the clinics went quiet?' })
  const { call, openai, rows, close } = await setup([teaser, teaser])
  try {
    const res = await create(call, 1)
    assert.equal(res.body.status, 'ready')
    assert.equal(res.body.follow_up_count, 0)
    assert.equal(openai.calls.length, 2)
    assert.match(openai.calls[1].payload.messages.at(-1).content, /teaser question/)
    assert.equal(rows('situation_turns').filter((t) => t.role === 'axiom').length, 0)
  } finally { await close() }
})

// Rafay, Nov 23: style alone never drops a question. One with no thread from the founder is retried, then asked anyway.
test('a question whose only problem is no thread is retried, then asked rather than skipped', async () => {
  const offTopic = verdict({ question: 'What is your biggest fear?' })
  const { call, openai, close } = await setup([offTopic, offTopic])
  try {
    const res = await create(call, 1)
    assert.equal(openai.calls.length, 2)
    assert.equal(res.body.follow_up_count, 1)
    assert.match(JSON.stringify(res.body), /biggest fear/)
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
  const { call, rows, close } = await setup([verdict(), verdict({ topic: 'new', title: 'Hiring a developer' }), enough(), enough()])
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
    // Care stays open until the founder checks in on home: no Read until then.
    assert.equal((await call('POST', `/api/situations/${id}/read`)).body.care, 'clear')
    assert.equal(rows('reads').length, 0)
    assert.deepEqual((await call('POST', '/api/home/checkin', { text: 'All fine, back to the clinics.' })).body, { ok: true })
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
  const { call, openai, rows, close } = await setup([enough(), enough(), readReply()])
  try {
    const id = (await create(call, 1)).body.situation_id
    const res = await call('POST', `/api/situations/${id}/read`)
    assert.equal(res.status, 200)
    assert.deepEqual(Object.keys(res.body).sort(), ['answered', 'body', 'closing_question', 'headline', 'situation_id', 'skipped', 'talk'])
    assert.equal(openai.calls[2].payload.model, 'gpt-5.2-2025-12-11')
    const usage = rows('model_usage_logs')
    assert.equal(usage.length, 3)
    assert.equal(usage[1].user_id, USER.id)
    const again = await call('POST', `/api/situations/${id}/read`)
    assert.deepEqual(again.body, res.body)
    assert.equal(openai.calls.length, 3)
    assert.equal(rows('reads').length, 1)
    assert.equal((await call('POST', `/api/situations/${id}/read/feedback`, {})).status, 404)
    assert.equal((await call('POST', `/api/situations/${id}/rating`, {})).status, 404)
    const detail = await call('GET', `/api/situations/${id}`)
    assert.equal(detail.body.read.headline, res.body.headline)
  } finally { await close() }
})

test('the Read: an invented quote is retried once with the problem named, then accepted', async () => {
  const bad = readReply({ body: 'You wrote "the clinics love my demo". That is not what you wrote. The clinics asked for pricing three weeks ago and heard nothing.' })
  const { call, openai, rows, close } = await setup([enough(), enough(), bad, readReply()])
  try {
    const id = (await create(call, 1)).body.situation_id
    const res = await call('POST', `/api/situations/${id}/read`)
    assert.equal(res.status, 200)
    assert.match(res.body.body, /The clinics wanted a price/)
    assert.match(openai.calls[3].payload.messages.at(-1).content, /quoted words are not in the answers/)
    assert.equal(rows('model_usage_logs').length, 4)
    assert.equal(rows('reads')[0].source, 'model')
  } finally { await close() }
})

test('the Read: an invented number is retried with the problem named', async () => {
  const bad = readReply({ body: 'You wrote that 40 clinics asked for pricing three weeks ago. Nobody has had an answer since then. That is the open gap in your week.' })
  const { call, openai, close } = await setup([enough(), enough(), bad, readReply()])
  try {
    const id = (await create(call, 1)).body.situation_id
    await call('POST', `/api/situations/${id}/read`)
    assert.match(openai.calls[3].payload.messages.at(-1).content, /number is not in the answers: 40/)
  } finally { await close() }
})

test('the Read: the grounding check runs by default (usage logged) and READ_GROUNDING=off switches it off', async () => {
  const names = (openai) => openai.calls.map((c) => c.payload.response_format.json_schema.name)
  const on = await setup([enough(), enough(), readReply()], { env: { FRONTEND_URL: 'https://app.example.com', LEARN_EVERY_MESSAGE: 'off' }, byName: { read_grounding: JSON.stringify({ unsupported: [] }) } })
  try {
    const id = (await create(on.call, 1)).body.situation_id
    assert.equal((await on.call('POST', `/api/situations/${id}/read`)).status, 200)
    assert.equal(names(on.openai).filter((n) => n === 'read_grounding').length, 1)
    assert.equal(on.rows('model_usage_logs').length, 4) // two follow-ups, the Read and the grounding check: every call is logged
  } finally { await on.close() }
  const off = await setup([enough(), enough(), readReply()])
  try {
    const id = (await create(off.call, 1)).body.situation_id
    await off.call('POST', `/api/situations/${id}/read`)
    assert.equal(names(off.openai).includes('read_grounding'), false)
  } finally { await off.close() }
})

test('the Read check: banned phrase, teaser and a closing line that is not a question all fail', () => {
  const answerTexts = [...buildEvidence(FULL_ANSWERS).answerTexts, FIRST]
  const cases = [
    [readReply({ headline: 'Great, the clinics are waiting for you today.' }), /banned phrase: great/],
    [readReply({ closing_question: 'Want to see why the clinics went quiet?' }), /teaser question/],
    [readReply({ closing_question: 'The clinics asked for pricing three weeks ago.' }), /not a question/],
    [readReply({ closing_question: 'What is your biggest fear right now?' }), /no thread from the founder/],
    [readReply({ underlines: [] }), /no underlines/],
    [readReply({ underlines: ['asked for pricing'] }), /no underlines/],
  ]
  for (const [raw, rx] of cases) {
    const out = checkRead({ read: JSON.parse(raw), answerTexts })
    assert.equal(out.ok, false)
    assert.match(out.problems.join(), rx)
  }
  assert.equal(checkRead({ read: JSON.parse(readReply()), answerTexts }).ok, true)
})

test('the Read: three failures give the plain fallback, which quotes the founder and passes its own checker', async () => {
  const bad = readReply({ body: 'You wrote "the clinics love my demo" and want 40 customers. That is not what you wrote. Send the price today.' })
  const { call, openai, rows, close } = await setup([enough(), enough(), bad, bad, bad])
  try {
    const id = (await create(call, 1)).body.situation_id
    const res = await call('POST', `/api/situations/${id}/read`)
    assert.equal(res.status, 200)
    assert.equal(openai.calls.length, 5)
    assert.match(res.body.body, /Here is what I have, in your words: "I have a demo ready but I have"\./)
    assert.equal(rows('reads')[0].source, 'fallback')
    assert.equal(rows('model_usage_logs').length, 5)
    const answerTexts = [...buildEvidence(FULL_ANSWERS).answerTexts, FIRST]
    assert.equal(checkRead({ read: res.body, answerTexts, fallback: true }).ok, true)
  } finally { await close() }
})

test('the Read: model errors and unparseable replies also end in the fallback', async () => {
  const { call, close } = await setup([enough(), enough(), new Error('boom'), 'not json', 'still not json'])
  try {
    const id = (await create(call, 1)).body.situation_id
    const res = await call('POST', `/api/situations/${id}/read`)
    assert.equal(res.status, 200)
  } finally { await close() }
})

test('the Read needs something the founder wrote, and closes the situation to more turns', async () => {
  const { call, close } = await setup([enough(), enough(), readReply()])
  try {
    const id = (await create(call, 1)).body.situation_id
    const early = await call('POST', `/api/situations/${uuid(5)}/read`)
    assert.equal(early.status, 404)
    await call('POST', `/api/situations/${id}/read`)
    const late = await call('POST', `/api/situations/${id}/turn`, { text: 'One more thing about the clinics and pricing.', client_turn_id: uuid(2) })
    assert.equal(late.status, 409)
  } finally { await close() }
})

// Rafay, Nov 9: after the Read, Axiom replies and talks (at least 1 question, at most 5) until it is time to learn.
const ANSWER = 'No, I have not contacted them since the demo three weeks ago.'
const talkLine = (over = {}) => JSON.stringify({
  asked_to_learn: false, knows_goal: false, knows_blocker: true, knows_detail: true, missing: 'goal',
  reply: 'Three weeks since the demo and no word to the clinics.',
  question: 'What do you want the clinics to do after the demo?', ...over,
})
const allKnown = (over = {}) => talkLine({ knows_goal: true, missing: 'none', ...over })

test('the talk after the Read replies, then asks; the line shown is reply plus question', async () => {
  const { call, rows, close } = await setup([enough(), enough(), readReply(), talkLine()])
  try {
    const id = (await create(call, 1)).body.situation_id
    await call('POST', `/api/situations/${id}/read`)
    const res = await call('POST', `/api/situations/${id}/read/answer`, { text: ANSWER })
    assert.deepEqual(res.body, { status: 'talk', situation_id: id, reply: 'Three weeks since the demo and no word to the clinics. What do you want the clinics to do after the demo?' })
    assert.equal(rows('reads')[0].answered_at, null)
    assert.deepEqual((await call('GET', `/api/situations/${id}`)).body.read.talk.map((t) => t.role), ['founder', 'axiom'])
  } finally { await close() }
})

// Replay 4: a bare number got "You said the part that takes the most time is ..., 16 units of time". Both are sent back.
test('the talk after the Read never says "You said" about something they did not say, nor gives a number a unit they never put on it', async () => {
  const invented = talkLine({ reply: 'You said the demo is the part that takes the most time, 5 units of time.', question: 'What does the 5 count?' })
  const { call, openai, close } = await setup([enough(), enough(), readReply(), invented, talkLine()])
  try {
    const id = (await create(call, 1)).body.situation_id
    await call('POST', `/api/situations/${id}/read`)
    const res = await call('POST', `/api/situations/${id}/read/answer`, { text: 'No, I have not contacted them since the demo, 5.' })
    assert.equal(res.body.reply, 'Three weeks since the demo and no word to the clinics. What do you want the clinics to do after the demo?')
    const talk = openai.calls.filter((c) => c.payload.response_format.json_schema.name === 'read_talk')
    assert.equal(talk.length, 2)
    assert.match(talk[1].payload.messages.at(-1).content, /not something they said/)
    assert.match(talk[1].payload.messages.at(-1).content, /never put after it: 5 unit/)
  } finally { await close() }
})

test('the talk after the Read always asks once, even when everything is known after the first answer', async () => {
  const { call, close } = await setup([enough(), enough(), readReply(), allKnown(), allKnown()])
  try {
    const id = (await create(call, 1)).body.situation_id
    await call('POST', `/api/situations/${id}/read`)
    assert.equal((await call('POST', `/api/situations/${id}/read/answer`, { text: ANSWER })).body.status, 'talk')
    assert.equal((await call('POST', `/api/situations/${id}/read/answer`, { text: 'I want both clinics to start a paid pilot.' })).body.next, 'learn')
  } finally { await close() }
})

test('asking what to do goes straight to Learn', async () => {
  const { call, close } = await setup([enough(), enough(), readReply(), talkLine({ asked_to_learn: true })])
  try {
    const id = (await create(call, 1)).body.situation_id
    await call('POST', `/api/situations/${id}/read`)
    assert.equal((await call('POST', `/api/situations/${id}/read/answer`, { text: 'Not since the demo. Ok, what should I do?' })).body.next, 'learn')
  } finally { await close() }
})

test('the talk after the Read asks at most 5 questions, even when the model wants more', async () => {
  const { call, rows, openai, close } = await setup([enough(), enough(), readReply(), talkLine(), talkLine(), talkLine(), talkLine(), talkLine()])
  try {
    const id = (await create(call, 1)).body.situation_id
    await call('POST', `/api/situations/${id}/read`)
    for (let i = 0; i < 5; i += 1) {
      assert.equal((await call('POST', `/api/situations/${id}/read/answer`, { text: `${ANSWER} Answer ${i}.` })).body.status, 'talk')
    }
    const calls = openai.calls.length
    const last = await call('POST', `/api/situations/${id}/read/answer`, { text: 'The owner of each clinic, Dr Patel and Dr Rao.' })
    assert.deepEqual(last.body, { status: 'stored', situation_id: id, skipped: false, next: 'learn' })
    assert.equal(openai.calls.length, calls) // no sixth question is even asked for
    assert.equal(rows('situation_turns').filter((t) => t.result?.read_talk && t.role === 'axiom').length, 5)
    assert.equal(rows('model_usage_logs').at(-1).call_type, 'followup')
  } finally { await close() }
})

test('a talk line whose reply asks a question or says nothing of theirs is sent back', async () => {
  const { call, openai, close } = await setup([enough(), enough(), readReply(), talkLine({ reply: 'Why is that?' }), talkLine()])
  try {
    const id = (await create(call, 1)).body.situation_id
    await call('POST', `/api/situations/${id}/read`)
    assert.equal((await call('POST', `/api/situations/${id}/read/answer`, { text: ANSWER })).body.status, 'talk')
    assert.match(openai.calls.at(-1).payload.messages.at(-1).content, /the reply holds a question/)
  } finally { await close() }
})

test('skipping during the talk after the Read moves on to Learn and keeps the answer', async () => {
  const { call, rows, close } = await setup([enough(), enough(), readReply(), talkLine()])
  try {
    const id = (await create(call, 1)).body.situation_id
    await call('POST', `/api/situations/${id}/read`)
    assert.equal((await call('POST', `/api/situations/${id}/read/answer`, { text: ANSWER })).body.status, 'talk')
    const skip = await call('POST', `/api/situations/${id}/read/answer`, { skip: true })
    assert.deepEqual(skip.body, { status: 'stored', situation_id: id, skipped: false, next: 'learn' })
    assert.ok(rows('reads')[0].answered_at)
    assert.equal(rows('reads')[0].closing_answer, ANSWER)
  } finally { await close() }
})

test('the reply to the closing question is stored with the situation; the first answer wins', async () => {
  const { call, rows, close } = await setup([enough(), enough(), readReply()])
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
  const { call, rows, close } = await setup([enough(), enough(), readReply()])
  try {
    const id = (await create(call, 1)).body.situation_id
    await call('POST', `/api/situations/${id}/read`)
    const res = await call('POST', `/api/situations/${id}/read/answer`, { skip: true })
    assert.equal(res.body.skipped, true)
    assert.equal(rows('reads')[0].closing_answer, null)
    assert.equal(rows('reads')[0].skipped, true)
  } finally { await close() }
})

// Rafay, Nov 2: testing hit the limit. Accounts in ADMIN_USER_IDS skip it; everyone else keeps it.
test('a test account in ADMIN_USER_IDS is not held to the daily limit', async () => {
  const { call, close } = await setup(Array.from({ length: MAX_NEW_SITUATIONS_PER_DAY + 1 }, () => enough()), { env: { ...ENV, ADMIN_USER_IDS: USER.id } })
  try {
    for (let i = 1; i <= MAX_NEW_SITUATIONS_PER_DAY + 1; i += 1) assert.equal((await create(call, i)).status, 200)
  } finally { await close() }
})

// Live, Nov 9: a new situation about a different app got a Read built only on the
// sign-up answers (the founder's main business), so it read as the old chat. Later steps
// now also see the brief and track record, but the conversation wins and only the first
// reading uses the sign-up answers directly (Rafay: founders change ideas and pivot).
test('a Read that says nothing about this situation is sent back', () => {
  const answerTexts = ['I built this app earlier which helped people reflect on their thoughts. I built it end to end but never sold it.']
  const offTopic = {
    headline: 'You are trying to get your first 10 customers this month.',
    body: 'You avoid talking to customers, asking for money and launching. You are still unsure about positioning.',
    closing_question: 'What did people say when you showed them the app you built?',
  }
  assert.ok(checkRead({ read: offTopic, answerTexts }).problems.some((p) => p.includes('not about this situation')))
  const onTopic = { ...offTopic, body: 'You built the reflection app end to end and never sold it. Nobody has been asked to pay yet.' }
  assert.ok(!checkRead({ read: onTopic, answerTexts }).problems.some((p) => p.includes('not about this situation')))
})

test('later steps never send the sign-up answers to the model', async () => {
  const { call, openai, close } = await setup([enough(), enough(), readReply()])
  try {
    const id = (await create(call, 1)).body.situation_id
    await call('POST', `/api/situations/${id}/read`)
    for (const c of openai.calls) assert.ok(!c.payload.messages.some((m) => /sign_up_answers/.test(m.content)))
  } finally { await close() }
})

// Rafay, Nov 19: memory learns from every founder message, not only after a report. One message, one background pass.
const memoryReply = (...pairs) => JSON.stringify({ ...EMPTY_MESSAGE, new_beliefs: pairs.map(([belief, snippet]) => ({ belief, kind: 'fact', snippet, shifts_from: '' })) })

test('memory: the first message, the Read answer and a Read talk reply are each remembered from their own source', async () => {
  const TALK = 'I want both clinics to start a paid pilot this month.'
  const byName = { beliefs_message: memoryReply(
    ['Has a demo ready.', 'I have a demo ready'],
    ['Has not contacted the clinics since the demo.', 'I have not contacted them since the demo'],
    ['Wants both clinics on a paid pilot this month.', 'start a paid pilot this month'],
  ) }
  const { call, rows, close } = await setup([enough(), enough(), readReply(), talkLine(), allKnown()], { env: { FRONTEND_URL: 'https://app.example.com', READ_GROUNDING: 'off' }, byName })
  try {
    const id = (await create(call, 1)).body.situation_id
    await call('POST', `/api/situations/${id}/read`)
    await call('POST', `/api/situations/${id}/read/answer`, { text: ANSWER })
    await call('POST', `/api/situations/${id}/read/answer`, { text: TALK })
    await memoryIdle()
    const talkTurn = rows('situation_turns').find((t) => t.text === TALK)
    const firstTurn = rows('situation_turns').find((t) => t.text === FIRST)
    assert.deepEqual(rows('memory_evidence').map((e) => [e.source_kind, e.source_id]).sort(), [
      ['read', rows('reads')[0].id], ['read', talkTurn.id], ['situation', firstTurn.id], ['situation', id], // the last: the situation's own thread, made when the Read was created
    ].sort())
    assert.equal(rows('founder_beliefs').length, 3)
    assert.deepEqual(rows('founder_threads').map((t) => [t.title, t.kind]), [[rows('situations')[0].title, 'open_question']])
    assert.equal(rows('memory_runs').length, 0)
  } finally { await close() }
})

test('memory: a filler reply and a switched-off learner make no memory call', async () => {
  const byName = { beliefs_message: memoryReply(['Has a demo ready.', 'I have a demo ready']) }
  const filler = await setup([], { env: { FRONTEND_URL: 'https://app.example.com' }, byName })
  try {
    assert.equal((await create(filler.call, 1, 'ok')).body.status, 'say_more')
    await memoryIdle()
    assert.equal(filler.openai.calls.length, 0)
  } finally { await filler.close() }
  const off = await setup([enough(), enough()], { byName })
  try {
    await create(off.call, 1)
    await memoryIdle()
    assert.equal(off.rows('memory_evidence').length, 0)
  } finally { await off.close() }
})

// Nov 23: a number from a line under "Earlier they said:" is one the prompt allows, so the talk after the Read takes it on the first try.
test('the talk after the Read may use a number and a "You said" from an "Earlier they said" line', async () => {
  const fact = { id: uuid(901), user_id: USER.id, belief: 'Has 7 clinics on the waiting list.', kind: 'fact', confidence: 0.6, source: 'signup', status: 'active', created_at: '2026-10-20T00:00:00Z', updated_at: '2026-10-20T00:00:00Z' }
  const line = talkLine({ reply: 'You said 7 clinics are on the waiting list.' })
  const { call, openai, close } = await setup([enough(), enough(), readReply(), line], { tables: { founder_beliefs: [fact] } })
  try {
    const id = (await create(call, 1)).body.situation_id
    await call('POST', `/api/situations/${id}/read`)
    const res = await call('POST', `/api/situations/${id}/read/answer`, { text: ANSWER })
    const talk = openai.calls.filter((c) => c.payload.response_format.json_schema.name === 'read_talk')
    assert.match(talk[0].payload.messages.find((m) => m.content.startsWith('Past observations')).content, /Earlier they said:\n- Has 7 clinics/)
    assert.equal(talk.length, 1)
    assert.equal(res.body.reply, 'You said 7 clinics are on the waiting list. What do you want the clinics to do after the demo?')
  } finally { await close() }
})

// Review of Nov 23: the founder said 16 hours earlier in this conversation, so the old "under 15 hours" line is no source for the talk.
test('the talk after the Read may not state an earlier number the founder changed earlier in this conversation', async () => {
  const fact = { id: uuid(902), user_id: USER.id, belief: 'Works evenings and weekends, under 15 hours a week.', kind: 'fact', confidence: 0.6, source: 'signup', status: 'active', created_at: '2026-10-20T00:00:00Z', updated_at: '2026-10-20T00:00:00Z' }
  const stale = talkLine({ reply: 'You said under 15 hours a week, and the ordering by hand takes them.' })
  const { call, openai, close } = await setup([enough(), enough(), readReply(), readReply(), readReply(), stale, talkLine(), talkLine()], { tables: { founder_beliefs: [fact] } })
  try {
    const id = (await create(call, 1, 'I order everything by hand for the clinic and it takes 16 hours a week.')).body.situation_id
    await call('POST', `/api/situations/${id}/read`)
    await call('POST', `/api/situations/${id}/read/answer`, { text: 'Nobody, the clinic staff are too busy with patients.' })
    const talk = openai.calls.filter((c) => c.payload.response_format.json_schema.name === 'read_talk')
    assert.match(talk[0].payload.messages.find((m) => m.content.startsWith('Past observations')).content, /under 15 hours/)
    assert.ok(talk.length >= 2)
    assert.match(talk[1].payload.messages.at(-1).content, /15 hour/)
  } finally { await close() }
})

test('the talk after the Read never quotes words the founder did not type in this conversation', async () => {
  const fact = { id: uuid(903), user_id: USER.id, belief: '18 of them train with it three or more times a week.', kind: 'fact', confidence: 0.6, source: 'signup', status: 'active', created_at: '2026-10-20T00:00:00Z', updated_at: '2026-10-20T00:00:00Z' }
  const quoted = talkLine({ reply: 'You said "18 of them train with it three or more times a week", and monthly is your pick for the price.' })
  const { call, openai, close } = await setup([enough(), enough(), readReply(), readReply(), readReply(), quoted, talkLine(), talkLine()], { tables: { founder_beliefs: [fact] } })
  try {
    const id = (await create(call, 1, 'I built a boxing app people train with, and I need to pick the price: monthly or yearly.')).body.situation_id
    await call('POST', `/api/situations/${id}/read`)
    const res = await call('POST', `/api/situations/${id}/read/answer`, { text: ANSWER })
    const talk = openai.calls.filter((c) => c.payload.response_format.json_schema.name === 'read_talk')
    assert.ok(talk.length >= 2)
    assert.match(talk[1].payload.messages.at(-1).content, /quoted words are not in the answers/)
    assert.doesNotMatch(String(res.body.reply), /18 of them/)
  } finally { await close() }
})

// Rafay, Nov 19 (real replay): sign-up said "under 15 hours", the Read answer was a bare "16". The server must name both.
test('15 then a bare 16: the Read talk gets the notice and must name both, and memory keeps both numbers', async () => {
  const OLD = uuid(900)
  const SAID = 'I order the products myself, and it takes my hours at the weekends.'
  const old = { id: OLD, user_id: USER.id, belief: 'Works evenings and weekends, under 15 hours a week.', kind: 'fact', confidence: 0.5, source: 'signup', status: 'active', created_at: '2026-10-20T00:00:00Z', updated_at: '2026-10-20T00:00:00Z' }
  const read = readReply({
    headline: 'Ordering everything yourself takes hours that nothing else gets.',
    body: 'You order the products yourself at the weekends, so every other job waits. The hours the ordering takes decide what is left for the rest.',
    closing_question: 'At the weekends, how many hours does the ordering take you?',
  })
  const missesNew = talkLine({ reply: 'Ordering at the weekends takes your hours.', question: 'What does the ordering involve each week?' })
  const namesBothNumbers = talkLine({ reply: 'You said under 15 hours before, and now you say 16.', question: 'What changed in your weekends?' })
  const shift = JSON.stringify({ ...EMPTY_MESSAGE, new_beliefs: [{ belief: 'Said under 15 hours at sign-up, then 16 hours a week now.', kind: 'fact', snippet: '16', shifts_from: OLD }] })
  const { call, openai, rows, db, close } = await setup([enough(), enough(), read, missesNew, namesBothNumbers], { env: { FRONTEND_URL: 'https://app.example.com', READ_GROUNDING: 'off' }, byName: { beliefs_message: shift }, tables: { founder_beliefs: [old] } })
  try {
    const id = (await create(call, 1, SAID)).body.situation_id
    await call('POST', `/api/situations/${id}/read`)
    const res = await call('POST', `/api/situations/${id}/read/answer`, { text: '16' })
    await memoryIdle()
    const talk = openai.calls.filter((c) => c.payload.response_format.json_schema.name === 'read_talk')
    assert.equal(talk.length, 2)
    const notice = (c) => c.payload.messages.filter((m) => m.role === 'system' && m.content.startsWith('The founder said'))
    assert.equal(notice(talk[0]).length, 1)
    assert.match(notice(talk[0])[0].content, /and now says 16 hours\. Open by naming both/)
    assert.match(talk[1].payload.messages.at(-1).content, /name both numbers, 15 and 16/)
    assert.equal(res.body.reply, 'You said under 15 hours before, and now you say 16. What changed in your weekends?')
    // memory: the bare 16 was learned, the old fact is still active, and the next brief holds both numbers
    const facts = rows('founder_beliefs')
    assert.equal(facts.length, 2)
    assert.equal(facts.find((b) => b.id === OLD).status, 'active')
    const lines = earlierLines(await loadBrief(db, USER.id, `${SAID}\n16`, NOW))
    assert.ok(lines.some((l) => l.includes('under 15')) && lines.some((l) => l.includes('now says 16')), lines.join('|'))
  } finally { await close() }
})

// Rafay, Nov 23: "What is Axiom?" is answered with the approved wording, not started as a situation.
test('a question about Axiom gets the fixed answer: no situation, no model call, no daily count', async () => {
  const { call, openai, rows, close } = await setup([])
  try {
    const res = await call('POST', '/api/situations', { text: 'What is Axiom?', client_turn_id: uuid(990) })
    assert.equal(res.status, 200)
    assert.equal(res.body.situation_id, null)
    assert.equal(res.body.status, 'say_more')
    assert.match(res.body.reply, /^You're making calls nobody around you has made before/)
    assert.match(res.body.reply, /What's the decision you keep putting off\?$/)
    assert.equal(openai.calls.length, 0)
    assert.equal(rows('situations').length, 0)
  } finally { await close() }
})

test('a follow-up question that fails the checks is logged with its reasons, never the founder text', async () => {
  const bad = verdict({ question: 'Tell me how many clinics asked for pricing.' }) // not a question
  const { call, close } = await setup([bad, bad])
  const original = console.error
  const logged = []
  console.error = (...a) => logged.push(a.join(' '))
  try {
    const res = await create(call, 1)
    assert.equal(res.status, 200)
    const line = logged.find((l) => l.includes('follow-up question failed the checks'))
    assert.ok(line, `no log line in ${JSON.stringify(logged)}`)
    assert.match(line, /it is not a question/)
    assert.ok(!line.includes('clinics') && !line.includes('demo'), 'no founder or model text in the log')
  } finally { console.error = original; await close() }
})
