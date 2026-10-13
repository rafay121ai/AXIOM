-- Revoke browser (anon/authenticated) writes on the app tables.
--
-- WRITTEN AGAINST the checked-in baseline
-- (20260929000000_baseline_live_public_schema.sql), NOT a live schema dump.
-- CLAUDE.md requires a plan based on a live dump before this is pushed:
-- diff the live policies and grants against the baseline first.
--
-- PUSH ONLY AFTER the server and frontend from branch feature/backend-hardening
-- are deployed. The currently live frontend writes to these tables directly
-- and will break if this runs first.
--
-- All writes now go through the Express API (service_role, bypasses RLS and
-- has ALL grants). Browser keeps own-rows SELECT. Browser reads confirmed in
-- src/: sessions, users, conversation_threads, messages. app_sessions and
-- experiments have no browser reads; own-rows SELECT is kept anyway (harmless).
--
-- Triggers (messages_sync_conversation_thread, experiments_set_updated_at)
-- are not SECURITY DEFINER; they run as the writing role. With service_role
-- they keep working (BYPASSRLS, ALL grants on every table).
-- No data changes, no drops of tables or columns. Idempotent.

-- Privileges
revoke insert, update, delete, truncate on public.experiments from anon, authenticated;
revoke all on public.experiments from anon;
revoke insert, update, delete, truncate on public.sessions from anon, authenticated;
revoke all on public.sessions from anon;
revoke insert, update, delete, truncate on public.messages from anon, authenticated;
revoke all on public.messages from anon;
revoke insert, update, delete, truncate on public.conversation_threads from anon, authenticated;
revoke all on public.conversation_threads from anon;
revoke insert, update, delete, truncate on public.app_sessions from anon, authenticated;
revoke all on public.app_sessions from anon;
revoke insert, update, delete, truncate on public.users from anon, authenticated;
revoke all on public.users from anon;

-- experiments
drop policy if exists "Users own their experiments" on public.experiments;
drop policy if exists "Users read their experiments" on public.experiments;
create policy "Users read their experiments" on public.experiments
  for select to authenticated using (auth.uid() = user_id);

-- sessions
drop policy if exists "Users own their sessions" on public.sessions;
drop policy if exists "Users read their sessions" on public.sessions;
create policy "Users read their sessions" on public.sessions
  for select to authenticated using (auth.uid() = user_id);

-- messages (ownership through the session, as in the baseline)
drop policy if exists "Users own their messages" on public.messages;
drop policy if exists "Users read their messages" on public.messages;
create policy "Users read their messages" on public.messages
  for select to authenticated using (
    auth.uid() = (
      select sessions.user_id
      from public.sessions
      where sessions.id = messages.session_id
    )
  );

-- conversation_threads
drop policy if exists "Users own their conversation threads" on public.conversation_threads;
drop policy if exists "Users read their conversation threads" on public.conversation_threads;
create policy "Users read their conversation threads" on public.conversation_threads
  for select to authenticated using (auth.uid() = user_id);

-- app_sessions
drop policy if exists "Users own their app sessions" on public.app_sessions;
drop policy if exists "Users read their app sessions" on public.app_sessions;
create policy "Users read their app sessions" on public.app_sessions
  for select to authenticated using (auth.uid() = user_id);

-- users: users_read_own (SELECT, auth.uid() = id) already exists and stays.
drop policy if exists users_insert_own on public.users;
drop policy if exists users_update_own on public.users;
