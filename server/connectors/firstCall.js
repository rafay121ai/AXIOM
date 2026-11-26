// Manual check, not part of the server: connect one toolkit for one founder and make one read-only call.
// Usage: node server/connectors/firstCall.js <supabase-user-id> [googlecalendar|gmail|notion]
// Prints only counts, times and the Composio log id, never titles, subjects, senders or bodies.
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') })
const { createConnectors } = await import('./composio.js')

const [userId, toolkit = 'googlecalendar'] = process.argv.slice(2)
const CHECKS = {
  googlecalendar: {
    slug: 'GOOGLECALENDAR_EVENTS_LIST',
    args: () => ({ timeMin: new Date().toISOString(), maxResults: 5, singleEvents: true, orderBy: 'startTime' }),
    summary: (data) => {
      const items = data?.items ?? []
      return { events: items.length, starts: items.map((e) => e.start?.dateTime ?? e.start?.date) }
    },
  },
  gmail: {
    slug: 'GMAIL_FETCH_EMAILS',
    args: () => ({ max_results: 5, ids_only: true }),
    summary: (data) => ({ messages: (data?.messages ?? []).length }),
  },
  notion: {
    slug: 'NOTION_SEARCH_NOTION_PAGE',
    args: () => ({ query: '', page_size: 5 }),
    summary: (data) => ({ pages: (data?.results ?? data?.response_data?.results ?? []).length }),
  },
}
const check = CHECKS[toolkit]
if (!userId || !check) throw new Error('usage: node server/connectors/firstCall.js <supabase-user-id> [googlecalendar|gmail|notion]')

const connectors = createConnectors()
if (!(await connectors.isConnected(userId, toolkit))) {
  const request = await connectors.connect(userId, toolkit)
  console.log(`Open this link and sign in:\n${request.redirectUrl}\nWaiting up to 5 minutes...`)
  await request.waitForConnection(5 * 60 * 1000)
}

const res = await connectors.run(userId, check.slug, check.args())
console.log({ tool: check.slug, resultType: res.resultType, logId: res.logId, error: res.error, ...check.summary(res.data) })
if (res.resultType === 'completed') console.log('data keys:', Object.keys(res.data ?? {}))
