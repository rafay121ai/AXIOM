-- notification_log.kind accepts 'nudge': a morning push from the founder's
-- own memory (their sign-up goal date a week away, or an open thread gone
-- quiet). server/push/policy.js PUSH_KINDS.
--
-- NOT APPLIED. Written Nov 20 2026 after a read-only check of live main
-- (zmzrrmqqxqzmmfovpqjt): the live check matched 20261101000007 exactly and
-- the table held 0 rows (tasks/todo.md, "N1 result").
--
-- Widens the CHECK: every value allowed before stays allowed. NOT VALID, so
-- existing rows are never checked. No new column, no data change: a nudge row
-- keeps move_id and situation_id null and its dedupe_key names the goal or
-- thread. The slot check (morning, evening) and the cap of 2 a day are
-- unchanged; a nudge takes the morning slot.
-- Idempotent.
--
-- ROLLBACK (only while no 'nudge' row exists; otherwise delete those rows
-- first, with approval):
--   alter table public.notification_log drop constraint if exists notification_log_kind_check;
--   alter table public.notification_log add constraint notification_log_kind_check
--     check (kind in ('morning', 'quiet_check', 'evening', 'reminder')) not valid;

set lock_timeout = '5s';

alter table public.notification_log
  drop constraint if exists notification_log_kind_check;

alter table public.notification_log
  add constraint notification_log_kind_check
  check (kind in ('morning', 'quiet_check', 'evening', 'reminder', 'nudge')) not valid;

reset lock_timeout;
