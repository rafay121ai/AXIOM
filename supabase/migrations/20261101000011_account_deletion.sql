-- Journey 11: account deletion (grace period and the atomic delete function).
--
-- NOT APPLIED. Read supabase/DELETION_PLAN.md and supabase/MIGRATION_PLAN.md
-- first. Needs Rafay's approval: this file removes founder data (CLAUDE.md:
-- never touch founder memory, consent and peer outcome privacy logic without
-- explicit instruction). Verify against a fresh read-only dump of the live
-- main schema, and test on a COPY of the database first.
--
-- 1. account_requests gains delete_after (end of the 7-day grace period) and
--    a second partial unique index: one pending deletion per founder.
-- 2. delete_account(p_user_id) removes everything stored about one founder in
--    one transaction, in a safe order. The server then removes the sign-in
--    account (auth admin API). The server only calls it when ACCOUNT_DELETE=on
--    and the grace period is over.
--
-- Published (approved) peer outcomes hold no name: only their private
-- outcome_author_links row is removed, so they can never be traced back. Any
-- outcome still pending review, rejected or withdrawn is removed with its link.
--
-- SECURITY INVOKER, empty search_path, service role only. Idempotent: a
-- second call finds nothing and changes nothing.
--
-- ROLLBACK: supabase/rollback/20261101_rollback.sql (drops the function; the column and
-- index go with account_requests). Deleted data cannot be brought back by any rollback.

alter table public.account_requests add column if not exists delete_after timestamptz;

create unique index if not exists account_requests_user_pending_key
  on public.account_requests (user_id) where kind = 'delete' and status = 'pending';

create or replace function public.delete_account(p_user_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Shared outcomes. Unpublished ones go with their link; a published story
  -- stays, and loses only the private link.
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

  -- Old stack (deprecated, still holds what the founder said).
  delete from public.messages where session_id in (select id from public.sessions where user_id = p_user_id);
  delete from public.weekly_reads where session_id in (select id from public.sessions where user_id = p_user_id);
  delete from public.personal_wiki_edges where session_id in (select id from public.sessions where user_id = p_user_id);
  delete from public.personal_wiki_nodes where session_id in (select id from public.sessions where user_id = p_user_id);
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
$$;

revoke all on function public.delete_account(uuid) from PUBLIC, anon, authenticated;
grant execute on function public.delete_account(uuid) to service_role;
