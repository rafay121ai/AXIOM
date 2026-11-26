-- Rollback for the connector migrations (supabase/pending/20261125*). Run by hand, never by a tool, and only
-- after the server code that uses them is rolled back. Order matters: the old delete_account goes back first,
-- then the CHECKs, then the tables. Dropping the tables deletes every founder's connections,
-- signals and action history; situations, moves, reports and memory are not touched.
-- The slot, belief, evidence and memory-run CHECKs come back VALID, so this fails while signal-slot rows or
-- connector memory rows exist (as it should): delete those rows first, with approval. The kind and call_type
-- CHECKs come back NOT VALID, so old 'signal' and 'connector' rows there stay (push and cost history).

begin;

-- 3: delete_account as it was live on Nov 25 2026 (md5 e845cf4819f27f848cbc7ff7e8ff5237)
CREATE OR REPLACE FUNCTION public.delete_account(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  delete from public.peer_outcomes
   where status <> 'approved'
     and id in (select peer_outcome_id from public.outcome_author_links where user_id = p_user_id);
  delete from public.outcome_author_links where user_id = p_user_id;

  delete from public.peer_unlocks where user_id = p_user_id;
  delete from public.consent_log where user_id = p_user_id;
  delete from public.notification_log where user_id = p_user_id;
  delete from public.reports where user_id = p_user_id;
  delete from public.moves where user_id = p_user_id;

  delete from public.lesson_citations
   where learn_turn_id in (
     select t.id from public.learn_turns t
       join public.learn_conversations c on c.id = t.conversation_id
      where c.user_id = p_user_id);
  delete from public.learn_turns
   where conversation_id in (select id from public.learn_conversations where user_id = p_user_id);
  delete from public.learn_conversations where user_id = p_user_id;
  delete from public.situation_turns
   where situation_id in (select id from public.situations where user_id = p_user_id);
  delete from public.reads
   where situation_id in (select id from public.situations where user_id = p_user_id);
  delete from public.situations where user_id = p_user_id;

  delete from public.messages where session_id in (select id from public.sessions where user_id = p_user_id);
  delete from public.app_sessions where user_id = p_user_id;
  delete from public.conversation_threads where user_id = p_user_id;
  delete from public.experiments where user_id = p_user_id;
  delete from public.personal_memories where user_id = p_user_id;
  delete from public.model_usage_logs where user_id = p_user_id;
  delete from public.product_events where user_id = p_user_id;
  delete from public.sessions where user_id = p_user_id;

  delete from public.founder_lesson_log where user_id = p_user_id;

  delete from public.memory_evidence where user_id = p_user_id;
  delete from public.founder_beliefs where user_id = p_user_id;
  delete from public.founder_traits where user_id = p_user_id;
  delete from public.founder_world where user_id = p_user_id;
  delete from public.founder_vocabulary where user_id = p_user_id;
  delete from public.founder_threads where user_id = p_user_id;
  delete from public.memory_runs where user_id = p_user_id;
  delete from public.founder_corrections where user_id = p_user_id;

  delete from public.care_events where user_id = p_user_id;
  delete from public.push_tokens where user_id = p_user_id;
  delete from public.user_settings where user_id = p_user_id;
  delete from public.users where id = p_user_id;
  delete from public.founder_profiles where user_id = p_user_id;
  delete from public.account_requests where user_id = p_user_id;
end
$function$;

-- 2: the CHECKs as they were
set local lock_timeout = '5s';
alter table public.notification_log drop constraint if exists notification_log_kind_check;
alter table public.notification_log add constraint notification_log_kind_check
  check (kind in ('morning', 'quiet_check', 'evening', 'reminder', 'nudge')) not valid;
alter table public.notification_log drop constraint if exists notification_log_slot_check;
alter table public.notification_log add constraint notification_log_slot_check check (slot in ('morning', 'evening'));
alter table public.founder_beliefs drop constraint if exists founder_beliefs_source_check;
alter table public.founder_beliefs add constraint founder_beliefs_source_check
  check (source in ('signup', 'conversation', 'report'));
alter table public.memory_evidence drop constraint if exists memory_evidence_source_kind_check;
alter table public.memory_evidence add constraint memory_evidence_source_kind_check
  check (source_kind in ('signup', 'situation', 'read', 'learn', 'move', 'swap', 'report'));
alter table public.memory_runs drop constraint if exists memory_runs_source_kind_check;
alter table public.memory_runs add constraint memory_runs_source_kind_check
  check (source_kind in ('signup', 'report', 'move', 'situation'));
alter table public.model_usage_logs drop constraint if exists model_usage_logs_call_type_check;
alter table public.model_usage_logs add constraint model_usage_logs_call_type_check
  check (call_type in ('chat', 'query_expansion', 'onboarding', 'memory_update', 'concept_state_update', 'embedding',
    'read', 'learn', 'followup', 'move', 'care', 'report', 'memory', 'beliefs')) not valid;

-- 1: the tables (children first)
drop table if exists public.connector_actions;
drop table if exists public.signals;
drop table if exists public.connector_jobs;
drop table if exists public.watch_sources;
drop table if exists public.connector_accounts;

-- The history must match the schema, or a later push would skip these files.
delete from supabase_migrations.schema_migrations where version in ('20261125000001', '20261125000002', '20261125000003');

commit;
