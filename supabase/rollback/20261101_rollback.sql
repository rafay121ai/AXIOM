-- ROLLBACK of the journey migrations 20261101000001 to 20261101000011.
--
-- RUN BY HAND ONLY. DESTRUCTIVE OF NEW DATA ONLY: it removes the tables,
-- functions, trigger, columns and constraints those files created, and every
-- row stored in them. It touches nothing that existed before 20261101*.
-- It is not a migration and must never be placed in supabase/migrations/.
--
-- Run only with Rafay's approval, and only before founder data is stored in
-- the new tables (situations, reports, consent_log and the rest are founder
-- memory and consent evidence; afterwards fix forward with a new migration).
-- Before running: compare with the pre-apply live dump and confirm each object
-- below was created by the journey files, not found already live.
--
-- Reverse order, 10 to 1. No cascade: a dependency this file does not know
-- about stops it instead of being removed with it.
--
-- 9: model_usage_logs_call_type_check is not new (20260930000001); the wider
--    list is harmless and is left as it is.

begin;

-- 11 (delete_after and its index go with account_requests in step 8)
drop function if exists public.delete_account(uuid);

-- 10
drop table if exists public.founder_lesson_log;

-- 8
drop table if exists public.account_requests;

-- 7
drop table if exists public.notification_log;
drop table if exists public.push_tokens;
drop table if exists public.user_settings;

-- 6
drop function if exists public.unshare_outcome(uuid, uuid, text, text, text, text, timestamptz);
drop function if exists public.share_outcome(uuid, uuid, text, boolean, text, text, jsonb, timestamptz);
drop table if exists public.peer_unlocks;
drop table if exists public.outcome_author_links;
drop table if exists public.peer_outcomes;
drop function if exists public.peer_outcomes_guard();
drop table if exists public.consent_log;
drop table if exists public.reports;

-- 5
drop table if exists public.moves;

-- 4
drop table if exists public.lesson_citations;
drop table if exists public.learn_turns;
drop table if exists public.learn_conversations;

-- 3
drop function if exists public.take_follow_up(uuid, uuid, timestamptz);
drop table if exists public.reads;
drop table if exists public.situation_turns;
drop table if exists public.situations;

-- 2
drop table if exists public.care_events;

-- 1 (report_time_local and timezone come from 20261013000003: kept)
alter table public.founder_profiles drop constraint if exists founder_profiles_first_reading_object;
alter table public.founder_profiles drop constraint if exists founder_profiles_signup_answers_object;
alter table public.founder_profiles drop column if exists first_reading;
alter table public.founder_profiles drop column if exists signup_answers;

commit;
