import test from 'node:test'
import assert from 'node:assert/strict'
import { isUuid, normalizeReportTime } from './writeValidation.js'

test('isUuid accepts only uuid strings', () => {
  assert.equal(isUuid('00000000-0000-4000-8000-000000000001'), true)
  assert.equal(isUuid('nope'), false)
  assert.equal(isUuid(undefined), false)
})

test('normalizeReportTime accepts HH:MM and HH:MM:SS within bounds', () => {
  assert.equal(normalizeReportTime('21:30:00'), '21:30')
  assert.equal(normalizeReportTime('09:05'), '09:05')
  assert.equal(normalizeReportTime('24:00'), null)
  assert.equal(normalizeReportTime('12:60'), null)
  assert.equal(normalizeReportTime(null), null)
})
