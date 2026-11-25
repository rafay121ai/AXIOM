-- Connectors 3 of 3: delete_account also removes the founder's connector rows.
-- DRAFT IN supabase/pending/: NOT APPLIED. It removes founder data: needs Rafay's explicit approval.
-- Copied from the LIVE function on Nov 25 2026 (md5 of pg_get_functiondef: e845cf4819f27f848cbc7ff7e8ff5237;
-- EXECUTE held by postgres and service_role only). Re-check that md5 right before applying; if it differs, stop.
-- The only change: five deletes for the connector tables, children first (actions point at signals).
-- Revoking the founder's Composio connections is server code (accountService), done before this runs.
--
-- ROLLBACK: supabase/rollback/20261125_rollback.sql restores the live function as copied above.

-- Refuse to run if live changed since the copy (safe to run twice: an already-updated function passes).
do $guard$
declare def text := pg_get_functiondef('public.delete_account(uuid)'::regprocedure);
begin
  if md5(def) <> 'e845cf4819f27f848cbc7ff7e8ff5237' and position('public.connector_actions' in def) = 0 then
    raise exception 'delete_account changed on live since Nov 25 2026: re-copy it before applying';
  end if;
end
$guard$;

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

  delete from public.connector_actions where user_id = p_user_id;
  delete from public.signals where user_id = p_user_id;
  delete from public.connector_jobs where user_id = p_user_id;
  delete from public.watch_sources where user_id = p_user_id;
  delete from public.connector_accounts where user_id = p_user_id;

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

revoke all on function public.delete_account(uuid) from PUBLIC, anon, authenticated;
grant execute on function public.delete_account(uuid) to service_role;
