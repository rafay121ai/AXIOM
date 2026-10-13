-- Security hardening: user_conversations view, default privileges, model_usage_logs writes.
--
-- Checked against a live schema dump on 2026-10-13: no conflicts. Push order: see tasks/todo.md.
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

-- ─── B4. Table grants tightened ─────────────────────────────────────────────
-- Browser roles never need TRUNCATE, REFERENCES or TRIGGER on any table.
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;

-- personal_memories, wiki_chunks, wiki_sources: all writes go through the
-- Express API (service_role). grep of src/, server/, scripts/ shows no browser
-- write. wiki_chunks/wiki_sources are read in the browser only from the
-- separate knowledge project, and by service-role scripts here.
revoke insert, update, delete on public.personal_memories, public.wiki_chunks, public.wiki_sources from anon, authenticated;

-- anon SELECT: the only main-project browser read is match_personal_memories
-- (SECURITY INVOKER) from the signed-in Chat page; with no session
-- auth.uid() is null so the "Users read own memories" policy returns nothing.
-- Nothing reads these tables without a signed-in session, so anon loses SELECT.
-- authenticated keeps SELECT: the personal_memories policy and
-- match_personal_memories rely on it.
revoke select on public.personal_memories from anon;
revoke select on public.wiki_chunks from anon;
revoke select on public.wiki_sources from anon;
