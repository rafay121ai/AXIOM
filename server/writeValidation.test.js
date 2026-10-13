import test from 'node:test'
import assert from 'node:assert/strict'
import {
  cleanOnboardingPayload,
  cleanSessionMemoryPayload,
  cleanConceptProgress,
  cleanAppSessionStart,
  cleanMessagesSentAmount,
  isExperimentExpired,
  cleanThreadPayload,
  cleanMessageCreate,
  cleanMessageUpdate,
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
  assert.equal(cleanSessionMemoryPayload('x'), null)
  assert.equal(cleanSessionMemoryPayload({ session_notes: 'x'.repeat(20001) }).session_notes.length, 20000)
  assert.equal(cleanSessionMemoryPayload({ user_id: 'x' }), null)
})

test('concept progress shape', () => {
  const ok = [{ topic: 'Game Theory', concepts_completed: ['A'], concepts_remaining: ['B'] }]
  assert.deepEqual(cleanConceptProgress(ok), ok)
  assert.equal(cleanConceptProgress('x'), null)
  assert.deepEqual(cleanConceptProgress([{ topic: 1 }]), [])
  assert.deepEqual(cleanConceptProgress([{ topic: 't', concepts_completed: [1, 'a', null] }]), [{ topic: 't', concepts_completed: ['a'], concepts_remaining: [] }])
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

test('session memory sanitizes malformed model output', () => {
  const many = Array.from({ length: 150 }, (_, i) => `c${i}`)
  const out = cleanSessionMemoryPayload({
    session_notes: 'y'.repeat(50000),
    concept_progress: [{ concepts_completed: ['x'] }, null, { topic: 't', concepts_completed: many, concepts_remaining: [5, {}, 'ok'] }],
  })
  assert.equal(out.session_notes.length, 20000)
  assert.equal(out.concept_progress.length, 1)
  assert.equal(out.concept_progress[0].concepts_completed.length, 100)
  assert.deepEqual(out.concept_progress[0].concepts_remaining, ['ok'])
  const entries = Array.from({ length: 80 }, (_, i) => ({ topic: `t${i}` }))
  assert.equal(cleanSessionMemoryPayload({ concept_progress: entries }).concept_progress.length, 50)
  assert.equal(cleanSessionMemoryPayload({ concept_progress: [{ nope: 1 }] }), null)
  assert.deepEqual(cleanSessionMemoryPayload({ concept_progress: 'bad', session_notes: 'n' }), { session_notes: 'n' })
})

const U1 = '11111111-1111-4111-8111-111111111111'
const U2 = '22222222-2222-4222-8222-222222222222'

test('thread payload validation', () => {
  assert.deepEqual(cleanThreadPayload({ id: U1, session_id: U2, title: 'T', primary_pillar: 'money_game', user_id: 'x' }),
    { id: U1, session_id: U2, title: 'T', primary_pillar: 'money_game' })
  assert.deepEqual(cleanThreadPayload({ session_id: U2 }), { id: null, session_id: U2, title: null, primary_pillar: null })
  assert.equal(cleanThreadPayload({ id: 'bad', session_id: U2 }), null)
  assert.equal(cleanThreadPayload({ session_id: 'bad' }), null)
  assert.equal(cleanThreadPayload({ session_id: U2, primary_pillar: 'nope' }), null)
  assert.equal(cleanThreadPayload({ session_id: U2, title: 5 }), null)
  assert.equal(cleanThreadPayload(null), null)
})

test('message create validation', () => {
  const ok = { session_id: U1, thread_id: U2, role: 'assistant', content: 'hi' }
  assert.deepEqual(cleanMessageCreate({ ...ok, extra: 1 }), ok)
  assert.equal(cleanMessageCreate({ ...ok, thread_id: null }).thread_id, null)
  assert.equal(cleanMessageCreate({ ...ok, role: 'system' }), null)
  assert.equal(cleanMessageCreate({ ...ok, thread_id: 'x' }), null)
  assert.equal(cleanMessageCreate({ ...ok, content: 5 }), null)
  assert.equal(cleanMessageCreate({ ...ok, content: 'x'.repeat(100001) }), null)
  assert.equal(cleanMessageCreate({ ...ok, content: 'x'.repeat(100000) }).content.length, 100000)
  assert.equal(cleanMessageCreate({ ...ok, session_id: undefined }), null)
})

test('message update validation keeps today capabilities', () => {
  assert.deepEqual(cleanMessageUpdate({ content: 'edited' }, 'user'), { content: 'edited' })
  assert.equal(cleanMessageUpdate({ content: '  ' }, 'user'), null)
  assert.equal(cleanMessageUpdate({ content: 'plain' }, 'assistant'), null)
  const enriched = 'text\n\n<experiment>\n{"a":1}\n</experiment>'
  assert.deepEqual(cleanMessageUpdate({ content: enriched }, 'assistant'), { content: enriched })
  assert.equal(cleanMessageUpdate({ content: 'x' }, 'system'), null)
  assert.equal(cleanMessageUpdate({ role: 'user' }, 'user'), null)
})
