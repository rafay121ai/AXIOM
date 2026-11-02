-- Journey 2 of 9: care_events (server/care/).
--
-- Applied to main (zmzrrmqqxqzmmfovpqjt) on Oct 31 2026, after a fresh
-- read-only check of live (audit/schema_live_2026-10-31.md).
--
-- Replaces supabase/pending/care_events_PROPOSED.sql (same shape). Holds NO
-- message text, ever: only the level, an optional situation or thread id and
-- the times. Server only: RLS on, no policies, no client grants.
-- Idempotent: every statement is guarded.
--
-- ROLLBACK: only before any care event is stored; afterwards keep the table
-- (care history decides whether pushes stay paused and sharing stays closed).

create table if not exists public.care_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  level text not null constraint care_events_level_check check (level in ('unclear', 'clear')),
  scope_id uuid,                       -- thread or situation id, for escalation; no foreign key
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists care_events_user_open_idx
  on public.care_events (user_id) where resolved_at is null;
create index if not exists care_events_user_created_idx
  on public.care_events (user_id, created_at desc);

alter table public.care_events enable row level security;
revoke all on table public.care_events from PUBLIC, anon, authenticated;
grant all on table public.care_events to service_role;
