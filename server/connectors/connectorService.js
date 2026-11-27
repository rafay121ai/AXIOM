// Connectors, Phase 2: what the founder sees (reconciled with Composio), connect, disconnect, and the 30-day
// clearing of action content. Tables are server only; all access is the service-role client.
import { TOOLKITS } from './composio.js'
import { HttpError } from '../journey/situations.js'
import { expireSignals } from './signal.js'

export const COPY = {
  care: 'Connecting can wait. Come back to it when things feel steadier.',
  deleting: 'Your account is being deleted, so nothing new can be connected.',
  unknown: 'That is not something I can connect.',
  unavailable: 'That is not available yet. Try again later.',
  revokeFailed: 'I could not disconnect that just now. Nothing was removed. Try again.',
}
// Consent wording version for the switch: its line, plus the privacy page section 8 as written on Nov 27 2026.
export const LEARN_LINE = 'Learn how I work. Make every read sharper.'
export const LEARN_VERSION = 'settings-learn-how-i-work-v1+privacy-s8-2026-11-27'
const DAY = 24 * 60 * 60 * 1000
export const ACTION_KEEP_MS = 30 * DAY
export const JOB_KEEP_MS = 7 * DAY
const CALENDAR_JOB_KEEP_MS = 21 * 24 * 60 * 60 * 1000
const ENDED = ['done', 'failed', 'rejected', 'expired']

// Before the pending migration is applied the column is missing (Postgres 42703, PostgREST PGRST204): GET says false, PUT says 503.
const missingColumn = (err) => err?.code === '42703' || err?.code === 'PGRST204'
const unavailable = (err) => { throw missingColumn(err) ? new HttpError(503, { error: 'learn_unavailable', line: COPY.unavailable }) : err }
const ok = (r) => { if (r.error) throw r.error; return r.data }

export function createConnectorService({ supabase, connectors, care, pendingDeletion, clock, onFirstActive = () => {} }) {
  const iso = () => new Date(clock.now()).toISOString()
  const check = (toolkit) => { if (!TOOLKITS.includes(toolkit)) throw new HttpError(404, { error: 'unknown_connector', line: COPY.unknown }) }

  // Composio is the truth about whether the connection works. Our row follows it.
  async function list(userId) {
    const live = await connectors.status(userId)
    const rows = ok(await supabase.from('connector_accounts').select('id, toolkit, status, composio_account_id').eq('user_id', userId))
    const out = []
    for (const toolkit of TOOLKITS) {
      const { active, accountId } = live[toolkit]
      const row = rows.find((r) => r.toolkit === toolkit)
      let status = 'not_connected'
      if (active && accountId) {
        status = 'active'
        if (row?.status !== 'active' || row.composio_account_id !== accountId) {
          ok(await supabase.from('connector_accounts').upsert({ user_id: userId, toolkit, composio_account_id: accountId, status, last_error_code: null, updated_at: iso() }, { onConflict: 'user_id,toolkit' }).select('id'))
          // The first time a tool is active: a bounded backfill, in the background. The poller covers a failure.
          if (!row) Promise.resolve(onFirstActive(userId, toolkit)).catch((err) => console.error('[Connectors] backfill failed', err?.code ?? ''))
        }
      } else if (row) {
        status = 'needs_reconnect'
        if (row.status !== status) ok(await supabase.from('connector_accounts').update({ status, updated_at: iso() }).eq('id', row.id).select('id'))
      }
      out.push({ toolkit, connected: status === 'active', status })
    }
    return { connectors: out, learn_how_i_work: await learnOf(userId).catch((err) => { if (missingColumn(err)) return false; throw err }) }
  }

  const learnOf = async (userId) => ok(await supabase.from('user_settings').select('learn_how_i_work').eq('user_id', userId).limit(1))[0]?.learn_how_i_work === true

  const refuseIfBlocked = async (userId) => {
    if (await care.isCareOpen(userId)) throw new HttpError(409, { error: 'care_open', line: COPY.care })
    if (await pendingDeletion(userId)) throw new HttpError(409, { error: 'account_deleting', line: COPY.deleting })
  }

  // Decision Nov 25/27 ("Learn how I work"): this only stores the choice and its consent record. The anonymous pattern tables
  // are not built yet, so the switch has no other effect. The consent row is written first: if it fails, the setting does not change.
  async function setLearn(userId, on) {
    if (typeof on !== 'boolean') throw new HttpError(400, { error: 'bad_request', line: 'on must be true or false' })
    await refuseIfBlocked(userId)
    const current = await learnOf(userId).catch(unavailable)
    if (current === on) return { learn_how_i_work: on }
    ok(await supabase.from('consent_log').insert({ user_id: userId, report_id: null, action: on ? 'learn_on' : 'learn_off', wording_version: LEARN_VERSION, decided_at: iso() }).select('id')) // a CHECK not yet widened fails here, before the setting changes
    const fields = { learn_how_i_work: on, updated_at: iso() }
    if (ok(await supabase.from('user_settings').update(fields).eq('user_id', userId).select('user_id')).length === 0) {
      const ins = await supabase.from('user_settings').insert({ user_id: userId, ...fields }).select('user_id')
      if (ins.error?.code === '23505') ok(await supabase.from('user_settings').update(fields).eq('user_id', userId).select('user_id'))
      else if (ins.error) throw ins.error
    }
    return { learn_how_i_work: on }
  }

  // Deletes what Axiom learned from this tool: its connector evidence, then each world row left with no evidence at all.
  // A row the founder also mentioned has other evidence, so it stays. Evidence is found by the toolkit in source_key,
  // or by a signal of that toolkit that still exists (rows written before the toolkit was recorded).
  async function forget(userId, toolkit) {
    check(toolkit)
    await refuseIfBlocked(userId)
    const mine = (table) => supabase.from(table).delete().eq('user_id', userId).eq('source_kind', 'connector')
    const ids = ok(await supabase.from('signals').select('id').eq('user_id', userId).eq('toolkit', toolkit)).map((s) => s.id)
    const gone = ok(await mine('memory_evidence').eq('source_key', toolkit).select('item_table, item_id'))
    if (ids.length) gone.push(...ok(await mine('memory_evidence').in('source_id', ids).select('item_table, item_id')))
    const worldIds = [...new Set(gone.filter((e) => e.item_table === 'founder_world').map((e) => e.item_id))]
    let forgotten = 0
    for (const id of worldIds) {
      const left = ok(await supabase.from('memory_evidence').select('id').eq('user_id', userId).eq('item_table', 'founder_world').eq('item_id', id).limit(1))
      if (left.length === 0) forgotten += ok(await supabase.from('founder_world').delete().eq('user_id', userId).eq('id', id).select('id')).length
    }
    // The signals hold what_happened, which is what Axiom learned; the situations opened from them keep their own turns.
    const signals = ok(await supabase.from('signals').delete().eq('user_id', userId).eq('toolkit', toolkit).select('id'))
    return { forgotten, signals_deleted: signals.length }
  }

  async function connect(userId, toolkit) {
    check(toolkit)
    await refuseIfBlocked(userId)
    const { redirectUrl } = await connectors.connect(userId, toolkit)
    return { url: redirectUrl }
  }

  // Revoke first: if Composio fails nothing is deleted and the founder can retry.
  // Beliefs, world and evidence learned from it are kept (decision Nov 10).
  async function disconnect(userId, toolkit) {
    check(toolkit)
    try { await connectors.revoke(userId, toolkit) } catch (err) {
      console.error('[Connectors] revoke failed', err?.status ?? err?.code ?? 'none')
      throw new HttpError(502, { error: 'disconnect_failed', line: COPY.revokeFailed })
    }
    const gone = (table) => supabase.from(table).delete().eq('user_id', userId)
    ok(await gone('connector_accounts').eq('toolkit', toolkit).select('id'))
    ok(await gone('signals').eq('toolkit', toolkit).select('id'))
    ok(await gone('connector_jobs').eq('toolkit', toolkit).select('id'))
    // An approval given before a disconnect can never run after a reconnect.
    ok(await supabase.from('connector_actions').update({ status: 'expired', updated_at: iso() }).eq('user_id', userId).eq('toolkit', toolkit).in('status', ['proposed', 'approved']).select('id'))
    if (toolkit === 'gmail') ok(await gone('watch_sources').select('id'))
    return { toolkit, connected: false, status: 'not_connected' }
  }

  return { list, connect, disconnect, setLearn, forget }
}

// Decision Nov 27: the content of an action is cleared 30 days after it ends; preview and hash stay.
// Also deletes done and dropped connector_jobs after 7 days.
// Ended = done, failed, rejected or expired; the end is done_at, else updated_at.
export async function clearActionContent({ supabase, clock }) {
  const cutoff = new Date(clock.now() - ACTION_KEEP_MS).toISOString()
  const base = () => supabase.from('connector_actions').update({ args: {} }).in('status', ENDED).neq('args', '{}')
  const withDone = ok(await base().lt('done_at', cutoff).select('id'))
  const without = ok(await base().is('done_at', null).lt('updated_at', cutoff).select('id'))
  await expireSignals({ supabase, clock })
  // Finished queue rows hold no content and are only history: a week is enough.
  // Calendar polls list every event in the next 14 days each time, and the finished job is what stops an unchanged event being fetched
  // again, so calendar jobs are kept past that window (21 days) instead of a week.
  const old = (ms) => new Date(clock.now() - ms).toISOString()
  ok(await supabase.from('connector_jobs').delete().in('status', ['done', 'dropped']).neq('toolkit', 'googlecalendar').lt('updated_at', old(JOB_KEEP_MS)).select('id'))
  ok(await supabase.from('connector_jobs').delete().in('status', ['done', 'dropped']).eq('toolkit', 'googlecalendar').lt('updated_at', old(CALENDAR_JOB_KEEP_MS)).select('id'))
  return withDone.length + without.length
}

// Daily, started by index.js only when CONNECTORS is on. Never overlaps itself.
export function startActionClearing({ supabase, clock, intervalMs = DAY, log = (what, err) => console.error(`[Connectors] ${what}`, err?.message || '') }) {
  let running = false
  const run = async () => {
    if (running) return
    running = true
    try { await clearActionContent({ supabase, clock }) } catch (err) { log('action clearing failed', err) } finally { running = false }
  }
  const timer = setInterval(run, intervalMs)
  timer.unref?.()
  run()
  return { stop: () => clearInterval(timer), run }
}
