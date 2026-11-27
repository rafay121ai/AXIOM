// The one place that calls Composio (tasks/connectors-plan.md, Phase 2). Read only, enforced here: a tool not in
// READ_ONLY throws before any call, because development runs on Composio's default Google scopes (full access).
import { Composio } from '@composio/core'

// notion is Composio's own toolkit (it has triggers), not the separate notion_mcp toolkit.
export const TOOLKITS = ['googlecalendar', 'gmail', 'notion']
// Slugs checked against Composio's live catalog (readOnlyHint), Nov 25 and 27.
export const READ_ONLY = new Set([
  'GOOGLECALENDAR_EVENTS_LIST',
  'GOOGLECALENDAR_LIST_CALENDARS',
  'GOOGLECALENDAR_FIND_EVENT',
  'GOOGLECALENDAR_EVENTS_GET', // readOnlyHint tag in the live catalog, Nov 27
  'GOOGLECALENDAR_FIND_FREE_SLOTS',
  'GMAIL_FETCH_EMAILS',
  'GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID',
  'GMAIL_FETCH_MESSAGE_BY_THREAD_ID',
  'NOTION_SEARCH_NOTION_PAGE',
  'NOTION_RETRIEVE_PAGE',
  'NOTION_GET_PAGE_MARKDOWN',
])

// userId: the founder's Supabase user id (opaque), never an email or name. composio: the SDK client; tests pass a fake.
export function createConnectors({ composio = new Composio() } = {}) {
  const deleteAll = async (accounts) => {
    const failed = []
    for (const { toolkit, id } of accounts) {
      try { await composio.connectedAccounts.delete(id) } catch { failed.push(`${toolkit} ${id}`) }
    }
    return failed
  }
  const sessionFor = (userId) => composio.create(userId, { toolkits: TOOLKITS })
  return {
    async isConnected(userId, toolkit) {
      return (await this.status(userId))[toolkit].active
    },
    // Per toolkit: { active, accountId }. accountId is null when the founder never connected it. Read only.
    async status(userId) {
      const { items } = await (await sessionFor(userId)).toolkits()
      return Object.fromEntries(TOOLKITS.map((slug) => {
        const connection = items.find((t) => t.slug === slug)?.connection
        return [slug, { active: Boolean(connection?.isActive), accountId: connection?.connectedAccount?.id ?? null }]
      }))
    },
    // Every connected account this founder has for these toolkits, however many a reconnect left behind.
    async accounts(userId, toolkits) {
      const out = []
      let cursor
      do {
        const page = await composio.connectedAccounts.list({ userIds: [userId], toolkitSlugs: toolkits, cursor, limit: 100 })
        out.push(...page.items.map((a) => ({ toolkit: a.toolkit.slug, id: a.id })))
        cursor = page.nextCursor
      } while (cursor)
      return out
    },
    // Deletes ALL the founder's connected accounts for the toolkit at Composio (that revokes the tokens). Throws if any failed.
    async revoke(userId, toolkit) {
      const failed = await deleteAll(await this.accounts(userId, [toolkit]))
      if (failed.length) throw new Error('revoke failed')
    },
    // Every toolkit, one failing never stops the others. Returns what failed as "toolkit ca_id" (opaque ids, for the Composio dashboard).
    async revokeAll(userId) {
      return deleteAll(await this.accounts(userId, TOOLKITS))
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
