import assert from 'node:assert/strict'
import test from 'node:test'
import { createEventTracker, toReportedOutcome, shouldEmitExperimentReported } from './productEvents.js'
import { capExperimentMetadata } from './writeValidation.js'

test('trackEvent logs and swallows a thrown database error', async () => {
  const logged = []
  const supabase = {
    from() {
      return {
        insert() {
          throw new Error('database unavailable')
        },
      }
    },
  }
  const trackEvent = createEventTracker({
    supabase,
    logger: { error: (...args) => logged.push(args) },
  })

  let result
  await assert.doesNotReject(async () => {
    result = await trackEvent('user-1', 'message_sent', { message_id: 'message-1' })
  })
  assert.equal(result, false)
  assert.equal(logged.length, 1)
  assert.match(logged[0][0], /tracking failed/)
})

test('toReportedOutcome maps completed to done', () => {
  assert.equal(toReportedOutcome('completed', null), 'done')
})
test('toReportedOutcome maps cancelled with couldnt/didnt reason', () => {
  assert.equal(toReportedOutcome('cancelled', 'couldnt'), 'couldnt')
  assert.equal(toReportedOutcome('cancelled', 'didnt'), 'didnt')
})
test('toReportedOutcome returns null for cancel without reason, other reasons and other statuses', () => {
  assert.equal(toReportedOutcome('cancelled', null), null)
  assert.equal(toReportedOutcome('cancelled', 'other'), null)
  assert.equal(toReportedOutcome('ghosted', 'didnt'), null)
  assert.equal(toReportedOutcome('active', null), null)
})
test('shouldEmitExperimentReported emits on first report', () => {
  assert.equal(shouldEmitExperimentReported({ status: 'active' }, { status: 'completed' }), true)
})
test('shouldEmitExperimentReported suppresses identical retry', () => {
  assert.equal(shouldEmitExperimentReported({ status: 'completed' }, { status: 'completed' }), false)
})
test('shouldEmitExperimentReported emits couldnt to didnt correction', () => {
  assert.equal(
    shouldEmitExperimentReported(
      { status: 'cancelled', outcome_reason: 'couldnt' },
      { status: 'cancelled', outcome_reason: 'didnt' },
    ),
    true,
  )
})
test('shouldEmitExperimentReported emits done to couldnt', () => {
  assert.equal(
    shouldEmitExperimentReported({ status: 'completed' }, { status: 'cancelled', outcome_reason: 'couldnt' }),
    true,
  )
})
test('shouldEmitExperimentReported emits ghosted to done', () => {
  assert.equal(shouldEmitExperimentReported({ status: 'ghosted' }, { status: 'completed' }), true)
})
test('shouldEmitExperimentReported suppresses cancel with no reason', () => {
  assert.equal(shouldEmitExperimentReported({ status: 'active' }, { status: 'cancelled' }), false)
})
test('shouldEmitExperimentReported suppresses null to null', () => {
  assert.equal(shouldEmitExperimentReported({ status: 'active' }, { status: 'ghosted' }), false)
})
test('shouldEmitExperimentReported suppresses cancel retry that drops the reason', () => {
  assert.equal(
    shouldEmitExperimentReported(
      { status: 'cancelled', outcome_reason: 'couldnt' },
      { status: 'cancelled', outcome_reason: undefined },
    ),
    false,
  )
})
test('shouldEmitExperimentReported suppresses identical cancelled couldnt retry', () => {
  assert.equal(
    shouldEmitExperimentReported(
      { status: 'cancelled', outcome_reason: 'couldnt' },
      { status: 'cancelled', outcome_reason: 'couldnt' },
    ),
    false,
  )
})
test('capExperimentMetadata leaves small metadata unchanged', () => {
  assert.deepEqual(capExperimentMetadata({ a: 1 }, { hypothesis: 'h' }), { a: 1, hypothesis: 'h' })
})
test('capExperimentMetadata drops oversized original but keeps hypothesis', () => {
  const out = capExperimentMetadata({ big: 'x'.repeat(20 * 1024) }, { hypothesis: 'h' })
  assert.deepEqual(out, { hypothesis: 'h', original_dropped: true })
})
