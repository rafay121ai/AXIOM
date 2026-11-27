-- Rollback for 20261127000002_learn_how_i_work.sql. Run by hand, after the server code that uses it is rolled back.
-- Founders' switch choices are lost; their consent rows for it must be deleted first so the old CHECK can apply.
begin;
set local lock_timeout = '5s';
delete from public.consent_log where action in ('learn_on', 'learn_off');
alter table public.consent_log drop constraint if exists consent_log_action_check;
alter table public.consent_log add constraint consent_log_action_check
  check (action in ('asked', 'share', 'auto_share', 'keep_private', 'withdraw', 'auto_share_on', 'auto_share_off')) not valid;
alter table public.user_settings drop column if exists learn_how_i_work;
delete from supabase_migrations.schema_migrations where version = '20261127000002';
commit;
