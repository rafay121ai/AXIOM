// The Report: the evening check-in on a committed move. Rules enforced in code:
// - the outcome is exactly done, couldnt or didnt. Nothing here, or in any
//   route, adds a strike, a warning or removes anything;
// - a report marks the move `reported` and frees its active slot;
// - one report per move (the database keeps report.move_id unique), so a
//   repeat or a double tap returns the stored report;
// - the prediction check is right or wrong only after Done with the founder's
//   own words, and Axiom's reply may only use numbers the founder or the move
//   gave (reportChecks.js);
// - a report unlocks founder stories for the next situation (sharing.js);
// - the sharing question is asked at every report, unless the founder turned
//   on "share automatically"; a situation the care check touched is never
//   shared. Every decision is logged with its time and wording version.
// Tables and columns: see ../schema_needs.md.
import { HttpError } from '../situations.js'
import { isFillerReply } from '../filler.js'
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

function consentView(row, storyOffered = false) {
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

export function createReports({ supabase, callStructured, clock, log = () => {} }) {
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
  async function compose({ userId, move, situation, outcome, note }) {
    const fallback = () => ({
      reply: fallbackReply({ outcome, title: move.title }),
      prediction_check: predictionCheckFor({ outcome, hasNote: Boolean(note) }),
    })
    if (!note) return fallback()

    const [turns, read] = await Promise.all([
      one(supabase.from('situation_turns').select().eq('situation_id', move.situation_id).order('seq', { ascending: true })),
      one(supabase.from('reads').select().eq('situation_id', move.situation_id).maybeSingle()),
    ])
    const founderSaid = turns.filter((t) => t.role === 'founder' && !t.filler).map((t) => t.text)
    const knownTexts = [
      ...founderSaid, read?.closing_answer ?? '', note,
      move.title, move.mission, move.success_condition, move.prediction, move.words ?? '', ...(move.checklist ?? []),
    ]
    const input = {
      situation: { title: situation?.title ?? null, founder_said: founderSaid },
      move: { title: move.title, mission: move.mission, success: move.success_condition, prediction: move.prediction },
      outcome,
      note,
    }
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

  // Asks, shares automatically, or (care) does neither. Decided once.
  async function decideSharing({ userId, row, move }) {
    const situation = await situationOf(move)
    const setFrom = async (fields) => (await one(supabase.from('reports').update({ ...fields, updated_at: iso() })
      .eq('id', row.id).eq('user_id', userId).is('share_state', null).select()))[0] ?? null

    if (await sharing.careTouched(userId, situation)) return (await setFrom({ share_state: 'not_offered' })) ?? ownReport(userId, row.id)

    if (await sharing.shareAuto(userId)) {
      try {
        const shared = await sharing.share({ userId, report: row, move, automatic: true, wordingVersion: SHARE_AUTO_VERSION })
        if (shared) return shared
      } catch (err) {
        log('automatic share failed, asking instead', err)
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
    const storyOffered = decided.share_state !== 'not_offered' && (await sharing.findStory(userId)) !== null
    return {
      status: 'reported',
      report: reportView(decided, move),
      reply: decided.reply,
      story_offer: storyOffered ? { text: STORY_OFFER } : null,
      consent: consentView(decided, storyOffered),
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

  async function report({ userId, moveId, outcome, note = null, clientTurnId }) {
    let move = await ownMove(userId, moveId)
    const stored = await reportOfMove(userId, move.id)
    if (stored) return finish({ userId, row: stored, move })
    if (note && isFillerReply(note, { minWords: NOTE_MIN_WORDS })) return { status: 'need_more', reply: NEED_MORE }

    await moves.settle(userId)
    move = await ownMove(userId, moveId)
    if (!REPORTABLE.includes(move.status)) throw new HttpError(409, { error: 'This move cannot be checked in.' })

    const { reply, prediction_check } = await compose({ userId, move, situation: await situationOf(move), outcome, note })
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
      share_state: null,
      share_automatic: false,
      share_decided_at: null,
      consent_wording_version: null,
      created_at: iso(),
      updated_at: iso(),
    }).select().single()
    if (inserted.error?.code === '23505') return finish({ userId, row: await reportOfMove(userId, move.id), move })
    if (inserted.error) throw inserted.error
    return finish({ userId, row: inserted.data, move })
  }

  async function get({ userId, reportId }) {
    const row = await ownReport(userId, reportId)
    return { report: reportView(row, await ownMove(userId, row.move_id)) }
  }

  // The founder story, once they said yes to seeing it. Null when none fits.
  async function story({ userId, reportId }) {
    const row = await ownReport(userId, reportId)
    if (row.share_state === 'not_offered') return { story: null }
    return { story: await sharing.findStory(userId) }
  }

  // Share or keep private. wordingVersion: which question the founder saw.
  async function consent({ userId, reportId, share, wordingVersion = null }) {
    const row = await ownReport(userId, reportId)
    if (row.share_state === null) throw stillSaving()
    if (row.share_state === 'not_offered') throw new HttpError(409, { error: 'This check-in cannot be shared.' })
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

  return { due, report, get, story, consent, withdraw }
}
