import assert from 'node:assert/strict'
import test from 'node:test'
import { HELP_TABLE, helpFor } from './help.js'
import { CARE_COPY } from './copy.js'

test('no placeholder is verified and no digits of a phone number exist in the table', () => {
  for (const e of HELP_TABLE) {
    assert.equal(e.verified, false)
    assert.equal(e.emergency, null)
    for (const l of e.lines) assert.equal(l.contact, null)
  }
})
test('unverified or unknown countries get the worldwide fallback and needs_verification', () => {
  for (const c of ['United States', 'uk', 'Narnia', null, '']) {
    const h = helpFor(c)
    assert.equal(h.needs_verification, true)
    assert.equal(h.fallback, CARE_COPY.fallbackLine)
    assert.deepEqual(h.lines, [])
    assert.equal(h.emergency, null)
  }
  assert.equal(helpFor('U.S.A').country, 'US')
})
test('a verified entry is returned once a person verifies it', () => {
  const table = [{ code: 'XX', names: ['xland'], emergency: 'TEST-EMERGENCY', lines: [{ name: 'Test line', contact: 'TEST-CONTACT' }], verified: true }]
  const h = helpFor('Xland', table)
  assert.equal(h.needs_verification, false)
  assert.equal(h.emergency, 'TEST-EMERGENCY')
})
test('copy has no banned phrases', () => {
  const banned = /great question|certainly|i understand|that'?s interesting|absolutely|of course|i'?d be happy to|\bgreat\b/i
  for (const v of Object.values(CARE_COPY)) assert.doesNotMatch(v, banned)
})

test('care copy matches the mocks', async () => {
  const { CARE_COPY: C } = await import('./copy.js')
  assert.equal(C.unclearReply, 'That sounded heavy. What is going on?')
  assert.equal(C.fallbackLine, 'More help near you: findahelpline.com')
})
