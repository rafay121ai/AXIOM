-- Connectors 2 of 3: existing CHECKs accept the connector values and the signal push slots.
-- DRAFT IN supabase/pending/: NOT APPLIED. Needs Rafay's explicit approval; move into supabase/migrations/ only then.
-- Written Nov 25 2026 against live main (read-only check the same day):
--   notification_log_kind_check   morning, quiet_check, evening, reminder, nudge (NOT VALID); 0 rows in the table
--   notification_log_slot_check   morning, evening
--   notification_log_user_day_slot_key  unique (user_id, local_day, slot) where status in (sending, sent): unchanged
--   memory_runs_source_kind_check  signup, report, move, situation
--   founder_beliefs_source_check  signup, conversation, report
--   memory_evidence_source_kind_check  signup, situation, read, learn, move, swap, report
--   model_usage_logs_call_type_check  chat ... beliefs (14 values, NOT VALID)
--
-- Every value allowed before stays allowed; no index changes. Widened CHECKs are NOT VALID, so existing rows are never re-checked.
-- Signals (decisions.md, Nov 10): their own 4 a day on top of morning and evening, plus at most 2 extreme events.
-- A signal push takes slot signal_1..signal_4 (extreme_1..extreme_2), so the EXISTING unique index
-- (user_id, local_day, slot) enforces the cap in the database: a fifth signal is a 23505, exactly like a second
-- morning push today. The index is not changed.
-- Before any signal row is written, server/push/policy.js must count only morning and evening against the
-- 2-a-day scheduled cap (Phase 7), or two signals would hold back the scheduled pushes.
-- 5 second lock timeout. Idempotent.
--
-- ROLLBACK: supabase/rollback/20261125_rollback.sql (only while no connector or signal rows exist).

set lock_timeout = '5s';

alter table public.notification_log drop constraint if exists notification_log_kind_check;
alter table public.notification_log add constraint notification_log_kind_check
  check (kind in ('morning', 'quiet_check', 'evening', 'reminder', 'nudge', 'signal')) not valid;

alter table public.notification_log drop constraint if exists notification_log_slot_check;
alter table public.notification_log add constraint notification_log_slot_check
  check (slot in ('morning', 'evening', 'signal_1', 'signal_2', 'signal_3', 'signal_4', 'extreme_1', 'extreme_2')) not valid;

alter table public.founder_beliefs drop constraint if exists founder_beliefs_source_check;
alter table public.founder_beliefs add constraint founder_beliefs_source_check
  check (source in ('signup', 'conversation', 'report', 'connector')) not valid;

alter table public.memory_evidence drop constraint if exists memory_evidence_source_kind_check;
alter table public.memory_evidence add constraint memory_evidence_source_kind_check
  check (source_kind in ('signup', 'situation', 'read', 'learn', 'move', 'swap', 'report', 'connector')) not valid;

alter table public.memory_runs drop constraint if exists memory_runs_source_kind_check;
alter table public.memory_runs add constraint memory_runs_source_kind_check
  check (source_kind in ('signup', 'report', 'move', 'situation', 'connector')) not valid;

alter table public.model_usage_logs drop constraint if exists model_usage_logs_call_type_check;
alter table public.model_usage_logs add constraint model_usage_logs_call_type_check
  check (call_type in ('chat', 'query_expansion', 'onboarding', 'memory_update', 'concept_state_update', 'embedding',
    'read', 'learn', 'followup', 'move', 'care', 'report', 'memory', 'beliefs', 'signal', 'connector')) not valid;

reset lock_timeout;
