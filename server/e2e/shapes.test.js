// The response shapes the Expo app's http client relies on
// (app/src/api/http.ts and app/src/api/types.ts). One short walk through the
// real createApp collects a response for every call the app makes; each is
// checked against the fields the app reads, so a server change that the app
// would trip over fails here first. Extra fields are allowed; missing or
// differently typed ones are not.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { after, before, test } from 'node:test'
import { QUESTION_KEYS } from '../journey/questions.js'
import { createWorld } from './harness.js'
import {
  FIRST_READING, FOLLOWUP_ANSWER, FULL_ANSWERS, LEARN_OFFER, LEARN_REPLY_1, LESSON, MOVE, READ, READ_ANSWER, REAL_1, REAL_2,
  REPORT_NOTE, REPORT_REPLY, SITUATION_TEXT, SWAPPED_MOVE, SWAP_REASON, TURN_2, situationVerdict, uuid,
} from './script.js'

// ── Shape language ───────────────────────────────────────────────────────────
// 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null', joined by |;
// [a, b]: one of these literal values; { $array: shape, min? }; { $nullable: shape };
// { key: shape, 'key?': shape }: an object holding at least these keys.
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const TYPE_OK = {
  null: (v) => v === null, array: Array.isArray, object: isObject,
  string: (v) => typeof v === 'string', number: (v) => typeof v === 'number', boolean: (v) => typeof v === 'boolean',
}
const show = (v) => JSON.stringify(v)?.slice(0, 80)

export function problemsOf(value, shape, path = '$') {
  if (typeof shape === 'string') {
    return shape.split('|').some((t) => TYPE_OK[t](value)) ? [] : [`${path}: expected ${shape}, got ${show(value)}`]
  }
  if (Array.isArray(shape)) return shape.includes(value) ? [] : [`${path}: expected one of ${shape.map(show).join(', ')}, got ${show(value)}`]
  if (shape.$nullable) return value === null ? [] : problemsOf(value, shape.$nullable, path)
  if (shape.$array) {
    if (!Array.isArray(value)) return [`${path}: expected an array, got ${show(value)}`]
    if (value.length < (shape.min ?? 0)) return [`${path}: expected at least ${shape.min} items`]
    return value.flatMap((v, i) => problemsOf(v, shape.$array, `${path}[${i}]`))
  }
  if (!isObject(value)) return [`${path}: expected an object, got ${show(value)}`]
  return Object.entries(shape).flatMap(([k, s]) => {
    const optional = k.endsWith('?')
    const key = optional ? k.slice(0, -1) : k
    if (!Object.hasOwn(value, key)) return optional ? [] : [`${path}.${key}: missing`]
    return problemsOf(value[key], s, `${path}.${key}`)
  })
}

// ── What the app reads (types.ts names) ──────────────────────────────────────
const STAGE = ['situation', 'read', 'learn', 'move', 'report']
const OUTCOME = ['done', 'couldnt', 'didnt']
const Target = { stage: STAGE, situation_id: 'string', 'move_id?': 'string' }
const HomeItem = { kind: ['report', 'move', 'situation'], label: 'string', title: 'string|null', stays: 'boolean', target: Target }
const DrawerSituation = { id: 'string', title: 'string|null', stage: { $nullable: STAGE }, last_activity_at: 'string' }
const LearnSource = { author: 'string', book: 'string', 'quote?': 'string' }
const LearnTurn = {
  id: 'string', kind: ['lesson', 'reply', 'followup'], text: 'string', sources: { $array: LearnSource }, picture: 'object|null',
  follow_ups: { $array: 'string' }, 'for_turn_id?': 'string', 'followup_index?': 'number',
}
const MoveNotice = { kind: ['first', 'second'], kicker: 'string', text: 'string' }
const LearnReply = {
  learn_id: 'string', situation_id: 'string', status: ['reply', 'say_more'], turn: { $nullable: LearnTurn }, 'reply?': 'string',
  move_offer: ['none', 'first', 'second'], move_notice: { $nullable: MoveNotice },
}
const MoveView = {
  id: 'string', learn_id: 'string', situation_id: 'string', status: 'string', title: 'string', mission: 'string', success: 'string',
  words: 'string|null', checklist: { $array: 'string', min: 1 }, prediction: 'string', start_minutes: 'number', can_swap: 'boolean',
  swapped_from: 'string|null', committed_at: 'string|null', report_due_at: 'string|null', report_time_local: 'string|null',
  time_zone: 'string|null', created_at: 'string',
}
const ConsentQuestion = { text: 'string', wording_version: 'string' }
const ConsentAsked = { ask: [true], state: ['asked'], question: ConsentQuestion, question_after_story: { $nullable: ConsentQuestion }, choices: { $array: ['share', 'keep_private'], min: 2 } }
const ConsentSettled = { ask: [false], state: 'string', automatic: 'boolean' }
const SituationReply = {
  situation_id: 'string|null', status: ['follow_up', 'ready', 'say_more'], reply: 'string|null', follow_up_count: 'number',
  follow_ups_left: 'number', 'started_new?': 'boolean',
}
const HistoryRow = { id: 'string', title: 'string|null', status: ['open', 'done', 'couldnt', 'didnt', 'paused'], status_label: 'string', last_activity_at: 'string' }
const Settings = {
  you: { name: 'string|null', email: 'string|null', country: 'string|null', timezone: 'string|null' },
  signup_answers: 'object',
  links: { privacy: 'string|null', terms: 'string|null' },
  reminders: {
    checkin_time: 'string', morning_on: 'boolean', evening_on: 'boolean', lock_screen: ['full', 'short', 'hidden'],
    quiet_hours: { start: 'string', end: 'string' }, push_registered: 'boolean',
  },
  mentor_style: ['calm', 'direct', 'hard'], keep_items: 'boolean', pending_deletion: { $nullable: { delete_after: 'string', message: 'string' } }, privacy: { share_automatically: 'boolean', text: 'string' },
  }

const NotCare = (shape) => ({ ...shape, 'care?': ['__never__'] }) // Screened<T>: no `care` field means carry on.

export const CONTRACT = Object.freeze({
  // http.ts reads questions, answers, complete.
  getSignup: { questions: { $array: { type: 'string', key: 'string', title: 'string' }, min: 13 }, answers: 'object', complete: 'boolean' },
  // http.ts saveAnswer: only `care` decides anything.
  saveAnswer: NotCare({}),
  getFirstReading: { headline: 'string', body: 'string', underlines: { $array: 'string' } },
  'startSituation(follow_up)': NotCare(SituationReply),
  'startSituation(say_more)': NotCare({ ...SituationReply, situation_id: 'null', status: ['say_more'], reply: 'string' }),
  'sendTurn(ready)': NotCare({ ...SituationReply, status: ['ready'], reply: 'null' }),
  getSituation: {
    situation: { id: 'string', title: 'string|null', status: 'string', follow_up_count: 'number', created_at: 'string' },
    turns: { $array: { role: ['founder', 'axiom'], text: 'string', created_at: 'string' }, min: 2 },
    read: { $nullable: { headline: 'string', body: 'string', closing_question: 'string', answered: 'boolean', skipped: 'boolean' } },
  },
  getRead: { headline: 'string', body: 'string', closing_question: 'string', answered: 'boolean', skipped: 'boolean' },
  'answerRead(say_more)': NotCare({ status: ['say_more'], reply: 'string' }),
  'answerRead(stored)': NotCare({ status: ['stored'], skipped: 'boolean', next: ['learn'] }),
  startLearn: { ...LearnReply, turn: { ...LearnTurn, kind: ['lesson'], sources: { $array: LearnSource, min: 1 } } },
  tapFollowUp: { ...LearnReply, turn: { ...LearnTurn, kind: ['followup'], for_turn_id: 'string', followup_index: 'number' } },
  'sendLearnTurn(reply)': NotCare(LearnReply),
  'sendLearnTurn(offer)': NotCare({ ...LearnReply, move_offer: ['first'], move_notice: MoveNotice }),
  'sendLearnTurn(say_more)': NotCare({ ...LearnReply, status: ['say_more'], turn: 'null', reply: 'string' }),
  openMove: { move: MoveView }, // http.ts returns `.move`
  getMove: { move: MoveView }, // http.ts returns `.move`
  'swapMove(need_reason)': NotCare({ status: ['need_reason'], reply: 'string' }),
  'swapMove(swapped)': NotCare({ status: ['swapped'], replaced_id: 'string', move: MoveView }),
  commitMove: { move: MoveView, report: { due_at: 'string', local_time: 'string', time_zone: 'string' } },
  getLoadingHint: { hint: { $nullable: { book: 'string', quote: 'string' } } }, // http.ts returns `.hint`
  getDueReports: { // http.ts returns `.reports`
    reports: {
      $array: {
        move_id: 'string', title: 'string', due: 'boolean', report_due_at: 'string|null', opening: 'string', prediction: 'string',
        outcomes: { $array: OUTCOME, min: 3 }, questions: { done: 'string', couldnt: 'string', didnt: 'string' },
      },
      min: 1,
    },
  },
  'sendReport(need_more)': NotCare({ status: ['need_more'], reply: 'string' }),
  'sendReport(reported)': NotCare({
    status: ['reported'], report: { id: 'string', outcome: OUTCOME }, reply: 'string', story_offer: { $nullable: { text: 'string' } },
    consent: ConsentAsked, unlock: { granted: 'boolean' },
  }),
  getStory: { story: { $nullable: { story: 'string', lesson: 'string|null', outcome: 'string', stage: 'string|null' } } }, // http.ts returns `.story`
  setConsent: { consent: ConsentSettled, reply: 'string' },
  withdrawShare: { consent: ConsentSettled, reply: 'string|null' }, // null when nothing was shared
  getHome: {
    greeting: { kind: 'string', text: 'string' }, care_check_in: 'boolean', items: { $array: HomeItem, min: 1 }, fade_after_ms: 'number',
    drawer: { to_do: { $array: HomeItem }, open: { $array: DrawerSituation }, paused: { $array: DrawerSituation }, recent: { $array: { id: 'string', title: 'string|null', status: 'string' } } },
    due_reports: { $array: { move_id: 'string', situation_id: 'string', title: 'string|null', report_due_at: 'string' } },
  },
  'getHome(care)': { greeting: { kind: ['care_check_in'], text: 'string' }, care_check_in: [true], items: { $array: HomeItem }, fade_after_ms: 'number', drawer: 'object', due_reports: 'array' },
  sendCheckIn: NotCare({ ok: [true] }),
  getHistory: { items: { $array: HistoryRow, min: 1 } }, // http.ts returns `.items`
  getHistoryPage: {
    id: 'string', title: 'string|null', status: HistoryRow.status, status_label: 'string',
    what_i_read: { $nullable: { headline: 'string', body: 'string', closing_question: 'string', your_answer: 'string|null' } },
    what_you_learned: { $nullable: { text: 'string', sources: { $array: LearnSource } } },
    your_move: { $nullable: { title: 'string', mission: 'string', success: 'string' } },
    how_it_went: { $nullable: { report_id: 'string', outcome: OUTCOME, note: 'string|null', reply: 'string', prediction: { text: 'string', check: 'string|null' }, sharing: ['shared', 'private'] } },
    action: { kind: ['pick_up', 'bring_back', 'talk_again'], label: 'string', target: Target },
  },
  getSettings: Settings,
  updateSettings: Settings, // the whole page again
  requestExport: { message: 'string', exported_at: 'string' },
  requestDelete: { status: 'string', message: 'string' },
  cancelDelete: { status: 'string', message: 'string' },
  // Screened<T> when the care check stops a step (types.ts CareClear, CareUnclear).
  careUnclear: { care: ['unclear'], reply: 'string' },
  careClear: { care: ['clear'], message: 'string', help: { line: 'string', url: 'string' } },
  // Any non-2xx: http.ts shows body.error when it is a string.
  error: { error: 'string' },
})

// ── One walk that makes every call ───────────────────────────────────────────
const got = {}
const errors = []
let world

before(async () => {
  world = await createWorld()
  const { founder: call, openai } = world
  const keep = async (name, promise) => {
    const res = await promise
    assert.ok(res.status >= 200 && res.status < 300, `${name}: ${res.status} ${JSON.stringify(res.body)}`)
    got[name] = res.body
    return res.body
  }
  const fail = async (promise) => errors.push(await promise)
  const zone = 'Asia/Karachi'

  errors.push(await call('POST', '/api/first-reading'))
  await keep('getSignup', call('GET', '/api/signup'))
  for (const key of QUESTION_KEYS) await keep('saveAnswer', call('PUT', `/api/signup/answers/${key}`, { answer: FULL_ANSWERS[key] }))
  openai.script('first_reading', FIRST_READING)
  await keep('getFirstReading', call('POST', '/api/first-reading'))

  await keep('startSituation(say_more)', call('POST', '/api/situations', { text: 'ok', client_turn_id: uuid(1) }))
  openai.script('situation_turn', situationVerdict(), situationVerdict({ has_detail: true, missing: 'none', question: '' }))
  const sit = (await keep('startSituation(follow_up)', call('POST', '/api/situations', { text: SITUATION_TEXT, client_turn_id: uuid(2) }))).situation_id
  await keep('sendTurn(ready)', call('POST', `/api/situations/${sit}/turn`, { text: TURN_2, client_turn_id: uuid(3) }))
  await keep('getSituation', call('GET', `/api/situations/${sit}`))
  openai.script('read', READ)
  await keep('getRead', call('POST', `/api/situations/${sit}/read`))
  await keep('answerRead(say_more)', call('POST', `/api/situations/${sit}/read/answer`, { text: 'ok' }))
  await keep('answerRead(stored)', call('POST', `/api/situations/${sit}/read/answer`, { text: READ_ANSWER }))

  openai.script('learn_reply', { ...LESSON, citations: LESSON.citations.slice(0, 1) }, FOLLOWUP_ANSWER, LEARN_REPLY_1, LEARN_OFFER)
  const learn = await keep('startLearn', call('POST', `/api/situations/${sit}/learn`))
  await keep('tapFollowUp', call('POST', `/api/learn/${learn.learn_id}/followup/1`, { turn_id: learn.turn.id }))
  await keep('sendLearnTurn(say_more)', call('POST', `/api/learn/${learn.learn_id}/turn`, { text: 'ok', client_turn_id: uuid(10) }))
  await keep('sendLearnTurn(reply)', call('POST', `/api/learn/${learn.learn_id}/turn`, { text: REAL_1, client_turn_id: uuid(11) }))
  await keep('sendLearnTurn(offer)', call('POST', `/api/learn/${learn.learn_id}/turn`, { text: REAL_2, client_turn_id: uuid(12) }))

  openai.script('move', MOVE, SWAPPED_MOVE)
  const first = (await keep('openMove', call('POST', `/api/learn/${learn.learn_id}/move`))).move
  await keep('getMove', call('GET', `/api/moves/${first.id}`))
  await keep('swapMove(need_reason)', call('POST', `/api/moves/${first.id}/swap`, { reason: "I'm busy" }))
  const swapped = (await keep('swapMove(swapped)', call('POST', `/api/moves/${first.id}/swap`, { reason: SWAP_REASON }))).move
  await keep('getLoadingHint', call('GET', `/api/loading-hint?seed=${encodeURIComponent(swapped.id)}`))
  await keep('registerPushToken', call('POST', '/api/push/token', { token: 'ExponentPushToken[shape-test-0001]', platform: 'android', timezone: zone }))
  await keep('commitMove', call('POST', `/api/moves/${swapped.id}/commit`, { timezone: zone }))
  await keep('getDueReports', call('GET', '/api/reports/due'))
  await keep('getHome', call('GET', `/api/home?time_zone=${encodeURIComponent(zone)}`))

  await keep('sendReport(need_more)', call('POST', `/api/moves/${swapped.id}/report`, { outcome: 'done', note: 'ok', client_turn_id: uuid(20) }))
  openai.script('report', REPORT_REPLY)
  const report = (await keep('sendReport(reported)', call('POST', `/api/moves/${swapped.id}/report`, { outcome: 'done', note: REPORT_NOTE, client_turn_id: uuid(21) }))).report
  await keep('getStory', call('GET', `/api/reports/${report.id}/story`))
  await keep('setConsent', call('POST', `/api/reports/${report.id}/consent`, { share: false, wording_version: got['sendReport(reported)'].consent.question.wording_version }))
  await keep('withdrawShare', call('POST', `/api/reports/${report.id}/withdraw`))
  await keep('sendCheckIn', call('POST', '/api/home/checkin', { text: 'All fine, back to the clinics.' }))
  await keep('getHistory', call('GET', `/api/history?q=${encodeURIComponent('')}`))
  await keep('getHistoryPage', call('GET', `/api/history/${sit}`))
  await keep('getSettings', call('GET', '/api/settings'))
  await keep('updateSettings', call('PUT', '/api/settings', { mentor_style: 'hard', lock_screen: 'full' }))
  await keep('requestExport', call('POST', '/api/account/export', {}))
  await keep('requestDelete', call('DELETE', '/api/account', { confirm: 'DELETE' }))
  await keep('cancelDelete', call('DELETE', '/api/account', { cancel: true }))
  await keep('removePushToken', call('DELETE', '/api/push/token', { token: 'ExponentPushToken[shape-test-0001]' }))

  await fail(call('GET', `/api/moves/${uuid(77)}`))
  await fail(call('POST', '/api/situations', { text: '', client_turn_id: uuid(30) }))
  await fail(call('POST', `/api/moves/${swapped.id}/commit`, { timezone: 'Not/AZone' }))

  // Care last: it changes what home shows.
  openai.script('care_check', { level: 'unclear', reason: 'slang about the founder' })
  await keep('careUnclear', call('POST', '/api/situations', { text: 'I wanna die lol, pricing again', client_turn_id: uuid(40) }))
  await keep('careClear', call('POST', '/api/situations', { text: 'Honestly I want to end it all.', client_turn_id: uuid(41) }))
  await keep('getHome(care)', call('GET', `/api/home?time_zone=${encodeURIComponent(zone)}`))
})

after(() => world?.close())

// ── The checks ───────────────────────────────────────────────────────────────

for (const name of Object.keys(CONTRACT)) {
  test(`shape: ${name}`, () => {
    if (name === 'error') {
      assert.equal(errors.length, 4)
      for (const e of errors) {
        assert.ok(e.status >= 400, `${e.path} answered ${e.status}`)
        assert.deepEqual(problemsOf(e.body, CONTRACT.error), [], `${e.method} ${e.path}`)
      }
      return
    }
    assert.ok(Object.hasOwn(got, name), `the walk made no ${name} call`)
    assert.deepEqual(problemsOf(got[name], CONTRACT[name]), [])
  })
}

test('every call in the app\'s http client has a contract here', () => {
  const http = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../app/src/api/http.ts'), 'utf8')
  // Methods of the object createHttpApi returns, by name.
  const api = http.slice(http.indexOf('\n  return {'))
  const methods = [...api.matchAll(/^ {4}(?:async )?(\w+)(?:: |\()/gm)].map((m) => m[1])
  const local = new Set(['signInWithGoogle', 'signOut', 'isSignedIn', 'resumeUnsent']) // sign-in and the phone's own outbox, not the API
  const covered = new Set(Object.keys(CONTRACT).map((k) => k.replace(/\(.*\)$/, '')))
  covered.add('registerPushToken').add('removePushToken') // http.ts ignores the answer
  const missing = methods.filter((m) => !local.has(m) && !covered.has(m))
  assert.ok(methods.length >= 30, `read ${methods.length} methods from http.ts`)
  assert.deepEqual(missing, [])
})

test('the app talks to Supabase for sign-in only: no table, function or storage call', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '../../app/src')
  const files = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(ts|tsx|js|jsx)$/.test(name)) files.push(p)
    }
  }
  walk(root)
  const offenders = []
  for (const file of files) {
    const src = readFileSync(file, 'utf8')
    const usesSupabase = /@supabase\/supabase-js/.test(src)
    if (usesSupabase && /\.(from|rpc)\(\s*['"`]|\.storage\b|\.channel\(/.test(src)) offenders.push(relative(root, file))
    if (usesSupabase && relative(root, file) !== join('api', 'auth.ts')) offenders.push(`${relative(root, file)} imports supabase-js`)
  }
  assert.deepEqual(offenders, [])
})
