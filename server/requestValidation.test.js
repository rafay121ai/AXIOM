import test from 'node:test'
import assert from 'node:assert/strict'
import {
  validateChatMessages,
  isAllowedResponseFormat,
  validateEmbeddingInput,
  parseBearerToken,
  upstreamErrorStatus,
  CHAT_MAX_MESSAGES,
  CHAT_MAX_TOTAL_CHARS,
  EMBEDDING_MAX_ITEMS,
  EMBEDDING_MAX_CHARS,
} from './requestValidation.js'

test('validateChatMessages accepts normal payloads', () => {
  assert.equal(validateChatMessages([{ role: 'system', content: 'a' }, { role: 'user', content: 'b' }]), true)
})

test('validateChatMessages rejects bad shapes', () => {
  assert.equal(validateChatMessages(undefined), false)
  assert.equal(validateChatMessages([]), false)
  assert.equal(validateChatMessages([null]), false)
  assert.equal(validateChatMessages([{ role: 'tool', content: 'x' }]), false)
  assert.equal(validateChatMessages([{ role: 'user', content: ['x'] }]), false)
  assert.equal(validateChatMessages([{ role: 'user' }]), false)
})

test('validateChatMessages enforces count and size caps', () => {
  const ok = { role: 'user', content: 'x' }
  assert.equal(validateChatMessages(Array(CHAT_MAX_MESSAGES).fill(ok)), true)
  assert.equal(validateChatMessages(Array(CHAT_MAX_MESSAGES + 1).fill(ok)), false)
  assert.equal(validateChatMessages([{ role: 'user', content: 'x'.repeat(CHAT_MAX_TOTAL_CHARS) }]), true)
  assert.equal(validateChatMessages([{ role: 'user', content: 'x'.repeat(CHAT_MAX_TOTAL_CHARS + 1) }]), false)
})

test('isAllowedResponseFormat', () => {
  assert.equal(isAllowedResponseFormat(undefined), true)
  assert.equal(isAllowedResponseFormat({ type: 'json_object' }), true)
  assert.equal(isAllowedResponseFormat({ type: 'json_schema' }), false)
  assert.equal(isAllowedResponseFormat({ type: 'json_object', extra: 1 }), false)
  assert.equal(isAllowedResponseFormat('json_object'), false)
})

test('validateEmbeddingInput', () => {
  assert.equal(validateEmbeddingInput('hi'), true)
  assert.equal(validateEmbeddingInput('x'.repeat(EMBEDDING_MAX_CHARS + 1)), false)
  assert.equal(validateEmbeddingInput(Array(EMBEDDING_MAX_ITEMS).fill('a')), true)
  assert.equal(validateEmbeddingInput(Array(EMBEDDING_MAX_ITEMS + 1).fill('a')), false)
  assert.equal(validateEmbeddingInput([]), false)
  assert.equal(validateEmbeddingInput([1]), false)
  assert.equal(validateEmbeddingInput({}), false)
})

test('parseBearerToken is strict', () => {
  assert.equal(parseBearerToken('Bearer abc'), 'abc')
  assert.equal(parseBearerToken('bearer abc'), null)
  assert.equal(parseBearerToken('abc'), null)
  assert.equal(parseBearerToken('Bearer '), null)
  assert.equal(parseBearerToken(undefined), null)
})

test('upstreamErrorStatus', () => {
  assert.equal(upstreamErrorStatus({ status: 429 }), 429)
  assert.equal(upstreamErrorStatus({ status: 401 }), 502)
  assert.equal(upstreamErrorStatus({ status: 503 }), 502)
  assert.equal(upstreamErrorStatus(new Error('x')), 500)
})
