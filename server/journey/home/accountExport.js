// Account export: one JSON document of what Axiom stores about this founder.
// It only reads, and only rows that belong to this founder. Left out on
// purpose: internal evidence, validation, chunk ids and sources, model usage
// (model_usage_logs: cost, latency and error details, not the founder's content),
// push tokens, session tokens, and anything about another founder. A shared story is shown
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
  founder_profiles: ['stage', 'business_model', 'customer_markets', 'country', 'goal', 'deadline', 'report_time_local', 'timezone', 'open_answers', 'signup_answers', 'first_reading', 'birth_month', 'birth_day', 'created_at'],
  sessions: ['id', 'onboarding_answers', 'axiom_profile', 'session_notes', 'concept_progress', 'created_at', 'last_active'], // never session_token
  conversation_threads: ['id', 'session_id', 'title', 'started_at', 'last_message_at', 'message_count', 'status', 'primary_pillar', 'created_at'],
  app_sessions: ['id', 'started_at', 'ended_at', 'duration_seconds', 'entry_point', 'messages_sent', 'device'],
  experiments: ['id', 'session_id', 'title', 'description', 'status', 'pillar', 'topic', 'how_to_do_it', 'real_world_example', 'what_to_notice', 'success_condition', 'report', 'result_summary', 'assigned_at', 'due_at', 'completed_at', 'cancelled_at', 'ghosted_at', 'outcome', 'outcome_reason', 'created_at'],
  founder_lesson_log: ['id', 'source_key', 'slot', 'created_at'],
  notification_log: ['id', 'kind', 'local_day', 'slot', 'status', 'sent_at', 'created_at'],
  peer_unlocks: ['id', 'granted_by_report_id', 'kind', 'used_on_situation_id', 'created_at'],
  product_events: ['id', 'event', 'created_at'], // not properties: free-form, can hold ids
  messages: ['id', 'session_id', 'role', 'content', 'created_at'],
  personal_memories: ['id', 'type', 'content', 'importance', 'created_at'], // never the embedding
  // What Axiom learned about the founder, superseded rows included. No user_id.
  founder_beliefs: ['id', 'belief', 'kind', 'confidence', 'status', 'superseded_by', 'source', 'created_at', 'updated_at'],
  founder_traits: ['id', 'dimension', 'value', 'confidence', 'origin', 'status', 'superseded_by', 'created_at', 'updated_at'],
  founder_world: ['id', 'name', 'kind', 'role', 'mention_count', 'last_mentioned_at', 'status', 'created_at', 'updated_at'],
  founder_vocabulary: ['id', 'term', 'meaning', 'confidence', 'mention_count', 'status', 'created_at', 'updated_at'],
  founder_threads: ['id', 'title', 'kind', 'status', 'created_at', 'updated_at'],
  memory_evidence: ['id', 'item_table', 'item_id', 'source_kind', 'snippet', 'created_at'],
  memory_runs: ['id', 'source_kind', 'mode', 'status', 'created_at'],
  founder_corrections: ['id', 'item_table', 'item_text', 'reason', 'created_at'],
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
    const sessions = await mine('sessions', userId)
    const noIdOf = async (table) => (await mine(table, userId)).map(noId)
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
      messages: await under('messages', 'session_id', sessions.map((x) => x.id)),
      personal_memories: await mine('personal_memories', userId),
      sessions,
      conversation_threads: await mine('conversation_threads', userId),
      app_sessions: await mine('app_sessions', userId),
      experiments: await mine('experiments', userId),
      founder_lesson_log: await noIdOf('founder_lesson_log'),
      notification_log: await noIdOf('notification_log'),
      peer_unlocks: await mine('peer_unlocks', userId),
      founder_beliefs: await mine('founder_beliefs', userId),
      founder_traits: await mine('founder_traits', userId),
      founder_world: await mine('founder_world', userId),
      founder_vocabulary: await mine('founder_vocabulary', userId),
      founder_threads: await mine('founder_threads', userId),
      memory_evidence: await mine('memory_evidence', userId),
      memory_runs: await mine('memory_runs', userId),
      founder_corrections: await mine('founder_corrections', userId),
      product_events: await noIdOf('product_events'),
      devices: (await mine('push_tokens', userId)).map((d) => ({ ...noId(d), token: 'redacted' })),
    }
    if (Buffer.byteLength(JSON.stringify(doc)) > EXPORT_MAX_BYTES) throw new HttpError(413, { error: ACCOUNT_COPY.exportTooLarge })
    return doc
  }

  return { build }
}
