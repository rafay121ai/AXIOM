// Polling and backfill (connectors-plan Phase 3). Read-only tools only. Each item becomes one connector_jobs row
// (external_id = item id | updated time); the job holds no content. The unique key makes repeats harmless (23505).
// last_sync_at moves only after every enqueue succeeded.
import { createBreaker, createReader } from './read.js'
import { createWorker } from './worker.js'
import { handleItem as defaultHandleItem } from './handleItem.js'

const DAY = 86400000
export const POLL_MS = 5 * 60 * 1000
export const WORKER_MS = 30 * 1000
// Hard caps per connect (a call past Composio's allowance costs real money).
export const BACKFILL = { gmailDays: 30, gmailMax: 50, calendarDaysBack: 30, calendarDaysAhead: 14, calendarMax: 250, notionMax: 50 }
export const POLL_CAP = { gmail: 100, googlecalendar: 250, notion: 50 }
const PAGE = 100
const MAX_PAGES = 5 // list calls per account per poll or backfill
const ok = (r) => { if (r.error) throw r.error; return r.data }

// One list call per page; returns [{ id, updated }] up to `cap`. The list content is discarded.
async function listItems(read, userId, toolkit, { sinceMs, nowMs, backfill }) {
  const iso = (ms) => new Date(ms).toISOString()
  const cap = backfill ? { gmail: BACKFILL.gmailMax, googlecalendar: BACKFILL.calendarMax, notion: BACKFILL.notionMax }[toolkit] : POLL_CAP[toolkit]
  const out = []
  let token
  let pages = 0
  do {
    pages += 1
    let d
    if (toolkit === 'gmail') {
      d = await read(userId, 'GMAIL_FETCH_EMAILS', { query: `after:${Math.floor(sinceMs / 1000)}`, max_results: Math.min(PAGE, cap - out.length), page_token: token, include_payload: false })
      out.push(...(d.messages ?? []).map((m) => ({ id: m.messageId ?? m.id, updated: m.messageTimestamp ?? m.internalDate ?? '' })))
      token = d.nextPageToken
    } else if (toolkit === 'googlecalendar') {
      const timeMin = backfill ? nowMs - BACKFILL.calendarDaysBack * DAY : nowMs
      d = await read(userId, 'GOOGLECALENDAR_EVENTS_LIST', { calendarId: 'primary', timeMin: iso(timeMin), timeMax: iso(nowMs + BACKFILL.calendarDaysAhead * DAY), singleEvents: true, maxResults: Math.min(PAGE, cap - out.length), pageToken: token })
      out.push(...(d.items ?? d.events ?? []).map((e) => ({ id: e.id, updated: e.updated ?? '' })))
      token = d.nextPageToken
    } else {
      d = await read(userId, 'NOTION_SEARCH_NOTION_PAGE', { filter_property: 'object', filter_value: 'page', timestamp: 'last_edited_time', direction: 'descending', page_size: Math.min(PAGE, cap - out.length), start_cursor: token })
      const results = d.results ?? d.pages ?? []
      // Newest first: the first page older than the last sync ends the poll.
      const stop = !backfill && results.some((p) => !(Date.parse(p.last_edited_time) > sinceMs))
      out.push(...results.filter((p) => backfill || Date.parse(p.last_edited_time) > sinceMs).map((p) => ({ id: p.id, updated: p.last_edited_time ?? '' })))
      token = stop || d.has_more === false ? undefined : d.next_cursor
    }
  } while (token && out.length < cap && pages < MAX_PAGES)
  return out.filter((i) => i.id).slice(0, cap)
}

export function createIngestion({ supabase, connectors, clock, breaker = createBreaker({ clock }), handleItem = defaultHandleItem, learnPeople, blocked = async () => false, log = (what, info) => console.error(`[Connectors] ${what}`, info ?? '') }) {
  const read = createReader({ connectors, breaker })
  const worker = createWorker({ supabase, read, breaker, clock, handleItem, learnPeople, blocked, log })
  const iso = (ms = clock.now()) => new Date(ms).toISOString()

  async function enqueue(userId, toolkit, items, kind) {
    // A backfill is queued newest first (run_after steps by a millisecond), so a spent budget goes to recent items.
    const stamp = (u) => (Number.isFinite(Date.parse(u)) ? Date.parse(u) : Number(u) || 0)
    const ordered = kind === 'backfill' ? [...items].sort((a, b) => stamp(b.updated) - stamp(a.updated)) : items
    for (const [i, { id, updated }] of ordered.entries()) {
      const { error } = await supabase.from('connector_jobs').insert({ user_id: userId, toolkit, external_id: `${id}|${updated}`.slice(0, 300), kind, run_after: iso(clock.now() + (kind === 'backfill' ? i : 0)) })
      if (error && error.code !== '23505') throw error
    }
  }

  // Backfill or poll one account. Per-founder errors never stop the others.
  async function sync(account, backfill) {
    // A deletion request or an open care event: nothing is read. If we cannot tell, wait.
    if (await blocked(account.user_id).catch(() => true)) return
    const nowMs = clock.now()
    const sinceMs = backfill ? nowMs - BACKFILL.gmailDays * DAY : Date.parse(account.last_sync_at)
    try {
      await enqueue(account.user_id, account.toolkit, await listItems(read, account.user_id, account.toolkit, { sinceMs, nowMs, backfill }), backfill ? 'backfill' : 'poll')
      ok(await supabase.from('connector_accounts').update({ last_sync_at: iso(nowMs), last_error_code: null, updated_at: iso() }).eq('id', account.id).select('id'))
    } catch (err) {
      const code = err.code === 'auth' || err.code === 'paused' || err.code === 'composio' ? err.code : 'enqueue_error'
      log('sync failed', `${account.toolkit} ${code}`)
      if (code === 'paused') return
      const patch = code === 'auth' ? { status: 'needs_reconnect', last_error_code: code } : { last_error_code: code }
      // A database error here must not stop the other founders.
      try { ok(await supabase.from('connector_accounts').update({ ...patch, updated_at: iso() }).eq('id', account.id).select('id')) } catch { log('sync status not saved', account.toolkit) }
    }
  }

  // Called when a toolkit first becomes active; a failure is fine, the poller backfills any account never synced.
  async function backfill(userId, toolkit) {
    const [account] = ok(await supabase.from('connector_accounts').select('id, user_id, toolkit, last_sync_at').eq('user_id', userId).eq('toolkit', toolkit))
    if (account && !account.last_sync_at) await sync(account, true)
  }

  async function poll() {
    if (breaker.isOpen()) return 0
    const accounts = ok(await supabase.from('connector_accounts').select('id, user_id, toolkit, last_sync_at').eq('status', 'active'))
    for (const account of accounts) {
      if (breaker.isOpen()) break
      await sync(account, !account.last_sync_at)
    }
    return accounts.length
  }

  return { poll, backfill, sync, worker, breaker }
}

// Started by index.js only when CONNECTORS=on, with the one ingestion the routes also use (one breaker). A run still going makes the next one wait.
export function startConnectorIngestion({ pollMs = Number(process.env.CONNECTORS_POLL_MS) || POLL_MS, workerMs = Number(process.env.CONNECTORS_WORKER_MS) || WORKER_MS, ingestion }) {
  const loop = (fn, what) => {
    let running = false
    return async () => {
      if (running) return
      running = true
      try { await fn() } catch (err) { console.error(`[Connectors] ${what} failed`, err?.code ?? err?.name ?? '') } finally { running = false }
    }
  }
  const poll = loop(() => ingestion.poll(), 'poll')
  const work = loop(() => ingestion.worker.run(), 'worker')
  const timers = [setInterval(poll, pollMs), setInterval(work, workerMs)]
  timers.forEach((t) => t.unref?.())
  poll()
  return { stop: () => timers.forEach(clearInterval), poll, work, ingestion }
}
