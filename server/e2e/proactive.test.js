// Axiom speaks first: a trigger makes an opener, the founder replies, and the
// journey runs as for any situation (Read, Learn, Move, Report). Fakes only.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createProactive } from '../proactive/run.js'
import { FOUNDER, createWorld } from './harness.js'
import {
  FULL_ANSWERS, LESSON, MOVE, READ, READ_ANSWER, REPORT_NOTE, REPORT_REPLY, SITUATION_TEXT, WHAT_NEXT, situationVerdict, uuid,
} from './script.js'

const DAY = 24 * 60 * 60 * 1000
const ZONE = 'Asia/Karachi'
const OPENER = 'You said "My first 10 customers" by 6 November 2026. That is 11 days away. Where is it now?'

test('a trigger, Axiom\'s opener, the founder\'s reply, then Read, Learn, Move and Report', async (t) => {
  const w = await createWorld()
  const { founder, openai, rows, clock } = w
  // A founder who signed up, did one situation recently and has a goal 11 days away (the world starts on 26 October).
  const now = clock.now()
  w.supabase.from('founder_profiles').insert({ user_id: FOUNDER.id, timezone: ZONE, deadline: '2026-11-06', signup_answers: FULL_ANSWERS })
    .then(() => {})
  w.supabase.from('situations').insert({
    user_id: FOUNDER.id, title: 'Old', status: 'open', follow_up_count: 0, created_at: new Date(now - 3 * DAY).toISOString(), last_activity_at: new Date(now - DAY).toISOString(),
  }).then(() => {})
  const proactive = createProactive({ supabase: w.supabase, clock, isCareOpen: w.app.locals.isCareOpen, log: () => {} })
  const ids = {}

  try {
    await t.test('trigger: the job makes the opener, no model call', async () => {
      assert.equal(await proactive.run(), 1)
      const [made] = rows('situations').filter((s) => s.started_by === 'axiom')
      ids.situation = made.id
      assert.equal(made.trigger_key, 'goal:2026-11-06:14')
      assert.equal(openai.calls.length, 0)
      const [turn] = rows('situation_turns')
      assert.deepEqual([turn.role, turn.text], ['axiom', OPENER])
      assert.equal(await proactive.run(), 0)
    })

    await t.test('Home: Axiom asked is the first item and stays', async () => {
      const home = await founder('GET', '/api/home')
      const [first] = home.body.items
      assert.equal(first.label, `Axiom asked: ${OPENER}`)
      assert.equal(first.stays, true)
      assert.equal(first.target.situation_id, ids.situation)
      const open = await founder('GET', `/api/situations/${ids.situation}`)
      assert.deepEqual(open.body.turns.map((x) => x.role), ['axiom'])
    })

    await t.test('the founder\'s reply goes through the turn route; the model sees the opener as Axiom\'s', async () => {
      openai.script('situation_turn', situationVerdict({ has_detail: true, missing: 'none', question: '' }))
      const res = await founder('POST', `/api/situations/${ids.situation}/turn`, { text: SITUATION_TEXT, client_turn_id: uuid(1) })
      assert.equal(res.status, 200)
      assert.equal(res.body.status, 'ready')
      const seen = JSON.parse(openai.chatCalls('situation_turn')[0].payload.messages[1].content).conversation
      assert.equal(seen[0].role, 'axiom')
      assert.match(seen[0].note, /not the founder's words/)
      assert.equal(seen[1].note, undefined)
      const home = await founder('GET', '/api/home')
      assert.ok(!home.body.items.some((i) => i.label.startsWith('Axiom asked')))
    })

    await t.test('Read, Learn, Move, Report as for any situation', async () => {
      openai.script('read', READ)
      assert.equal((await founder('POST', `/api/situations/${ids.situation}/read`)).status, 200)
      assert.equal((await founder('POST', `/api/situations/${ids.situation}/read/answer`, { text: READ_ANSWER })).body.status, 'stored')

      openai.script('learn_reply', LESSON, LESSON)
      const lesson = await founder('POST', `/api/situations/${ids.situation}/learn`)
      assert.equal(lesson.status, 200)
      ids.learn = lesson.body.learn_id
      const ask = await founder('POST', `/api/learn/${ids.learn}/turn`, { text: WHAT_NEXT, client_turn_id: uuid(11) })
      assert.ok(ask.body.move_offer, 'a founder who asks what to do next gets the move')

      openai.script('move', MOVE)
      ids.move = (await founder('POST', `/api/learn/${ids.learn}/move`)).body.move.id
      assert.equal((await founder('POST', `/api/moves/${ids.move}/commit`, { timezone: ZONE })).body.move.status, 'committed')

      clock.set(clock.now() + 2 * DAY)
      openai.script('report', REPORT_REPLY)
      const report = await founder('POST', `/api/moves/${ids.move}/report`, { outcome: 'done', note: REPORT_NOTE, client_turn_id: uuid(21) })
      assert.equal(report.body.status, 'reported')
      assert.equal(report.body.consent.ask, true)
      assert.deepEqual(report.body.unlock, { granted: true })
      assert.deepEqual(openai.unexpected, [])
    })
  } finally {
    await w.close()
  }
})
