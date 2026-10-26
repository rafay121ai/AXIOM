// Sharing: consent, the peer outcome, the private author link, the standing
// "share automatically" setting, founder stories and the give-to-get unlock.
// Server only. Privacy rules enforced here, in code:
// - a peer_outcomes row never holds a user_id, a report id or anything that
//   points back to the founder; it starts as pending_review and nobody sees it
//   until a person approves it;
// - outcome_author_links (private) is the only thing connecting an outcome to
//   its author. It is read here to take a share down and to keep a founder's
//   own outcome out of their stories. No function returns it, nor any id from it;
// - a situation the care check touched is never shared and offers no story;
// - every share decision is written to consent_log with its time and the
//   version of the words the founder saw.
// Tables: see ../schema_needs.md.
import { SHARE_AUTO_VERSION } from './wording.js'

export function createSharing({ supabase, clock }) {
  const iso = () => new Date(clock.now()).toISOString()
  const one = async (query) => {
    const { data, error } = await query
    if (error) throw error
    return data
  }

  // ── Consent log ────────────────────────────────────────────────────────────

  // action: asked | share | auto_share | keep_private | withdraw | auto_share_on | auto_share_off
  const logConsent = ({ userId, reportId = null, action, wordingVersion }) =>
    one(supabase.from('consent_log').insert({
      user_id: userId, report_id: reportId, action, wording_version: wordingVersion, decided_at: iso(),
    }).select('id'))

  // ── Share automatically (Settings), off by default ──────────────────────────

  async function shareAuto(userId) {
    const row = await one(supabase.from('user_settings').select('share_auto').eq('user_id', userId).maybeSingle())
    return row?.share_auto === true
  }

  async function setShareAuto(userId, on) {
    if ((await shareAuto(userId)) === on) return on
    const fields = { share_auto: on, updated_at: iso() }
    const updated = await one(supabase.from('user_settings').update(fields).eq('user_id', userId).select('user_id'))
    if (updated.length === 0) {
      const inserted = await supabase.from('user_settings').insert({ user_id: userId, ...fields }).select('user_id')
      if (inserted.error?.code === '23505') await one(supabase.from('user_settings').update(fields).eq('user_id', userId).select('user_id'))
      else if (inserted.error) throw inserted.error
    }
    await logConsent({ userId, action: on ? 'auto_share_on' : 'auto_share_off', wordingVersion: SHARE_AUTO_VERSION })
    return on
  }

  // ── Care ───────────────────────────────────────────────────────────────────

  // Whether care stops sharing for this situation: a care screen still open,
  // or any care signal in this situation or since it started. Catch rather
  // than miss: a failed lookup counts as touched.
  async function careTouched(userId, situation) {
    try {
      const events = await one(supabase.from('care_events').select('level, scope_id, created_at, resolved_at').eq('user_id', userId))
      return (events ?? []).some((e) =>
        (e.level === 'clear' && !e.resolved_at)
        || (situation && (e.scope_id === situation.id || e.created_at >= situation.created_at)))
    } catch {
      return true
    }
  }

  async function careOpen(userId) {
    try {
      const open = await one(supabase.from('care_events').select('id').eq('user_id', userId).eq('level', 'clear').is('resolved_at', null).limit(1))
      return open.length > 0
    } catch {
      return true
    }
  }

  // ── Peer outcomes and the private link ─────────────────────────────────────

  // The anonymous tags a story is matched by. Coarse answers only.
  async function tagsOf(userId) {
    const p = await one(supabase.from('founder_profiles').select('stage, business_model, signup_answers').eq('user_id', userId).maybeSingle())
    const customers = p?.signup_answers?.where?.customers
    return {
      stage: p?.stage ?? null,
      business_model: p?.business_model ?? null,
      customer_market: typeof customers === 'string' ? customers : null,
    }
  }

  // Writes the pending outcome and its private link. The draft is raw material
  // for the anonymised story a person reviews; it is never shown as it is.
  async function publish({ userId, report, move }) {
    const now = iso()
    const peer = await one(supabase.from('peer_outcomes').insert({
      status: 'pending_review',
      ...(await tagsOf(userId)),
      outcome: report.outcome,
      draft: {
        move: { title: move.title, mission: move.mission, success: move.success_condition },
        prediction: report.prediction,
        prediction_check: report.prediction_check,
        note: report.note ?? null,
      },
      story: null,
      lesson: null,
      reviewed_by: null,
      reviewed_at: null,
      withdrawn_at: null,
      created_at: now,
    }).select('id').single())
    const link = await supabase.from('outcome_author_links').insert({
      peer_outcome_id: peer.id, user_id: userId, report_id: report.id, created_at: now, withdrawn_at: null,
    }).select('peer_outcome_id')
    if (link.error) {
      // An outcome nobody can take down must not exist.
      await supabase.from('peer_outcomes').delete().eq('id', peer.id)
      throw link.error
    }
  }

  // Takes every live share of this report down: the outcome keeps no content
  // and is marked withdrawn, so it can never be shown.
  async function takeDown({ userId, reportId }) {
    const now = iso()
    const links = await one(supabase.from('outcome_author_links').select('peer_outcome_id')
      .eq('report_id', reportId).eq('user_id', userId).is('withdrawn_at', null))
    for (const { peer_outcome_id: id } of links) {
      await one(supabase.from('peer_outcomes').update({ status: 'withdrawn', draft: null, story: null, lesson: null, withdrawn_at: now })
        .eq('id', id).select('id'))
      await one(supabase.from('outcome_author_links').update({ withdrawn_at: now }).eq('peer_outcome_id', id).select('peer_outcome_id'))
    }
  }

  // Moves a report's share state from `from` to `to` (compare and swap), so a
  // double tap shares or takes down once. Returns the stored row after it.
  // The words the founder saw for each decision live in consent_log;
  // reports.consent_wording_version keeps the question that was asked.
  async function claim({ userId, reportId, from, fields }) {
    const q = supabase.from('reports').update({ ...fields, updated_at: iso() }).eq('id', reportId).eq('user_id', userId)
    const won = await one((from === null ? q.is('share_state', null) : q.eq('share_state', from)).select())
    return won[0] ?? null
  }

  // Shares a report (asked or automatic). Returns the row; unchanged when it
  // was already shared.
  async function share({ userId, report, move, automatic, wordingVersion }) {
    if (report.share_state === 'shared') return report
    const won = await claim({
      userId, reportId: report.id, from: report.share_state,
      fields: { share_state: 'shared', share_automatic: automatic, share_decided_at: iso() },
    })
    if (!won) return null
    try {
      await publish({ userId, report: won, move })
    } catch (err) {
      await supabase.from('reports').update({ share_state: report.share_state, share_automatic: false, share_decided_at: report.share_decided_at ?? null })
        .eq('id', report.id).eq('share_state', 'shared')
      throw err
    }
    await logConsent({ userId, reportId: report.id, action: automatic ? 'auto_share' : 'share', wordingVersion })
    await unlock({ userId, reportId: report.id, kind: 'share' })
    return won
  }

  // Keep private, or withdraw: the share (if any) comes down first.
  async function unshare({ userId, report, to, wordingVersion }) {
    if (report.share_state === to) return report
    if (report.share_state === 'shared') await takeDown({ userId, reportId: report.id })
    const won = await claim({
      userId, reportId: report.id, from: report.share_state,
      fields: { share_state: to, share_automatic: false, share_decided_at: iso() },
    })
    if (!won) return null
    await logConsent({ userId, reportId: report.id, action: to === 'withdrawn' ? 'withdraw' : 'keep_private', wordingVersion })
    return won
  }

  // ── Give to get ────────────────────────────────────────────────────────────

  // kind 'report': a report unlocks founder stories for the next situation.
  // kind 'share': sharing opens more of them later. A flag only; the stories
  // themselves come once approved outcomes exist. Never taken away.
  async function unlock({ userId, reportId, kind }) {
    const existing = await one(supabase.from('peer_unlocks').select('id').eq('granted_by_report_id', reportId).eq('kind', kind))
    if (existing.length > 0) return
    const inserted = await supabase.from('peer_unlocks').insert({
      user_id: userId, granted_by_report_id: reportId, kind, used_on_situation_id: null, created_at: iso(),
    }).select('id')
    if (inserted.error && inserted.error.code !== '23505') throw inserted.error
  }

  // ── Founder stories ────────────────────────────────────────────────────────

  // One approved story that fits, never the founder's own. Matched by stage,
  // then customer market, then business model. Null when none: then nothing
  // is said about stories.
  async function findStory(userId) {
    const approved = await one(supabase.from('peer_outcomes').select('id, status, stage, customer_market, business_model, outcome, story, lesson')
      .eq('status', 'approved'))
    const usable = approved.filter((p) => p.status === 'approved' && typeof p.story === 'string' && p.story.trim())
    if (usable.length === 0) return null
    const own = new Set((await one(supabase.from('outcome_author_links').select('peer_outcome_id').eq('user_id', userId)))
      .map((l) => l.peer_outcome_id))
    const tags = await tagsOf(userId)
    const score = (p) => (p.stage === tags.stage ? 4 : 0) + (p.customer_market === tags.customer_market ? 2 : 0) + (p.business_model === tags.business_model ? 1 : 0)
    const best = usable.filter((p) => !own.has(p.id)).sort((a, b) => score(b) - score(a))[0]
    return best ? { story: best.story, lesson: best.lesson ?? null, outcome: best.outcome, stage: best.stage ?? null } : null
  }

  return { shareAuto, setShareAuto, careTouched, careOpen, share, unshare, unlock, findStory, logConsent }
}
