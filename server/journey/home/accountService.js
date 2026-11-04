// Account: the delete request, its 7-day grace period, and the deletion itself
// (accountDelete.js). Deleting is OFF unless ACCOUNT_DELETE=on: then a request
// is only recorded and nothing is removed. Founder memory is sacred, so a
// deletion starts only from a typed confirmation, waits out the grace period,
// and a founder in distress is never blocked from it.
// account_requests (kind 'delete') status: queued (switch off, recorded only),
// pending (grace period running), deleting (claimed), cancelled.
import { HttpError } from '../situations.js'
import { createFounderDeletion, DeletionError } from './accountDelete.js'
import { ACCOUNT_COPY, DELETION_PLAN } from './wording.js'

export const GRACE_MS = 7 * 24 * 60 * 60 * 1000
export const DELETE_CHECK_MS = 60 * 60 * 1000

const one = async (query) => {
  const { data, error } = await query
  if (error) throw error
  return data
}

export const day = (iso) => new Date(iso).toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' })

export function createAccount({ supabase, clock, deleteOn = false, log = () => {} }) {
  const iso = (ms = clock.now()) => new Date(ms).toISOString()
  const deletion = createFounderDeletion({ supabase })
  const waiting = (userId, status) => one(supabase.from('account_requests').select('id, created_at, delete_after')
    .eq('user_id', userId).eq('kind', 'delete').eq('status', status).limit(1))

  // The database keeps one row per founder for queued and for pending; a
  // request that races another and loses (23505) returns the one already there.
  async function record(userId, status, fields = {}) {
    const [existing] = await waiting(userId, status)
    if (existing) return existing
    const inserted = await supabase.from('account_requests').insert({
      user_id: userId, kind: 'delete', status, created_at: iso(), ...fields,
    }).select('id, created_at, delete_after')
    if (inserted.error?.code !== '23505') {
      if (inserted.error) throw inserted.error
      return inserted.data[0]
    }
    const [row] = await waiting(userId, status)
    if (!row) throw inserted.error
    return row
  }

  async function cancel(userId) {
    const hit = await one(supabase.from('account_requests').update({ status: 'cancelled' })
      .eq('user_id', userId).eq('kind', 'delete').eq('status', 'pending').select('id'))
    return hit.length > 0
      ? { status: 'cancelled', message: ACCOUNT_COPY.deleteCancelled }
      : { status: 'none', message: ACCOUNT_COPY.deleteNothingToCancel }
  }

  // What Settings shows: the day and sentence of a deletion in its grace period, else null.
  async function pending(userId) {
    if (!deleteOn) return null
    const [row] = await waiting(userId, 'pending')
    return row ? { delete_after: row.delete_after, message: ACCOUNT_COPY.deleteWaiting.replace('{date}', day(row.delete_after)) } : null
  }

  // body: { confirm: 'DELETE' } starts it; { cancel: true } stops it during the
  // grace period. careOpen only changes the tone of the answer.
  async function requestDelete(userId, body, careOpen) {
    if (body?.cancel === true) return cancel(userId)
    if (body?.confirm !== 'DELETE') throw new HttpError(400, { error: ACCOUNT_COPY.confirmNeeded })
    if (!deleteOn) {
      const row = await record(userId, 'queued')
      return {
        status: 'recorded', deleted: false, requested_at: row.created_at, plan: DELETION_PLAN,
        message: careOpen ? ACCOUNT_COPY.deleteRecordedCare : ACCOUNT_COPY.deleteRecorded,
      }
    }
    // Already being deleted: answer with that request, never a second one with a new date.
    const [deleting] = await waiting(userId, 'deleting')
    const row = deleting ?? await record(userId, 'pending', { delete_after: iso(clock.now() + GRACE_MS) })
    const text = careOpen ? ACCOUNT_COPY.deletePendingCare : ACCOUNT_COPY.deletePending
    return {
      status: 'pending_deletion', deleted: false, requested_at: row.created_at, delete_after: row.delete_after, plan: DELETION_PLAN,
      message: text.replace('{date}', day(row.delete_after)),
    }
  }

  // Deletes every founder whose grace period is over. Safe to run twice at
  // once: a deletion repeats without error, and one founder failing does not
  // stop the others.
  async function deleteDue() {
    if (!deleteOn) return 0
    const due = await one(supabase.from('account_requests').select('id, user_id')
      .eq('kind', 'delete').in('status', ['pending', 'deleting']).lte('delete_after', iso()).order('delete_after').limit(20))
    let done = 0
    for (const { id, user_id: userId } of due) {
      try {
        // The claim must hit exactly this row: a founder who cancelled since the read is not deleted.
        const claimed = await one(supabase.from('account_requests').update({ status: 'deleting' }).eq('id', id).in('status', ['pending', 'deleting']).select('id'))
        if (claimed.length !== 1) continue
        await deletion.deleteFounder(userId)
        done += 1
      } catch (err) {
        // Only our own short message is logged, never the database's: it can hold the founder's id.
        log(`deletion failed (${err instanceof DeletionError ? err.message : 'claim failed'}); it is tried again next hour`, null)
      }
    }
    return done
  }

  return { requestDelete, pending, deleteDue }
}

// Hourly check. Started by index.js only when ACCOUNT_DELETE is on. Never
// overlaps itself.
export function startDeletionLoop({ account, intervalMs = DELETE_CHECK_MS, log = (what, err) => console.error(`[Account] ${what}`, err?.message || '') }) {
  let running = false
  const run = async () => {
    if (running) return
    running = true
    try { await account.deleteDue() } catch (err) { log('deletion check failed', err) } finally { running = false }
  }
  const timer = setInterval(run, intervalMs)
  timer.unref?.()
  return { stop: () => clearInterval(timer), run }
}
