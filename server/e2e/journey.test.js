// One founder, the whole journey, through the real createApp over HTTP with
// fakes only. Steps run in order and share state.
import assert from 'node:assert/strict'
import test from 'node:test'
import { QUESTION_KEYS } from '../journey/questions.js'
import { CARE_COPY } from '../care/copy.js'
import { validateExperimentQuality } from '../experimentQuality.js'
import { experimentOf } from '../journey/move/moveChecks.js'
import { AXIOM_LINES } from '../journey/learn/moveOffer.js'
import { AFTER_STORY_VERSION, SHARED_LINE, WITHDRAWN_LINE } from '../journey/report/wording.js'
import { MODELS, STEPS } from '../config.js'
import { FOUNDER, OTHER, createWorld, keysIn, routesOf } from './harness.js'
import {
  CHECK_IN_ANSWER, DISTRESS, FABRICATED_QUOTE, FIRST_READING, FOLLOWUP_ANSWER, FULL_ANSWERS, LEARN_AFTER_CARE, LEARN_OFFER,
  LEARN_REPLY_1, LESSON, MOVE, PEER_STORY, PEER_STORY_ID, Q1, Q2, Q3_REFUSED, READ, READ_ANSWER, REAL_1, REAL_2,
  REPORT_NOTE, REPORT_REPLY, SITUATION_TEXT, SWAP_REASON, TURN_2, TURN_3, VERIFIED_QUOTE_SHOWN, WHAT_NEXT, situationVerdict, uuid,
} from './script.js'

const HOUR = 60 * 60 * 1000
const MIN = 60 * 1000
const at = (iso) => Date.parse(iso)
const PUSH_TOKEN = 'ExponentPushToken[amina-phone-0001]'
const ZONE = 'Asia/Karachi'

test('a founder walks the whole journey', async (t) => {
  const w = await createWorld()
  const { founder, other, anon, openai, rows, clock, sender, scheduler } = w
  const ids = {}
  const modelCalls = () => openai.calls.length
  const sentLog = () => rows('notification_log').filter((r) => r.status === 'sent')

  try {
    // ── Sign-up ───────────────────────────────────────────────────────────────
    await t.test('sign-up: 13 answers saved one by one, resumed mid-way', async () => {
      const first = await founder('GET', '/api/signup')
      assert.equal(first.status, 200)
      assert.equal(first.body.questions.length, 13)
      assert.equal(first.body.next, 'stage')
      assert.equal(first.body.complete, false)

      const early = await founder('POST', '/api/first-reading')
      assert.equal(early.status, 409)
      assert.equal(early.body.next, 'stage')

      const [half, rest] = [QUESTION_KEYS.slice(0, 6), QUESTION_KEYS.slice(6)]
      for (const key of half) assert.equal((await founder('PUT', `/api/signup/answers/${key}`, { answer: FULL_ANSWERS[key] })).status, 200, key)

      // The founder closes the app and comes back: it resumes at question 7.
      const resumed = await founder('GET', '/api/signup')
      assert.deepEqual(Object.keys(resumed.body.answers), half)
      assert.equal(resumed.body.next, rest[0])
      assert.equal(resumed.body.complete, false)

      let last
      for (const key of rest) {
        last = await founder('PUT', `/api/signup/answers/${key}`, { answer: FULL_ANSWERS[key] })
        assert.equal(last.status, 200, key)
      }
      assert.equal(last.body.complete, true)
      assert.equal(last.body.next, null)
      const [profile] = rows('founder_profiles')
      assert.equal(Object.keys(profile.signup_answers).length, 13)
      assert.equal(profile.country, 'Pakistan')
      assert.equal(modelCalls(), 0)
    })

    await t.test('first reading from the 13 answers', async () => {
      openai.script('first_reading', FIRST_READING)
      const res = await founder('POST', '/api/first-reading')
      assert.equal(res.status, 200)
      assert.deepEqual(Object.keys(res.body).sort(), ['body', 'headline', 'underlines'])
      assert.deepEqual(res.body.underlines, ['asked for pricing'])
      assert.equal(openai.chatCalls('first_reading').length, 1)
    })

    // ── Situation ─────────────────────────────────────────────────────────────
    await t.test('situation: 2 follow-ups, then the third turn asks nothing more', async () => {
      openai.script('situation_turn', situationVerdict(), situationVerdict({ missing: 'tried', question: Q2 }), situationVerdict({ missing: 'date', question: Q3_REFUSED }))
      const opened = await founder('POST', '/api/situations', { text: SITUATION_TEXT, client_turn_id: uuid(1) })
      assert.equal(opened.status, 200)
      assert.deepEqual([opened.body.status, opened.body.reply, opened.body.follow_up_count, opened.body.follow_ups_left], ['follow_up', Q1, 1, 1])
      ids.situation = opened.body.situation_id

      // The same send again (a retry) is answered from what is stored.
      const calls = modelCalls()
      const replay = await founder('POST', '/api/situations', { text: SITUATION_TEXT, client_turn_id: uuid(1) })
      assert.deepEqual(replay.body, opened.body)
      assert.equal(modelCalls(), calls)

      const second = await founder('POST', `/api/situations/${ids.situation}/turn`, { text: TURN_2, client_turn_id: uuid(2) })
      assert.deepEqual([second.body.status, second.body.reply, second.body.follow_up_count, second.body.follow_ups_left], ['follow_up', Q2, 2, 0])

      // The model still wants a third question; the server refuses it.
      const third = await founder('POST', `/api/situations/${ids.situation}/turn`, { text: TURN_3, client_turn_id: uuid(3) })
      assert.deepEqual([third.body.status, third.body.reply, third.body.follow_up_count, third.body.follow_ups_left], ['ready', null, 2, 0])
      const lastPrompt = JSON.parse(openai.chatCalls('situation_turn').at(-1).payload.messages[1].content)
      assert.equal(lastPrompt.follow_ups_left, 0)
      assert.equal(rows('situations')[0].follow_up_count, 2)
      assert.deepEqual(rows('situation_turns').map((r) => r.role), ['founder', 'axiom', 'founder', 'axiom', 'founder'])
      assert.ok(!rows('situation_turns').some((r) => r.text === Q3_REFUSED))
    })

    // ── Read ──────────────────────────────────────────────────────────────────
    await t.test('read: written once, then answered', async () => {
      openai.script('read', READ)
      const read = await founder('POST', `/api/situations/${ids.situation}/read`)
      assert.equal(read.status, 200)
      assert.deepEqual([read.body.headline, read.body.closing_question, read.body.answered], [READ.headline, READ.closing_question, false])
      const calls = modelCalls()
      assert.deepEqual((await founder('POST', `/api/situations/${ids.situation}/read`)).body, read.body)
      assert.equal(modelCalls(), calls)

      const thin = await founder('POST', `/api/situations/${ids.situation}/read/answer`, { text: 'ok' })
      assert.equal(thin.body.status, 'say_more')
      const answered = await founder('POST', `/api/situations/${ids.situation}/read/answer`, { text: READ_ANSWER })
      assert.deepEqual(answered.body, { status: 'stored', situation_id: ids.situation, skipped: false, next: 'learn' })
      assert.equal(rows('reads')[0].closing_answer, READ_ANSWER)
    })

    // ── Learn ─────────────────────────────────────────────────────────────────
    await t.test('learn: lesson with a verified citation; the invented quote is stripped', async () => {
      // Both tries cite the invented quote, so the server shows the cleaned reply.
      openai.script('learn_reply', LESSON, LESSON)
      const res = await founder('POST', `/api/situations/${ids.situation}/learn`)
      assert.equal(res.status, 200)
      ids.learn = res.body.learn_id
      const lesson = res.body.turn
      ids.lesson = lesson.id
      assert.equal(lesson.kind, 'lesson')
      assert.deepEqual(lesson.sources, [
        { author: 'Rob Fitzpatrick', book: 'The Mom Test', quote: VERIFIED_QUOTE_SHOWN },
        { author: 'Chris Voss', book: 'Never Split the Difference' },
      ])
      assert.ok(!JSON.stringify(res.body).includes(FABRICATED_QUOTE))
      assert.ok(lesson.text.endsWith('?'))
      assert.equal(res.body.move_offer, 'none')
      // The retry named the problem; both tries cost a model call.
      const tries = openai.chatCalls('learn_reply')
      assert.equal(tries.length, 2)
      assert.match(tries[1].payload.messages.at(-1).content, /quote is not word for word/)
      // Stored citations: the verified quote kept, the invented one dropped.
      const citations = rows('lesson_citations')
      assert.deepEqual(citations.map((c) => [c.author, c.book_title, c.quote]), [
        ['Rob Fitzpatrick', 'The Mom Test', VERIFIED_QUOTE_SHOWN],
        ['Chris Voss', 'Never Split the Difference', null],
      ])
      assert.deepEqual(citations.map((c) => c.chunk_ids), [[uuid(901)], [uuid(904)]])
      // The model never sees an author, a title or a database id.
      const prompt = JSON.stringify(tries[0].payload.messages)
      // The model is given author and title to name who taught it, never a database id.
      assert.ok(prompt.includes('Fitzpatrick') && !prompt.includes(uuid(901)))
    })

    await t.test('learn: a tapped follow-up is answered in place, with no founder message', async () => {
      openai.script('learn_reply', FOLLOWUP_ANSWER)
      const res = await founder('POST', `/api/learn/${ids.learn}/followup/0`, { turn_id: ids.lesson })
      assert.equal(res.status, 200)
      assert.equal(res.body.turn.kind, 'followup')
      assert.equal(res.body.turn.for_turn_id, ids.lesson)
      assert.ok(!res.body.turn.text.includes('?'))
      assert.equal(rows('learn_turns').filter((r) => r.role === 'founder').length, 0)
    })

    await t.test('learn: 2 real replies bring the first move card', async () => {
      openai.script('learn_reply', LEARN_REPLY_1, LEARN_OFFER)
      const r1 = await founder('POST', `/api/learn/${ids.learn}/turn`, { text: REAL_1, client_turn_id: uuid(11) })
      assert.equal(r1.body.move_offer, 'none')
      assert.ok(r1.body.turn.text.endsWith('?'))
      const r2 = await founder('POST', `/api/learn/${ids.learn}/turn`, { text: REAL_2, client_turn_id: uuid(12) })
      assert.equal(r2.body.move_offer, 'first')
      assert.deepEqual(r2.body.move_notice, { kind: 'first', kicker: 'Your move', text: 'Your move for the two clinics is ready.' })
      assert.ok(!r2.body.turn.text.includes('?'))
    })

    await t.test('learn: "what should I do next" brings the move at once, with no model call', async () => {
      const calls = modelCalls()
      const res = await founder('POST', `/api/learn/${ids.learn}/turn`, { text: WHAT_NEXT, client_turn_id: uuid(13) })
      assert.equal(res.body.move_offer, 'second')
      assert.equal(res.body.turn.text, AXIOM_LINES.intent)
      assert.deepEqual(res.body.move_notice, {
        kind: 'second', kicker: 'Still waiting', text: 'It takes 10 minutes, Amina. The two clinics have heard nothing from you for three weeks.',
      })
      assert.equal(modelCalls(), calls)
      const view = await founder('GET', `/api/learn/${ids.learn}`)
      assert.equal(view.body.offers_made, 2)
      assert.equal(view.body.offers_left, 0)
    })

    // ── Move ──────────────────────────────────────────────────────────────────
    await t.test('move: created behind the card, validator passed, nothing internal shown', async () => {
      openai.script('move', MOVE)
      const res = await founder('POST', `/api/learn/${ids.learn}/move`)
      assert.equal(res.status, 200)
      const move = res.body.move
      ids.move = move.id
      assert.deepEqual([move.status, move.title, move.success, move.can_swap, move.start_minutes], ['draft', MOVE.title, MOVE.success, true, 5])
      assert.ok(!('hypothesis' in move) && !('validation' in move) && !('active_slot' in move))
      const [row] = rows('moves')
      assert.equal(row.validation.ok, true)
      assert.equal(validateExperimentQuality(experimentOf({ ...row, success: row.success_condition })).ok, true)
      // Asking again returns the same move, with no model call.
      const calls = modelCalls()
      assert.equal((await founder('POST', `/api/learn/${ids.learn}/move`)).body.move.id, ids.move)
      assert.equal(modelCalls(), calls)
      assert.equal((await founder('GET', `/api/moves/${ids.move}`)).body.move.id, ids.move)
    })

    await t.test('move: commit schedules the report at 8 pm in the founder\'s zone', async () => {
      const token = await founder('POST', '/api/push/token', { token: PUSH_TOKEN, platform: 'ios', timezone: ZONE })
      assert.deepEqual(token.body, { registered: true, platform: 'ios' })

      clock.set(at('2026-10-26T14:30:00.000Z')) // 7:30 pm in Karachi: tonight is too close, so tomorrow at 8 pm
      const res = await founder('POST', `/api/moves/${ids.move}/commit`, { timezone: ZONE })
      assert.equal(res.status, 200)
      assert.equal(res.body.move.status, 'committed')
      assert.deepEqual(res.body.report, { due_at: '2026-10-27T15:00:00.000Z', local_time: '20:00', time_zone: ZONE })
      assert.deepEqual((await founder('POST', `/api/moves/${ids.move}/commit`, { timezone: ZONE })).body, res.body)
      const [row] = rows('moves')
      assert.equal(row.active_slot, 1)
      assert.equal(row.closes_at, '2026-10-28T14:30:00.000Z')

      const due = await founder('GET', '/api/reports/due')
      assert.equal(due.body.reports.length, 1)
      assert.equal(due.body.reports[0].due, false)

      const home = await founder('GET', `/api/home?time_zone=${encodeURIComponent(ZONE)}`)
      assert.equal(home.body.care_check_in, false)
      assert.equal(home.body.greeting.kind, 'evening')
      assert.ok(home.body.greeting.text.includes('Amina'))
      assert.deepEqual(home.body.items.map((i) => [i.kind, i.label]), [['move', 'Today: ask both clinics that asked for pricing for a call']])
    })

    // ── Pushes ────────────────────────────────────────────────────────────────
    await t.test('pushes: the morning move and the evening check-in, never a third', async () => {
      const tickAt = async (iso) => { clock.set(at(iso)); await scheduler.tick(); await scheduler.tick() } // twice: no double send
      for (let ms = at('2026-10-26T15:00:00.000Z'); ms <= at('2026-10-27T15:00:00.000Z'); ms += 30 * MIN) await tickAt(new Date(ms).toISOString())
      assert.deepEqual(sentLog().map((r) => [r.kind, r.local_day, r.slot]), [
        ['morning', '2026-10-27', 'morning'],
        ['evening', '2026-10-27', 'evening'],
      ])
      assert.deepEqual(sender.sent.map((m) => m.to), [PUSH_TOKEN, PUSH_TOKEN])
      // Lock screen is Short by default: the name, nothing about the move.
      assert.deepEqual(sender.sent.map((m) => m.body), ['Morning, Amina. Your move for today is waiting.', 'Amina, how did it go?'])
      // Still waiting for the report: more ticks that day send nothing.
      await tickAt('2026-10-27T15:10:00.000Z')
      assert.equal(sender.sent.length, 2)
    })

    await t.test('home: the due report is the first thing to do', async () => {
      const home = await founder('GET', `/api/home?time_zone=${encodeURIComponent(ZONE)}`)
      assert.deepEqual(home.body.items.map((i) => [i.kind, i.label, i.stays]), [['report', 'Tell me how it went', false]])
      assert.equal(home.body.due_reports.length, 1)
      assert.equal((await founder('GET', '/api/reports/due')).body.reports[0].due, true)
    })

    // ── Report and sharing ────────────────────────────────────────────────────
    await t.test('report: Done, consent asked, a story offered, unlock granted', async () => {
      clock.set(at('2026-10-27T15:30:00.000Z'))
      openai.script('report', REPORT_REPLY)
      const res = await founder('POST', `/api/moves/${ids.move}/report`, { outcome: 'done', note: REPORT_NOTE, client_turn_id: uuid(21) })
      assert.equal(res.status, 200)
      ids.report = res.body.report.id
      assert.equal(res.body.status, 'reported')
      assert.equal(res.body.report.outcome, 'done')
      assert.equal(res.body.reply, REPORT_REPLY.reply)
      assert.equal(res.body.report.prediction.check, 'right')
      assert.equal(res.body.consent.ask, true)
      assert.equal(res.body.consent.question_after_story.wording_version, AFTER_STORY_VERSION)
      assert.ok(res.body.story_offer)
      assert.deepEqual(res.body.unlock, { granted: true })
      // Sent again: the same report, no second model call.
      const calls = modelCalls()
      const again = await founder('POST', `/api/moves/${ids.move}/report`, { outcome: 'done', note: REPORT_NOTE, client_turn_id: uuid(21) })
      assert.equal(again.body.report.id, ids.report)
      assert.equal(modelCalls(), calls)
      const [move] = rows('moves')
      assert.deepEqual([move.status, move.active_slot], ['reported', null])
      assert.deepEqual(rows('consent_log').map((r) => r.action), ['asked'])

      const story = await founder('GET', `/api/reports/${ids.report}/story`)
      assert.deepEqual(story.body.story, { story: PEER_STORY.story, lesson: PEER_STORY.lesson, outcome: 'done', stage: 'validating' })
    })

    await t.test('report: share, then withdraw, then share again', async () => {
      const shared = await founder('POST', `/api/reports/${ids.report}/consent`, { share: true, wording_version: AFTER_STORY_VERSION })
      assert.deepEqual([shared.body.consent.state, shared.body.reply], ['shared', SHARED_LINE])
      const mine = rows('peer_outcomes').filter((p) => p.id !== PEER_STORY_ID)
      assert.equal(mine.length, 1)
      assert.equal(mine[0].status, 'pending_review')
      assert.ok(!('user_id' in mine[0]) && !('report_id' in mine[0]))
      assert.equal(JSON.stringify(mine[0]).includes(FOUNDER.id), false)
      ids.firstShare = mine[0].id

      const withdrawn = await founder('POST', `/api/reports/${ids.report}/withdraw`)
      assert.deepEqual([withdrawn.body.consent.state, withdrawn.body.reply], ['withdrawn', WITHDRAWN_LINE])
      const down = rows('peer_outcomes').find((p) => p.id === ids.firstShare)
      assert.deepEqual([down.status, down.draft], ['withdrawn', null])
      assert.ok(rows('outcome_author_links').find((l) => l.peer_outcome_id === ids.firstShare).withdrawn_at)

      const again = await founder('POST', `/api/reports/${ids.report}/consent`, { share: true, wording_version: AFTER_STORY_VERSION })
      assert.equal(again.body.consent.state, 'shared')
      ids.secondShare = rows('peer_outcomes').find((p) => p.id !== PEER_STORY_ID && p.id !== ids.firstShare).id
      assert.deepEqual(rows('consent_log').map((r) => r.action), ['asked', 'share', 'withdraw', 'share'])
      assert.deepEqual(rows('peer_unlocks').map((u) => u.kind).sort(), ['report', 'share'])
    })

    await t.test('pushes: nothing after the report', async () => {
      for (let ms = at('2026-10-27T16:00:00.000Z'); ms <= at('2026-10-28T16:00:00.000Z'); ms += HOUR) {
        clock.set(ms)
        await scheduler.tick()
      }
      assert.equal(sender.sent.length, 2)
      const perDay = Object.groupBy(rows('notification_log').filter((r) => r.status !== 'failed'), (r) => r.local_day)
      for (const [day, list] of Object.entries(perDay)) assert.ok(list.length <= 2, day)
    })

    // ── A second founder ──────────────────────────────────────────────────────
    await t.test('a second founder can read and change nothing of the first founder\'s', async () => {
      clock.set(at('2026-10-28T16:30:00.000Z'))
      const ownedByFirst = () => Object.fromEntries(Object.entries(w.snapshot()).map(([t, list]) => [t, list.filter((r) => r.user_id !== OTHER.id)]))
      const before = ownedByFirst()
      const calls = modelCalls()
      const tries = [
        ['GET', `/api/situations/${ids.situation}`],
        ['POST', `/api/situations/${ids.situation}/turn`, { text: 'The owner of each clinic decides.', client_turn_id: uuid(31) }],
        ['POST', `/api/situations/${ids.situation}/read`],
        ['POST', `/api/situations/${ids.situation}/read/answer`, { text: 'Nothing since the demo.' }],
        ['POST', `/api/situations/${ids.situation}/learn`],
        ['GET', `/api/learn/${ids.learn}`],
        ['POST', `/api/learn/${ids.learn}/turn`, { text: 'Tell me more about the clinics.', client_turn_id: uuid(32) }],
        ['POST', `/api/learn/${ids.learn}/followup/0`, { turn_id: ids.lesson }],
        ['POST', `/api/learn/${ids.learn}/move`],
        ['GET', `/api/moves/${ids.move}`],
        ['POST', `/api/moves/${ids.move}/commit`, { timezone: ZONE }],
        ['POST', `/api/moves/${ids.move}/swap`, { reason: SWAP_REASON }],
        ['POST', `/api/moves/${ids.move}/report`, { outcome: 'didnt', note: 'Too much going on with work.', client_turn_id: uuid(33) }],
        ['GET', `/api/reports/${ids.report}`],
        ['GET', `/api/reports/${ids.report}/story`],
        ['POST', `/api/reports/${ids.report}/consent`, { share: false }],
        ['POST', `/api/reports/${ids.report}/withdraw`],
        ['GET', `/api/history/${ids.situation}`],
      ]
      for (const [method, path, body] of tries) {
        const res = await other(method, path, body)
        assert.equal(res.status, 404, `${method} ${path}`)
      }
      // Lists show only their own (nothing).
      assert.deepEqual((await other('GET', '/api/situations/open')).body, { situations: [] })
      assert.deepEqual((await other('GET', '/api/moves/active')).body.moves, [])
      assert.deepEqual((await other('GET', '/api/reports/due')).body, { reports: [] })
      assert.deepEqual((await other('GET', '/api/history')).body, { items: [] })
      const home = await other('GET', '/api/home')
      assert.deepEqual([home.body.items, home.body.drawer.open, home.body.due_reports], [[], [], []])
      const signup = await other('GET', '/api/signup')
      assert.deepEqual(signup.body.answers, {})
      // Signing out on another phone cannot remove the first founder's device.
      assert.deepEqual((await other('DELETE', '/api/push/token', { token: PUSH_TOKEN })).body, { removed: false })
      // The first founder's own words never reach the other founder.
      for (const r of w.responses.filter((x) => x.who === 'other')) {
        const text = JSON.stringify(r.body)
        for (const secret of [SITUATION_TEXT, READ_ANSWER, REPORT_NOTE, 'clinic']) assert.ok(!text.includes(secret), `${r.method} ${r.path}`)
      }
      assert.equal(modelCalls(), calls)
      assert.deepEqual(ownedByFirst(), before)
    })

    // ── Care ──────────────────────────────────────────────────────────────────
    await t.test('distress at any step stops it: care screen, no lesson, no move, shares taken down', async () => {
      clock.set(at('2026-10-28T17:00:00.000Z'))
      const calls = modelCalls()
      const steps = [
        ['POST', '/api/situations', { text: DISTRESS, client_turn_id: uuid(41) }, 'situations'],
        ['POST', `/api/situations/${ids.situation}/turn`, { text: DISTRESS, client_turn_id: uuid(42) }, 'situation_turns'],
        ['POST', `/api/situations/${ids.situation}/read/answer`, { text: DISTRESS }, 'reads'],
        ['POST', `/api/learn/${ids.learn}/turn`, { text: DISTRESS, client_turn_id: uuid(43) }, 'learn_turns'],
        ['POST', `/api/moves/${ids.move}/swap`, { reason: DISTRESS }, 'moves'],
        ['POST', `/api/moves/${ids.move}/report`, { outcome: 'didnt', note: DISTRESS, client_turn_id: uuid(44) }, 'reports'],
        ['PUT', '/api/signup/answers/stuck', { answer: DISTRESS }, 'founder_profiles'],
        ['POST', '/api/home/checkin', { text: DISTRESS }, 'care_events'],
      ]
      for (const [method, path, body, table] of steps) {
        const before = rows(table)
        const res = await founder(method, path, body)
        assert.equal(res.status, 200, path)
        assert.equal(res.body.care, 'clear', path)
        assert.equal(res.body.message, CARE_COPY.clearMessage)
        assert.ok(res.body.help, path)
        for (const k of ['turn', 'move', 'lesson', 'move_offer', 'report', 'situation_id']) assert.ok(!(k in res.body), `${path} carries ${k}`)
        if (table !== 'care_events' && table !== 'situations') assert.deepEqual(rows(table).map(({ updated_at, ...r }) => r), before.map(({ updated_at, ...r }) => r), path)
      }
      assert.equal(rows('situations').length, 1)
      assert.equal(modelCalls(), calls)
      // Nothing the founder wrote is stored in a care event.
      for (const e of rows('care_events')) assert.deepEqual(Object.keys(e).sort(), ['created_at', 'id', 'level', 'resolved_at', 'scope_id', 'user_id'])
      // The share that was live is taken down, and the report can no longer be shared.
      assert.equal(rows('reports')[0].share_state, 'not_offered')
      assert.equal(rows('peer_outcomes').find((p) => p.id === ids.secondShare).status, 'withdrawn')
      assert.ok(rows('outcome_author_links').filter((l) => l.user_id === FOUNDER.id).every((l) => l.withdrawn_at))
      assert.equal((await founder('POST', `/api/reports/${ids.report}/consent`, { share: true })).status, 409)
      assert.equal(rows('situations')[0].care_flag, true)
    })

    await t.test('while care is open: home is only the check-in, no reports, no pushes', async () => {
      const home = await founder('GET', `/api/home?time_zone=${encodeURIComponent(ZONE)}`)
      assert.deepEqual(home.body.greeting, { kind: 'care_check_in', text: CARE_COPY.returnCheckIn })
      assert.equal(home.body.care_check_in, true)
      assert.deepEqual([home.body.items, home.body.due_reports, home.body.drawer.to_do, home.body.drawer.open], [[], [], [], []])
      assert.deepEqual((await founder('GET', '/api/reports/due')).body, { reports: [] })

      // Three days quiet: nothing goes out (the only situation is done, and care pauses
      // pushes anyway; push.test.js covers the pause itself).
      clock.set(at('2026-10-30T03:30:00.000Z'))
      const summary = await scheduler.tick()
      assert.equal(summary.sent, 0)
      assert.equal(sender.sent.length, 2)
    })

    await t.test('the check-in answer closes care and home comes back', async () => {
      const res = await founder('POST', '/api/home/checkin', { text: CHECK_IN_ANSWER })
      assert.deepEqual(res.body, { ok: true })
      assert.ok(rows('care_events').every((e) => e.resolved_at))
      const home = await founder('GET', `/api/home?time_zone=${encodeURIComponent(ZONE)}`)
      assert.equal(home.body.care_check_in, false)
      assert.notEqual(home.body.greeting.kind, 'care_check_in')
      assert.ok(home.body.greeting.text.includes('Amina'))
      assert.deepEqual(home.body.items, [])
      assert.deepEqual(home.body.drawer.recent.map((r) => [r.id, r.status]), [[ids.situation, 'done']])
    })

    await t.test('pushes: no "where are you with" push for a situation already reported Done', async () => {
      clock.set(at('2026-10-30T03:45:00.000Z'))
      await scheduler.tick()
      assert.equal(sender.sent.length, 2, `sent: ${JSON.stringify(sender.sent.slice(2).map((m) => m.body))}`)
    })

    await t.test('while care is open, a plain Learn reply gets no lesson and no move', async () => {
      assert.equal((await founder('POST', '/api/situations', { text: DISTRESS, client_turn_id: uuid(51) })).body.care, 'clear')
      openai.scriptOptional('learn_reply', LEARN_AFTER_CARE)
      const calls = modelCalls()
      const turns = rows('learn_turns').length
      try {
        const res = await founder('POST', `/api/learn/${ids.learn}/turn`, { text: 'The first clinic owner is called Bilal.', client_turn_id: uuid(52) })
        assert.equal(modelCalls(), calls, 'a model call was made while care was open')
        assert.equal(rows('learn_turns').length, turns, 'a Learn turn was stored while care was open')
        assert.equal(res.body.care, 'clear')
        assert.ok(!('turn' in res.body) && !('move_offer' in res.body), 'a lesson or a move offer came back while care was open')
      } finally {
        assert.deepEqual((await founder('POST', '/api/home/checkin', { text: CHECK_IN_ANSWER })).body, { ok: true })
      }
    })

    // ── History, Settings, Account ────────────────────────────────────────────
    await t.test('history lists the situation and opens it read only', async () => {
      const list = await founder('GET', '/api/history')
      assert.deepEqual(list.body.items.map((i) => [i.id, i.status, i.status_label]), [[ids.situation, 'done', 'Done']])
      assert.equal((await founder('GET', '/api/history?q=clinics')).body.items.length, 1)
      assert.equal((await founder('GET', '/api/history?q=zebra')).body.items.length, 0)
      const page = await founder('GET', `/api/history/${ids.situation}`)
      assert.equal(page.body.what_i_read.your_answer, READ_ANSWER)
      assert.deepEqual(page.body.what_you_learned.sources, [
        { author: 'Rob Fitzpatrick', book: 'The Mom Test', quote: VERIFIED_QUOTE_SHOWN },
        { author: 'Chris Voss', book: 'Never Split the Difference' },
        { author: 'Rob Fitzpatrick', book: 'The Mom Test' }, // the follow-up builds on E1 too
      ])
      assert.equal(page.body.your_move.title, MOVE.title)
      assert.deepEqual([page.body.how_it_went.outcome, page.body.how_it_went.sharing], ['done', 'private'])
      assert.equal(page.body.action.kind, 'talk_again')
    })

    await t.test('settings: saved and read back the same', async () => {
      const first = await founder('GET', '/api/settings')
      assert.deepEqual([first.body.mentor_style, first.body.keep_items, first.body.reminders.checkin_time, first.body.reminders.push_registered, first.body.privacy.share_automatically], ['direct', false, '20:00', true, false])
      const saved = await founder('PUT', '/api/settings', { mentor_style: 'calm', keep_items: true, checkin_time: '19:30', timezone: ZONE, morning_on: false })
      assert.equal(saved.status, 200)
      assert.deepEqual([saved.body.mentor_style, saved.body.keep_items, saved.body.reminders.checkin_time, saved.body.reminders.morning_on, saved.body.you.timezone], ['calm', true, '19:30', false, ZONE])
      assert.deepEqual((await founder('GET', '/api/settings')).body, saved.body)

      const on = await founder('PUT', '/api/settings', { share_automatically: true })
      assert.equal(on.body.privacy.share_automatically, true)
      const off = await founder('PUT', '/api/settings', { share_automatically: false })
      assert.equal(off.body.privacy.share_automatically, false)
      assert.deepEqual(rows('consent_log').map((r) => r.action).slice(-2), ['auto_share_on', 'auto_share_off'])

      const before = w.snapshot()
      assert.equal((await founder('PUT', '/api/settings', { mentor_style: 'shouty' })).status, 400)
      assert.equal((await founder('PUT', '/api/settings', { checkin_time: '23:00' })).status, 400) // inside quiet hours
      assert.deepEqual(w.snapshot(), before)
    })

    await t.test('delete account: recorded, nothing deleted, no more pushes', async () => {
      const before = w.snapshot()
      const res = await founder('DELETE', '/api/account', { confirm: 'DELETE' })
      assert.equal(res.status, 200)
      assert.deepEqual([res.body.status, res.body.deleted], ['recorded', false])
      const again = await founder('DELETE', '/api/account', { confirm: 'DELETE' })
      assert.equal(again.body.requested_at, res.body.requested_at)
      const after = w.snapshot()
      for (const table of Object.keys(before)) {
        if (table === 'account_requests') continue
        assert.deepEqual(after[table], before[table], table)
      }
      assert.deepEqual(after.account_requests.map((r) => [r.user_id, r.kind, r.status]), [[FOUNDER.id, 'delete', 'queued']])
      // Quiet again three days later: the founder is skipped, nothing is sent.
      clock.set(at('2026-11-03T03:30:00.000Z'))
      const summary = await scheduler.tick()
      assert.deepEqual([summary.founders, summary.sent], [0, 0])
    })

    // ── Across the whole walk ─────────────────────────────────────────────────
    await t.test('no response carries another founder\'s id, a private link, a peer outcome id or a user_id', () => {
      const peerIds = rows('peer_outcomes').map((p) => p.id)
      const linkKeys = ['user_id', 'peer_outcome_id', 'granted_by_report_id', 'outcome_author_links', 'author_link']
      const internalKeys = ['evidence', 'chunk_ids', 'chunk_id', 'handle', 'lock_token', 'hypothesis', 'validation', 'swap_reason', 'active_slot', 'consent_versions']
      for (const r of w.responses) {
        const text = JSON.stringify(r.body)
        const where = `${r.who} ${r.method} ${r.path}`
        const otherId = r.who === 'other' ? FOUNDER.id : OTHER.id
        assert.ok(!text.includes(otherId), `${where} holds another founder's id`)
        for (const id of peerIds) assert.ok(!text.includes(id), `${where} holds a peer outcome id`)
        const keys = keysIn(r.body)
        for (const k of [...linkKeys, ...internalKeys]) assert.ok(!keys.has(k), `${where} has key ${k}`)
      }
      // The founder's own account id is never sent back either.
      assert.deepEqual(w.responses.filter((r) => JSON.stringify(r.body).includes(FOUNDER.id) || JSON.stringify(r.body).includes(OTHER.id)).map((r) => `${r.who} ${r.method} ${r.path}`), [])
      assert.ok(w.responses.length >= 90, `only ${w.responses.length} responses`)
    })

    await t.test('every model call wrote a usage row', () => {
      const usage = rows('model_usage_logs')
      assert.equal(openai.unexpected.length, 0, `unscripted model calls: ${openai.unexpected}`)
      assert.equal(usage.length, openai.calls.length)
      assert.ok(usage.every((u) => u.user_id === FOUNDER.id))
      const byType = (list) => list.reduce((m, x) => ({ ...m, [x]: (m[x] ?? 0) + 1 }), {})
      const chats = openai.calls.filter((c) => c.kind === 'chat').length
      const embeds = openai.calls.filter((c) => c.kind === 'embedding').length
      const types = byType(usage.map((u) => u.call_type))
      assert.equal(types.embedding, embeds)
      assert.equal(usage.filter((u) => STEPS.includes(u.call_type)).length, chats)
      assert.deepEqual(usage.map((u) => u.model).sort(), openai.calls.map((c) => c.model).sort())
      assert.ok(usage.filter((u) => u.call_type === 'embedding').every((u) => u.model === MODELS.embedding))
      assert.ok(usage.every((u) => u.estimated_cost_usd > 0))
      assert.deepEqual(openai.pending(), [], 'scripted replies left unused')
    })

    await t.test('journey usage rows name their step, not "chat"', () => {
      const chatRows = rows('model_usage_logs').filter((u) => u.model !== MODELS.embedding)
      assert.ok(chatRows.length > 0)
      assert.ok(chatRows.every((u) => STEPS.includes(u.call_type)), 'a journey call logged a call_type that is not its step')
    })

    await t.test('no write route outside the API, and every API route needs a sign-in', async () => {
      const routes = routesOf(w.app)
      assert.ok(routes.length > 40)
      for (const { method, path } of routes) {
        if (path === '/health') continue
        assert.ok(path.startsWith('/api/'), `${method} ${path} is outside /api`)
        const concrete = path.replace(/:n\b/g, '0').replace(/:[a-z_]+/gi, uuid(99))
        const res = await anon(method, concrete, method === 'GET' ? undefined : {})
        assert.equal(res.status, 401, `${method} ${path} answers without a sign-in`)
      }
      assert.deepEqual(routes.filter((r) => r.path === '/health').map((r) => r.method), ['GET'])
    })

    await t.test('no route penalises or removes a move or a report', () => {
      const routes = routesOf(w.app)
      for (const { method, path } of routes) {
        assert.ok(!/strike|warn|penal|punish|remov|refund|ban\b/i.test(path), `${method} ${path}`)
        if (/\/(moves|reports|situations|learn)\b/.test(path)) assert.notEqual(method, 'DELETE', `${method} ${path}`)
      }
      // The walk kept everything: one situation, one move, one report, all there.
      assert.deepEqual(rows('moves').map((m) => m.status), ['reported'])
      assert.deepEqual(rows('reports').map((r) => r.outcome), ['done'])
      assert.equal(rows('situations').length, 1)
      assert.ok(!keysIn(rows('moves')).has('strikes') && !keysIn(rows('reports')).has('warning'))
    })
  } finally {
    await w.close()
  }
})
