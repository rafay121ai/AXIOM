// The queue worker (connectors-plan Phase 3). Claims connector_jobs with a conditional update (supabase-js has no
// SKIP LOCKED: the update that returns the row is the claim), fetches the item fresh and read-only, filters it, and
// hands kept items to handleItem. Content is never stored and never logged: ids and reason codes only.
import { filterItem, overridable, emailOf } from './filter.js'
import { handleItem as defaultHandleItem } from './handleItem.js'

export const MAX_ATTEMPTS = 5
export const STALE_LOCK_MS = 10 * 60 * 1000
export const BACKOFF_MS = 60 * 1000
export const BATCH = 10
const ok = (r) => { if (r.error) throw r.error; return r.data }
const header = (d, name) => (d.payload?.headers ?? []).find((h) => h.name?.toLowerCase() === name)?.value

// Composio's shapes are read tolerantly; what the filter needs is normalised here.
async function fetchItem(read, userId, toolkit, jobExternalId) {
  const [id, updated] = jobExternalId.split('|')
  if (toolkit === 'gmail') {
    const d = await read(userId, 'GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID', { message_id: id, format: 'full' })
    return {
      id, threadId: d.threadId,
      labels: d.labelIds ?? [], from: d.sender ?? header(d, 'from') ?? '', subject: d.subject ?? header(d, 'subject') ?? '',
      body: d.messageText ?? d.body ?? '', bulk: Boolean(header(d, 'list-unsubscribe')),
    }
  }
  if (toolkit === 'googlecalendar') {
    const d = await read(userId, 'GOOGLECALENDAR_EVENTS_LIST', { calendarId: 'primary', updatedMin: updated, singleEvents: true, maxResults: 50 })
    const e = (d.items ?? d.events ?? []).find((x) => x.id === id)
    return e ? { id, ...e } : null
  }
  const d = await read(userId, 'NOTION_RETRIEVE_PAGE', { page_id: id })
  return { id, title: d.title ?? d.properties?.title?.title?.[0]?.plain_text ?? d.properties?.Name?.title?.[0]?.plain_text ?? '', ...d }
}

export function createWorker({ supabase, read, breaker, clock, handleItem = defaultHandleItem, log = (what, info) => console.error(`[Connectors] ${what}`, info ?? '') }) {
  const iso = (ms = clock.now()) => new Date(ms).toISOString()
  const meetingCache = new Map()

  // Calendar people for the next 14 days, cached 10 minutes per founder.
  async function meetingPeople(userId) {
    const hit = meetingCache.get(userId)
    if (hit && hit.at > clock.now() - 10 * 60 * 1000) return hit.people
    const d = await read(userId, 'GOOGLECALENDAR_EVENTS_LIST', { calendarId: 'primary', timeMin: iso(), timeMax: iso(clock.now() + 14 * 86400000), singleEvents: true, maxResults: 100 })
    const people = new Set((d.items ?? d.events ?? []).flatMap((e) => (e.attendees ?? []).map((a) => emailOf(a.email))))
    meetingCache.set(userId, { at: clock.now(), people })
    return people
  }

  async function filterFor(userId, toolkit, item) {
    let result = filterItem(toolkit, item)
    if (overridable(toolkit, result)) {
      const ctx = { meetingPeople: await meetingPeople(userId).catch(() => new Set()) }
      if (item.threadId && /^\s*(re|aw|fwd?):/i.test(item.subject)) {
        const t = await read(userId, 'GMAIL_FETCH_MESSAGE_BY_THREAD_ID', { thread_id: item.threadId })
        ctx.repliedTo = (t.messages ?? []).some((m) => (m.labelIds ?? []).includes('SENT'))
      }
      result = filterItem(toolkit, item, ctx)
    }
    return result
  }

  const finish = async (job, patch) => ok(await supabase.from('connector_jobs').update({ locked_at: null, updated_at: iso(), ...patch }).eq('id', job.id).select('id'))

  // Stale running jobs (a crashed worker) go back to queued, or to failed when out of attempts.
  async function requeueStale() {
    const stale = (patch) => supabase.from('connector_jobs').update({ locked_at: null, updated_at: iso(), ...patch }).eq('status', 'running').lt('locked_at', iso(clock.now() - STALE_LOCK_MS))
    ok(await stale({ status: 'queued' }).lt('attempts', MAX_ATTEMPTS).select('id'))
    ok(await stale({ status: 'failed', last_error_code: 'stale_lock' }).gte('attempts', MAX_ATTEMPTS).select('id'))
  }

  async function claim() {
    const due = ok(await supabase.from('connector_jobs').select('id').eq('status', 'queued').lte('run_after', iso()).order('run_after').limit(BATCH))
    const claimed = []
    for (const { id } of due) {
      // Conditional on status: a second worker's update matches no row.
      const rows = ok(await supabase.from('connector_jobs').update({ status: 'running', locked_at: iso(), updated_at: iso() })
        .eq('id', id).eq('status', 'queued').lte('run_after', iso()).select('id, user_id, toolkit, external_id, attempts'))
      if (rows[0]) claimed.push(rows[0])
    }
    return claimed
  }

  async function process(job) {
    const attempts = job.attempts + 1
    try {
      const [account] = ok(await supabase.from('connector_accounts').select('id, status, last_error_code').eq('user_id', job.user_id).eq('toolkit', job.toolkit))
      if (account?.status !== 'active') return finish(job, { status: 'dropped', attempts, last_error_code: 'no_active_account' })
      const item = await fetchItem(read, job.user_id, job.toolkit, job.external_id)
      if (!item) return finish(job, { status: 'dropped', attempts, last_error_code: 'item_gone' })
      const result = await filterFor(job.user_id, job.toolkit, item)
      if (!result.keep) return finish(job, { status: 'dropped', attempts, last_error_code: result.reason })
      await handleItem(job.user_id, job.toolkit, result.injection ? { ...item, injection: true } : item)
      if (account.last_error_code) ok(await supabase.from('connector_accounts').update({ last_error_code: null, updated_at: iso() }).eq('id', account.id).select('id'))
      return finish(job, { status: 'done', attempts, last_error_code: null })
    } catch (err) {
      const code = err.code === 'auth' || err.code === 'paused' || err.code === 'composio' ? err.code : 'handler_error'
      log('job failed', `${job.id} ${job.toolkit} ${code}`)
      if (code === 'auth') {
        ok(await supabase.from('connector_accounts').update({ status: 'needs_reconnect', last_error_code: 'auth', updated_at: iso() }).eq('user_id', job.user_id).eq('toolkit', job.toolkit).select('id'))
        return finish(job, { status: 'dropped', attempts, last_error_code: 'auth' })
      }
      // A paused breaker is not this job's fault: wait, do not spend an attempt.
      if (code === 'paused') return finish(job, { status: 'queued', run_after: iso(clock.now() + BACKOFF_MS), last_error_code: code })
      if (code === 'composio') ok(await supabase.from('connector_accounts').update({ last_error_code: 'composio', updated_at: iso() }).eq('user_id', job.user_id).eq('toolkit', job.toolkit).select('id'))
      if (attempts >= MAX_ATTEMPTS) return finish(job, { status: 'failed', attempts, last_error_code: code })
      return finish(job, { status: 'queued', attempts, run_after: iso(clock.now() + BACKOFF_MS * 2 ** attempts), last_error_code: code })
    }
  }

  // Drains due jobs (at most `max` per run). Returns how many it processed.
  async function run(max = 50) {
    await requeueStale()
    if (breaker.isOpen()) return 0
    let n = 0
    while (n < max) {
      const jobs = await claim()
      if (!jobs.length) break
      for (const job of jobs) { await process(job); n += 1 }
    }
    return n
  }
  return { run, claim, requeueStale }
}
