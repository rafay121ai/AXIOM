import assert from 'node:assert/strict'
import test from 'node:test'
import { createEventTracker } from './productEvents.js'

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
