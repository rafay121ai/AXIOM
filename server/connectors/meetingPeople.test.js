// Past calendar meetings teach who the founder's regular people are (fakes only, no model).
import assert from 'node:assert/strict'
import test from 'node:test'
import { createFakeClock, createFakeSupabase } from '../testing/fakes.js'
import { loadBrief } from '../journey/memory/brief.js'
import { createMemoryScreen } from '../journey/memory/memoryScreen.js'
import { createConnectorService } from './connectorService.js'
import { createMeetingLearner } from './meetingPeople.js'

const U = '11111111-1111-4111-8111-111111111111'
const NOW = Date.parse('2026-11-28T10:00:00.000Z')
const DAY = 86400000
const setup = (tables = {}) => {
  const supabase = createFakeSupabase({ tables: { founder_world: [], memory_evidence: [], founder_corrections: [], care_events: [], ...tables } })
  const clock = createFakeClock(NOW)
  return { supabase, clock, learn: createMeetingLearner({ supabase, clock }) }
}
const hannes = { displayName: 'Hannes', email: 'h@kroots.example' }
const event = (n, daysAgo, over = {}) => ({
  id: `ev${n}`, summary: n === 0 ? 'Kroots onboarding - Rafay x Hannes' : 'Rafay x Hannes', start: { dateTime: new Date(NOW - daysAgo * DAY).toISOString() },
  attendees: [{ self: true, email: 'me@x.example', displayName: 'Rafay' }, hannes], ...over,
})
const daily = async (s) => { for (let n = 0; n < 10; n += 1) await s.learn(U, event(n, 10 - n)) }

test('a recurring meeting makes one person row, a rhythm line in the brief, and leaves mention_count alone', async () => {
  const s = setup()
  await daily(s)
  const world = s.supabase.rows('founder_world')
  assert.equal(world.length, 1)
  assert.deepEqual([world[0].name, world[0].kind, world[0].mention_count], ['Hannes', 'person', 1])
  assert.equal(s.supabase.rows('memory_evidence').length, 10)
  const brief = await loadBrief(s.supabase, U, 'what should I do about pricing', NOW)
  assert.match(brief, /- Meets Hannes about every day since 18 Nov \(Kroots onboarding\)\./)
  const screen = await createMemoryScreen({ supabase: s.supabase, clock: s.clock }).list(U)
  const person = JSON.stringify(screen)
  assert.match(person, /Meets Hannes about every day/)
  assert.match(person, /From your connected tools: \\"Rafay x Hannes\\"/)
})

test('the same event is learned once; a single meeting gives no rhythm line', async () => {
  const s = setup()
  await s.learn(U, event(1, 2)); await s.learn(U, event(1, 2))
  assert.equal(s.supabase.rows('memory_evidence').length, 1)
  assert.ok(!(await loadBrief(s.supabase, U, '', NOW)).includes('Meets'))
})

test('nothing for an attendee without a display name, a future meeting, a room or care open', async () => {
  const s = setup()
  await s.learn(U, event(1, 2, { attendees: [{ self: true }, { email: 'someone@x.example' }, { displayName: 'a@b.co' }, { displayName: 'Room 4', resource: true }] }))
  await s.learn(U, event(2, -1))
  assert.equal(s.supabase.rows('founder_world').length, 0)
  const c = setup({ care_events: [{ id: 'c1', user_id: U, level: 'clear', resolved_at: null }] })
  await c.learn(U, event(1, 2))
  assert.equal(c.supabase.rows('founder_world').length, 0)
})

test('a sensitive title is stored as "a meeting"', async () => {
  const s = setup()
  await s.learn(U, event(1, 2, { summary: 'Hannes: therapy session' }))
  assert.equal(s.supabase.rows('memory_evidence')[0].snippet, 'a meeting')
})

test('a person the founder marked wrong is not learned again', async () => {
  const s = setup({ founder_corrections: [{ id: 'k1', user_id: U, item_table: 'founder_world', item_text: 'Hannes', reason: 'wrong' }] })
  await s.learn(U, event(1, 2))
  assert.equal(s.supabase.rows('founder_world').length, 0)
})

test('forget Calendar removes the people and their receipts', async () => {
  const s = setup()
  await daily(s)
  const svc = createConnectorService({ supabase: s.supabase, connectors: {}, care: { isCareOpen: async () => false }, pendingDeletion: async () => false, clock: s.clock })
  assert.equal((await svc.forget(U, 'googlecalendar')).forgotten, 1)
  assert.equal(s.supabase.rows('founder_world').length, 0)
  assert.equal(s.supabase.rows('memory_evidence').length, 0)
})
