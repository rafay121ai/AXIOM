// A report's response never waits for memory and never changes because of it.
import assert from 'node:assert/strict'
import test from 'node:test'
import { FOUNDER, createWorld } from './harness.js'
import { FIRST_READING, REPORT_NOTE, REPORT_REPLY, uuid } from './script.js'
import { FULL_ANSWERS } from '../journey/fixtures.js'

const SIT = uuid(100)
const MOVE = uuid(300)
const HOUR = 3600 * 1000
const START = Date.parse('2026-10-26T13:00:00.000Z')
const at = (ms) => new Date(ms).toISOString()
const seed = () => ({
  founder_profiles: [{ user_id: FOUNDER.id, signup_answers: {}, timezone: 'Asia/Karachi' }],
  situations: [{ id: SIT, user_id: FOUNDER.id, title: 'Pricing emails', status: 'open', follow_up_count: 0, created_at: at(START - 10 * HOUR), last_activity_at: at(START - 9 * HOUR) }],
  situation_turns: [{ id: uuid(101), seq: 1, situation_id: SIT, role: 'founder', text: 'I have a demo ready but I have not emailed the 2 clinics that asked for pricing.', filler: false }],
  moves: [{
    id: MOVE, user_id: FOUNDER.id, situation_id: SIT, learn_id: uuid(200), status: 'report_due', title: 'Ask both clinics for a call', mission: 'Email the 2 clinics and ask each for a call.',
    success_condition: 'Both clinics reply.', words: 'Can we talk?', checklist: ['a', 'b'], prediction: 'At least one clinic will not reply.', hypothesis: 'Tests a direct ask.',
    start_minutes: 5, validation: { ok: true }, swap_count: 0, swapped_from: null, active_slot: 1, committed_at: at(START - 8 * HOUR),
    report_due_at: at(START - HOUR), closes_at: at(START + 40 * HOUR), closed_at: null, created_at: at(START - 9 * HOUR), updated_at: at(START - 8 * HOUR),
  }],
})
// The facts-only schema has no traits, so the harness default (the full empty answer) is rejected and retried; script a valid empty one.
const FACTS_EMPTY = { new_beliefs: [], reinforce: [], weaken: [], supersede: [], world: [], vocabulary: [], threads: [] }
const post = (w) => w.founder('POST', `/api/moves/${MOVE}/report`, { outcome: 'done', note: REPORT_NOTE, client_turn_id: uuid(21) })
const shape = ({ status, body }) => [status, body.status, body.reply, body.report.outcome, body.consent.ask, body.unlock]

test('a report triggers exactly one extraction and writes nothing when the model returns nothing', async () => {
  const w = await createWorld({ seed: seed() })
  try {
    w.openai.script('report', REPORT_REPLY)
    assert.equal((await post(w)).status, 200)
    await w.idle()
    await post(w)
    await w.idle()
    assert.equal(w.openai.chatCalls('beliefs').length, 1)
    for (const t of ['founder_beliefs', 'founder_traits', 'founder_world', 'founder_vocabulary', 'founder_threads', 'memory_evidence']) assert.equal(w.rows(t).length, 0, t)
    assert.deepEqual(w.rows('memory_runs').map((r) => [r.source_kind, r.mode, r.status]), [['report', 'full', 'done']])
    assert.equal(w.rows('model_usage_logs').filter((r) => r.call_type === 'beliefs').length, 1)
  } finally { await w.close() }
})

test('the response does not wait for extraction, and is the same when extraction throws', async () => {
  const control = await createWorld({ seed: seed() })
  control.openai.script('report', REPORT_REPLY)
  const expected = shape(await post(control))
  await control.idle()
  await control.close()

  const w = await createWorld({ seed: seed() })
  try {
    w.openai.script('report', REPORT_REPLY)
    let release
    const gate = new Promise((resolve) => { release = resolve })
    const create = w.openai.chat.completions.create
    w.openai.chat.completions.create = async (payload) => {
      if (payload.response_format?.json_schema?.name !== 'beliefs') return create(payload)
      await gate // the extraction hangs here
      throw new Error('extraction broke')
    }
    const res = await post(w) // answers while the extraction is still waiting
    assert.deepEqual(shape(res), expected)
    assert.equal(w.rows('memory_runs').length, 0)
    release()
    await w.idle() // the failure only reaches the log
    assert.deepEqual(w.rows('memory_runs').map((r) => r.status), ['failed'])
    assert.equal(w.rows('founder_beliefs').length, 0)
    assert.deepEqual(shape(await post(w)), expected)
    await w.idle()
  } finally { await w.close() }
})

test('moves that closed with no report: only the last 14 days, at most 3 a visit, and none over the daily cost cap', async () => {
  const closed = (n, daysAgo) => ({
    id: uuid(400 + n), user_id: FOUNDER.id, situation_id: SIT, learn_id: uuid(200 + n), status: 'closed_no_report', title: `Move ${n}`, mission: 'Email the clinics.',
    success_condition: 'Both reply.', prediction: 'One will not reply.', active_slot: null, swap_count: 0, closed_at: at(START - daysAgo * 24 * HOUR),
    created_at: at(START - (daysAgo + 3) * 24 * HOUR), updated_at: at(START - daysAgo * 24 * HOUR),
  })
  const base = seed()
  base.moves = [closed(1, 1), closed(2, 2), closed(3, 3), closed(4, 4), closed(5, 30)]
  const w = await createWorld({ seed: base })
  try {
    assert.equal((await w.founder('GET', '/api/reports/due')).status, 200)
    await w.idle()
    const ran = w.rows('memory_runs').filter((r) => r.source_kind === 'move').map((r) => r.source_id)
    assert.equal(ran.length, 3)
    assert.ok(!ran.includes(uuid(405)), 'a move closed 30 days ago is not remembered')
    assert.ok(ran.includes(uuid(401)), 'newest first')
  } finally { await w.close() }
})

test('moves closed with no report: over the daily cost cap there is no model call and no run row; under it, one pass each for the last 14 days, at most 3', async () => {
  const closed = (n, daysAgo) => ({
    id: uuid(400 + n), user_id: FOUNDER.id, situation_id: SIT, learn_id: uuid(200 + n), status: 'closed_no_report', title: `Move ${n}`, mission: 'Email the clinics.',
    success_condition: 'Both reply.', prediction: 'One will not reply.', active_slot: null, swap_count: 0, closed_at: at(START - daysAgo * 24 * HOUR),
    created_at: at(START - (daysAgo + 3) * 24 * HOUR), updated_at: at(START - daysAgo * 24 * HOUR),
  })
  const base = () => ({ ...seed(), moves: [closed(1, 1), closed(2, 2), closed(3, 3), closed(4, 4), closed(5, 20)] })
  const spent = { id: uuid(900), user_id: FOUNDER.id, call_type: 'beliefs', estimated_cost_usd: 5, created_at: at(START - HOUR) }
  const beliefCalls = (w) => w.openai.chatCalls().filter((c) => c.step.startsWith('beliefs'))

  const capped = await createWorld({ seed: { ...base(), model_usage_logs: [spent] } })
  try {
    assert.equal((await capped.founder('GET', '/api/reports/due')).status, 200)
    await capped.idle()
    assert.equal(beliefCalls(capped).length, 0)
    assert.equal(capped.rows('memory_runs').length, 0)
  } finally { await capped.close() }

  const w = await createWorld({ seed: base() })
  try {
    w.openai.script('beliefs_facts_only', FACTS_EMPTY, FACTS_EMPTY, FACTS_EMPTY)
    assert.equal((await w.founder('GET', '/api/reports/due')).status, 200)
    await w.idle()
    assert.equal(beliefCalls(w).length, 3)
    const ran = w.rows('memory_runs').filter((r) => r.source_kind === 'move').map((r) => r.source_id)
    assert.deepEqual([...ran].sort(), [uuid(401), uuid(402), uuid(403)])
    assert.ok(!ran.includes(uuid(405)), 'a move closed 20 days ago is not remembered')
    assert.ok(!ran.includes(uuid(404)), 'the 4th move waits for the next visit')
  } finally { await w.close() }
})

test('the sign-up seed is scheduled only when the first reading was written: a repeat or a stored reading seeds nothing more', async () => {
  const beliefCalls = (w) => w.openai.chatCalls().filter((c) => c.step.startsWith('beliefs'))
  const profile = (extra = {}) => ({ founder_profiles: [{ user_id: FOUNDER.id, signup_answers: { ...FULL_ANSWERS }, timezone: 'Asia/Karachi', ...extra }] })

  const w = await createWorld({ seed: profile() })
  try {
    w.openai.script('first_reading', FIRST_READING)
    w.openai.script('beliefs_facts_only', FACTS_EMPTY)
    assert.equal((await w.founder('POST', '/api/first-reading')).status, 200)
    await w.idle()
    assert.equal(beliefCalls(w).length, 1)
    const evidence = w.rows('memory_evidence').length
    assert.ok(evidence > 0)
    assert.equal(w.rows('memory_runs').filter((r) => r.source_kind === 'signup' && r.mode === 'facts_only').length, 1)

    assert.equal((await w.founder('POST', '/api/first-reading')).status, 200)
    await w.idle()
    assert.equal(w.openai.chatCalls('first_reading').length, 1)
    assert.equal(beliefCalls(w).length, 1)
    assert.equal(w.rows('memory_evidence').length, evidence)
  } finally { await w.close() }

  const replay = await createWorld({ seed: profile({ first_reading: FIRST_READING }) })
  try {
    assert.equal((await replay.founder('POST', '/api/first-reading')).status, 200)
    await replay.idle()
    assert.equal(replay.openai.chatCalls().length, 0)
    assert.equal(replay.rows('memory_evidence').length, 0)
    assert.equal(replay.rows('memory_runs').length, 0)
  } finally { await replay.close() }
})
