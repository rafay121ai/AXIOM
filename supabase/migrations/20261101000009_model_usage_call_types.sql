-- Journey 9 of 9: model_usage_logs.call_type accepts the journey steps.
--
-- NOT APPLIED. Read supabase/MIGRATION_PLAN.md first. Verify against a fresh
-- read-only dump of the live main schema before pushing.
--
-- Widens the CHECK from 20260930000001 with the journey step names
-- (server/config.js STEP_DEFAULTS: read, learn, followup, move, care, report,
-- memory). Every value allowed before stays allowed. NOT VALID, as before:
-- existing rows (including legacy values such as session_notes and artifact)
-- are never checked or rejected. No data changes.
-- Idempotent.
--
-- ROLLBACK: re-run the constraint statements of 20260930000001.

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
    'memory'
  )) not valid;

reset lock_timeout;
