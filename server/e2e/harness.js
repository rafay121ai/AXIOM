// The end-to-end world: the real createApp over HTTP on an ephemeral port,
// with fakes only. A scripted OpenAI answers per step (by the schema name each
// journey call sends), the in-memory Supabase holds the database's unique
// indexes, a fake clock, a fake push sender and a fake knowledge search. No
// network beyond 127.0.0.1, no env read.
import { createApp } from '../app.js'
import { createFakeClock, createFakePushSender, createFakeSupabase } from '../testing/fakes.js'
import { createNameLookup, createPushScheduler } from '../push/scheduler.js'
import { KNOWLEDGE_ROWS, PEER_STORY, uuid } from './script.js'

export const FOUNDER = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'amina@example.com', user_metadata: { full_name: 'Amina Khan' } }
export const OTHER = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', email: 'sam@example.com', user_metadata: { full_name: 'Sam Lee' } }
const ENV = Object.freeze({ FRONTEND_URL: 'https://app.example.com' })
export const START = Date.parse('2026-10-26T13:00:00.000Z') // Monday, 6 pm in Karachi

// The unique indexes in journey/schema_needs.md that the walk leans on.
const COUNTING = (r) => r.status === 'sending' || r.status === 'sent'
export const UNIQUE = Object.freeze({
  founder_profiles: [{ cols: ['user_id'] }],
  user_settings: [{ cols: ['user_id'] }],
  situations: [{ cols: ['user_id', 'create_turn_id'] }],
  situation_turns: [{ cols: ['situation_id', 'client_turn_id'] }],
  reads: [{ cols: ['situation_id'] }],
  learn_conversations: [{ cols: ['situation_id'] }],
  learn_turns: [{ cols: ['conversation_id', 'client_turn_id'] }, { cols: ['parent_turn_id', 'followup_index'] }],
  moves: [{ cols: ['user_id', 'active_slot'] }, { cols: ['learn_id'], where: (r) => r.swapped_from == null }, { cols: ['swapped_from'] }],
  reports: [{ cols: ['move_id'] }],
  peer_unlocks: [{ cols: ['granted_by_report_id', 'kind'] }],
  outcome_author_links: [{ cols: ['peer_outcome_id'] }],
  notification_log: [{ cols: ['user_id', 'dedupe_key'] }, { cols: ['user_id', 'local_day', 'slot'], where: COUNTING }],
  push_tokens: [{ cols: ['token'] }],
  account_requests: [{ cols: ['user_id', 'kind'], where: (r) => r.status === 'queued' }],
})

// OpenAI scripted per step. Journey calls send a json_schema name
// (first_reading, situation_turn, read, learn_reply, move, report, care_check):
// each answers from its own queue, in order. A call with nothing scripted
// throws and is recorded in `unexpected`. `optional` replies may stay unused.
export function createStepOpenAI() {
  const queues = new Map()
  const optional = new Set()
  const calls = []
  const unexpected = []
  const push = (step, replies) => queues.set(step, [...(queues.get(step) ?? []), ...replies])
  return {
    calls,
    unexpected,
    script: (step, ...replies) => push(step, replies),
    scriptOptional: (step, reply) => { push(step, [reply]); optional.add(reply) },
    pending: () => [...queues].flatMap(([step, q]) => q.filter((r) => !optional.has(r)).map(() => step)),
    chatCalls: (step) => calls.filter((c) => c.kind === 'chat' && (!step || c.step === step)),
    chat: {
      completions: {
        async create(payload) {
          const step = payload.response_format?.json_schema?.name ?? 'unstructured'
          calls.push({ kind: 'chat', step, model: payload.model, payload })
          const queue = queues.get(step)
          if (!queue?.length) {
            unexpected.push(step)
            throw new Error(`StepOpenAI: nothing scripted for "${step}"`)
          }
          const next = queue.shift()
          return {
            id: `fake-${calls.length}`,
            model: payload.model,
            choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: typeof next === 'string' ? next : JSON.stringify(next) } }],
            usage: { prompt_tokens: 120, completion_tokens: 60, total_tokens: 180 },
          }
        },
      },
    },
    embeddings: {
      async create(payload) {
        calls.push({ kind: 'embedding', step: 'embedding', model: payload.model, payload })
        return { data: [{ embedding: [0.11, 0.22, 0.33] }], usage: { prompt_tokens: 8, total_tokens: 8 } }
      },
    },
  }
}

// The Knowledge project: only the match_wiki_chunks search the server uses.
export function createFakeKnowledge(rows = KNOWLEDGE_ROWS) {
  const calls = []
  return { calls, async rpc(name, args) { calls.push({ name, args }); return { data: rows, error: null } } }
}

// Response bodies, as text and as parsed JSON.
async function readBody(res) {
  const text = await res.text()
  try { return JSON.parse(text) } catch { return text }
}

export async function createWorld({ seed = {} } = {}) {
  const tables = {
    peer_outcomes: [{ ...PEER_STORY }],
    // The private link of the seeded story belongs to the other founder.
    outcome_author_links: [{ peer_outcome_id: PEER_STORY.id, user_id: OTHER.id, report_id: uuid(951), created_at: PEER_STORY.created_at, withdrawn_at: null }],
    ...seed,
  }
  const base = createFakeSupabase({ users: { 'token-founder': FOUNDER, 'token-other': OTHER }, tables, unique: UNIQUE })
  const used = new Set(Object.keys(tables))
  const users = new Map([FOUNDER, OTHER].map((u) => [u.id, u]))
  // The service-role client also has auth.admin (the push name lookup reads it).
  const supabase = {
    ...base,
    from(table) { used.add(table); return base.from(table) },
    auth: {
      ...base.auth,
      admin: {
        async getUserById(id) {
          const user = users.get(id) ?? null
          return user ? { data: { user }, error: null } : { data: { user: null }, error: { message: 'not found' } }
        },
      },
    },
  }
  const openai = createStepOpenAI()
  const knowledge = createFakeKnowledge()
  const clock = createFakeClock(START)
  const sender = createFakePushSender()
  const app = createApp({ env: ENV, supabase, knowledgeSupabase: knowledge, openai, clock })
  const scheduler = createPushScheduler({
    supabase, sender, clock, isCareOpen: app.locals.isCareOpen, nameOf: createNameLookup(supabase), log: () => {},
  })

  const server = app.listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  const url = `http://127.0.0.1:${server.address().port}`
  const responses = []

  const client = (who, token) => async (method, path, body) => {
    const res = await fetch(`${url}${path}`, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const out = { status: res.status, body: await readBody(res) }
    responses.push({ who, method, path, ...out })
    return out
  }

  const rows = (table) => base.rows(table)
  // Every table the walk touched, row for row.
  const snapshot = () => Object.fromEntries([...used].sort().map((t) => [t, base.rows(t)]))

  return {
    app,
    url,
    supabase,
    openai,
    knowledge,
    clock,
    sender,
    scheduler,
    responses,
    rows,
    snapshot,
    founder: client('founder', 'token-founder'),
    other: client('other', 'token-other'),
    anon: client('anon', null),
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

// Every route the app serves: [{ method, path }]. The CORS preflight
// (OPTIONS *) answers browsers only and writes nothing.
export function routesOf(app) {
  return app._router.stack
    .filter((layer) => layer.route)
    .flatMap((layer) => Object.keys(layer.route.methods).filter((m) => m !== '_all' && m !== 'options').map((m) => ({ method: m.toUpperCase(), path: layer.route.path })))
}

// Keys anywhere in a JSON value.
export function keysIn(value, out = new Set()) {
  if (Array.isArray(value)) value.forEach((v) => keysIn(v, out))
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.add(k)
      keysIn(v, out)
    }
  }
  return out
}
