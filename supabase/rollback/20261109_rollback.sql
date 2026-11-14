-- Rollback for the memory layer (supabase/migrations/20261109*). Run by hand,
-- never by a tool. Order matters: the old delete_account goes back first, then
-- the tables it no longer mentions are dropped. Dropping the tables deletes
-- everything Axiom learned about every founder; situations, moves and reports
-- are not touched.

begin;

-- 4: the birthday columns (dropping the columns drops their check)
alter table public.founder_profiles drop column if exists birth_day;
alter table public.founder_profiles drop column if exists birth_month;

-- 3: the function as it was before the memory block
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
  delete from public.care_events where user_id = p_user_id;
  delete from public.push_tokens where user_id = p_user_id;
  delete from public.user_settings where user_id = p_user_id;
  delete from public.users where id = p_user_id;
  delete from public.founder_profiles where user_id = p_user_id;
  delete from public.account_requests where user_id = p_user_id;
end
$function$;

-- 2: call_type without 'beliefs' (NOT VALID, as live)
set lock_timeout = '5s';
alter table public.model_usage_logs drop constraint if exists model_usage_logs_call_type_check;
alter table public.model_usage_logs
  add constraint model_usage_logs_call_type_check
  check (call_type in ('chat', 'query_expansion', 'onboarding', 'memory_update', 'concept_state_update',
    'embedding', 'read', 'learn', 'followup', 'move', 'care', 'report', 'memory')) not valid;
reset lock_timeout;

-- 1: the tables
drop table if exists public.memory_evidence;
drop table if exists public.founder_corrections;
drop table if exists public.memory_runs;
drop table if exists public.founder_threads;
drop table if exists public.founder_vocabulary;
drop table if exists public.founder_world;
drop table if exists public.founder_traits;
drop table if exists public.founder_beliefs;

commit;
