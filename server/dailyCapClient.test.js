import assert from 'node:assert/strict'
import test from 'node:test'
import { DailyCapError, isDailyCapError, isCappedBody, formatLocalResetTime, localizeCapMessage } from '../src/lib/dailyCapError.js'
import { buildCappedResponse } from './dailyCap.js'

const body = buildCappedResponse(new Date('2026-10-13T10:00:00Z'))

test('isCappedBody only for capped:true', () => {
  assert.equal(isCappedBody(body), true)
  assert.equal(isCappedBody({ capped: false }), false)
  assert.equal(isCappedBody({ choices: [] }), false)
  assert.equal(isCappedBody(null), false)
})

test('DailyCapError from a server body uses local reset time', () => {
  const err = new DailyCapError(body)
  const time = new Date(body.resets_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  assert.equal(err.message, `You've hit today's limit. Come back after ${time} to keep going.`)
  assert.equal(isDailyCapError(err), true)
  assert.equal(err.resetsAt, body.resets_at)
})

test('local message formats a known instant in en-US', () => {
  assert.match(localizeCapMessage(body.message, '2026-10-14T00:00:00.000Z', 'en-US'), /^You've hit today's limit\. Come back after \d{1,2}:\d{2}\s?(AM|PM) to keep going\.$/)
})

test('missing or invalid resetsAt keeps the server string', () => {
  assert.equal(new DailyCapError({ capped: true, message: body.message }).message, body.message)
  assert.equal(new DailyCapError({ ...body, resets_at: 'garbage' }).message, body.message)
  assert.equal(formatLocalResetTime(null), null)
  assert.equal(formatLocalResetTime('nope'), null)
})
