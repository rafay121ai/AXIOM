// Deleting one founder: the SQL function `delete_account`
// (supabase/DELETION_PLAN.md), one transaction. If the function is missing that
// is an error and deletion fails closed: nothing is removed by other means.
// Order: ban the sign-in (so nobody can sign in and write rows meanwhile),
// the data function, then the sign-in account itself. A failure at any step
// throws a DeletionError that names the step and the error code only (database
// errors can hold the founder's id, so their text is never passed on). Steps
// before the failed one are safe to repeat on the next hourly run, because the
// request row is still there. Only if the last step fails is it gone: the
// sign-in is banned and empty, so it is retried here a few times, then left
// to be removed from the Supabase dashboard.
//
// Shared outcomes: a story already published (approved) holds no name. Only
// its private link to the founder is removed (inside the SQL function), so it
// can never be traced back or taken down by the person any more.
const NO_FUNCTION = 'PGRST202'
const BAN_FOREVER = '876000h'
const SIGN_IN_TRIES = 3

export class DeletionError extends Error {}

const missing = (error) => error.status === 404 || /not found/i.test(error.message ?? '')
const fail = (step, error) => new DeletionError(`${step} failed, code ${error.code ?? error.status ?? 'none'}`)

// revokeConnections(userId) -> names of connectors Composio could not revoke (Phase 2 connectors); null when connectors are off.
export function createFounderDeletion({ supabase, revokeConnections = null }) {
  async function dataFunction(userId) {
    if (typeof supabase.rpc !== 'function') throw new DeletionError('data function missing')
    const { error } = await supabase.rpc('delete_account', { p_user_id: userId })
    if (error?.code === NO_FUNCTION) { console.error('[Account] delete_account is missing in the database; deletion is refused'); throw new DeletionError('data function missing') }
    if (error) throw fail('data step', error)
  }

  async function ban(userId) {
    const { error } = await supabase.auth.admin.updateUserById(userId, { ban_duration: BAN_FOREVER })
    if (error && !missing(error)) throw fail('ban', error)
  }

  // The sign-in account goes last. Already gone counts as done.
  async function removeSignIn(userId) {
    let last
    for (let i = 0; i < SIGN_IN_TRIES; i += 1) {
      const { error } = await supabase.auth.admin.deleteUser(userId)
      if (!error || missing(error)) return
      last = error
    }
    throw fail('sign-in removal', last)
  }

  // Before the data function, so Composio's tokens never outlive the founder. A Composio failure never
  // blocks the deletion: it is logged (toolkit names only; the founder's data is going) so Rafay can clear it by hand.
  async function revoke(userId) {
    if (!revokeConnections) return
    try {
      const failed = await revokeConnections(userId)
      if (failed.length) console.error(`[Account] Composio did not revoke: ${failed.join(', ')}; deletion continues, clear it in the Composio dashboard`)
    } catch (err) {
      console.error(`[Account] Composio revoke failed (${err?.code ?? err?.status ?? 'none'}); deletion continues, clear it in the Composio dashboard`)
    }
  }

  async function deleteFounder(userId) {
    await ban(userId)
    await revoke(userId)
    await dataFunction(userId)
    await removeSignIn(userId)
  }

  return { deleteFounder }
}
