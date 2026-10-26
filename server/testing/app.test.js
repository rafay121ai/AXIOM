import assert from 'node:assert/strict'
import test from 'node:test'
import { createApp } from '../app.js'
import { createFakeClock, createFakeOpenAI, createFakeSupabase } from './fakes.js'

const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'founder@example.com' }
const ENV = { FRONTEND_URL: 'https://app.example.com' }

async function withServer(app, fn) {
  const server = app.listen(0)
  try {
    await new Promise((resolve) => server.once('listening', resolve))
    return await fn(`http://127.0.0.1:${server.address().port}`)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

test('createApp returns an app and starts nothing', () => {
  const app = createApp({ env: ENV, openai: createFakeOpenAI() })
  assert.equal(typeof app.listen, 'function')
  assert.equal(typeof app.use, 'function')
})

test('createApp refuses to build without FRONTEND_URL', () => {
  assert.throws(() => createApp({ env: {}, openai: createFakeOpenAI() }), /FRONTEND_URL/)
})

test('GET /health works through createApp', async () => {
  const app = createApp({ env: ENV, openai: createFakeOpenAI() })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/health`)
    assert.equal(res.status, 200)
    assert.deepEqual(await res.json(), { ok: true })
  })
})

test('POST /api/app-sessions needs a valid token', async () => {
  const supabase = createFakeSupabase()
  const app = createApp({ env: ENV, supabase, openai: createFakeOpenAI() })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/app-sessions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    assert.equal(res.status, 401)
    assert.equal(supabase.rows('app_sessions').length, 0)
  })
})

test('POST /api/app-sessions writes a row stamped with the injected clock', async () => {
  const supabase = createFakeSupabase()
  supabase.addUser('good-token', USER)
  const clock = createFakeClock()
  const app = createApp({ env: ENV, supabase, openai: createFakeOpenAI(), clock })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/app-sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer good-token' },
      body: JSON.stringify({ entry_point: 'direct', device: 'ios' }),
    })
    assert.equal(res.status, 200)
    const rows = supabase.rows('app_sessions')
    assert.equal(rows.length, 1)
    assert.equal(rows[0].user_id, USER.id)
    assert.equal(rows[0].last_ping_at, '2026-10-26T09:00:00.000Z')
  })
})

test('POST /api/openai/chat uses the injected OpenAI and logs one usage row', async () => {
  const supabase = createFakeSupabase()
  supabase.addUser('good-token', USER)
  const openai = createFakeOpenAI(['{"ok":true}'])
  const app = createApp({ env: ENV, supabase, openai })
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/openai/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer good-token' },
      body: JSON.stringify({ model: 'gpt-4.1-mini', messages: [{ role: 'user', content: 'hi' }] }),
    })
    assert.equal(res.status, 200)
    assert.equal(openai.calls.length, 1)
    assert.equal(openai.calls[0].payload.model, 'gpt-4.1-mini')
    for (let i = 0; i < 20 && supabase.rows('model_usage_logs').length === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    assert.equal(supabase.rows('model_usage_logs').length, 1)
  })
})
