// Connectors, Phase 2: what the founder sees (reconciled with Composio), connect, disconnect, and the 30-day
// clearing of action content. Tables are server only; all access is the service-role client.
import { TOOLKITS } from './composio.js'
import { HttpError } from '../journey/situations.js'

export const COPY = {
  care: 'Connecting can wait. Come back to it when things feel steadier.',
  deleting: 'Your account is set to be deleted, so I will not connect anything new.',
  unknown: 'That is not something I can connect.',
  revokeFailed: 'I could not disconnect that just now. Nothing was removed. Try again.',
}
const DAY = 24 * 60 * 60 * 1000
export const ACTION_KEEP_MS = 30 * DAY
const ENDED = ['done', 'failed', 'rejected', 'expired']

const ok = (r) => { if (r.error) throw r.error; return r.data }

export function createConnectorService({ supabase, connectors, care, pendingDeletion, clock, onFirstActive = () => {} }) {
  const iso = () => new Date(clock.now()).toISOString()
  const check = (toolkit) => { if (!TOOLKITS.includes(toolkit)) throw new HttpError(404, { error: COPY.unknown }) }

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
    return { connectors: out }
  }

  async function connect(userId, toolkit) {
    check(toolkit)
    if (await care.isCareOpen(userId)) throw new HttpError(409, { error: COPY.care })
    if (await pendingDeletion(userId)) throw new HttpError(409, { error: COPY.deleting })
    const { redirectUrl } = await connectors.connect(userId, toolkit)
    return { url: redirectUrl }
  }

  // Revoke first: if Composio fails nothing is deleted and the founder can retry.
  // Beliefs, world and evidence learned from it are kept (decision Nov 10).
  async function disconnect(userId, toolkit) {
    check(toolkit)
    try { await connectors.revoke(userId, toolkit) } catch (err) {
      console.error('[Connectors] revoke failed', err?.status ?? err?.code ?? 'none')
      throw new HttpError(502, { error: COPY.revokeFailed })
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

  return { list, connect, disconnect }
}

// Decision Nov 27: the content of an action is cleared 30 days after it ends; preview and hash stay.
// Ended = done, failed, rejected or expired; the end is done_at, else updated_at.
export async function clearActionContent({ supabase, clock }) {
  const cutoff = new Date(clock.now() - ACTION_KEEP_MS).toISOString()
  const base = () => supabase.from('connector_actions').update({ args: {} }).in('status', ENDED).neq('args', '{}')
  const withDone = ok(await base().lt('done_at', cutoff).select('id'))
  const without = ok(await base().is('done_at', null).lt('updated_at', cutoff).select('id'))
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
