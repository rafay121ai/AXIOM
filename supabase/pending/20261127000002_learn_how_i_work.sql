-- NOT APPLIED. Draft only ("Learn how I work" switch, decisions.md Nov 25 and Nov 27). Do not run; move to supabase/migrations/
-- with a new timestamp after Rafay's yes.
-- 1. The switch: off by default, never pre-ticked. 2. consent_log gets two actions for it. The CHECK is added NOT VALID
-- (like the earlier widenings): existing rows are not re-checked, new rows are.
-- Rollback (by hand): alter table public.user_settings drop column if exists learn_how_i_work;
--   and put the old consent_log_action_check back (the seven actions of 20261101000006), NOT VALID; delete learn_on/learn_off rows first to validate.
-- Apply BEFORE CONNECTORS=on: GET /api/connectors reads the column (it answers false while it is missing, PUT /learn answers 503).
set lock_timeout = '5s';

alter table public.user_settings add column if not exists learn_how_i_work boolean not null default false;

alter table public.consent_log drop constraint if exists consent_log_action_check;
alter table public.consent_log add constraint consent_log_action_check
  check (action in ('asked', 'share', 'auto_share', 'keep_private', 'withdraw', 'auto_share_on', 'auto_share_off', 'learn_on', 'learn_off')) not valid;
