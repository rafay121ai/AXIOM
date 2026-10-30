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
  async function request(userId, kind) {
    const waiting = await one(supabase.from('account_requests').select('id, created_at').eq('user_id', userId).eq('kind', kind).eq('status', 'queued').limit(1))
    if (waiting.length > 0) return waiting[0]
    const rows = await one(supabase.from('account_requests').insert({
      user_id: userId, kind, status: 'queued', created_at: new Date(clock.now()).toISOString(),
    }).select('id, created_at'))
    return rows[0]
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
