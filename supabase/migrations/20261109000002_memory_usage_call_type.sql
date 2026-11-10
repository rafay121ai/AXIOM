-- Memory layer 2 of 3: model_usage_logs.call_type accepts 'beliefs'.
-- NOT APPLIED. Written against the live check of Nov 9 2026
-- (audit/schema_live_2026-11-09.md), which allows exactly the 13 values below
-- without 'beliefs'.
--
-- The memory extraction call logs as its own step (server/config.js STEPS:
-- beliefs, set by MODEL_BELIEFS). Same pattern as 20261101000009: every value
-- allowed before stays allowed, NOT VALID so existing rows are never checked
-- or rejected. No data changes. Idempotent.
--
-- ROLLBACK: supabase/rollback/20261109_rollback.sql restores the previous list.

-- Both statements take an ACCESS EXCLUSIVE lock on a busy logging table: give
-- up after 5 seconds instead of queueing every insert behind this file.
set lock_timeout = '5s';

alter table public.model_usage_logs
  drop constraint if exists model_usage_logs_call_type_check;

alter table public.model_usage_logs
  add constraint model_usage_logs_call_type_check
  check (call_type in (
    'chat',
    'query_expansion',
    'onboarding',
    'memory_update',
    'concept_state_update',
    'embedding',
    'read',
    'learn',
    'followup',
    'move',
    'care',
    'report',
    'memory',
    'beliefs'
  )) not valid;

reset lock_timeout;
