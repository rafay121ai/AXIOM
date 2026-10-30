// History: a plain list of past situations and a read-only page for each.
// Reads only. Nothing here writes, deletes or names a peer outcome: the
// sharing line says "shared" or "private" and nothing more.
import { HttpError } from '../situations.js'
import { sourceView } from '../learn/learn.js'
import { HISTORY_ACTIONS, STATUS_LABELS } from './wording.js'
import { HISTORY_MAX, loadStates, stageOf, statusOf } from './state.js'

export const SEARCH_MAX = 100

const one = async (query) => {
  const { data, error } = await query
  if (error) throw error
  return data
}

const notFound = () => new HttpError(404, { error: 'Not found' })

// Where the one action on the page leads. A situation that is done or paused
// has no live stage, so it goes back to its latest finished screen.
const resumeStage = (state) => stageOf(state) ?? (state.learn ? 'learn' : state.read ? 'read' : 'situation')

function actionOf(status, state, situationId) {
  const kind = status === 'open' ? 'pick_up' : status === 'paused' ? 'bring_back' : 'talk_again'
  return { kind, label: HISTORY_ACTIONS[kind], target: { stage: resumeStage(state), situation_id: situationId } }
}

export function createHistory({ supabase, clock }) {
  // A situation matches when the text is in its title, in anything the founder
  // said in it, or in the headline of its Read.
  async function matching(situations, needle) {
    const ids = situations.map((s) => s.id)
    if (ids.length === 0) return []
    const [turns, reads] = await Promise.all([
      one(supabase.from('situation_turns').select('situation_id, text, role').in('situation_id', ids)),
      one(supabase.from('reads').select('situation_id, headline').in('situation_id', ids)),
    ])
    const hit = new Set([
      ...turns.filter((t) => t.role === 'founder'),
      ...reads.map((r) => ({ situation_id: r.situation_id, text: r.headline })),
    ].filter((r) => String(r.text ?? '').toLowerCase().includes(needle)).map((r) => r.situation_id))
    return situations.filter((s) => hit.has(s.id) || (s.title ?? '').toLowerCase().includes(needle))
  }

  async function list({ userId, q = '' }) {
    const nowMs = clock.now()
    const situations = await one(supabase.from('situations').select().eq('user_id', userId)
      .order('last_activity_at', { ascending: false }).limit(HISTORY_MAX))
    const needle = q.trim().toLowerCase()
    const shown = needle ? await matching(situations, needle) : situations
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
        outcome: report.outcome, note: report.note ?? null, reply: report.reply,
        prediction: { text: report.prediction, check: report.prediction_check },
        sharing: report.share_state === 'shared' ? 'shared' : 'private',
      } : null,
      action: actionOf(status, state, situation.id),
    }
  }

  return { list, detail }
}
