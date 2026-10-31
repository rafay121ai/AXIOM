// Deleting one founder. Production path: the SQL function `delete_account`
// (supabase/DELETION_PLAN.md), one transaction. While it does not exist yet
// (PostgREST answers PGRST202) the same plan runs as steps in a safe order.
// Every step is "delete where it is this founder's", so repeating it, or two
// at once, changes nothing the second time. The request row goes last but one
// and the sign-in account last, so a failure part-way is tried again.
// The step list must match the SQL function; keep them in step.
//
// Shared outcomes: a story already published (approved) holds no name. Only
// its private link to the founder is removed, so it can never be traced back
// or taken down by the person any more. A share still waiting for review, a
// rejected one and a withdrawn one are removed with their link.
// Other founders' rows are never touched: every delete is filtered to this
// founder's id, or to ids read from this founder's own rows.
const NO_FUNCTION = 'PGRST202'
const CHUNK = 100

// Old-stack tables keyed by session, then by user. Deprecated, but they still
// hold what the founder said.
const BY_SESSION = ['messages'] // weekly_reads and personal_wiki_* are dropped by 20260930000000
const BY_USER_LATE = ['founder_lesson_log', 'care_events', 'push_tokens', 'user_settings',
  'app_sessions', 'conversation_threads', 'experiments', 'personal_memories', 'model_usage_logs', 'product_events', 'sessions']

export function createFounderDeletion({ supabase }) {
  const run = async (query) => {
    const { data, error } = await query
    if (error) throw error
    return data
  }
  const ids = async (table, column, value, pick = 'id') => (await run(supabase.from(table).select(pick).eq(column, value))).map((r) => r[pick])
  const deleteIn = async (table, column, values) => {
    for (let i = 0; i < values.length; i += CHUNK) await run(supabase.from(table).delete().in(column, values.slice(i, i + CHUNK)))
  }
  const deleteMine = (table, userId) => run(supabase.from(table).delete().eq('user_id', userId))

  async function sharedOutcomes(userId) {
    const linked = await ids('outcome_author_links', 'user_id', userId, 'peer_outcome_id')
    const unpublished = []
    for (let i = 0; i < linked.length; i += CHUNK) {
      const rows = await run(supabase.from('peer_outcomes').select('id').in('id', linked.slice(i, i + CHUNK)).neq('status', 'approved'))
      unpublished.push(...rows.map((r) => r.id))
    }
    await deleteIn('peer_outcomes', 'id', unpublished)
    await deleteMine('outcome_author_links', userId)
  }

  async function steps(userId) {
    await sharedOutcomes(userId)
    for (const table of ['peer_unlocks', 'consent_log', 'notification_log', 'reports', 'moves']) await deleteMine(table, userId)
    const conversations = await ids('learn_conversations', 'user_id', userId)
    const turns = []
    for (let i = 0; i < conversations.length; i += CHUNK) {
      const rows = await run(supabase.from('learn_turns').select('id').in('conversation_id', conversations.slice(i, i + CHUNK)))
      turns.push(...rows.map((r) => r.id))
    }
    await deleteIn('lesson_citations', 'learn_turn_id', turns)
    await deleteIn('learn_turns', 'conversation_id', conversations)
    await deleteMine('learn_conversations', userId)
    const situations = await ids('situations', 'user_id', userId)
    await deleteIn('situation_turns', 'situation_id', situations)
    await deleteIn('reads', 'situation_id', situations)
    await deleteMine('situations', userId)
    const sessions = await ids('sessions', 'user_id', userId)
    for (const table of BY_SESSION) await deleteIn(table, 'session_id', sessions)
    for (const table of BY_USER_LATE) await deleteMine(table, userId)
    await run(supabase.from('users').delete().eq('id', userId))
    await deleteMine('founder_profiles', userId)
    await deleteMine('account_requests', userId)
  }

  // True when the SQL function ran.
  async function viaFunction(userId) {
    if (typeof supabase.rpc !== 'function') return false
    const { error } = await supabase.rpc('delete_account', { p_user_id: userId })
    if (error?.code === NO_FUNCTION) return false
    if (error) throw error
    return true
  }

  // The sign-in account goes last. Already gone counts as done.
  async function removeSignIn(userId) {
    const { error } = await supabase.auth.admin.deleteUser(userId)
    if (error && error.status !== 404 && !/not found/i.test(error.message ?? '')) throw error
  }

  async function deleteFounder(userId) {
    if (!(await viaFunction(userId))) await steps(userId)
    await removeSignIn(userId)
  }

  return { deleteFounder }
}
