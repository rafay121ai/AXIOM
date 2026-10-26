-- PROPOSED, not applied. Needs Rafay's approval and a read-only dump of the
-- live schema first (CLAUDE.md). Holds NO message text, ever.
create table if not exists public.care_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  level text not null check (level in ('unclear', 'clear')),
  scope_id uuid,                       -- thread or situation id, for escalation
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists care_events_user_open_idx on public.care_events (user_id) where resolved_at is null;
alter table public.care_events enable row level security;  -- no policies: server (service role) only
