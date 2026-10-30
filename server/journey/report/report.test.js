import assert from 'node:assert/strict'
import test from 'node:test'
import { createApp } from '../../app.js'
import { createFakeClock, createFakeOpenAI, createFakeSupabase } from '../../testing/fakes.js'
import { FULL_ANSWERS } from '../fixtures.js'
import { checkReportReply, predictionCheckFor } from './reportChecks.js'
import { STALE_MS, createReports } from './reportService.js'
import { STORY_CAP } from './sharing.js'
import {
  AFTER_STORY_VERSION, ALONE_VERSION, CONSENT_WORDINGS, KEPT_PRIVATE_LINE, NEED_MORE, OUTCOMES, SHARED_LINE,
  SHARE_AUTO_TEXT, STORY_OFFER, WITHDRAWN_LINE, fallbackReply, openingLine,
} from './wording.js'

const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'founder@example.com' }
const OTHER = { id: '22222222-2222-4222-8222-222222222222', email: 'other@example.com' }
const ENV = { FRONTEND_URL: 'https://app.example.com' }
const NOW = Date.parse('2026-10-26T16:00:00.000Z') // 9 pm in Karachi
const HOUR = 60 * 60 * 1000
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const at = (ms) => new Date(ms).toISOString()
const SIT = uuid(100)
const FIRST = 'I have a demo ready but I have not emailed the 2 clinics that asked for pricing three weeks ago.'
const M1 = uuid(301)
const M2 = uuid(302)
const DRAFT = uuid(303)
const NOTE = 'One clinic gave me a time on Thursday, the other did not reply.'

const MOVE = {
  title: 'Ask both clinics that asked for pricing for a call.',
  mission: 'Email the 2 clinics that asked for pricing and ask each for a 20-minute call.',
  success_condition: 'Both clinics reply with a day and time for the call.',
  words: 'I have the pricing you asked for. Can we book 20 minutes to go through it?',
  checklist: ['Open the last email from each clinic', 'Send it to both clinics'],
  prediction: 'At least one of the clinics will not reply.',
  hypothesis: 'Tests whether the clinics will reply with a day and time when asked directly.',
}
const move = (id, over = {}) => ({
  id, user_id: USER.id, situation_id: SIT, learn_id: uuid(200 + Number(id.slice(-3))), status: 'committed', ...MOVE,
  start_minutes: 5, validation: { ok: true }, swap_count: 0, swapped_from: null, active_slot: null,
  committed_at: at(NOW - 8 * HOUR), report_due_at: at(NOW - HOUR), report_time_local: '20:00', time_zone: 'Asia/Karachi',
  closes_at: at(NOW + 40 * HOUR), closed_at: null, created_at: at(NOW - 9 * HOUR), updated_at: at(NOW - 8 * HOUR), ...over,
})

const GOOD_REPLY = JSON.stringify({
  reply: 'One clinic gave you Thursday and one did not reply. I said at least one would not reply, and I was right. Send the clinic that replied a message confirming Thursday.',
  prediction_check: 'right',
})
const replyFor = (outcome) => (outcome === 'done' ? GOOD_REPLY : JSON.stringify({
  reply: 'Things changed for the clinics this week. Email only the clinic that is easiest to reach and ask for a call.',
  prediction_check: 'unclear',
}))

// The real database refuses repeated unique keys; the in-memory fake does not.
// This wrapper does it for the keys the Report relies on.
const UNIQUE = {
  reports: [['move_id']],
  peer_unlocks: [['granted_by_report_id', 'kind']],
  user_settings: [['user_id']],
  outcome_author_links: [['peer_outcome_id']],
}
// fail(table, action, payload): true makes that write answer an error.
function withKeys(base, { fail = () => false } = {}) {
  return {
    ...base,
    from(table) {
      const b = base.from(table)
      const eqs = []
      let action = 'select'
      let payload = null
      const { eq, insert, update, then } = b
      const del = b.delete
      b.delete = () => { action = 'delete'; del(); return b }
      b.eq = (c, v) => { eqs.push([c, v]); eq(c, v); return b }
      b.insert = (p) => { action = 'insert'; payload = p; insert(p); return b }
      b.update = (p) => { action = 'update'; payload = p; update(p); return b }
      b.then = (resolve, reject) => {
        if (action !== 'select' && fail(table, action, payload)) {
          return Promise.resolve({ data: null, error: { code: 'XX000', message: `${table} ${action} failed` } }).then(resolve, reject)
        }
        const rows = base.rows(table)
        let clash = false
        if (action === 'insert' && UNIQUE[table]) {
          clash = UNIQUE[table].some((cols) => rows.some((r) => cols.every((c) => r[c] === payload[c])))
        }
        if (table === 'moves' && action === 'update' && payload.active_slot != null) {
          const hits = rows.filter((r) => eqs.every(([c, v]) => r[c] === v))
          clash = hits.some((h) => rows.some((r) => r.id !== h.id && r.user_id === h.user_id && r.active_slot === payload.active_slot))
        }
        if (clash) return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key' } }).then(resolve, reject)
        return then(resolve, reject)
      }
      return b
    },
  }
}

const seed = ({ moves, care = [], settings = [], peers = [], links = [] } = {}) => ({
  founder_profiles: [{ user_id: USER.id, signup_answers: FULL_ANSWERS, stage: 'building', business_model: 'b2b', timezone: 'Asia/Karachi', report_time_local: null }],
  situations: [{ id: SIT, user_id: USER.id, title: 'Pricing emails to clinics', status: 'open', follow_up_count: 0, created_at: at(NOW - 10 * HOUR), last_activity_at: at(NOW - 9 * HOUR) }],
  situation_turns: [{ id: uuid(101), seq: 1, situation_id: SIT, role: 'founder', text: FIRST, filler: false, created_at: at(NOW - 10 * HOUR) }],
  reads: [{ id: uuid(102), situation_id: SIT, headline: 'Nobody has said yes or no yet.', body: 'They asked three weeks ago.', closing_question: 'Have you gone back to either clinic?', closing_answer: 'No, not since the demo.', skipped: false }],
  moves: moves ?? [
    move(M1, { status: 'report_due', active_slot: 1 }),
    move(M2, { active_slot: 2, report_due_at: at(NOW + 20 * HOUR) }),
    move(DRAFT, { status: 'draft', committed_at: null, report_due_at: null, closes_at: null }),
  ],
  care_events: care,
  user_settings: settings,
  peer_outcomes: peers,
  outcome_author_links: links,
})

async function setup(script = [], opts = {}) {
  const base = createFakeSupabase({ users: { tok: USER, tok2: OTHER }, tables: seed(opts) })
  const openai = createFakeOpenAI(script)
  const clock = createFakeClock(NOW)
  const app = createApp({ env: ENV, supabase: withKeys(base, opts), openai, clock })
  const server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  const url = `http://127.0.0.1:${server.address().port}`
  const responses = []
  const as = (token) => async (method, path, body) => {
    const res = await fetch(`${url}${path}`, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    responses.push(text)
    return { status: res.status, body: text.startsWith('{') ? JSON.parse(text) : text }
  }
  const chatCalls = () => openai.calls.filter((c) => c.payload?.messages && c.payload.messages[0]?.content?.includes('told you how it went'))
  return { call: as('tok'), callOther: as('tok2'), callAnon: as(null), clock, chatCalls, responses, base, rows: (t) => base.rows(t), close: () => new Promise((r) => server.close(r)) }
}

const report = (call, moveId, body) => call('POST', `/api/moves/${moveId}/report`, { client_turn_id: uuid(900), ...body })

// Nothing that points at a founder or at the private link leaves the server.
function assertNoPrivateData(texts, extra = []) {
  for (const text of texts) {
    for (const bad of [USER.id, 'user_id', 'peer_outcome', 'author_link', 'draft', ...extra]) {
      assert.ok(!text.includes(bad), `a response holds ${bad}: ${text.slice(0, 200)}`)
    }
    assert.ok(!/strike|warning|penalt|removed/i.test(text), `penalty language in ${text.slice(0, 200)}`)
  }
}

// ── Pure checks ──────────────────────────────────────────────────────────────

test('the prediction check is only right or wrong after Done with a note', () => {
  assert.equal(predictionCheckFor({ outcome: 'couldnt', modelCheck: 'right', hasNote: true }), 'not_tested')
  assert.equal(predictionCheckFor({ outcome: 'didnt', modelCheck: 'wrong', hasNote: true }), 'not_tested')
  assert.equal(predictionCheckFor({ outcome: 'done', modelCheck: 'right', hasNote: false }), 'unclear')
  assert.equal(predictionCheckFor({ outcome: 'done', modelCheck: 'maybe', hasNote: true }), 'unclear')
  assert.equal(predictionCheckFor({ outcome: 'done', modelCheck: 'wrong', hasNote: true }), 'wrong')
})

test('the reply may not invent numbers, claim a check it did not make, or penalise', () => {
  const knownTexts = [FIRST, NOTE, MOVE.mission]
  const problemsOf = (reply, outcome = 'done', check = 'right') => checkReportReply({ data: { reply, prediction_check: check }, outcome, knownTexts }).problems.join(' | ')
  assert.equal(problemsOf('Both of the 2 clinics heard from you. I was right. Confirm Thursday with the one that replied.'), '')
  assert.match(problemsOf('7 of the 9 clinics replied. Send the next one.'), /never gave: 7/)
  assert.match(problemsOf('I was right. Send it again.', 'didnt', 'right'), /says the prediction was right/)
  assert.match(problemsOf('I was wrong. Send it again.', 'done', 'right'), /says the prediction was wrong/)
  assert.match(problemsOf('That is a strike. Try again tomorrow.', 'didnt', 'unclear'), /penalty/)
  assert.match(problemsOf('Absolutely great work. Want to see why it worked?'), /teaser/)
  const cleaned = checkReportReply({ data: { reply: 'Got it. Confirm Thursday with the clinic that replied.', prediction_check: 'right' }, outcome: 'couldnt', knownTexts })
  assert.equal(cleaned.reply, 'Confirm Thursday with the clinic that replied.')
  assert.equal(cleaned.prediction_check, 'not_tested')
})

test('the opening line names the move and the prediction', () => {
  assert.equal(openingLine(MOVE), 'Your move was to ask both clinics that asked for pricing for a call. I said at least one of the clinics will not reply. What happened?')
  for (const o of OUTCOMES) assert.ok(fallbackReply({ outcome: o, title: MOVE.title }).includes('ask both clinics'))
  for (const o of ['couldnt', 'didnt']) assert.ok(!/which helps nobody|i was right|did it/i.test(fallbackReply({ outcome: o, title: MOVE.title })))
})

// ── Through the API ──────────────────────────────────────────────────────────

test('due lists the committed moves with the opening line; nothing while care is open', async () => {
  const { call, close } = await setup()
  try {
    const res = await call('GET', '/api/reports/due')
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.reports.map((r) => [r.move_id, r.due]), [[M1, true], [M2, false]])
    assert.equal(res.body.reports[0].opening, openingLine(MOVE))
    assert.deepEqual(res.body.reports[0].outcomes, ['done', 'couldnt', 'didnt'])
  } finally { await close() }

  const care = await setup([], { care: [{ id: uuid(800), user_id: USER.id, level: 'clear', scope_id: null, created_at: at(NOW - 20 * HOUR), resolved_at: null }] })
  try {
    assert.deepEqual((await care.call('GET', '/api/reports/due')).body, { reports: [] })
  } finally { await care.close() }
})

for (const outcome of OUTCOMES) {
  test(`${outcome}: saved, the move is reported, its slot is free, the sharing question is asked`, async () => {
    const { call, rows, chatCalls, responses, close } = await setup([replyFor(outcome)])
    try {
      const res = await report(call, M1, { outcome, note: NOTE })
      assert.equal(res.status, 200)
      assert.equal(res.body.status, 'reported')
      assert.equal(res.body.report.outcome, outcome)
      assert.equal(res.body.report.note, NOTE)
      assert.equal(res.body.reply, JSON.parse(replyFor(outcome)).reply)
      assert.equal(res.body.report.prediction.text, MOVE.prediction)
      assert.equal(res.body.report.prediction.check, outcome === 'done' ? 'right' : 'not_tested')
      assert.equal(chatCalls().length, 1)

      const stored = rows('reports')
      assert.equal(stored.length, 1)
      assert.equal(stored[0].outcome, outcome)
      const m = rows('moves').find((r) => r.id === M1)
      assert.deepEqual([m.status, m.active_slot], ['reported', null])

      assert.deepEqual(res.body.consent, {
        ask: true, state: 'asked', question: { text: CONSENT_WORDINGS[ALONE_VERSION], wording_version: ALONE_VERSION },
        question_after_story: null, choices: ['share', 'keep_private'],
      })
      assert.equal(res.body.story_offer, null)
      assert.deepEqual(res.body.unlock, { granted: true })
      assert.deepEqual(rows('peer_unlocks').map((u) => [u.user_id, u.granted_by_report_id, u.kind, u.used_on_situation_id]), [[USER.id, stored[0].id, 'report', null]])
      const log = rows('consent_log')
      assert.deepEqual(log.map((l) => [l.action, l.report_id, l.wording_version]), [['asked', stored[0].id, ALONE_VERSION]])
      assert.ok(log[0].decided_at)
      assert.equal(rows('peer_outcomes').length, 0)
      assertNoPrivateData(responses)
    } finally { await close() }
  })
}

test('only Done, Couldn\'t and Didn\'t; a one-word note is asked for more and nothing is saved', async () => {
  const { call, rows, chatCalls, close } = await setup()
  try {
    for (const outcome of ['skipped', 'failed', 'strike', '', null]) {
      assert.equal((await report(call, M1, { outcome })).status, 400, String(outcome))
    }
    assert.equal((await call('POST', `/api/moves/${M1}/report`, { outcome: 'done' })).status, 400) // no client_turn_id
    const short = await report(call, M1, { outcome: 'done', note: 'ok' })
    assert.deepEqual(short.body, { status: 'need_more', reply: NEED_MORE })
    assert.equal(rows('reports').length, 0)
    assert.equal(rows('moves').find((r) => r.id === M1).status, 'report_due')
    assert.equal(chatCalls().length, 0)
  } finally { await close() }
})

test('no note: the fixed line, no model call, the prediction stays unclear', async () => {
  const { call, chatCalls, close } = await setup()
  try {
    const res = await report(call, M1, { outcome: 'done' })
    assert.equal(res.status, 200)
    assert.equal(res.body.reply, fallbackReply({ outcome: 'done', title: MOVE.title }))
    assert.equal(res.body.report.prediction.check, 'unclear')
    assert.equal(chatCalls().length, 0)
  } finally { await close() }
})

test('a reply with invented numbers is never stored; the prediction check stays honest', async () => {
  const invented = JSON.stringify({ reply: '6 of the 9 clinics replied, so I was right. Book the 4 calls.', prediction_check: 'right' })
  const { call, rows, chatCalls, close } = await setup([invented, invented])
  try {
    const res = await report(call, M1, { outcome: 'done', note: NOTE })
    assert.equal(res.status, 200)
    assert.equal(chatCalls().length, 2)
    assert.match(chatCalls()[1].payload.messages.at(-1).content, /never gave: 6/)
    assert.equal(res.body.reply, fallbackReply({ outcome: 'done', title: MOVE.title }))
    assert.equal(res.body.report.prediction.check, 'unclear')
    const stored = rows('reports')[0]
    assert.ok(!/[469]/.test(stored.reply))
    assert.equal(stored.prediction_check, 'unclear')
  } finally { await close() }
})

test('a report is saved once: a repeat or a double tap returns the stored one', async () => {
  const { call, rows, chatCalls, close } = await setup([GOOD_REPLY, GOOD_REPLY])
  try {
    const [a, b] = await Promise.all([report(call, M1, { outcome: 'done', note: NOTE }), report(call, M1, { outcome: 'done', note: NOTE })])
    assert.deepEqual([a.status, b.status], [200, 200])
    assert.deepEqual(a.body, b.body)
    assert.equal(a.body.reply, JSON.parse(GOOD_REPLY).reply)
    assert.equal(chatCalls().length, 1, 'the row is claimed before the model call, so a double tap costs one call')
    assert.equal(rows('reports')[0].reply_pending, false)
    const again = await report(call, M1, { outcome: 'didnt', note: 'Something else entirely happened here.' })
    assert.deepEqual(again.body, a.body)
    assert.equal(rows('reports').length, 1)
    assert.equal(rows('peer_unlocks').length, 1)
    assert.equal(rows('consent_log').length, 1)
  } finally { await close() }
})

test('the freed slot takes a new commit', async () => {
  const { call, close } = await setup()
  try {
    assert.equal((await call('POST', `/api/moves/${DRAFT}/commit`)).body.error, 'move_cap')
    await report(call, M1, { outcome: 'didnt' })
    const commit = await call('POST', `/api/moves/${DRAFT}/commit`)
    assert.equal(commit.status, 200)
    assert.equal(commit.body.move.status, 'committed')
    const due = await call('GET', '/api/reports/due')
    assert.ok(!due.body.reports.some((r) => r.move_id === M1))
  } finally { await close() }
})

test('a quietly closed move can still be checked in; a draft cannot', async () => {
  const { call, clock, rows, close } = await setup()
  try {
    clock.advance(41 * HOUR)
    assert.equal((await call('GET', `/api/moves/${M1}`)).body.move.status, 'closed_no_report')
    const late = await report(call, M1, { outcome: 'couldnt' })
    assert.equal(late.status, 200)
    assert.equal(rows('moves').find((r) => r.id === M1).status, 'reported')
    assert.equal((await report(call, DRAFT, { outcome: 'done' })).status, 409)
  } finally { await close() }
})

test('share: the peer outcome holds no user id, only the private link does, and it never leaves the server', async () => {
  const { call, rows, responses, close } = await setup([GOOD_REPLY])
  try {
    const res = await report(call, M1, { outcome: 'done', note: NOTE })
    const reportId = res.body.report.id
    const shared = await call('POST', `/api/reports/${reportId}/consent`, { share: true })
    assert.equal(shared.status, 200)
    assert.deepEqual(shared.body.consent, { ask: false, state: 'shared', automatic: false, decided_at: at(NOW) })
    assert.equal(shared.body.reply, SHARED_LINE)

    const peers = rows('peer_outcomes')
    assert.equal(peers.length, 1)
    const peer = peers[0]
    assert.equal(peer.status, 'pending_review')
    assert.ok(!('user_id' in peer) && !('report_id' in peer) && !('move_id' in peer))
    const flat = JSON.stringify(peer)
    for (const bad of [USER.id, USER.email, reportId, M1, SIT]) assert.ok(!flat.includes(bad), `peer row holds ${bad}`)
    assert.deepEqual([peer.stage, peer.business_model, peer.customer_market, peer.outcome], ['building', 'b2b', 'Mostly abroad', 'done'])

    const links = rows('outcome_author_links')
    assert.deepEqual(links.map((l) => [l.peer_outcome_id, l.user_id, l.report_id]), [[peer.id, USER.id, reportId]])
    assert.ok(!JSON.stringify(rows('reports')).includes(peer.id))

    const again = await call('POST', `/api/reports/${reportId}/consent`, { share: true })
    assert.deepEqual(again.body, shared.body)
    assert.equal(rows('peer_outcomes').length, 1)
    assert.deepEqual(rows('consent_log').map((l) => l.action), ['asked', 'share'])
    assert.deepEqual(rows('peer_unlocks').map((u) => u.kind).sort(), ['report', 'share'])

    const got = await call('GET', `/api/reports/${reportId}`)
    assert.equal(got.body.report.sharing.state, 'shared')
    assertNoPrivateData(responses, [peer.id])
  } finally { await close() }
})

test('keep private shares nothing; withdraw takes a share down; both are logged', async () => {
  // An approved story from someone else exists, so the after-story question is really offered.
  const seeded = { id: uuid(790), status: 'approved', stage: 'building', customer_market: 'Mostly abroad', business_model: 'b2b', outcome: 'done',
    story: 'They asked each clinic to book a call.', lesson: null, draft: null }
  const { call, rows: allRows, responses, close } = await setup([GOOD_REPLY, GOOD_REPLY], { peers: [seeded] })
  const rows = (t) => (t === 'peer_outcomes' ? allRows(t).filter((p) => p.id !== seeded.id) : allRows(t))
  try {
    const first = (await report(call, M1, { outcome: 'done', note: NOTE })).body.report.id
    const priv = await call('POST', `/api/reports/${first}/consent`, { share: false })
    assert.equal(priv.body.consent.state, 'private')
    assert.equal(priv.body.reply, KEPT_PRIVATE_LINE)
    assert.equal(rows('peer_outcomes').length, 0)
    assert.equal((await call('POST', `/api/reports/${first}/withdraw`)).body.consent.state, 'private') // nothing to take down

    const second = (await report(call, M2, { outcome: 'done', note: NOTE, client_turn_id: uuid(901) })).body.report.id
    await call('POST', `/api/reports/${second}/consent`, { share: true, wording_version: AFTER_STORY_VERSION })
    const out = await call('POST', `/api/reports/${second}/withdraw`)
    assert.equal(out.status, 200)
    assert.deepEqual([out.body.consent.state, out.body.reply], ['withdrawn', WITHDRAWN_LINE])
    const peer = rows('peer_outcomes')[0]
    assert.deepEqual([peer.status, peer.draft, peer.story], ['withdrawn', null, null])
    assert.ok(rows('outcome_author_links')[0].withdrawn_at)
    const repeat = await call('POST', `/api/reports/${second}/withdraw`)
    assert.deepEqual([repeat.status, repeat.body.consent.state], [200, 'withdrawn'])

    // The consent toggle back on shares again as a new outcome; off takes it down.
    await call('POST', `/api/reports/${second}/consent`, { share: true })
    assert.equal(rows('peer_outcomes').filter((p) => p.status === 'pending_review').length, 1)
    await call('POST', `/api/reports/${second}/consent`, { share: false })
    assert.equal(rows('peer_outcomes').filter((p) => p.status === 'pending_review').length, 0)

    const log = rows('consent_log').filter((l) => l.report_id === second).map((l) => [l.action, l.wording_version])
    assert.deepEqual(log, [
      ['asked', ALONE_VERSION], ['share', AFTER_STORY_VERSION], ['withdraw', 'withdraw-v1'], ['share', ALONE_VERSION], ['keep_private', ALONE_VERSION],
    ])
    assert.equal((await call('POST', `/api/reports/${second}/consent`, { share: true, wording_version: 'made-up-v9' })).status, 400)
    assert.equal((await call('POST', `/api/reports/${second}/consent`, { share: 'yes' })).status, 400)
    assertNoPrivateData(responses)
  } finally { await close() }
})

test('share automatically: off by default, logged when changed, and the report shares without asking', async () => {
  const { call, rows, close } = await setup([GOOD_REPLY, GOOD_REPLY])
  try {
    assert.deepEqual((await call('GET', '/api/settings/sharing')).body, { share_automatically: false, text: SHARE_AUTO_TEXT.off })
    const asked = await report(call, M1, { outcome: 'done', note: NOTE })
    assert.equal(asked.body.consent.ask, true)

    assert.equal((await call('PUT', '/api/settings/sharing', { share_automatically: 'on' })).status, 400)
    const on = await call('PUT', '/api/settings/sharing', { share_automatically: true })
    assert.deepEqual(on.body, { share_automatically: true, text: SHARE_AUTO_TEXT.on })
    await call('PUT', '/api/settings/sharing', { share_automatically: true })
    assert.equal(rows('user_settings').length, 1)

    const auto = await report(call, M2, { outcome: 'done', note: NOTE, client_turn_id: uuid(901) })
    assert.deepEqual(auto.body.consent, { ask: false, state: 'shared', automatic: true, decided_at: at(NOW) })
    assert.equal(rows('peer_outcomes').length, 1)
    assert.ok(!('user_id' in rows('peer_outcomes')[0]))
    assert.deepEqual(rows('consent_log').map((l) => l.action), ['asked', 'auto_share_on', 'auto_share'])

    const off = await call('PUT', '/api/settings/sharing', { share_automatically: false })
    assert.equal(off.body.share_automatically, false)
    assert.equal(rows('consent_log').at(-1).action, 'auto_share_off')
    assert.equal(rows('peer_outcomes')[0].status, 'pending_review') // turning it off does not take past shares down
  } finally { await close() }
})

test('care: a worrying note is not saved; a situation care touched is never shared, even automatically', async () => {
  const gate = await setup()
  try {
    const res = await report(gate.call, M1, { outcome: 'didnt', note: 'I want to kill myself' })
    assert.equal(res.body.care, 'clear')
    assert.equal(gate.rows('reports').length, 0)
  } finally { await gate.close() }

  const touched = await setup([GOOD_REPLY], {
    care: [{ id: uuid(800), user_id: USER.id, level: 'unclear', scope_id: null, created_at: at(NOW - 5 * HOUR), resolved_at: null }],
    settings: [{ user_id: USER.id, share_auto: true }],
  })
  try {
    const res = await report(touched.call, M1, { outcome: 'done', note: NOTE })
    assert.equal(res.status, 200)
    assert.deepEqual(res.body.consent, { ask: false, state: 'not_offered', automatic: false, decided_at: null })
    assert.equal(res.body.story_offer, null)
    assert.equal(touched.rows('peer_outcomes').length, 0)
    const id = res.body.report.id
    assert.equal((await touched.call('POST', `/api/reports/${id}/consent`, { share: true })).status, 409)
    assert.deepEqual((await touched.call('GET', `/api/reports/${id}/story`)).body, { story: null })
    assert.equal(touched.rows('peer_outcomes').length, 0)
    assert.equal(touched.rows('consent_log').length, 0)
  } finally { await touched.close() }
})

test('stories: none until an approved one exists, never the founder\'s own, never with an author', async () => {
  const story = (n, status, over = {}) => ({
    id: uuid(700 + n), status, stage: 'building', customer_market: 'Mostly abroad', business_model: 'b2b', outcome: 'done',
    story: `Story ${n}: they asked each clinic to book a call.`, lesson: 'The first real ask mattered.', draft: null, ...over,
  })
  const pending = await setup([GOOD_REPLY], { peers: [story(1, 'pending_review'), story(2, 'rejected'), story(3, 'withdrawn')] })
  try {
    const res = await report(pending.call, M1, { outcome: 'done', note: NOTE })
    assert.equal(res.body.story_offer, null)
    assert.equal(res.body.consent.question_after_story, null)
    assert.deepEqual((await pending.call('GET', `/api/reports/${res.body.report.id}/story`)).body, { story: null })
  } finally { await pending.close() }

  const approved = await setup([GOOD_REPLY], {
    peers: [story(4, 'approved'), story(5, 'approved', { stage: 'selling' }), story(6, 'pending_review')],
    links: [{ peer_outcome_id: uuid(704), user_id: USER.id, report_id: uuid(999), created_at: at(NOW - 99 * HOUR), withdrawn_at: null }],
  })
  try {
    const res = await report(approved.call, M1, { outcome: 'done', note: NOTE })
    assert.deepEqual(res.body.story_offer, { text: STORY_OFFER })
    assert.equal(res.body.consent.question_after_story.wording_version, AFTER_STORY_VERSION)
    const got = await approved.call('GET', `/api/reports/${res.body.report.id}/story`)
    // Story 4 is the founder's own; story 5 is the only other approved one.
    assert.deepEqual(got.body.story, { story: 'Story 5: they asked each clinic to book a call.', lesson: 'The first real ask mattered.', outcome: 'done', stage: 'selling' })
    assertNoPrivateData(approved.responses, [uuid(704), uuid(705)])
  } finally { await approved.close() }
})

test("another founder's move or report is a plain 404; no auth is 401", async () => {
  const { call, callOther, callAnon, close } = await setup()
  try {
    const id = (await report(call, M1, { outcome: 'couldnt' })).body.report.id
    assert.equal((await report(callOther, M2, { outcome: 'done' })).status, 404)
    for (const [method, path, body] of [
      ['GET', `/api/reports/${id}`], ['GET', `/api/reports/${id}/story`],
      ['POST', `/api/reports/${id}/consent`, { share: true }], ['POST', `/api/reports/${id}/withdraw`],
    ]) {
      const res = await callOther(method, path, body)
      assert.deepEqual([res.status, res.body], [404, { error: 'Not found' }], `${method} ${path}`)
    }
    assert.equal((await callOther('GET', '/api/reports/not-a-uuid')).status, 404)
    assert.deepEqual((await callOther('GET', '/api/reports/due')).body, { reports: [] })
    assert.equal((await callAnon('GET', '/api/reports/due')).status, 401)
    assert.equal((await callAnon('GET', '/api/settings/sharing')).status, 401)
    assert.equal((await callAnon('POST', `/api/moves/${M2}/report`, { outcome: 'done', client_turn_id: uuid(1) })).status, 401)
  } finally { await close() }
})

test('no route deletes a report or penalises a founder', async () => {
  const { call, rows, responses, close } = await setup()
  try {
    const id = (await report(call, M1, { outcome: 'didnt' })).body.report.id
    for (const [method, path] of [
      ['DELETE', `/api/reports/${id}`], ['POST', `/api/reports/${id}/strike`], ['POST', `/api/reports/${id}/warning`],
      ['POST', `/api/reports/${id}/remove`], ['PUT', `/api/reports/${id}`], ['DELETE', '/api/settings/sharing'],
      ['POST', `/api/moves/${M2}/penalty`], ['POST', '/api/reports/missed'],
    ]) {
      assert.equal((await call(method, path)).status, 404, `${method} ${path}`)
    }
    assert.equal(rows('reports').length, 1)
    assertNoPrivateData(responses.filter((t) => t.startsWith('{')))
  } finally { await close() }
})

// ── Audit findings ───────────────────────────────────────────────────────────

const careEvent = (over = {}) => ({ id: uuid(810), user_id: USER.id, level: 'unclear', scope_id: null, created_at: at(NOW), resolved_at: null, ...over })

test('the reply may only use numbers the model was sent, in digits or words, and may not claim a wrong prediction happened', async () => {
  const knownTexts = [FIRST, NOTE, MOVE.mission]
  const problemsOf = (reply, check = 'right') => checkReportReply({ data: { reply, prediction_check: check }, outcome: 'done', knownTexts }).problems.join(' | ')
  assert.match(problemsOf('Five clinics replied. Send the next one.'), /never gave: 5/)
  assert.equal(problemsOf('Both clinics heard from you after three weeks. Confirm Thursday.'), '')
  assert.match(problemsOf('I said at least one would not reply, and it happened. Confirm Thursday.', 'wrong'), /says the prediction was right/)
  assert.match(problemsOf('Just as I said, one did not reply. Confirm Thursday.', 'unclear'), /says the prediction was right/)
  assert.equal(problemsOf('I said at least one would not reply, and it happened. Confirm Thursday.', 'right'), '')

  // move.words is never sent to the model, so its 45 is not a number the founder gave.
  const fromWords = JSON.stringify({ reply: 'You offered them 45 minutes. Confirm Thursday with the clinic that replied.', prediction_check: 'right' })
  const { call, chatCalls, close } = await setup([fromWords, fromWords], { moves: [move(M1, { status: 'report_due', active_slot: 1, words: 'Can we book 45 minutes?' })] })
  try {
    const res = await report(call, M1, { outcome: 'done', note: NOTE })
    assert.equal(chatCalls().length, 2)
    assert.match(chatCalls()[1].payload.messages.at(-1).content, /never gave: 45/)
    assert.equal(res.body.reply, fallbackReply({ outcome: 'done', title: MOVE.title }))
  } finally { await close() }
})

test('a consent row that cannot be written stops the share, on the asked and the automatic path', async () => {
  const failShareLog = (table, action, payload) => table === 'consent_log' && action === 'insert' && ['share', 'auto_share'].includes(payload?.action)
  const asked = await setup([GOOD_REPLY], { fail: failShareLog })
  try {
    const id = (await report(asked.call, M1, { outcome: 'done', note: NOTE })).body.report.id
    assert.equal((await asked.call('POST', `/api/reports/${id}/consent`, { share: true })).status, 500)
    assert.equal(asked.rows('peer_outcomes').length, 0)
    assert.equal(asked.rows('reports')[0].share_state, 'asked')
  } finally { await asked.close() }

  const auto = await setup([GOOD_REPLY], { fail: failShareLog, settings: [{ user_id: USER.id, share_auto: true }] })
  try {
    const res = await report(auto.call, M1, { outcome: 'done', note: NOTE })
    assert.equal(res.status, 200)
    assert.equal(res.body.consent.state, 'asked', 'a failed automatic share asks; it never claims shared')
    assert.equal(auto.rows('peer_outcomes').length, 0)
    assert.deepEqual(auto.rows('consent_log').map((l) => l.action), ['asked'])
  } finally { await auto.close() }
})

test('share runs the care check itself: care after the question, or before a re-share, means not_offered and 409', async () => {
  const { call, base, rows, close } = await setup([GOOD_REPLY, GOOD_REPLY])
  try {
    const first = (await report(call, M1, { outcome: 'done', note: NOTE })).body.report.id
    await base.from('care_events').insert(careEvent())
    assert.equal((await call('POST', `/api/reports/${first}/consent`, { share: true })).status, 409)
    assert.equal(rows('reports').find((r) => r.id === first).share_state, 'not_offered')
    assert.equal(rows('peer_outcomes').length, 0)
  } finally { await close() }

  const again = await setup([GOOD_REPLY])
  try {
    const id = (await report(again.call, M1, { outcome: 'done', note: NOTE })).body.report.id
    await again.call('POST', `/api/reports/${id}/consent`, { share: true })
    await again.call('POST', `/api/reports/${id}/withdraw`)
    await again.base.from('care_events').insert(careEvent({ scope_id: SIT }))
    assert.equal((await again.call('POST', `/api/reports/${id}/consent`, { share: true })).status, 409)
    assert.equal(again.rows('peer_outcomes').filter((p) => p.status !== 'withdrawn').length, 0)
  } finally { await again.close() }
})

test('no founder story while a care event is open', async () => {
  const approved = { id: uuid(720), status: 'approved', stage: 'building', customer_market: 'Mostly abroad', business_model: 'b2b', outcome: 'done', story: 'They asked each clinic for a call.', lesson: null, draft: null }
  const { call, base, close } = await setup([GOOD_REPLY], { peers: [approved] })
  try {
    const id = (await report(call, M1, { outcome: 'done', note: NOTE })).body.report.id
    assert.equal((await call('GET', `/api/reports/${id}/story`)).body.story.story, approved.story)
    await base.from('care_events').insert(careEvent({ level: 'clear', created_at: at(NOW - 99 * HOUR) }))
    assert.deepEqual((await call('GET', `/api/reports/${id}/story`)).body, { story: null })
  } finally { await close() }
})

test('a care stop whose event was not recorded still closes sharing for that situation', async () => {
  const { call, rows, close } = await setup([GOOD_REPLY], {
    settings: [{ user_id: USER.id, share_auto: true }],
    fail: (table, action) => table === 'care_events' && action === 'insert',
  })
  try {
    const stopped = await report(call, M1, { outcome: 'didnt', note: 'I want to kill myself' })
    assert.equal(stopped.body.care, 'clear')
    assert.equal(rows('care_events').length, 0, 'the gate could not record its event')
    assert.equal(rows('situations')[0].care_flag, true)
    const later = await report(call, M2, { outcome: 'done', note: NOTE, client_turn_id: uuid(901) })
    assert.deepEqual(later.body.consent, { ask: false, state: 'not_offered', automatic: false, decided_at: null })
    assert.equal(rows('peer_outcomes').length, 0)
  } finally { await close() }
})

test('the after-story wording is accepted only when a story was offered with that report', async () => {
  const { call, rows, close } = await setup([GOOD_REPLY])
  try {
    const res = await report(call, M1, { outcome: 'done', note: NOTE })
    assert.equal(res.body.story_offer, null)
    assert.deepEqual(rows('reports')[0].consent_versions, [ALONE_VERSION])
    const refused = await call('POST', `/api/reports/${res.body.report.id}/consent`, { share: true, wording_version: AFTER_STORY_VERSION })
    assert.equal(refused.status, 400)
    assert.equal(rows('peer_outcomes').length, 0)
    assert.equal((await call('POST', `/api/reports/${res.body.report.id}/consent`, { share: true, wording_version: ALONE_VERSION })).status, 200)
  } finally { await close() }
})

test('a story pick reads at most STORY_CAP outcomes and none of the founder\'s own', async () => {
  const own = Array.from({ length: 60 }, (_, i) => ({ id: uuid(2000 + i), status: 'approved', stage: 'building', customer_market: 'Mostly abroad', business_model: 'b2b', outcome: 'done', story: `Own ${i}`, lesson: null, draft: null }))
  const other = { id: uuid(3000), status: 'approved', stage: 'building', customer_market: null, business_model: null, outcome: 'couldnt', story: 'Someone else asked for a call.', lesson: null, draft: null }
  const links = own.map((p) => ({ peer_outcome_id: p.id, user_id: USER.id, report_id: uuid(999), created_at: at(NOW - 99 * HOUR), withdrawn_at: null }))
  const { call, base, close } = await setup([GOOD_REPLY], { peers: [...own, other], links })
  const loaded = []
  const from = base.from
  base.from = (table) => {
    const b = from(table)
    if (table !== 'peer_outcomes') return b
    const then = b.then
    b.then = (resolve, reject) => then((r) => { if (Array.isArray(r.data)) loaded.push(r.data.length); return resolve(r) }, reject)
    return b
  }
  try {
    const id = (await report(call, M1, { outcome: 'done', note: NOTE })).body.report.id
    assert.equal((await call('GET', `/api/reports/${id}/story`)).body.story.story, other.story)
    assert.ok(loaded.length > 0 && Math.max(...loaded) <= STORY_CAP, `read ${Math.max(...loaded)} outcomes at once`)
  } finally { await close() }
})

// ── Re-audit leftovers ───────────────────────────────────────────────────────

test('plurals, ordinals and multiples are number claims too', () => {
  const knownTexts = [FIRST, NOTE, MOVE.mission]
  const problemsOf = (reply) => checkReportReply({ data: { reply, prediction_check: 'right' }, outcome: 'done', knownTexts }).problems.join(' | ')
  for (const [reply, n] of [
    ['Hundreds of clinics need this. Confirm Thursday.', 100], ['Thousands will follow. Confirm Thursday.', 1000],
    ['Dozens more are out there. Confirm Thursday.', 12], ['Send a seventh email to the clinic.', 7],
    ['This is the fifth time. Confirm Thursday.', 5], ['Half of them replied. Confirm Thursday.', 0.5],
    ['Ask for double the time. Confirm Thursday.', 2], ['Email them twice. Confirm Thursday.', 2],
  ]) {
    const known = n === 2 ? [MOVE.title] : knownTexts
    const problems = checkReportReply({ data: { reply, prediction_check: 'right' }, outcome: 'done', knownTexts: known }).problems.join(' | ')
    assert.match(problems, new RegExp(`never gave: ${String(n).replace('.', '\\.')}`), reply)
  }
  // Numbers the founder gave, in any of these forms, are fine.
  assert.equal(problemsOf('The second clinic did not reply. Confirm Thursday.'), '')
  assert.equal(problemsOf('Double-check the time, then confirm Thursday.'), '')
})

test('the stale cut-off is above the worst-case model time', () => {
  // compose: 2 structured calls x 2 attempts x (60 s request, 1 SDK retry).
  assert.ok(STALE_MS > 2 * 2 * 2 * 60 * 1000, `STALE_MS ${STALE_MS}`)
})

test('a waiting duplicate backs off; a stale writer that still finishes keeps its paid reply', async () => {
  const base = createFakeSupabase({ tables: seed() })
  const clock = createFakeClock(NOW)
  let release
  const modelGate = new Promise((r) => { release = r })
  const callStructured = async () => { await modelGate; return { data: JSON.parse(GOOD_REPLY) } }
  const pauses = []
  const service = createReports({ supabase: base, callStructured, clock, pause: async (ms) => { pauses.push(ms) } })
  const args = { userId: USER.id, moveId: M1, outcome: 'done', note: NOTE, clientTurnId: uuid(900) }

  const writing = service.report(args)
  for (let i = 0; i < 50 && base.rows('reports').length === 0; i += 1) await new Promise((r) => setImmediate(r))
  assert.equal(base.rows('reports')[0].reply_pending, true)

  await assert.rejects(() => service.report(args), (e) => e.status === 409)
  assert.ok(pauses.length <= 10, `${pauses.length} polls`)
  assert.ok(pauses.reduce((a, b) => a + b, 0) >= 8000)

  clock.advance(STALE_MS + 1)
  const givenUp = await service.report(args)
  assert.equal(givenUp.reply, fallbackReply({ outcome: 'done', title: MOVE.title }))

  release()
  const written = await writing
  assert.equal(written.reply, JSON.parse(GOOD_REPLY).reply)
  assert.equal(base.rows('reports')[0].reply, JSON.parse(GOOD_REPLY).reply)
  assert.equal(base.rows('reports')[0].reply_pending, false)
})

test('care that begins after a share takes the share down', async () => {
  const { call, rows, close } = await setup([GOOD_REPLY])
  try {
    const id = (await report(call, M1, { outcome: 'done', note: NOTE })).body.report.id
    await call('POST', `/api/reports/${id}/consent`, { share: true })
    assert.equal(rows('peer_outcomes').filter((p) => p.status !== 'withdrawn').length, 1)
    const stopped = await call('POST', '/api/situations', { text: 'I want to kill myself', client_turn_id: uuid(950) })
    assert.equal(stopped.body.care, 'clear')
    assert.equal(rows('reports')[0].share_state, 'not_offered')
    assert.equal(rows('peer_outcomes').filter((p) => p.status !== 'withdrawn').length, 0)
    assert.ok(rows('outcome_author_links').every((l) => l.withdrawn_at))
    assert.deepEqual((await call('GET', `/api/reports/${id}`)).body.report.sharing.state, 'not_offered')
  } finally { await close() }
})

test('a care stop whose event and care_flag both fail to write still closes sharing', async () => {
  let careInserts = 0
  const { call, rows, close } = await setup([GOOD_REPLY], {
    settings: [{ user_id: USER.id, share_auto: true }],
    fail: (table, action) => (table === 'situations' && action === 'update')
      || (table === 'care_events' && action === 'insert' && (careInserts += 1) === 1),
  })
  try {
    const stopped = await report(call, M1, { outcome: 'didnt', note: 'I want to kill myself' })
    assert.equal(stopped.body.care, 'clear')
    assert.deepEqual(rows('care_events').map((e) => e.scope_id), [SIT], 'the fallback event names the situation')
    const later = await report(call, M2, { outcome: 'done', note: NOTE, client_turn_id: uuid(901) })
    assert.equal(later.body.consent.state, 'not_offered')
    assert.equal(rows('peer_outcomes').length, 0)
  } finally { await close() }
})
