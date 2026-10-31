// Account export: one JSON document of what Axiom stores about this founder.
// It only reads, and only rows that belong to this founder. Left out on
// purpose: internal evidence, validation, chunk ids and sources, model usage,
// push tokens, and anything about another founder. A shared story is shown
// only as the founder's own choice on their report (share_state): peer
// outcomes and their private link are never read, and no user_id is written.
import { ACCOUNT_COPY } from './wording.js'
import { HttpError } from '../situations.js'

export const EXPORT_MAX_BYTES = 10 * 1024 * 1024
const PAGE = 500
const CHUNK = 100

// What the founder wrote or was told, per table. Never `*`. Rows are cut down
// to these fields here as well as in the query.
const COLUMNS = Object.freeze({
  situations: ['id', 'title', 'status', 'follow_up_count', 'created_at', 'last_activity_at'],
  situation_turns: ['id', 'situation_id', 'role', 'text', 'created_at'],
  reads: ['id', 'situation_id', 'headline', 'body', 'closing_question', 'closing_answer', 'skipped', 'answered_at', 'created_at'],
  learn_conversations: ['id', 'situation_id', 'created_at'],
  learn_turns: ['id', 'conversation_id', 'role', 'kind', 'text', 'created_at'],
  moves: ['id', 'situation_id', 'status', 'title', 'mission', 'success_condition', 'words', 'checklist', 'prediction', 'start_minutes', 'swap_count', 'swap_reason', 'committed_at', 'report_due_at', 'closes_at', 'closed_at', 'created_at'],
  reports: ['id', 'move_id', 'situation_id', 'outcome', 'note', 'prediction', 'prediction_check', 'reply', 'share_state', 'share_automatic', 'share_decided_at', 'created_at'],
  consent_log: ['id', 'report_id', 'action', 'wording_version', 'decided_at'],
  care_events: ['id', 'level', 'created_at', 'resolved_at'],
  push_tokens: ['id', 'platform', 'timezone', 'created_at', 'updated_at'],
  founder_profiles: ['stage', 'business_model', 'customer_markets', 'country', 'goal', 'deadline', 'report_time_local', 'timezone', 'open_answers', 'signup_answers', 'first_reading', 'created_at'],
  users: ['email', 'first_name', 'created_at'],
  user_settings: ['share_auto', 'morning_on', 'evening_on', 'lock_screen', 'quiet_start', 'quiet_end', 'keep_items', 'mentor_style', 'created_at'],
})
const pick = (table, row) => Object.fromEntries(COLUMNS[table].filter((c) => c in row).map((c) => [c, row[c]]))
const noId = ({ id, ...rest }) => rest

export function createAccountExport({ supabase, clock }) {
  // Every row of a query, a page at a time (PostgREST caps one response).
  async function all(table, filter) {
    const out = []
    let after = null
    for (;;) {
      let q = filter(supabase.from(table).select(COLUMNS[table].join(', '))).order('id').limit(PAGE)
      if (after) q = q.gt('id', after)
      const { data, error } = await q
      if (error) throw error
      out.push(...data.map((r) => pick(table, r)))
      if (data.length < PAGE) return out
      after = data[data.length - 1].id
    }
  }
  const mine = (table, userId) => all(table, (q) => q.eq('user_id', userId))
  const under = async (table, column, parentIds) => {
    const out = []
    for (let i = 0; i < parentIds.length; i += CHUNK) out.push(...await all(table, (q) => q.in(column, parentIds.slice(i, i + CHUNK))))
    return out
  }
  const single = async (table, column, userId) => {
    const { data, error } = await supabase.from(table).select(COLUMNS[table].join(', ')).eq(column, userId).maybeSingle()
    if (error) throw error
    return data ? pick(table, data) : null
  }

  async function build(userId) {
    const situations = await mine('situations', userId)
    const situationIds = situations.map((s) => s.id)
    const conversations = await mine('learn_conversations', userId)
    const doc = {
      message: ACCOUNT_COPY.exportReady,
      exported_at: new Date(clock.now()).toISOString(),
      account: await single('users', 'id', userId),
      profile: await single('founder_profiles', 'user_id', userId),
      settings: await single('user_settings', 'user_id', userId),
      situations,
      situation_turns: await under('situation_turns', 'situation_id', situationIds),
      reads: await under('reads', 'situation_id', situationIds),
      learn_conversations: conversations,
      learn_turns: await under('learn_turns', 'conversation_id', conversations.map((c) => c.id)),
      moves: await mine('moves', userId),
      reports: await mine('reports', userId),
      consent_log: (await mine('consent_log', userId)).map(noId),
      care_events: (await mine('care_events', userId)).map(noId),
      devices: (await mine('push_tokens', userId)).map((d) => ({ ...noId(d), token: 'redacted' })),
    }
    if (Buffer.byteLength(JSON.stringify(doc)) > EXPORT_MAX_BYTES) throw new HttpError(413, { error: ACCOUNT_COPY.exportTooLarge })
    return doc
  }

  return { build }
}
