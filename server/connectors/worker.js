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

// Text of a Gmail payload: text/plain parts first, else text/html with tags stripped. null when there is none.
function payloadText(payload) {
  const parts = []
  const walk = (p) => { if (!p) return; if (p.body?.data && p.mimeType) parts.push(p); (p.parts ?? []).forEach(walk) }
  walk(payload)
  const decode = (p) => Buffer.from(p.body.data, 'base64url').toString('utf8')
  const plain = parts.filter((p) => p.mimeType === 'text/plain').map(decode).join('\n')
  if (plain) return plain
  const html = parts.filter((p) => p.mimeType === 'text/html').map(decode).join('\n')
  return html ? html.replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ') : null
}

// Composio's shapes are read tolerantly; what the filter needs is normalised here.
async function fetchItem(read, userId, toolkit, jobExternalId) {
  const [id] = jobExternalId.split('|')
  if (toolkit === 'gmail') {
    const d = await read(userId, 'GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID', { message_id: id, format: 'full' })
    const body = d.messageText || d.body || payloadText(d.payload) || ''
    // Content we could not read (an undecoded attachment or part) cannot be cleared by the sensitive scan.
    const hasContent = (d.payload?.parts?.length ?? 0) > 0 || (d.payload?.body?.size ?? 0) > 0
    return {
      id, threadId: d.threadId, textUnavailable: !body && hasContent,
      labels: d.labelIds ?? [], from: d.sender ?? header(d, 'from') ?? '', subject: d.subject ?? header(d, 'subject') ?? '',
      body, bulk: Boolean(header(d, 'list-unsubscribe')),
    }
  }
  if (toolkit === 'googlecalendar') {
    const d = await read(userId, 'GOOGLECALENDAR_EVENTS_GET', { calendar_id: 'primary', event_id: id })
    const e = d.event ?? d
    return e.id ? e : null
  }
  const page = await read(userId, 'NOTION_RETRIEVE_PAGE', { page_id: id })
  const md = await read(userId, 'NOTION_GET_PAGE_MARKDOWN', { page_id: id })
  const markdown = typeof md === 'string' ? md : (md.markdown ?? md.content ?? md.text)
  const title = page.title ?? page.properties?.title?.title?.[0]?.plain_text ?? page.properties?.Name?.title?.[0]?.plain_text ?? ''
  return { id, ...page, title, body: typeof markdown === 'string' ? markdown : '', textUnavailable: typeof markdown !== 'string' }
}

export function createWorker({ supabase, read, breaker, clock, blocked = async () => false, handleItem = defaultHandleItem, log = (what, info) => console.error(`[Connectors] ${what}`, info ?? '') }) {
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
      return { ...result, repliedTo: ctx.repliedTo === true }
    }
    return result
  }

  // Only the run that holds the lock may finish the job: a late finish of a requeued job changes nothing.
  const finish = async (job, patch) => ok(await supabase.from('connector_jobs').update({ locked_at: null, updated_at: iso(), ...patch }).eq('id', job.id).eq('status', 'running').eq('locked_at', job.locked_at).select('id'))

  // Stale running jobs (a crashed worker) go back to queued, or to failed when out of attempts.
  async function requeueStale() {
    const stale = (patch) => supabase.from('connector_jobs').update({ locked_at: null, updated_at: iso(), ...patch }).eq('status', 'running').lt('locked_at', iso(clock.now() - STALE_LOCK_MS))
    ok(await stale({ status: 'queued' }).lt('attempts', MAX_ATTEMPTS).select('id'))
    ok(await stale({ status: 'failed', last_error_code: 'stale_lock' }).gte('attempts', MAX_ATTEMPTS).select('id'))
  }

  async function claim() {
    const due = ok(await supabase.from('connector_jobs').select('id, attempts').eq('status', 'queued').lte('run_after', iso()).order('run_after').limit(BATCH))
    const claimed = []
    for (const { id, attempts } of due) {
      // Conditional on status and attempts: a second worker's update matches no row. The attempt is counted now, so a job
      // that hangs or crashes and is requeued as stale still reaches the dead letter.
      const rows = ok(await supabase.from('connector_jobs').update({ status: 'running', locked_at: iso(), attempts: attempts + 1, updated_at: iso() })
        .eq('id', id).eq('status', 'queued').eq('attempts', attempts).lte('run_after', iso()).select('id, user_id, toolkit, external_id, attempts, locked_at, created_at'))
      if (rows[0]) claimed.push(rows[0])
    }
    return claimed
  }

  const accountOf = async (job) => ok(await supabase.from('connector_accounts').select('id, status, last_error_code').eq('user_id', job.user_id).eq('toolkit', job.toolkit))[0]
  const isBlocked = (userId) => blocked(userId).catch(() => true) // cannot tell: wait

  async function process(job) {
    const attempts = job.attempts // already counted at claim
    try {
      // A founder with a deletion request or an open care event: nothing is read until it clears. No attempt is spent.
      if (await isBlocked(job.user_id)) return finish(job, { status: 'queued', attempts: attempts - 1, run_after: iso(clock.now() + 60 * 60 * 1000), last_error_code: 'founder_paused' })
      const account = await accountOf(job)
      if (account?.status !== 'active') return finish(job, { status: 'dropped', last_error_code: 'no_active_account' })
      const item = await fetchItem(read, job.user_id, job.toolkit, job.external_id)
      if (!item) return finish(job, { status: 'dropped', last_error_code: 'item_gone' })
      const result = await filterFor(job.user_id, job.toolkit, item)
      if (!result.keep) return finish(job, { status: 'dropped', last_error_code: result.reason })
      // The founder may have disconnected while we read: check again right before anything is written.
      if ((await accountOf(job))?.status !== 'active') return finish(job, { status: 'dropped', last_error_code: 'no_active_account' })
      await handleItem(job.user_id, job.toolkit, result.injection ? { ...item, injection: true } : item, { repliedTo: result.repliedTo === true, createdAt: Date.parse(job.created_at) || null })
      if (account.last_error_code) ok(await supabase.from('connector_accounts').update({ last_error_code: null, updated_at: iso() }).eq('id', account.id).select('id'))
      return finish(job, { status: 'done', last_error_code: null })
    } catch (err) {
      // The founder's connector budget for the day is spent: wait for the day it resets, or drop an item that would be stale by then.
      if (err.code === 'over_budget') {
        return err.retryAt ? finish(job, { status: 'queued', attempts: attempts - 1, run_after: iso(err.retryAt), last_error_code: 'over_budget' }) : finish(job, { status: 'dropped', last_error_code: 'over_budget' })
      }
      const code = ['auth', 'paused', 'composio', 'gone'].includes(err.code) ? err.code : 'handler_error'
      log('job failed', `${job.id} ${job.toolkit} ${code}`)
      if (code === 'gone') return finish(job, { status: 'dropped', last_error_code: 'item_gone' })
      if (code === 'auth') {
        ok(await supabase.from('connector_accounts').update({ status: 'needs_reconnect', last_error_code: 'auth', updated_at: iso() }).eq('user_id', job.user_id).eq('toolkit', job.toolkit).select('id'))
        return finish(job, { status: 'dropped', last_error_code: 'auth' })
      }
      // A paused breaker is not this job's fault: wait, do not spend an attempt.
      if (code === 'paused') return finish(job, { status: 'queued', attempts: attempts - 1, run_after: iso(clock.now() + BACKOFF_MS), last_error_code: code })
      if (code === 'composio') ok(await supabase.from('connector_accounts').update({ last_error_code: 'composio', updated_at: iso() }).eq('user_id', job.user_id).eq('toolkit', job.toolkit).select('id'))
      if (attempts >= MAX_ATTEMPTS) return finish(job, { status: 'failed', last_error_code: code })
      return finish(job, { status: 'queued', run_after: iso(clock.now() + BACKOFF_MS * 2 ** attempts), last_error_code: code })
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
      for (const job of jobs) {
        try { await process(job) } catch (err) { log('job update failed', `${job.id} ${err?.code ?? ''}`) } // the lock expires; requeueStale retries
        n += 1
      }
    }
    return n
  }
  return { run, claim, requeueStale }
}
