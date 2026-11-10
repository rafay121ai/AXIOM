-- Memory layer 3 of 3: delete_account also removes what Axiom learned.
-- NOT APPLIED. Removes founder data (CLAUDE.md: needs Rafay's explicit
-- approval). The body is the LIVE function of Nov 9 2026
-- (audit/schema_live_2026-11-09.md, copied verbatim) plus one block that
-- deletes the eight memory tables, before the rows they hang off. Superseded
-- rows go too: they are the founder's data.
--
-- CREATE OR REPLACE keeps the function's existing grants (service role only).
-- SECURITY INVOKER, empty search_path, idempotent: a second call finds nothing.
-- The memory tables also cascade from auth.users, so a missed table can never
-- outlive the sign-in account.
--
-- ROLLBACK: supabase/rollback/20261109_rollback.sql restores the previous
-- function. Deleted data cannot be brought back by any rollback.

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
