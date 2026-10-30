// Home: the greeting, up to 2 "left off" items, the drawer lists and the
// reports that are due. Rules enforced here:
// - while a care event is open the founder gets only the gentle check-in line
//   and nothing else; the answer to it is not stored (care text never is);
// - the greeting comes from the approved set, no model call, and is never the
//   same twice in a row (the id of the last one is kept in user_settings);
// - items say what to DO and only what is still left; nothing is a strike.
import { createMoves } from '../move/moveService.js'
import { validTimeZone } from '../move/schedule.js'
import { CARE_COPY } from '../../care/copy.js'
import { saveOwnRow } from '../../push/settings.js'
import { pickGreeting } from './greeting.js'
import { founderFirstName } from './name.js'
import { ITEM_LABELS } from './wording.js'
import { isActiveMove, loadStates, stageOf, statusOf, HISTORY_MAX } from './state.js'

export const MAX_ITEMS = 2
export const FADE_AFTER_MS = 8000
const RECENT_MAX = 5

const one = async (query) => {
  const { data, error } = await query
  if (error) throw error
  return data
}

const lowerFirst = (s) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s)
const plain = (s) => String(s ?? '').trim().replace(/[.!\s]+$/, '')
const label = (template, title) => template.replace('{title}', lowerFirst(plain(title)))

export function createHome({ supabase, care, callStructured, clock, log = () => {} }) {
  const moves = createMoves({ supabase, callStructured, clock, log })
  const iso = () => new Date(clock.now()).toISOString()

  const rememberGreeting = (userId, id) => saveOwnRow(supabase, 'user_settings', userId, { last_greeting: id, updated_at: iso() })

  const rowOf = (s, state, nowMs) => ({
    id: s.id,
    title: s.title ?? null,
    status: statusOf(s, state, nowMs),
    stage: stageOf(state),
    last_activity_at: s.last_activity_at,
  })

  // timeZone: the phone's zone, used when the founder has none saved.
  async function home({ user, timeZone = null }) {
    const userId = user.id
    if (await care.isCareOpen(userId)) {
      return { greeting: { kind: 'care_check_in', text: CARE_COPY.returnCheckIn }, care_check_in: true, items: [], fade_after_ms: FADE_AFTER_MS, drawer: { to_do: [], open: [], paused: [], recent: [] }, due_reports: [] }
    }
    const nowMs = clock.now()
    const [profile, settings, name, devices, { moves: open }] = await Promise.all([
      one(supabase.from('founder_profiles').select('timezone, deadline, signup_answers').eq('user_id', userId).maybeSingle()),
      one(supabase.from('user_settings').select('last_greeting, keep_items').eq('user_id', userId).maybeSingle()),
      founderFirstName(supabase, userId, user),
      one(supabase.from('push_tokens').select('id').eq('user_id', userId).limit(1)),
      moves.listActive({ userId }), // also settles: due moves become report_due, expired ones close
    ])
    const zone = validTimeZone(profile?.timezone) ? profile.timezone : (validTimeZone(timeZone) ? timeZone : null)
    const goalText = profile?.signup_answers?.goal?.goal ?? null

    const situations = await one(supabase.from('situations').select().eq('user_id', userId)
      .order('last_activity_at', { ascending: false }).limit(HISTORY_MAX))
    const states = await loadStates(supabase, userId, situations)
    const rows = situations.map((s) => rowOf(s, states.get(s.id), nowMs))

    // Everything still to do, most urgent first: due reports, moves, then the
    // newest unfinished situation.
    const dueMoves = open.filter((m) => isActiveMove(m) && Date.parse(m.report_due_at) <= nowMs)
    const waiting = open.filter((m) => isActiveMove(m) && Date.parse(m.report_due_at) > nowMs)
    // Items stay on screen when the founder asked for it, and the evening item
    // stays until they report when no phone can ring (reminders refused).
    const keepAll = settings?.keep_items === true
    const pushOff = devices.length === 0
    const todayOf = (m) => (m.committed_at && Date.parse(m.committed_at) > nowMs - 24 * 60 * 60 * 1000 ? ITEM_LABELS.moveToday : ITEM_LABELS.moveStill)
    const toDo = [
      ...dueMoves.map((m) => ({ kind: 'report', label: ITEM_LABELS.report, title: m.title, stays: keepAll || pushOff, target: { stage: 'report', situation_id: m.situation_id, move_id: m.id } })),
      ...waiting.map((m) => ({ kind: 'move', label: label(todayOf(m), m.title), title: m.title, stays: keepAll, target: { stage: 'move', situation_id: m.situation_id, move_id: m.id } })),
    ]
    const covered = new Set(open.map((m) => m.situation_id))
    const unfinished = rows.find((r) => r.status === 'open' && r.stage && !covered.has(r.id))
    if (unfinished) {
      toDo.push({
        kind: 'situation',
        label: unfinished.title ? label(ITEM_LABELS.situation, unfinished.title) : ITEM_LABELS.situationNoTitle,
        title: unfinished.title,
        stays: keepAll,
        target: { stage: unfinished.stage, situation_id: unfinished.id },
      })
    }

    const greeting = pickGreeting({
      nowMs, timeZone: zone, name, goal: goalText, deadline: profile?.deadline ?? null, lastId: settings?.last_greeting ?? null,
    })
    try {
      await rememberGreeting(userId, greeting.id)
    } catch (err) {
      log('greeting not remembered', err)
    }

    const listed = (r) => ({ id: r.id, title: r.title, stage: r.stage, last_activity_at: r.last_activity_at })
    return {
      greeting: { kind: greeting.kind, text: greeting.text },
      care_check_in: false,
      items: toDo.slice(0, MAX_ITEMS),
      fade_after_ms: FADE_AFTER_MS,
      reminders: { push_registered: !pushOff },
      drawer: {
        to_do: toDo,
        open: rows.filter((r) => r.status === 'open').map(listed),
        paused: rows.filter((r) => r.status === 'paused').map(listed),
        recent: rows.slice(0, RECENT_MAX).map((r) => ({ id: r.id, title: r.title, status: r.status })),
      },
      due_reports: dueMoves.map((m) => ({ move_id: m.id, situation_id: m.situation_id, title: m.title, report_due_at: m.report_due_at })),
    }
  }

  // After the founder answered the check-in (the care gate already read the answer).
  async function checkin(userId) {
    await care.resolveCare(userId)
    return { ok: true }
  }

  return { home, checkin }
}
