// The two sharing transitions, written so that a live peer outcome can never
// outlast a report that is not shared, and a share never exists without its
// consent_log row, even when taps race each other.
//
// Production path: the SQL functions `share_outcome` and `unshare_outcome`
// (../schema_needs.md), one transaction each: lock the report row, compare the
// state, write consent_log, publish or take down, set the state. supabase-js
// cannot run several statements in one transaction, so while the functions do
// not exist yet (PostgREST answers PGRST202) the same contract runs as steps in
// a safe order:
// - share: consent row, then the peer outcome and its private link, then the
//   compare-and-swap claim on reports.share_state, then a re-check. A lost
//   claim, or a state that moved on, takes its own outcome down. Any error
//   after the publish takes it down too and fails closed: a 'shared' state
//   left with nothing live goes back to what it was, so the founder is asked
//   again;
// - unshare: the claim first, then every live share of the report comes down,
//   then the consent row, then a second take-down for anything a racing share
//   published in between.
// Both return the report row after the change, or null when the state was no
// longer `from` (the caller reads the row again).

const NO_FUNCTION = 'PGRST202'

export const consentRow = ({ userId, reportId = null, action, wordingVersion, decidedAt }) =>
  ({ user_id: userId, report_id: reportId, action, wording_version: wordingVersion, decided_at: decidedAt })

const WITHDRAWN_CONTENT = Object.freeze({ status: 'withdrawn', draft: null, story: null, lesson: null })

export function createShareDb({ supabase, clock }) {
  const iso = () => new Date(clock.now()).toISOString()
  const one = async (query) => {
    const { data, error } = await query
    if (error) throw error
    return data
  }

  // { missing: true } when the SQL function does not exist yet.
  async function viaFunction(name, params) {
    if (typeof supabase.rpc !== 'function') return { missing: true }
    const { data, error } = await supabase.rpc(name, params)
    if (error?.code === NO_FUNCTION) return { missing: true }
    if (error) throw error
    return { row: (Array.isArray(data) ? data[0] : data) ?? null }
  }

  const claim = async ({ userId, reportId, from, fields }) => {
    const q = supabase.from('reports').update({ ...fields, updated_at: iso() }).eq('id', reportId).eq('user_id', userId)
    return (await one((from === null ? q.is('share_state', null) : q.eq('share_state', from)).select()))[0] ?? null
  }
  const stateOf = async (userId, reportId) =>
    (await one(supabase.from('reports').select('share_state').eq('id', reportId).eq('user_id', userId).maybeSingle()))?.share_state ?? null

  // One outcome down: no content, marked withdrawn, its link closed. Only an
  // outcome linked to this founder is touched; the link closes last, so a
  // failed step leaves it findable for the next take-down.
  async function takeDownOne({ userId, peerId, now = iso() }) {
    const mine = await one(supabase.from('outcome_author_links').select('peer_outcome_id')
      .eq('peer_outcome_id', peerId).eq('user_id', userId))
    if (mine.length === 0) return
    await one(supabase.from('peer_outcomes').update({ ...WITHDRAWN_CONTENT, withdrawn_at: now }).eq('id', peerId).select('id'))
    await one(supabase.from('outcome_author_links').update({ withdrawn_at: now })
      .eq('peer_outcome_id', peerId).eq('user_id', userId).select('peer_outcome_id'))
  }

  // Every live share of the report down.
  async function takeDownAll({ userId, reportId }) {
    const now = iso()
    const live = await one(supabase.from('outcome_author_links').select('peer_outcome_id')
      .eq('report_id', reportId).eq('user_id', userId).is('withdrawn_at', null))
    for (const { peer_outcome_id: peerId } of live) await takeDownOne({ userId, peerId, now })
  }

  // A new outcome that never became a share: removed (its link goes with it);
  // when that fails it is emptied and withdrawn, and when even that fails the
  // error says so. An outcome nobody can take down must not stay live.
  async function discard(id, now = iso()) {
    const removed = await supabase.from('peer_outcomes').delete().eq('id', id).select('id')
    if (!removed.error) return
    const emptied = await supabase.from('peer_outcomes').update({ ...WITHDRAWN_CONTENT, withdrawn_at: now }).eq('id', id).select('id')
    if (emptied.error) throw new Error(`peer outcome ${id} could not be removed or withdrawn: ${emptied.error.message}`)
  }

  // The pending outcome and its private link. When the link cannot be written
  // the outcome is discarded.
  async function publish({ userId, reportId, peer }) {
    const now = iso()
    const { id } = await one(supabase.from('peer_outcomes').insert({ ...peer, withdrawn_at: null, created_at: now }).select('id').single())
    const link = await supabase.from('outcome_author_links').insert({
      peer_outcome_id: id, user_id: userId, report_id: reportId, created_at: now, withdrawn_at: null,
    }).select('peer_outcome_id')
    if (!link.error) return id
    await discard(id, now)
    throw link.error
  }

  // Whether any outcome of the report is still live.
  async function anyLive(userId, reportId) {
    const ids = (await one(supabase.from('outcome_author_links').select('peer_outcome_id')
      .eq('report_id', reportId).eq('user_id', userId).is('withdrawn_at', null))).map((l) => l.peer_outcome_id)
    if (ids.length === 0) return false
    return (await one(supabase.from('peer_outcomes').select('id').in('id', ids).neq('status', 'withdrawn'))).length > 0
  }

  // A share that did not complete: its outcome comes down. After an error, a
  // 'shared' state with nothing live left goes back to `from` (fails closed:
  // the founder is asked again); a share another tap completed stays.
  async function undoShare({ userId, reportId, from, peerId, failed }) {
    try {
      await takeDownOne({ userId, peerId })
    } catch {
      await discard(peerId)
    }
    if (failed && !(await anyLive(userId, reportId))) {
      await claim({ userId, reportId, from: 'shared', fields: { share_state: from, share_automatic: false } })
    }
  }

  async function shareSteps({ userId, reportId, from, automatic, action, wordingVersion, peer }) {
    await one(supabase.from('consent_log').insert(consentRow({ userId, reportId, action, wordingVersion, decidedAt: iso() })).select('id'))
    const peerId = await publish({ userId, reportId, peer })
    let kept = false
    let failed = true
    try {
      const won = await claim({ userId, reportId, from, fields: { share_state: 'shared', share_automatic: automatic, share_decided_at: iso() } })
      kept = Boolean(won) && (await stateOf(userId, reportId)) === 'shared'
      failed = false
      return kept ? won : null
    } finally {
      if (!kept) await undoShare({ userId, reportId, from, peerId, failed })
    }
  }

  async function unshareSteps({ userId, reportId, from, to, action, wordingVersion }) {
    const won = await claim({ userId, reportId, from, fields: { share_state: to, share_automatic: false, share_decided_at: iso() } })
    if (!won) return null
    await takeDownAll({ userId, reportId })
    if (action) await one(supabase.from('consent_log').insert(consentRow({ userId, reportId, action, wordingVersion, decidedAt: iso() })).select('id'))
    if ((await stateOf(userId, reportId)) !== 'shared') await takeDownAll({ userId, reportId })
    return won
  }

  // peer: the peer_outcomes fields (no user id, nothing pointing back).
  async function shareOutcome(args) {
    const { userId, reportId, from, automatic, action, wordingVersion, peer } = args
    const fn = await viaFunction('share_outcome', {
      p_user_id: userId, p_report_id: reportId, p_from: from, p_automatic: automatic,
      p_action: action, p_wording_version: wordingVersion, p_peer: peer, p_now: iso(),
    })
    return fn.missing ? shareSteps(args) : fn.row
  }

  // action null: no consent row (the care check closing sharing, not the founder).
  async function unshareOutcome(args) {
    const { userId, reportId, from, to, action, wordingVersion } = args
    const fn = await viaFunction('unshare_outcome', {
      p_user_id: userId, p_report_id: reportId, p_from: from, p_to: to,
      p_action: action, p_wording_version: wordingVersion, p_now: iso(),
    })
    return fn.missing ? unshareSteps(args) : fn.row
  }

  return { shareOutcome, unshareOutcome }
}
