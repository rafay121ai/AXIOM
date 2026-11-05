alter function public.sync_conversation_thread_from_message() set search_path = public;
-- Proactive Axiom, stage 1 (tasks/todo.md). Approved by Rafay on Nov 4 2026.
-- Checked against live (read only) on Nov 4 2026: situations and
-- notification_log match 20261101000003 and 20261101000007.
--
-- situations.started_by: who opened it. 'axiom' means Axiom opened it from a
-- trigger, and trigger_key names that trigger ("goal:2026-11-30:14",
-- "misses:<report id>"), unique per founder so an opener is never made twice.
-- notification_log.kind gains 'proactive' (the opener in the morning slot).
-- No data changes. Server only, as before. Idempotent.
--
-- ROLLBACK (only while no axiom row exists): remove the two new situations
-- columns and their index, and restore the four kinds in
-- notification_log_kind_check.

-- Fail cleanly instead of queueing every read behind a long transaction.

alter table public.situations add column if not exists started_by text not null default 'founder';
alter table public.situations add column if not exists trigger_key text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'situations_started_by_check') then
    alter table public.situations add constraint situations_started_by_check check (started_by in ('founder', 'axiom'));
  end if;
end $$;

create unique index if not exists situations_user_trigger_key
  on public.situations (user_id, trigger_key) where trigger_key is not null;

alter table public.notification_log drop constraint if exists notification_log_kind_check;
alter table public.notification_log add constraint notification_log_kind_check
  check (kind in ('morning', 'quiet_check', 'evening', 'reminder', 'proactive'));
