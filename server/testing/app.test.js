import assert from 'node:assert/strict'
import test from 'node:test'
import { createApp } from '../app.js'
import { createFakeOpenAI } from './fakes.js'

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
