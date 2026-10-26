import assert from 'node:assert/strict'
import test from 'node:test'
import { escalateCare, ESCALATION_WINDOW_MS } from './escalation.js'

const now = Date.parse('2026-10-26T12:00:00Z')
const ev = (o) => ({ level: 'unclear', scope_id: 's1', created_at: new Date(now - 1000).toISOString(), ...o })

test('first unclear stays unclear', () => {
  assert.deepEqual(escalateCare({ level: 'unclear', scopeId: 's1', priorEvents: [], now }), { level: 'unclear', escalated: false })
})
test('second unclear in the same scope escalates to clear', () => {
  assert.deepEqual(escalateCare({ level: 'unclear', scopeId: 's1', priorEvents: [ev()], now }), { level: 'clear', escalated: true })
})
test('unclear in another scope does not escalate', () => {
  assert.equal(escalateCare({ level: 'unclear', scopeId: 's1', priorEvents: [ev({ scope_id: 's2' })], now }).level, 'unclear')
})
test('without a scope, a recent unclear counts and an old one does not', () => {
  assert.equal(escalateCare({ level: 'unclear', priorEvents: [ev({ scope_id: null })], now }).level, 'clear')
  const old = ev({ scope_id: null, created_at: new Date(now - ESCALATION_WINDOW_MS - 1).toISOString() })
  assert.equal(escalateCare({ level: 'unclear', priorEvents: [old], now }).level, 'unclear')
})
test('clear and none pass through; input is not mutated', () => {
  const prior = Object.freeze([Object.freeze(ev())])
  assert.equal(escalateCare({ level: 'clear', scopeId: 's1', priorEvents: prior, now }).level, 'clear')
  assert.equal(escalateCare({ level: 'none', scopeId: 's1', priorEvents: prior, now }).level, 'none')
})
