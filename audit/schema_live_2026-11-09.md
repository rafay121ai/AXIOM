# Live main schema before the memory layer (read-only, Nov 9 2026)

Project: Axiom (zmzrrmqqxqzmmfovpqjt), Postgres 17.6. Read-only catalog queries only. No row data was read.
Purpose: base for the memory-layer migration (tasks/memory-plan.md).

## Applied migrations (20)

20260929000000 baseline, 20260929000001 secure_public_schema, 20260930000000 drop_legacy_brain_and_warnings, 20260930000001 fix_model_usage_logging, 20260930000002 create_product_events, 20261013000001 security_view_and_default_privileges, 20261013000003 create_founder_profiles, 20261101000001 to 20261101000011 (journey), 20261103103416 founder_profiles_server_only, 20261104130402 message_trigger_search_path.

Matches `supabase/migrations/` in the repo file for file. Nothing in `supabase/pending/` is applied.

## Public tables (30), RLS on for all

account_requests, app_sessions, care_events, consent_log, conversation_threads, experiments, founder_lesson_log, founder_profiles, learn_conversations, learn_turns, lesson_citations, messages, model_usage_logs, moves, notification_log, outcome_author_links, peer_outcomes, peer_unlocks, personal_memories, product_events, push_tokens, reads, reports, sessions, situation_turns, situations, user_settings, users, wiki_chunks, wiki_sources.

None of the memory tables from the plan exist yet (founder_beliefs, founder_traits, founder_world, founder_vocabulary, founder_threads, memory_evidence, memory_runs, founder_corrections, founder_brief).

## RLS policies that exist

Only the old-product and library tables have policies: app_sessions, conversation_threads, experiments, messages, model_usage_logs (select own), personal_memories (select own), sessions, users (insert, select, update own), wiki_chunks, wiki_sources.
**Every journey table has RLS on and no policy at all** (situations, situation_turns, reads, learn_*, lesson_citations, moves, reports, consent_log, peer_*, outcome_author_links, push_tokens, notification_log, care_events, founder_lesson_log, founder_profiles, user_settings, account_requests). They are server-only, reached through the service role.

## Facts the migration depends on

- `founder_profiles`: user_id pk (fk auth.users on delete cascade), stage, business_model, customer_markets, country, goal, deadline, report_time_local, timezone, open_answers jsonb (check: array, at most 3), signup_answers jsonb (check: object), first_reading jsonb, created_at, updated_at. Checks on stage and business_model values.
- `users`: id (fk auth.users on delete cascade), email, first_name, created_at.
- `moves.status` check: draft, committed, report_due, reported, closed_no_report, swapped. `moves.user_id` and `reports.user_id` reference auth.users with NO cascade, so `delete_account` must remove them first (it does).
- `reports.outcome`: done, couldnt, didnt. `reports.prediction_check`: right, wrong, unclear, not_tested.
- `model_usage_logs_call_type_check` (NOT VALID, so old rows are not checked) allows: chat, query_expansion, onboarding, memory_update, concept_state_update, embedding, read, learn, followup, move, care, report, memory. **'beliefs' is not allowed yet.**
- `user_settings.mentor_style` check: calm, direct, hard (NOT VALID).

## `delete_account(p_user_id uuid)` as it is live (verbatim)

```sql
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
$function$
```
