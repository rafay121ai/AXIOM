-- APPLIED to live main on Nov 27 2026 (Rafay's yes), after a dry run in an undone transaction; version recorded.
-- "Learn how I work" switch (decisions.md Nov 25 and Nov 27).
-- 1. The switch: off by default, never pre-ticked. 2. consent_log gets two actions for it. The CHECK is added NOT VALID
-- (like the earlier widenings): existing rows are not re-checked, new rows are.
-- ROLLBACK: supabase/rollback/20261127_learn_how_i_work_rollback.sql (run by hand).
-- Apply BEFORE CONNECTORS=on: GET /api/connectors reads the column (it answers false while it is missing, PUT /learn answers 503).
set lock_timeout = '5s';

alter table public.user_settings add column if not exists learn_how_i_work boolean not null default false;

alter table public.consent_log drop constraint if exists consent_log_action_check;
alter table public.consent_log add constraint consent_log_action_check
  check (action in ('asked', 'share', 'auto_share', 'keep_private', 'withdraw', 'auto_share_on', 'auto_share_off', 'learn_on', 'learn_off')) not valid;
