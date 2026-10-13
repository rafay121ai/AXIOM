import test from 'node:test'
import assert from 'node:assert/strict'
import {
  cleanOnboardingPayload,
  cleanSessionMemoryPayload,
  cleanConceptProgress,
  cleanAppSessionStart,
  cleanMessagesSentAmount,
  isExperimentExpired,
} from './writeValidation.js'

const token = '123e4567-e89b-42d3-a456-426614174000'
const good = () => ({
  session_token: token,
  first_name: ' Ada ',
  answers: [{ question: 'q', answer: 'a', pillar: 'x', id: 1 }],
  pillar_weights: { human_mind: 2 },
  axiom_profile: 'You are...',
})

test('onboarding payload cleans and strips extra answer keys', () => {
  const out = cleanOnboardingPayload(good())
  assert.equal(out.first_name, 'Ada')
  assert.deepEqual(out.onboarding_answers, [{ question: 'q', answer: 'a' }])
})

test('onboarding payload rejects bad shapes', () => {
  assert.equal(cleanOnboardingPayload(null), null)
  assert.equal(cleanOnboardingPayload({ ...good(), session_token: 'nope' }), null)
  assert.equal(cleanOnboardingPayload({ ...good(), answers: [] }), null)
  assert.equal(cleanOnboardingPayload({ ...good(), answers: [{ question: 1, answer: 'a' }] }), null)
  assert.equal(cleanOnboardingPayload({ ...good(), pillar_weights: { a: 'x' } }), null)
  assert.equal(cleanOnboardingPayload({ ...good(), axiom_profile: 'x'.repeat(20001) }), null)
  assert.equal(cleanOnboardingPayload({ ...good(), first_name: 5 }), null)
  assert.equal(cleanOnboardingPayload({ ...good(), first_name: null }).first_name, null)
})

test('session memory payload only accepts the two fields', () => {
  assert.deepEqual(cleanSessionMemoryPayload({ session_notes: 'n', user_id: 'x' }), { session_notes: 'n' })
  assert.equal(cleanSessionMemoryPayload({}), null)
  assert.equal(cleanSessionMemoryPayload({ session_notes: 5 }), null)
  assert.equal(cleanSessionMemoryPayload({ session_notes: 'x'.repeat(20001) }), null)
  assert.equal(cleanSessionMemoryPayload({ user_id: 'x' }), null)
})

test('concept progress shape', () => {
  const ok = [{ topic: 'Game Theory', concepts_completed: ['A'], concepts_remaining: ['B'] }]
  assert.deepEqual(cleanConceptProgress(ok), ok)
  assert.equal(cleanConceptProgress('x'), null)
  assert.equal(cleanConceptProgress([{ topic: 1 }]), null)
  assert.equal(cleanConceptProgress([{ topic: 't', concepts_completed: [1] }]), null)
  assert.deepEqual(cleanConceptProgress([{ topic: 't' }]), [{ topic: 't', concepts_completed: [], concepts_remaining: [] }])
})

test('app session start and message amount', () => {
  assert.deepEqual(cleanAppSessionStart({}), { entry_point: 'direct', device: null })
  assert.equal(cleanAppSessionStart({ entry_point: 'evil' }), null)
  assert.equal(cleanMessagesSentAmount({}), 1)
  assert.equal(cleanMessagesSentAmount({ amount: 0 }), null)
  assert.equal(cleanMessagesSentAmount({ amount: 21 }), null)
  assert.equal(cleanMessagesSentAmount({ amount: 1.5 }), null)
})

test('experiment expiry rule', () => {
  const now = Date.parse('2026-10-13T12:00:00Z')
  assert.equal(isExperimentExpired({ status: 'active', due_at: '2026-10-13T11:00:00Z' }, now), true)
  assert.equal(isExperimentExpired({ status: 'active', due_at: '2026-10-13T13:00:00Z' }, now), false)
  assert.equal(isExperimentExpired({ status: 'active', assigned_at: '2026-10-12T00:00:00Z', window_hours: 24 }, now), true)
  assert.equal(isExperimentExpired({ status: 'completed', due_at: '2020-01-01T00:00:00Z' }, now), false)
})
