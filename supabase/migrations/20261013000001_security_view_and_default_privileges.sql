-- Security hardening: user_conversations view, default privileges, model_usage_logs writes.
--
-- WARNING: written against the checked-in baseline
-- (20260929000000_baseline_live_public_schema.sql), NOT a live dump. Check it
-- against a live schema dump before it is pushed.
--
-- CLAUDE.md requires a migration plan based on a live schema dump. That check
-- is NOT done yet. Do not push until it is. The model_usage_logs policy swap
-- must also be confirmed against the live policies.
--
-- Idempotent and non-destructive: no DROP of tables, views or columns, no data
-- changes. Only privileges, one view option and one RLS policy change.

-- ─── B1. user_conversations view ────────────────────────────────────────────
-- grep of src/, server/ and scripts/ finds no reader of user_conversations, so
-- locking it down cannot break the app. It exposes email and message content
-- of every user, so anon/authenticated must not read it. The view may already
-- be gone on live, hence the existence guard.
do $$
begin
  if to_regclass('public.user_conversations') is not null then
    revoke all on public.user_conversations from anon, authenticated, PUBLIC;
    alter view public.user_conversations set (security_invoker = true);
  end if;
end
$$;

-- ─── B2. Default privileges on future objects ───────────────────────────────
-- The baseline grants ALL on future tables, sequences and functions in schema
-- public to anon and authenticated (for roles postgres and supabase_admin).
-- Revoke that. Default privileges only affect objects created AFTER this runs,
-- so existing tables (including product_events) keep their current grants.
-- From now on every new table, sequence and function must grant explicitly,
-- e.g. `grant select on public.x to authenticated;` plus RLS policies.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;

-- supabase_admin may not be alterable by the migration role on every setup.
do $$
begin
  alter default privileges for role supabase_admin in schema public revoke all on tables from anon, authenticated;
  alter default privileges for role supabase_admin in schema public revoke all on sequences from anon, authenticated;
  alter default privileges for role supabase_admin in schema public revoke all on functions from anon, authenticated;
exception when insufficient_privilege or undefined_object then
  raise notice 'Skipped supabase_admin default privileges: %', sqlerrm;
end
$$;

-- ─── B3. model_usage_logs: server-only writes ───────────────────────────────
-- The browser (src/) never reads or writes model_usage_logs. The server writes
-- with service_role, which bypasses RLS. Keep an own-rows SELECT policy for
-- authenticated users, remove every write path for anon/authenticated.
revoke all on public.model_usage_logs from anon;
revoke insert, update, delete, truncate on public.model_usage_logs from anon, authenticated;

drop policy if exists "Users own their model usage logs" on public.model_usage_logs;
drop policy if exists "Users read their model usage logs" on public.model_usage_logs;
create policy "Users read their model usage logs"
  on public.model_usage_logs
  for select
  to authenticated
  using (auth.uid() = user_id);
