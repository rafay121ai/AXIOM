// The Report: the evening check-in on a committed move. Rules enforced in code:
// - the outcome is exactly done, couldnt or didnt. Nothing here, or in any
//   route, adds a strike, a warning or removes anything;
// - a report marks the move `reported` and frees its active slot;
// - one report per move (the database keeps report.move_id unique). The row
//   is claimed before the model is called and the reply filled in after, so a
//   repeat or a double tap costs one model call and returns the stored report;
// - the prediction check is right or wrong only after Done with the founder's
//   own words, and Axiom's reply may only use numbers from what the model was
//   sent (reportChecks.js);
// - a report unlocks founder stories for the next situation (sharing.js);
// - the sharing question is asked at every report, unless the founder turned
//   on "share automatically"; a situation the care check touched is never
//   shared. Every decision is logged with its time and wording version. The
//   question versions offered with a report are stored on it; a consent may
//   only name one of them.
// Tables and columns: see ../schema_needs.md.
import { HttpError } from '../situations.js'
import { isFillerReply } from '../filler.js'
import { isUuid } from '../../writeValidation.js'
import { createMoves } from '../move/moveService.js'
import { ACTIVE_STATUSES } from '../move/room.js'
import { checkReportReply, predictionCheckFor } from './reportChecks.js'
import { REPORT_SCHEMA, reportMessages } from './prompts/report.js'
import { createSharing } from './sharing.js'
import {
  AFTER_STORY_VERSION, ALONE_VERSION, CONSENT_WORDINGS, KEPT_PRIVATE_LINE, NEED_MORE, OUTCOMES, OUTCOME_QUESTIONS,
  SHARED_LINE, SHARE_AUTO_VERSION, STORY_OFFER, WITHDRAWN_LINE, WITHDRAW_VERSION, fallbackReply, openingLine,
} from './wording.js'

// An unreported move that closed quietly can still be checked in later (an
// offline check-in is sent when the phone is back online).
const REPORTABLE = Object.freeze([...ACTIVE_STATUSES, 'closed_no_report'])
const NOTE_MIN_WORDS = 2
// A second request for a report still being written polls for the reply,
// backing off (WAIT_FIRST_MS doubling up to WAIT_MAX_STEP_MS) for about
// WAIT_TOTAL_MS before answering 409. A reply still missing after STALE_MS is
// given up on and the fixed line shows. STALE_MS is above the worst-case model
// time: compose makes up to 2 structured calls, each up to 2 attempts, each
// an OpenAI request of up to 60 s tried twice (server/index.js: timeout 60 s,
// maxRetries 1), so 8 minutes, plus margin.
const WAIT_FIRST_MS = 100
const WAIT_MAX_STEP_MS = 2000
const WAIT_TOTAL_MS = 8000
const WORST_MODEL_MS = 2 * 2 * 2 * 60 * 1000
export const STALE_MS = WORST_MODEL_MS + 2 * 60 * 1000
const realPause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const notFound = () => new HttpError(404, { error: 'Not found' })
const stillSaving = () => new HttpError(409, { error: 'This check-in is still being saved. Try again in a moment.' })

// What the app sees of the sharing state. Never a peer outcome id or link.
function sharingView(row) {
  return { state: row.share_state ?? 'pending', automatic: row.share_automatic === true, decided_at: row.share_decided_at ?? null }
}

export function reportView(row, move) {
  return {
    id: row.id,
    move_id: row.move_id,
    situation_id: row.situation_id,
    move_title: move?.title ?? null,
    outcome: row.outcome,
    note: row.note ?? null,
    reply: row.reply,
    prediction: { text: row.prediction, check: row.prediction_check },
    sharing: sharingView(row),
    created_at: row.created_at,
  }
}

// The consent question versions offered with this report. Rows from before
// the column existed offered the plain question only.
export const offeredVersions = (row) => row.consent_versions ?? [ALONE_VERSION]
const storyOfferedWith = (row) => row.share_state !== 'not_offered' && offeredVersions(row).includes(AFTER_STORY_VERSION)

function consentView(row) {
  const storyOffered = storyOfferedWith(row)
  if (row.share_state === 'asked') {
    return {
      ask: true,
      state: 'asked',
      question: { text: CONSENT_WORDINGS[ALONE_VERSION], wording_version: ALONE_VERSION },
      question_after_story: storyOffered ? { text: CONSENT_WORDINGS[AFTER_STORY_VERSION], wording_version: AFTER_STORY_VERSION } : null,
      choices: ['share', 'keep_private'],
    }
  }
  return { ask: false, ...sharingView(row) }
}

export function createReports({ supabase, callStructured, clock, log = () => {}, pause = realPause }) {
  const moves = createMoves({ supabase, callStructured, clock, log })
  const sharing = createSharing({ supabase, clock })
  const iso = () => new Date(clock.now()).toISOString()
  const one = async (query) => {
    const { data, error } = await query
    if (error) throw error
    return data
  }

  // ── Stored state ───────────────────────────────────────────────────────────

  const ownMove = async (userId, id) => {
    const row = await one(supabase.from('moves').select().eq('id', id).eq('user_id', userId).maybeSingle())
    if (!row) throw notFound()
    return row
  }
  const ownReport = async (userId, id) => {
    const row = await one(supabase.from('reports').select().eq('id', id).eq('user_id', userId).maybeSingle())
    if (!row) throw notFound()
    return row
  }
  const reportOfMove = (userId, moveId) => one(supabase.from('reports').select().eq('move_id', moveId).eq('user_id', userId).maybeSingle())
  const situationOf = (move) => one(supabase.from('situations').select().eq('id', move.situation_id).maybeSingle())

  // ── Axiom's reply ──────────────────────────────────────────────────────────

  // One model call, a second naming the problems, then the fixed line. With no
  // note there is nothing to answer, so no model call.
  const fallbackFor = ({ move, outcome, note }) => ({
    reply: fallbackReply({ outcome, title: move.title }),
    prediction_check: predictionCheckFor({ outcome, hasNote: Boolean(note) }),
  })

  async function compose({ userId, move, situation, outcome, note }) {
    const fallback = () => fallbackFor({ move, outcome, note })
    if (!note) return fallback()

    const turns = await one(supabase.from('situation_turns').select().eq('situation_id', move.situation_id).order('seq', { ascending: true }))
    const founderSaid = turns.filter((t) => t.role === 'founder' && !t.filler).map((t) => t.text)
    const input = {
      situation: { title: situation?.title ?? null, founder_said: founderSaid },
      move: { title: move.title, mission: move.mission, success: move.success_condition, prediction: move.prediction },
      outcome,
      note,
    }
    // Exactly what the model is sent: a number from anywhere else is invented.
    const knownTexts = [input.situation.title ?? '', ...founderSaid, ...Object.values(input.move), note]
    let problems = null
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      let data
      try {
        ;({ data } = await callStructured({
          step: 'report',
          schema: REPORT_SCHEMA,
          schemaName: 'report',
          maxCompletionTokens: 500,
          userId,
          usageContext: { step: 'report', outcome, situation_id: move.situation_id },
          messages: reportMessages(input, problems),
        }))
      } catch (err) {
        log('model call failed', err)
        return fallback()
      }
      const verdict = checkReportReply({ data, outcome, knownTexts })
      if (verdict.problems.length === 0) return { reply: verdict.reply, prediction_check: verdict.prediction_check }
      problems = verdict.problems
    }
    log('reply failed the checks twice', { problems })
    return fallback()
  }

  // ── After the report is stored (safe to run again) ─────────────────────────

  // Asks, shares automatically, or (care) does neither. Decided once. The
  // question versions offered (the plain one, and the one after a founder
  // story when a story fits) are stored first, once.
  async function decideSharing({ userId, row, move }) {
    const situation = await situationOf(move)
    const setFrom = async (fields) => (await one(supabase.from('reports').update({ ...fields, updated_at: iso() })
      .eq('id', row.id).eq('user_id', userId).is('share_state', null).select()))[0] ?? null

    if (await sharing.careTouched(userId, situation)) return (await setFrom({ share_state: 'not_offered' })) ?? ownReport(userId, row.id)

    if (!row.consent_versions) {
      const versions = (await sharing.findStory(userId)) ? [ALONE_VERSION, AFTER_STORY_VERSION] : [ALONE_VERSION]
      await one(supabase.from('reports').update({ consent_versions: versions, updated_at: iso() })
        .eq('id', row.id).eq('user_id', userId).is('consent_versions', null).select('id'))
      row = await ownReport(userId, row.id)
      if (row.share_state !== null) return row
    }

    if (await sharing.shareAuto(userId)) {
      // A failed automatic share asks instead; what shareOutcome left behind
      // decides, never a guess. The care check inside share() answers 409
      // after setting not_offered.
      try {
        const shared = await sharing.share({ userId, report: row, move, automatic: true, wordingVersion: SHARE_AUTO_VERSION })
        if (shared) return shared
      } catch (err) {
        log('automatic share failed', err)
      }
      const now = await ownReport(userId, row.id)
      if (now.share_state !== null) return now
    }

    const asked = await setFrom({ share_state: 'asked', consent_wording_version: ALONE_VERSION })
    if (!asked) return ownReport(userId, row.id)
    await sharing.logConsent({ userId, reportId: row.id, action: 'asked', wordingVersion: ALONE_VERSION })
    return asked
  }

  async function finish({ userId, row, move }) {
    if (REPORTABLE.includes(move.status)) {
      await one(supabase.from('moves').update({ status: 'reported', active_slot: null, updated_at: iso() })
        .eq('id', move.id).eq('user_id', userId).in('status', REPORTABLE).select('id'))
    }
    await sharing.unlock({ userId, reportId: row.id, kind: 'report' })
    const decided = row.share_state === null ? await decideSharing({ userId, row, move }) : row
    return {
      status: 'reported',
      report: reportView(decided, move),
      reply: decided.reply,
      story_offer: storyOfferedWith(decided) ? { text: STORY_OFFER } : null,
      consent: consentView(decided),
      unlock: { granted: true },
    }
  }

  // ── Public operations ──────────────────────────────────────────────────────

  // Moves waiting for a check-in. Nothing while the care screen is open.
  async function due({ userId }) {
    if (await sharing.careOpen(userId)) return { reports: [] }
    await moves.settle(userId)
    const rows = await one(supabase.from('moves').select().eq('user_id', userId).in('status', ACTIVE_STATUSES)
      .order('report_due_at', { ascending: true }))
    return {
      reports: rows.map((m) => ({
        move_id: m.id,
        title: m.title,
        due: m.status === 'report_due',
        report_due_at: m.report_due_at ?? null,
        opening: openingLine(m),
        prediction: m.prediction,
        outcomes: OUTCOMES,
        questions: OUTCOME_QUESTIONS,
      })),
    }
  }

  // A row whose reply is still being written: wait for it. One left pending
  // past STALE_MS shows the fixed line it was claimed with; a writer that
  // still finishes fills it in then (fillReply).
  async function settled(userId, row) {
    for (let waited = 0, step = WAIT_FIRST_MS; row.reply_pending && waited < WAIT_TOTAL_MS; step = Math.min(step * 2, WAIT_MAX_STEP_MS)) {
      await pause(step)
      waited += step
      row = await ownReport(userId, row.id)
    }
    if (!row.reply_pending) return row
    if (clock.now() - Date.parse(row.created_at) < STALE_MS) throw stillSaving()
    await one(supabase.from('reports').update({ reply_pending: false, updated_at: iso() })
      .eq('id', row.id).eq('user_id', userId).eq('reply_pending', true).select('id'))
    return ownReport(userId, row.id)
  }

  // Fills the claimed row with Axiom's checked reply, as long as the row still
  // holds the fixed line it was claimed with: still pending, or given up on as
  // stale (then the paid reply is not thrown away). A reply already written
  // there is the first complete one and stays.
  async function fillReply({ userId, row, move, outcome, note }) {
    const { reply, prediction_check } = await compose({ userId, move, situation: await situationOf(move), outcome, note })
    const filled = await one(supabase.from('reports').update({ reply, prediction_check, reply_pending: false, updated_at: iso() })
      .eq('id', row.id).eq('user_id', userId).eq('reply', row.reply).eq('prediction_check', row.prediction_check).select())
    return filled[0] ?? ownReport(userId, row.id)
  }

  async function report({ userId, moveId, outcome, note = null, clientTurnId }) {
    let move = await ownMove(userId, moveId)
    const stored = await reportOfMove(userId, move.id)
    if (stored) return finish({ userId, row: await settled(userId, stored), move })
    if (note && isFillerReply(note, { minWords: NOTE_MIN_WORDS })) return { status: 'need_more', reply: NEED_MORE }

    await moves.settle(userId)
    move = await ownMove(userId, moveId)
    if (!REPORTABLE.includes(move.status)) throw new HttpError(409, { error: 'This move cannot be checked in.' })

    // Claim the move's one report before any model call; the fixed line holds
    // the place until the reply is written.
    const { reply, prediction_check } = fallbackFor({ move, outcome, note })
    const inserted = await supabase.from('reports').insert({
      user_id: userId,
      move_id: move.id,
      situation_id: move.situation_id,
      outcome,
      note,
      client_turn_id: clientTurnId,
      prediction: move.prediction,
      prediction_check,
      reply,
      reply_pending: Boolean(note),
      consent_versions: null,
      share_state: null,
      share_automatic: false,
      share_decided_at: null,
      consent_wording_version: null,
      created_at: iso(),
      updated_at: iso(),
    }).select().single()
    if (inserted.error?.code === '23505') return finish({ userId, row: await settled(userId, await reportOfMove(userId, move.id)), move })
    if (inserted.error) throw inserted.error
    const row = inserted.data.reply_pending ? await fillReply({ userId, row: inserted.data, move, outcome, note }) : inserted.data
    return finish({ userId, row, move })
  }

  // The care gate stopped a note on this move: its situation is never shared.
  // When care_flag cannot be written (the column is missing, or the write
  // fails) a care event scoped to the situation is written instead, which the
  // care check also reads: sharing stays blocked either way.
  async function markCare({ userId, moveId, level }) {
    if (!isUuid(moveId)) return
    const move = await one(supabase.from('moves').select('situation_id').eq('id', moveId).eq('user_id', userId).maybeSingle())
    if (!move) return
    const flagged = await supabase.from('situations').update({ care_flag: true }).eq('id', move.situation_id).eq('user_id', userId).select('id')
    if (!flagged.error) return
    log('care flag failed', flagged.error)
    await one(supabase.from('care_events').insert({
      user_id: userId, level, scope_id: move.situation_id, created_at: iso(), resolved_at: null,
    }).select('id'))
  }

  async function get({ userId, reportId }) {
    const row = await ownReport(userId, reportId)
    return { report: reportView(row, await ownMove(userId, row.move_id)) }
  }

  // The founder story, once they said yes to seeing it. Null when none fits.
  // None for a report care closed, or while care touches its situation now.
  async function story({ userId, reportId }) {
    const row = await ownReport(userId, reportId)
    if (row.share_state === 'not_offered') return { story: null }
    const situation = await one(supabase.from('situations').select().eq('id', row.situation_id).eq('user_id', userId).maybeSingle())
    if (await sharing.careTouched(userId, situation)) return { story: null }
    return { story: await sharing.findStory(userId) }
  }

  // Share or keep private. wordingVersion: which question the founder saw;
  // only a version offered with this report counts.
  async function consent({ userId, reportId, share, wordingVersion = null }) {
    const row = await ownReport(userId, reportId)
    if (row.share_state === null) throw stillSaving()
    if (row.share_state === 'not_offered') throw new HttpError(409, { error: 'This check-in cannot be shared.' })
    if (wordingVersion && !offeredVersions(row).includes(wordingVersion)) throw new HttpError(400, { error: 'wording_version was not offered' })
    const version = wordingVersion ?? row.consent_wording_version ?? ALONE_VERSION
    const next = share
      ? await sharing.share({ userId, report: row, move: await ownMove(userId, row.move_id), automatic: false, wordingVersion: version })
      : await sharing.unshare({ userId, report: row, to: 'private', wordingVersion: version })
    const now = next ?? await ownReport(userId, reportId)
    return { consent: consentView(now), reply: now.share_state === 'shared' ? SHARED_LINE : KEPT_PRIVATE_LINE }
  }

  // Takes a share back down. Nothing to take down: the state as it is.
  async function withdraw({ userId, reportId }) {
    const row = await ownReport(userId, reportId)
    if (row.share_state !== 'shared') return { consent: consentView(row), reply: null }
    const next = await sharing.unshare({ userId, report: row, to: 'withdrawn', wordingVersion: WITHDRAW_VERSION })
    const now = next ?? await ownReport(userId, reportId)
    return { consent: consentView(now), reply: now.share_state === 'withdrawn' ? WITHDRAWN_LINE : null }
  }

  return { due, report, markCare, get, story, consent, withdraw }
}
