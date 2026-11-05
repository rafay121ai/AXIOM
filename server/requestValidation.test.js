import test from 'node:test'
import assert from 'node:assert/strict'
import { parseBearerToken } from './requestValidation.js'

test('parseBearerToken is strict', () => {
  assert.equal(parseBearerToken('Bearer abc'), 'abc')
  assert.equal(parseBearerToken('bearer abc'), null)
  assert.equal(parseBearerToken('abc'), null)
  assert.equal(parseBearerToken('Bearer '), null)
  assert.equal(parseBearerToken(undefined), null)
})
