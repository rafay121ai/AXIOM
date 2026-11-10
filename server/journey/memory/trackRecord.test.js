import assert from 'node:assert/strict'
import test from 'node:test'
import { createFakeSupabase } from '../../testing/fakes.js'
import { loadTrackRecord, trackRecordMessages, trackRecordText, TRACK_MAX_CHARS } from './trackRecord.js'
import { readMessages } from '../prompts/read.js'
import { moveMessages } from '../move/prompts/move.js'
import { checkMove } from '../move/moveChecks.js'

const U = '11111111-1111-4111-8111-111111111111'
const V = '22222222-2222-4222-8222-222222222222'
const row = (outcome, prediction_check = 'not_tested', start_minutes = 5, status = 'reported') => ({ status, start_minutes, outcome, prediction_check })

test('no past moves: nothing is sent and the prompts are unchanged', () => {
  assert.equal(trackRecordText([]), '')
  assert.deepEqual(trackRecordMessages('move', ''), [])
  const conversation = [{ role: 'founder', text: 'I sell candles.' }]
  assert.deepEqual(readMessages({ conversation, style: 'direct', trackRecord: '' }), readMessages({ conversation, style: 'direct' }))
  const base = { situation: conversation, read: null, learn: [], subject: '', fact: '' }
  assert.deepEqual(moveMessages({ ...base, trackRecord: '' }), moveMessages(base))
})

test('counts outcomes and predictions, skipping zeros and not_tested', () => {
  const text = trackRecordText([row('done', 'right'), row('done', 'wrong'), row('couldnt'), row('didnt'), row('didnt')])
  assert.match(text, /^Last 5 moves: 2 done, 1 couldn't, 2 didn't\.$/m)
  assert.match(text, /^Predictions: right 1, wrong 1\.$/m)
  assert.doesNotMatch(text, /not_tested|unclear/)
})

test('a move closed with no report counts as one that was not done', () => {
  const text = trackRecordText([{ status: 'closed_no_report', start_minutes: 5, outcome: null, prediction_check: null }])
  assert.match(text, /^Last 1 move: 1 didn't\.$/m)
})

test('a pattern shows only when every skipped move took longer to start than every done move', () => {
  const clear = trackRecordText([row('done', 'right', 3), row('didnt', 'not_tested', 10), row('didnt', 'not_tested', 8)])
  assert.match(clear, /took longer to start/)
  assert.doesNotMatch(trackRecordText([row('done', 'right', 9), row('didnt', 'not_tested', 10), row('didnt', 'not_tested', 4)]), /took longer/)
  assert.doesNotMatch(trackRecordText([row('done', 'right', 3), row('didnt', 'not_tested', 10)]), /took longer/)
  assert.doesNotMatch(trackRecordText([row('didnt', 'not_tested', 10), row('didnt', 'not_tested', 8)]), /took longer/)
})

test('the block stays under the cap and uses only the 5 newest moves', () => {
  const rows = Array.from({ length: 9 }, (_, i) => row(i < 5 ? 'done' : 'didnt', 'right'))
  const text = trackRecordText(rows)
  assert.match(text, /Last 5 moves: 5 done\./)
  assert.ok(text.length <= TRACK_MAX_CHARS)
})

const tables = () => ({
  moves: [
    { id: 'm1', user_id: U, status: 'reported', start_minutes: 4, created_at: '2026-11-01T00:00:00Z' },
    { id: 'm2', user_id: U, status: 'closed_no_report', start_minutes: 9, created_at: '2026-11-02T00:00:00Z' },
    { id: 'm3', user_id: U, status: 'committed', start_minutes: 5, created_at: '2026-11-03T00:00:00Z' },
    { id: 'm4', user_id: V, status: 'reported', start_minutes: 5, created_at: '2026-11-04T00:00:00Z' },
  ],
  reports: [
    { move_id: 'm1', user_id: U, outcome: 'done', prediction_check: 'right' },
    { move_id: 'm4', user_id: V, outcome: 'didnt', prediction_check: 'not_tested' },
  ],
})

test('loads only this founder, only moves that ended, across situations', async () => {
  const text = await loadTrackRecord(createFakeSupabase({ tables: tables() }), U)
  assert.match(text, /^Last 2 moves: 1 done, 1 didn't\.$/m)
  assert.match(text, /Predictions: right 1\./)
  assert.equal(await loadTrackRecord(createFakeSupabase({ tables: { moves: [], reports: [] } }), U), '')
})

test('a failed read gives no track record and does not throw', async () => {
  const broken = { from: () => { throw new Error('down') } }
  const logged = []
  assert.equal(await loadTrackRecord(broken, U, (m) => logged.push(m)), '')
  assert.deepEqual(logged, ['track record failed'])
})

test('the record reaches both prompts, and an echoed record number still fails the existing checks', () => {
  const text = 'Last 2 moves: 1 done, 1 didn\'t.'
  const conversation = [{ role: 'founder', text: 'I sell candles to 40 people.' }]
  const read = readMessages({ conversation, trackRecord: text })
  const move = moveMessages({ situation: conversation, read: null, learn: [], subject: '', fact: '', trackRecord: text })
  for (const messages of [read, move]) assert.ok(messages.some((m) => m.role === 'system' && m.content.includes(text)))
  const MOVE = { title: 'Email the 40 people on your list.', mission: 'Email the 40 people on your list about 2 candles.', success: 'At least 5 people reply with a yes.', words: 'Hi', checklist: ['Open the list', 'Write the email', 'Send it'], prediction: 'A few will reply.', hypothesis: 'Tests whether the list replies.', start_minutes: 5 }
  const { problems } = checkMove({ data: MOVE, founderTexts: ['I sell candles to 40 people.'] })
  assert.ok(problems.some((p) => /never gave/.test(p)))
})
