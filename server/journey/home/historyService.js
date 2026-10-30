// History: a plain list of past situations and a read-only page for each.
// Reads only. Nothing here writes, deletes or names a peer outcome: the
// sharing line says "shared" or "private" and nothing more.
import { HttpError } from '../situations.js'
import { sourceView } from '../learn/learn.js'
import { HISTORY_ACTIONS, STATUS_LABELS } from './wording.js'
import { HISTORY_MAX, isActiveMove, loadStates, stageOf, statusOf } from './state.js'

export const SEARCH_MAX = 100
// The most matching founder turns read for one search.
export const SEARCH_HITS_MAX = 1000

// An ILIKE pattern for "contains q": \ % _ are escaped; PostgREST reads * as a
// wildcard and cannot escape it, so * matches any one character.
export const containsPattern = (q) => `%${q.replace(/[\\%_]/g, '\\$&').replace(/\*/g, '_')}%`

const one = async (query) => {
  const { data, error } = await query
  if (error) throw error
  return data
}

const notFound = () => new HttpError(404, { error: 'Not found' })

// Where the one action on the page leads. A situation that is done or paused
// has no live stage, so it goes back to its latest finished screen. move_id is
// there when the situation has a committed or due move, so the app can open it.
const resumeStage = (state) => stageOf(state) ?? (state.learn ? 'learn' : state.read ? 'read' : 'situation')

function actionOf(status, state, situationId) {
  const kind = status === 'open' ? 'pick_up' : status === 'paused' ? 'bring_back' : 'talk_again'
  const target = { stage: resumeStage(state), situation_id: situationId }
  if (isActiveMove(state.move)) target.move_id = state.move.id
  return { kind, label: HISTORY_ACTIONS[kind], target }
}

export function createHistory({ supabase, clock }) {
  // A situation matches when the text is in its title, in anything the founder
  // said in it, or in the headline of its Read. The matching runs in the
  // database (ILIKE, escaped), over this founder's situations only; no turn
  // text is loaded to search it.
  async function matching(userId, situations, q) {
    const ids = situations.map((s) => s.id)
    if (ids.length === 0) return []
    const pattern = containsPattern(q)
    const [titles, turns, reads] = await Promise.all([
      one(supabase.from('situations').select('id').eq('user_id', userId).in('id', ids).ilike('title', pattern)),
      one(supabase.from('situation_turns').select('situation_id').in('situation_id', ids).eq('role', 'founder')
        .ilike('text', pattern).limit(SEARCH_HITS_MAX)),
      one(supabase.from('reads').select('situation_id').in('situation_id', ids).ilike('headline', pattern)),
    ])
    const hit = new Set([...titles.map((r) => r.id), ...turns.map((r) => r.situation_id), ...reads.map((r) => r.situation_id)])
    return situations.filter((s) => hit.has(s.id))
  }

  async function list({ userId, q = '' }) {
    const nowMs = clock.now()
    const situations = await one(supabase.from('situations').select().eq('user_id', userId)
      .order('last_activity_at', { ascending: false }).limit(HISTORY_MAX))
    const shown = q.trim() ? await matching(userId, situations, q.trim()) : situations
    const states = await loadStates(supabase, userId, shown)
    return {
      items: shown.map((s) => {
        const status = statusOf(s, states.get(s.id), nowMs)
        return { id: s.id, title: s.title ?? null, status, status_label: STATUS_LABELS[status], last_activity_at: s.last_activity_at }
      }),
    }
  }

  async function detail({ userId, situationId }) {
    const nowMs = clock.now()
    const situation = await one(supabase.from('situations').select().eq('id', situationId).eq('user_id', userId).maybeSingle())
    if (!situation) throw notFound()
    const state = (await loadStates(supabase, userId, [situation])).get(situation.id)
    const status = statusOf(situation, state, nowMs)
    const { read, learn, move, report } = state

    let learned = null
    if (learn) {
      const turns = (await one(supabase.from('learn_turns').select().eq('conversation_id', learn.id)
        .order('seq', { ascending: true }))).filter((t) => t.role === 'axiom')
      const sources = new Map()
      for (const t of turns) for (const s of (t.sources ?? []).map(sourceView)) sources.set(`${s.author}|${s.book}|${s.quote ?? ''}`, s)
      const lesson = turns.find((t) => t.kind === 'lesson') ?? turns[0]
      if (lesson) learned = { text: lesson.text, sources: [...sources.values()] }
    }

    return {
      id: situation.id,
      title: situation.title ?? null,
      status,
      status_label: STATUS_LABELS[status],
      what_i_read: read ? {
        headline: read.headline, body: read.body, closing_question: read.closing_question,
        your_answer: read.skipped === true ? null : read.closing_answer ?? null,
      } : null,
      what_you_learned: learned,
      your_move: move ? { title: move.title, mission: move.mission, success: move.success_condition } : null,
      how_it_went: report ? {
        report_id: report.id, outcome: report.outcome, note: report.note ?? null, reply: report.reply,
        prediction: { text: report.prediction, check: report.prediction_check },
        sharing: report.share_state === 'shared' ? 'shared' : 'private',
      } : null,
      action: actionOf(status, state, situation.id),
    }
  }

  return { list, detail }
}
