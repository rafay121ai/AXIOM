import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'
import { createCare, lastUserMessage, bodyFields, founderMessageContent } from './middleware.js'
import { CARE_COPY } from './copy.js'
import { createApp } from '../app.js'
import { createFakeClock, createFakeOpenAI, createFakeSupabase } from '../testing/fakes.js'

const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'f@example.com' }
const THREAD = '22222222-2222-4222-8222-222222222222'

async function withServer(app, fn) {
  const server = app.listen(0)
  try {
    await new Promise((r) => server.once('listening', r))
    return await fn(`http://127.0.0.1:${server.address().port}`)
  } finally {
    await new Promise((r) => server.close(r))
  }
}

function build({ supabase = createFakeSupabase(), callStructured, extract = bodyFields('text') } = {}) {
  const clock = createFakeClock()
  const care = createCare({ supabase, callStructured, clock })
  const calls = { handler: 0 }
  const app = express()
  app.use(express.json())
  app.use((req, _res, next) => { req.user = USER; next() })
  app.post('/x', care.careGate(extract), (_req, res) => { calls.handler += 1; res.json({ ok: true }) })
  return { app, care, calls, supabase }
}
const post = (base, body) => fetch(`${base}/x`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

test('plain text reaches the handler and writes nothing', async () => {
  const { app, calls, supabase } = build()
  await withServer(app, async (base) => {
    const res = await post(base, { text: 'Kill the feature, burn rate is 40k' })
    assert.deepEqual(await res.json(), { ok: true })
  })
  assert.equal(calls.handler, 1)
  assert.equal(supabase.rows('care_events').length, 0)
})

test('clear: handler not called, fixed payload, event written, no text stored', async () => {
  const text = 'I want to kill myself, my startup is failing'
  const supabase = createFakeSupabase({ tables: { founder_profiles: [{ user_id: USER.id, country: 'Canada' }] } })
  const { app, calls, care } = build({ supabase })
  await withServer(app, async (base) => {
    const body = await (await post(base, { text })).json()
    assert.equal(body.care, 'clear')
    assert.equal(body.message, CARE_COPY.clearMessage)
    assert.equal(body.help.needs_verification, true)
    assert.equal(body.help.fallback, CARE_COPY.fallbackLine)
    assert.equal(body.help.country, 'CA')
    assert.equal('reply' in body, false)
  })
  assert.equal(calls.handler, 0)
  const rows = supabase.rows('care_events')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].user_id, USER.id)
  assert.equal(rows[0].level, 'clear')
  assert.equal(rows[0].resolved_at, null)
  assert.ok(rows[0].created_at)
  assert.equal(JSON.stringify(rows).includes('startup'), false)
  assert.equal(JSON.stringify(rows).includes('kill'), false)
  assert.equal(await care.isCareOpen(USER.id), true)
  await care.resolveCare(USER.id)
  assert.equal(await care.isCareOpen(USER.id), false)
})

test('unclear: fixed soft question, handler not called; the second unclear in the thread escalates', async () => {
  const supabase = createFakeSupabase()
  const { app, calls } = build({ supabase, callStructured: async () => ({ data: { level: 'unclear', reason: 'x' } }) })
  await withServer(app, async (base) => {
    const first = await (await post(base, { text: 'i wanna dieee', thread_id: THREAD })).json()
    assert.deepEqual(first, { care: 'unclear', reply: CARE_COPY.unclearReply })
    const second = await (await post(base, { text: "can't do this anymore", thread_id: THREAD })).json()
    assert.equal(second.care, 'clear')
  })
  assert.equal(calls.handler, 0)
  assert.deepEqual(supabase.rows('care_events').map((r) => r.level), ['unclear', 'clear'])
  assert.equal(JSON.stringify(supabase.rows('care_events')).includes('dieee'), false)
})

test('unclear in a different thread does not escalate', async () => {
  const { app } = build({ callStructured: async () => ({ data: { level: 'none', reason: 'x' } }) })
  await withServer(app, async (base) => {
    await post(base, { text: 'i wanna dieee', thread_id: THREAD })
    const other = await (await post(base, { text: 'i wanna dieee', thread_id: '33333333-3333-4333-8333-333333333333' })).json()
    assert.equal(other.care, 'unclear')
  })
})

test('model failure on ambiguous text still stops the step', async () => {
  const { app, calls } = build({ callStructured: async () => { throw new Error('down') } })
  await withServer(app, async (base) => {
    assert.equal((await (await post(base, { text: 'everything feels hopeless' })).json()).care, 'unclear')
  })
  assert.equal(calls.handler, 0)
})

test('a database failure never lets distress through', async () => {
  const broken = { from() { throw new Error('db down') } }
  const { app, calls } = build({ supabase: broken })
  await withServer(app, async (base) => {
    assert.equal((await (await post(base, { text: 'I want to end my life' })).json()).care, 'clear')
  })
  assert.equal(calls.handler, 0)
})

test('isCareOpen fails safe to true when the lookup fails', async () => {
  const care = createCare({ supabase: { from() { throw new Error('db down') } } })
  assert.equal(await care.isCareOpen(USER.id), true)
})

test('extractors', () => {
  assert.equal(lastUserMessage({ body: { messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] } }), 'a')
  assert.deepEqual(lastUserMessage({ body: { messages: [{ role: 'user', content: [{ type: 'text', text: 'p' }] }] } }), ['p'])
  assert.equal(founderMessageContent({ body: { content: 'Axiom text <experiment>{}</experiment>' } }), null)
  assert.equal(founderMessageContent({ body: { role: 'assistant', content: 'x' } }), null)
  assert.equal(founderMessageContent({ body: { role: 'user', content: 'hi' } }), 'hi')
})

test('wired into the real app: /api/messages and /api/openai/chat stop on clear', async () => {
  const supabase = createFakeSupabase({ users: { tok: USER } })
  const openai = createFakeOpenAI()
  const app = createApp({ env: { FRONTEND_URL: 'https://app.example.com' }, supabase, openai, clock: createFakeClock() })
  assert.equal(typeof app.locals.isCareOpen, 'function')
  await withServer(app, async (base) => {
    const headers = { 'content-type': 'application/json', authorization: 'Bearer tok' }
    const msg = await fetch(`${base}/api/messages`, { method: 'POST', headers, body: JSON.stringify({ session_id: THREAD, role: 'user', content: 'I want to kill myself' }) })
    assert.equal((await msg.json()).care, 'clear')
    const chat = await fetch(`${base}/api/openai/chat`, {
      method: 'POST', headers,
      body: JSON.stringify({ model: 'gpt-4.1-mini', messages: [{ role: 'system', content: 'be kind' }, { role: 'user', content: 'suicide' }] }),
    })
    assert.equal((await chat.json()).care, 'clear')
  })
  assert.equal(openai.calls.length, 0)
  assert.equal(supabase.rows('messages').length, 0)
})
