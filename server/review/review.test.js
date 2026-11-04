// Review queue: access, list shape, model draft, approve/reject compare-and-swap.
// Fakes only: no network, no real model.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createApp } from '../app.js'
import { createFakeClock, createFakeOpenAI, createFakeSupabase } from '../testing/fakes.js'
import { createSharing } from '../journey/report/sharing.js'
import { reviewDraftMessages } from '../journey/report/prompts/reviewDraft.js'

const REVIEWER = { id: '22222222-2222-4222-8222-222222222222', email: 'r@example.com' }
const OTHER = { id: '33333333-3333-4333-8333-333333333333', email: 'o@example.com' }
const AUTHOR = '11111111-1111-4111-8111-111111111111'
const id = (n) => `00000000-0000-4000-8000-0000000009${String(n).padStart(2, '0')}`
const NOW = Date.parse('2026-11-03T10:00:00.000Z')
const GOOD = JSON.stringify({
  story: 'A founder at the building stage emailed two clinics to test demand and one replied within a day.',
  lesson: 'Ask the smallest possible audience first and count replies.',
})
const row = (n, over = {}) => ({
  id: id(n), status: 'pending_review', stage: 'building', customer_market: 'clinics', business_model: 'b2b', outcome: 'done',
  draft: { move: { title: 'Ask both clinics' }, note: 'One clinic replied.' }, story: null, lesson: null,
  reviewed_by: null, reviewed_at: null, withdrawn_at: null, created_at: '2026-11-02T00:00:00.000Z', ...over,
})

async function world({ rows = [row(1), row(2)], env = { REVIEWER_USER_IDS: REVIEWER.id }, script = [GOOD] } = {}) {
  const supabase = createFakeSupabase({
    tables: { peer_outcomes: rows, outcome_author_links: [{ peer_outcome_id: id(1), user_id: AUTHOR, report_id: 'r1' }],
      founder_profiles: [{ user_id: OTHER.id, stage: 'building', customer_market: 'clinics', business_model: 'b2b' }] },
    users: { rt: REVIEWER, ot: OTHER },
  })
  const openai = createFakeOpenAI(script)
  const app = createApp({ env: { FRONTEND_URL: 'https://app.example.com', ...env }, supabase, openai, clock: createFakeClock(NOW) })
  const server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  const base = `http://127.0.0.1:${server.address().port}`
  const call = async (method, path, { token = 'rt', body } = {}) => {
    const res = await fetch(base + path, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body),
    })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
  return { supabase, openai, call, base, close: () => new Promise((r) => server.close(r)) }
}

test('non-reviewer and empty REVIEWER_USER_IDS get 404 on every review route', async () => {
  for (const [env, token] of [[{ REVIEWER_USER_IDS: REVIEWER.id }, 'ot'], [{}, 'rt'], [{ REVIEWER_USER_IDS: ' ' }, 'rt']]) {
    const w = await world({ env })
    for (const [m, p, body] of [['GET', '/api/review/outcomes'], ['POST', `/api/review/outcomes/${id(1)}/draft`], ['POST', `/api/review/outcomes/${id(1)}`, { decision: 'reject' }]]) {
      assert.equal((await w.call(m, p, { token, body })).status, 404)
    }
    if (!env.REVIEWER_USER_IDS?.trim()) assert.equal((await fetch(`${w.base}/review`)).status, 404)
    assert.equal(w.supabase.rows('peer_outcomes').filter((r) => r.status !== 'pending_review').length, 0)
    await w.close()
  }
})

test('GET /review serves the page without auth', async () => {
  const w = await world()
  const res = await fetch(`${w.base}/review`)
  assert.equal(res.status, 200)
  const html = await res.text()
  assert.match(html, /<title>Review<\/title>/)
  assert.ok(!html.includes(AUTHOR))
  assert.ok(!/<script[^>]+src="https?:/.test(html), 'no script from another site')
  const lib = await fetch(`${w.base}/review/supabase.js`)
  assert.equal(lib.status, 200)
  assert.match(await lib.text(), /createClient/)
  await w.close()
})

test('list returns pending rows only, oldest first, with nothing that links to a founder', async () => {
  const w = await world({ rows: [row(1, { created_at: '2026-11-02T00:00:00.000Z' }), row(2, { created_at: '2026-11-01T00:00:00.000Z' }),
    row(3, { status: 'approved' }), row(4, { status: 'withdrawn' })] })
  const { status, json } = await w.call('GET', '/api/review/outcomes')
  assert.equal(status, 200)
  assert.deepEqual(json.outcomes.map((o) => o.id), [id(2), id(1)])
  assert.equal(json.outcomes[0].created_at, '2026-11-01')
  const text = JSON.stringify(json)
  assert.ok(!text.includes(AUTHOR) && !/user_id|report_id|situation_id|reviewed_by|author/.test(text))
  await w.close()
})

test('draft returns model text, saves nothing, logs cost under the reviewer, and sends no ids', async () => {
  const w = await world()
  const before = JSON.stringify(w.supabase.rows('peer_outcomes'))
  const { status, json } = await w.call('POST', `/api/review/outcomes/${id(1)}/draft`)
  assert.equal(status, 200)
  assert.deepEqual(Object.keys(json).sort(), ['lesson', 'story'])
  assert.equal(JSON.stringify(w.supabase.rows('peer_outcomes')), before)
  const sent = JSON.stringify(w.openai.calls[0].payload.messages)
  assert.ok(!sent.includes(AUTHOR) && !/user_id|report_id|situation_id/.test(sent))
  await new Promise((r) => setTimeout(r, 20))
  const usage = w.supabase.rows('model_usage_logs')
  assert.equal(usage.length, 1)
  assert.equal(usage[0].user_id, REVIEWER.id)
  assert.equal(usage[0].call_type, 'report')
  await w.close()
})

test('draft retries once on bad output, then returns an error and no text', async () => {
  const w = await world({ script: ['{"story":"x"}', 'nope'] })
  const { status, json } = await w.call('POST', `/api/review/outcomes/${id(1)}/draft`)
  assert.equal(status, 502)
  assert.ok(!json.story)
  assert.equal(w.openai.calls.length, 2)
  await w.close()
})

test('draft on a row that is not pending is 409 and calls no model', async () => {
  const w = await world({ rows: [row(1, { status: 'withdrawn', draft: null })] })
  assert.equal((await w.call('POST', `/api/review/outcomes/${id(1)}/draft`)).status, 409)
  assert.equal(w.openai.calls.length, 0)
  await w.close()
})

test('approve needs a story and a lesson of allowed length (400)', async () => {
  const w = await world()
  for (const body of [{ decision: 'approve' }, { decision: 'approve', story: 'ok', lesson: ' ' }, { decision: 'approve', story: 'x'.repeat(1201), lesson: 'l' },
    { decision: 'approve', story: 's', lesson: 'x'.repeat(301) }, { decision: 'maybe' }]) {
    assert.equal((await w.call('POST', `/api/review/outcomes/${id(1)}`, { body })).status, 400)
  }
  assert.equal(w.supabase.rows('peer_outcomes')[0].status, 'pending_review')
  await w.close()
})

test('approve saves text, status and reviewer in one step; the founder-case reader then finds it; a second approve is 409', async () => {
  const w = await world()
  const body = { decision: 'approve', story: ' A founder tested two clinics. ', lesson: 'Count replies.' }
  const r = await w.call('POST', `/api/review/outcomes/${id(1)}`, { body })
  assert.equal(r.status, 200)
  const saved = w.supabase.rows('peer_outcomes').find((o) => o.id === id(1))
  assert.equal(saved.status, 'approved')
  assert.equal(saved.story, 'A founder tested two clinics.')
  assert.equal(saved.lesson, 'Count replies.')
  assert.equal(saved.reviewed_by, REVIEWER.id)
  assert.equal(saved.reviewed_at, new Date(NOW).toISOString())
  const found = await createSharing({ supabase: w.supabase, clock: createFakeClock(NOW) }).findStory(OTHER.id)
  assert.equal(found.story, 'A founder tested two clinics.')
  assert.equal((await w.call('POST', `/api/review/outcomes/${id(1)}`, { body })).status, 409)
  await w.close()
})

test('reject needs no text; a withdrawn row is 409 and stays withdrawn', async () => {
  const w = await world({ rows: [row(1), row(2, { status: 'withdrawn', draft: null })] })
  const r = await w.call('POST', `/api/review/outcomes/${id(1)}`, { body: { decision: 'reject' } })
  assert.equal(r.status, 200)
  assert.equal(w.supabase.rows('peer_outcomes')[0].status, 'rejected')
  assert.equal((await w.call('POST', `/api/review/outcomes/${id(2)}`, { body: { decision: 'reject' } })).status, 409)
  assert.equal((await w.call('POST', `/api/review/outcomes/${id(2)}`, { body: { decision: 'approve', story: 's', lesson: 'l' } })).status, 409)
  assert.equal(w.supabase.rows('peer_outcomes')[1].status, 'withdrawn')
  await w.close()
})

test('the prompt input holds only content fields', () => {
  const sent = reviewDraftMessages(row(1, { user_id: AUTHOR, report_id: 'r1' })).map((m) => m.content).join('\n')
  assert.ok(!sent.includes(AUTHOR) && !/user_id|report_id/.test(sent))
})
