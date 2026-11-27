import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createConnectors } from './composio.js'

test('a write tool throws before Composio is called', async () => {
  let calls = 0
  const composio = { create: async () => { calls += 1; return { execute: async () => ({}) } } }
  const connectors = createConnectors({ composio })
  for (const slug of ['GMAIL_SEND_EMAIL', 'GMAIL_DELETE_MESSAGE', 'GMAIL_MOVE_TO_TRASH', 'GMAIL_CREATE_EMAIL_DRAFT', 'GOOGLECALENDAR_CREATE_EVENT', 'NOTION_CREATE_NOTION_PAGE', 'NOTION_CREATE_VIEW_QUERY']) {
    await assert.rejects(connectors.run('user-1', slug), /not a read-only connector tool/)
  }
  assert.equal(calls, 0)
})

test('a read-only tool runs in the founder\'s own session', async () => {
  const seen = []
  const composio = {
    create: async (userId, config) => ({ execute: async (slug, args) => { seen.push({ userId, config, slug, args }); return { resultType: 'completed' } } }),
  }
  const out = await createConnectors({ composio }).run('user-1', 'GOOGLECALENDAR_EVENTS_LIST', { maxResults: 1 })
  assert.equal(out.resultType, 'completed')
  assert.deepEqual(seen, [{ userId: 'user-1', config: { toolkits: ['googlecalendar', 'gmail', 'notion'] }, slug: 'GOOGLECALENDAR_EVENTS_LIST', args: { maxResults: 1 } }])
})
