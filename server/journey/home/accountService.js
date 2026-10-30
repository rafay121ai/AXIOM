// Account: export and delete requests. Both are STUBS that record the request
// and nothing else. Deleting stays off until a deletion plan is approved
// (founder memory is sacred), so no function here deletes or changes any
// founder data. A repeated request returns the one already waiting.
import { ACCOUNT_COPY, DELETION_PLAN } from './wording.js'

const one = async (query) => {
  const { data, error } = await query
  if (error) throw error
  return data
}

export function createAccount({ supabase, clock }) {
  const waiting = (userId, kind) => one(supabase.from('account_requests').select('id, created_at')
    .eq('user_id', userId).eq('kind', kind).eq('status', 'queued').limit(1))

  // The database keeps one queued row per founder and kind; a request that
  // races another and loses (23505) returns the one already queued.
  async function request(userId, kind) {
    const queued = await waiting(userId, kind)
    if (queued.length > 0) return queued[0]
    const inserted = await supabase.from('account_requests').insert({
      user_id: userId, kind, status: 'queued', created_at: new Date(clock.now()).toISOString(),
    }).select('id, created_at')
    if (inserted.error?.code !== '23505') {
      if (inserted.error) throw inserted.error
      return inserted.data[0]
    }
    const [row] = await waiting(userId, kind)
    if (!row) throw inserted.error
    return row
  }

  async function requestExport(userId) {
    const row = await request(userId, 'export')
    return { status: 'queued', requested_at: row.created_at, message: ACCOUNT_COPY.exportQueued }
  }

  async function requestDelete(userId) {
    const row = await request(userId, 'delete')
    return { status: 'recorded', deleted: false, requested_at: row.created_at, message: ACCOUNT_COPY.deleteRecorded, plan: DELETION_PLAN }
  }

  return { requestExport, requestDelete }
}
