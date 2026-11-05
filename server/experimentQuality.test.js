import test from 'node:test'
import assert from 'node:assert/strict'
import { validateExperimentQuality } from './experimentQuality.js'

function validExperimentFixture(overrides = {}) {
  return {
    title: 'Zara Price Signal',
    pillar: 'Move People',
    description: 'Send Zara the $49 offer and ask if she would pay this week.',
    hypothesis: 'This test will reveal whether Zara sees the $49 offer as urgent enough to pay for this week.',
    window_hours: 48,
    how_to_do_it: 'Open WhatsApp and send Zara the $49 offer with one direct yes-or-no question.',
    real_world_example: 'A founder messages Zara on WhatsApp with a $49 offer and asks for a yes-or-no answer by Friday.',
    what_to_notice: 'Notice whether Zara answers the price directly or dodges the buying decision.',
    success_condition: 'Zara replies yes or no to the $49 offer on WhatsApp.',
    ...overrides,
  }
}

test('Experiment quality validator rejects vague behavior-change tests', () => {
  assert.equal(validateExperimentQuality(validExperimentFixture()).ok, true)

  assert.equal(
    validateExperimentQuality(validExperimentFixture({ hypothesis: '' })).reason,
    'missing_hypothesis'
  )
  assert.equal(
    validateExperimentQuality(validExperimentFixture({ hypothesis: 'This tests urgency.' })).reason,
    'invalid_hypothesis'
  )
  assert.equal(
    validateExperimentQuality(validExperimentFixture({ how_to_do_it: 'Reflect on the offer and think about why it matters.' })).reason,
    'missing_specific_action'
  )
  assert.equal(
    validateExperimentQuality(validExperimentFixture({ real_world_example: 'Imagine someone who asks a customer about an offer.' })).reason,
    'hypothetical_example'
  )
  assert.equal(
    validateExperimentQuality(validExperimentFixture({ success_condition: 'You feel clearer about the decision.' })).reason,
    'vague_success_condition'
  )
  assert.equal(
    validateExperimentQuality(validExperimentFixture({
      how_to_do_it: 'Send a message to someone in your network asking about the offer.',
      real_world_example: 'A founder messages someone in their network about an offer.',
      success_condition: 'Someone replies yes or no to the offer.',
    })).reason,
    'missing_real_world_target'
  )
  assert.equal(
    validateExperimentQuality(validExperimentFixture({
      hypothesis: 'This test will reveal whether Zara would pay for the offer this week.',
      success_condition: 'The note contains one pricing assumption and one disconfirming signal.',
    })).reason,
    'hypothesis_success_mismatch'
  )
})
