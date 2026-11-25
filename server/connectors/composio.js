// The one place that calls Composio (tasks/connectors-plan.md, Phase 2). Read only, enforced here: a tool not in
// READ_ONLY throws before any call, because development runs on Composio's default Google scopes (full access).
import { Composio } from '@composio/core'

// notion is Composio's own toolkit (it has triggers), not the separate notion_mcp toolkit.
export const TOOLKITS = ['googlecalendar', 'gmail', 'notion']
// Slugs checked against Composio's live catalog (readOnlyHint), Nov 25.
export const READ_ONLY = new Set([
  'GOOGLECALENDAR_EVENTS_LIST',
  'GOOGLECALENDAR_LIST_CALENDARS',
  'GMAIL_FETCH_EMAILS',
  'GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID',
  'GMAIL_FETCH_MESSAGE_BY_THREAD_ID',
  'NOTION_SEARCH_NOTION_PAGE',
  'NOTION_RETRIEVE_PAGE',
  'NOTION_GET_PAGE_MARKDOWN',
])

// userId: the founder's Supabase user id (opaque), never an email or name. composio: the SDK client; tests pass a fake.
export function createConnectors({ composio = new Composio() } = {}) {
  const sessionFor = (userId) => composio.create(userId, { toolkits: TOOLKITS })
  return {
    async isConnected(userId, toolkit) {
      const { items } = await (await sessionFor(userId)).toolkits()
      return Boolean(items.find((t) => t.slug === toolkit)?.connection?.isActive)
    },
    // A Connect Link the founder opens; Composio runs the Google sign-in. Returns { redirectUrl, waitForConnection }.
    async connect(userId, toolkit) {
      return (await sessionFor(userId)).authorize(toolkit)
    },
    async run(userId, slug, args = {}) {
      if (!READ_ONLY.has(slug)) throw new Error(`not a read-only connector tool: ${slug}`)
      return (await sessionFor(userId)).execute(slug, args)
    },
  }
}
