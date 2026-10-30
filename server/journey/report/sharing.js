// Sharing: consent, the peer outcome, the private author link, the standing
// "share automatically" setting, founder stories and the give-to-get unlock.
// Server only. Privacy rules enforced here, in code:
// - a peer_outcomes row never holds a user_id, a report id or anything that
//   points back to the founder; it starts as pending_review and nobody sees it
//   until a person approves it;
// - outcome_author_links (private) is the only thing connecting an outcome to
//   its author. It is read here and in shareDb.js to take a share down and to
//   keep a founder's own outcome out of their stories. No function returns it, nor any id from it;
// - a situation the care check touched is never shared and offers no story;
//   share() checks it on every path;
// - every share decision is written to consent_log with its time and the
//   version of the words the founder saw; a share never exists without it;
// - the share and unshare transitions themselves live in shareDb.js.
// Tables: see ../schema_needs.md.
import { HttpError } from '../situations.js'
import { consentRow, createShareDb } from './shareDb.js'
import { SHARE_AUTO_VERSION } from './wording.js'

// The most approved outcomes read for one story pick.
export const STORY_CAP = 20

const careStopped = () => new HttpError(409, { error: 'This check-in cannot be shared.' })

export function createSharing({ supabase, clock, db = createShareDb({ supabase, clock }) }) {
  const iso = () => new Date(clock.now()).toISOString()
  const one = async (query) => {
    const { data, error } = await query
    if (error) throw error
    return data
  }

  // ── Consent log ────────────────────────────────────────────────────────────

  // action: asked | share | auto_share | keep_private | withdraw | auto_share_on | auto_share_off
  const logConsent = ({ userId, reportId = null, action, wordingVersion }) =>
    one(supabase.from('consent_log').insert(consentRow({ userId, reportId, action, wordingVersion, decidedAt: iso() })).select('id'))

  // ── Share automatically (Settings), off by default ──────────────────────────

  async function shareAuto(userId) {
    const row = await one(supabase.from('user_settings').select('share_auto').eq('user_id', userId).maybeSingle())
    return row?.share_auto === true
  }

  // The consent row is written first: if it cannot be, the setting is not changed.
  async function setShareAuto(userId, on) {
    if ((await shareAuto(userId)) === on) return on
    await logConsent({ userId, action: on ? 'auto_share_on' : 'auto_share_off', wordingVersion: SHARE_AUTO_VERSION })
    const fields = { share_auto: on, updated_at: iso() }
    const updated = await one(supabase.from('user_settings').update(fields).eq('user_id', userId).select('user_id'))
    if (updated.length === 0) {
      const inserted = await supabase.from('user_settings').insert({ user_id: userId, ...fields }).select('user_id')
      if (inserted.error?.code === '23505') await one(supabase.from('user_settings').update(fields).eq('user_id', userId).select('user_id'))
      else if (inserted.error) throw inserted.error
    }
    return on
  }

  // ── Care ───────────────────────────────────────────────────────────────────

  // Whether care stops sharing for this situation: a care screen still open,
  // any care signal in this situation or since it started, or the situation's
  // care_flag (set when the care gate stopped a note here, in case its event
  // was not recorded). Catch rather than miss: a missing situation or a failed
  // lookup counts as touched.
  async function careTouched(userId, situation) {
    if (!situation || situation.care_flag === true) return true
    try {
      const events = await one(supabase.from('care_events').select('level, scope_id, created_at, resolved_at').eq('user_id', userId))
      return (events ?? []).some((e) =>
        (e.level === 'clear' && !e.resolved_at)
        || e.scope_id === situation.id || e.created_at >= situation.created_at)
    } catch {
      return true
    }
  }

  // Care began after a share: every shared report of the founder comes down
  // and becomes not_offered. A care signal touches every situation started
  // before it (careTouched), so this is all of them. No consent row: care
  // closed it, not the founder.
  async function takeDownForCare(userId) {
    const shared = await one(supabase.from('reports').select('id').eq('user_id', userId).eq('share_state', 'shared'))
    for (const { id } of shared) {
      await db.unshareOutcome({ userId, reportId: id, from: 'shared', to: 'not_offered', action: null, wordingVersion: null })
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

  // The pending outcome. The draft is raw material for the anonymised story a
  // person reviews; it is never shown as it is.
  async function peerOf({ userId, report, move }) {
    return {
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
    }
  }

  // Shares a report (asked, automatic, or again after a withdraw). Returns the
  // row; unchanged when it was already shared; null when the state moved on.
  // The care check runs here every time: when it touched the situation the
  // report becomes not_offered and nothing is shared (409).
  async function share({ userId, report, move, automatic, wordingVersion }) {
    if (report.share_state === 'shared') return report
    const situation = await one(supabase.from('situations').select().eq('id', report.situation_id).eq('user_id', userId).maybeSingle())
    if (await careTouched(userId, situation)) {
      await db.unshareOutcome({ userId, reportId: report.id, from: report.share_state, to: 'not_offered', action: null, wordingVersion: null })
      throw careStopped()
    }
    const won = await db.shareOutcome({
      userId, reportId: report.id, from: report.share_state, automatic,
      action: automatic ? 'auto_share' : 'share', wordingVersion, peer: await peerOf({ userId, report, move }),
    })
    if (won) await unlock({ userId, reportId: report.id, kind: 'share' })
    return won
  }

  // Keep private, or withdraw. Any live share comes down after the claim.
  async function unshare({ userId, report, to, wordingVersion }) {
    if (report.share_state === to) return report
    return db.unshareOutcome({
      userId, reportId: report.id, from: report.share_state, to, action: to === 'withdrawn' ? 'withdraw' : 'keep_private', wordingVersion,
    })
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

  // One approved story that fits, never the founder's own. Same stage first,
  // then any stage; within that, customer market then business model. The
  // query excludes the founder's own outcomes and reads at most STORY_CAP.
  // Null when none: then nothing is said about stories.
  async function findStory(userId) {
    const own = (await one(supabase.from('outcome_author_links').select('peer_outcome_id').eq('user_id', userId)))
      .map((l) => l.peer_outcome_id)
    const tags = await tagsOf(userId)
    const score = (p) => (p.customer_market === tags.customer_market ? 2 : 0) + (p.business_model === tags.business_model ? 1 : 0)
    const pick = async (stage) => {
      let q = supabase.from('peer_outcomes').select('id, stage, customer_market, business_model, outcome, story, lesson').eq('status', 'approved')
      if (own.length > 0) q = q.not('id', 'in', `(${own.join(',')})`)
      if (stage) q = q.eq('stage', stage)
      const found = await one(q.order('reviewed_at', { ascending: false }).limit(STORY_CAP))
      return found.filter((p) => typeof p.story === 'string' && p.story.trim()).sort((a, b) => score(b) - score(a))[0] ?? null
    }
    const best = (tags.stage && (await pick(tags.stage))) || (await pick(null))
    return best ? { story: best.story, lesson: best.lesson ?? null, outcome: best.outcome, stage: best.stage ?? null } : null
  }

  return { shareAuto, setShareAuto, careTouched, careOpen, takeDownForCare, share, unshare, unlock, findStory, logConsent }
}
