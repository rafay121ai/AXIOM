// Give to get: 2 free founder lessons, then only while sharing. Access is
// derived from stored truth on every request. Fakes only.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createFakeClock, createFakeSupabase } from '../../testing/fakes.js'
import { createSharing } from './sharing.js'
import { createFounderLessons } from './founderLessons.js'
import { FOUNDER_LESSONS_CLOSED_TEXT } from './wording.js'

const USER = '11111111-1111-4111-8111-111111111111'
const APPROVED = (n) => ({
  id: `00000000-0000-4000-8000-00000000090${n}`, status: 'approved', stage: null, customer_market: null, business_model: null,
  outcome: 'done', story: `Story ${n}.`, lesson: 'Send the price.', reviewed_at: '2026-10-01T00:00:00.000Z',
})
const UNIQUE = { founder_lesson_log: [{ cols: ['user_id', 'source_key'] }, { cols: ['user_id', 'slot'] }] }

function world({ stories = [APPROVED(1)], settings = [], unlocks = [] } = {}) {
  const supabase = createFakeSupabase({
    tables: { peer_outcomes: stories, user_settings: settings, peer_unlocks: unlocks, founder_profiles: [], outcome_author_links: [] },
    unique: UNIQUE,
  })
  const clock = createFakeClock(Date.parse('2026-10-26T16:00:00.000Z'))
  const sharing = createSharing({ supabase, clock })
  const lessons = createFounderLessons({ supabase, sharing, clock })
  return { supabase, sharing, ask: (key) => lessons.forSource({ userId: USER, sourceKey: key }), log: () => supabase.rows('founder_lesson_log') }
}

test('two free founder lessons, then closed with one notice, then silence', async () => {
  const w = world()
  assert.equal((await w.ask('report:a')).story.story, 'Story 1.')
  assert.equal((await w.ask('report:b')).story.story, 'Story 1.')
  const third = await w.ask('report:c')
  assert.equal(third.story, null)
  assert.equal(third.founder_lessons.state, 'closed_notice')
  assert.equal(third.founder_lessons.notice.text, FOUNDER_LESSONS_CLOSED_TEXT)
  assert.match(FOUNDER_LESSONS_CLOSED_TEXT, /Settings/)
  const fourth = await w.ask('report:d')
  assert.deepEqual([fourth.story, fourth.founder_lessons], [null, null])
  assert.equal(w.log().filter((l) => l.slot != null).length, 2)
})

test('re-reading the same report does not count twice; a delivered report can still be re-read when closed', async () => {
  const w = world()
  await w.ask('report:a')
  const again = await w.ask('report:a')
  assert.equal(again.story.story, 'Story 1.')
  assert.equal(again.fresh, false)
  await w.ask('report:b')
  assert.equal((await w.ask('report:a')).story.story, 'Story 1.')
  assert.equal(w.log().length, 2)
})

test('two simultaneous requests cannot both take the second free lesson', async () => {
  const w = world()
  await w.ask('report:a')
  const [x, y] = await Promise.all([w.ask('report:b'), w.ask('report:c')])
  assert.equal([x, y].filter((r) => r.story).length, 1)
  assert.equal(w.log().filter((l) => l.slot != null).length, 2)
})

test('no approved story: nothing counted and nothing said, even when closed', async () => {
  const w = world({ stories: [] })
  for (const k of ['a', 'b', 'c', 'd']) {
    const r = await w.ask(`report:${k}`)
    assert.deepEqual([r.story, r.founder_lessons], [null, null])
  }
  assert.equal(w.log().length, 0)
})

test('turning share_auto on opens the very next request; turning it off closes it again', async () => {
  const w = world()
  await w.ask('report:a')
  await w.ask('report:b')
  assert.equal((await w.ask('report:c')).story, null)
  await w.sharing.setShareAuto(USER, true)
  assert.equal((await w.ask('report:d')).story.story, 'Story 1.')
  await w.sharing.setShareAuto(USER, false)
  assert.equal((await w.ask('report:e')).story, null)
})

test('a founder who shared an outcome keeps access', async () => {
  const w = world({ unlocks: [{ id: 'u1', user_id: USER, kind: 'share', granted_by_report_id: 'r1' }] })
  for (const k of ['a', 'b', 'c', 'd']) assert.ok((await w.ask(`report:${k}`)).story)
  assert.equal(w.log().filter((l) => l.slot != null).length, 0)
})
