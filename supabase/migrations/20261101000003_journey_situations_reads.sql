-- Journey 3 of 9: situations, situation_turns, reads, take_follow_up().
--
-- Applied to main (zmzrrmqqxqzmmfovpqjt) on Oct 31 2026, after a fresh
-- read-only check of live (audit/schema_live_2026-10-31.md).
--
-- Shapes: server/journey/schema_needs.md (B4, plus situations.care_flag from B7).
-- Server only: RLS on, no policies, no anon/authenticated grants. All reads and
-- writes go through the Express API with the service role.
-- Idempotent: every statement is guarded.
--
-- ROLLBACK: only before any founder data is stored. Afterwards these rows are
-- founder memory (CLAUDE.md): export first, and get Rafay's approval.

-- ─── situations ─────────────────────────────────────────────────────────────
create table if not exists public.situations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  title text,
  status text not null default 'open'
    constraint situations_status_check check (status in ('open', 'paused', 'closed')),
  -- The database backstop for the cap of 2 follow-up questions (CLAUDE.md).
  follow_up_count integer not null default 0
    constraint situations_follow_up_count_check check (follow_up_count between 0 and 2),
  create_turn_id uuid,
  -- Set when the care gate stops a report note: sharing fails closed.
  care_flag boolean not null default false,
  created_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now()
);

-- POST /api/situations is safe to repeat with the same turn id.
create unique index if not exists situations_user_create_turn_key
  on public.situations (user_id, create_turn_id) where create_turn_id is not null;
create index if not exists situations_user_status_activity_idx
  on public.situations (user_id, status, last_activity_at desc);
create index if not exists situations_user_created_idx
  on public.situations (user_id, created_at);
-- The push scheduler looks for quiet open situations.
create index if not exists situations_status_activity_idx
  on public.situations (status, last_activity_at);

alter table public.situations enable row level security;
revoke all on table public.situations from PUBLIC, anon, authenticated;
grant all on table public.situations to service_role;

-- ─── situation_turns ────────────────────────────────────────────────────────
create table if not exists public.situation_turns (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  situation_id uuid not null references public.situations(id) on delete cascade,
  role text not null constraint situation_turns_role_check check (role in ('founder', 'axiom')),
  text text not null,
  filler boolean not null default false,
  client_turn_id uuid,
  result jsonb,
  created_at timestamptz not null default now()
);

-- A repeated turn id hits this and the code replays the stored result.
create unique index if not exists situation_turns_situation_client_turn_key
  on public.situation_turns (situation_id, client_turn_id) where client_turn_id is not null;
create unique index if not exists situation_turns_seq_key
  on public.situation_turns (seq);
create index if not exists situation_turns_situation_seq_idx
  on public.situation_turns (situation_id, seq);

alter table public.situation_turns enable row level security;
revoke all on table public.situation_turns from PUBLIC, anon, authenticated;
grant all on table public.situation_turns to service_role;

-- ─── reads ──────────────────────────────────────────────────────────────────
create table if not exists public.reads (
  id uuid primary key default gen_random_uuid(),
  situation_id uuid not null references public.situations(id) on delete cascade,
  headline text,
  body text,
  closing_question text,
  source text constraint reads_source_check check (source is null or source in ('model', 'fallback')),
  closing_answer text,
  skipped boolean not null default false,
  answered_at timestamptz,
  created_at timestamptz not null default now()
);

-- One Read per situation; a repeat returns the stored one.
create unique index if not exists reads_situation_key
  on public.reads (situation_id);

alter table public.reads enable row level security;
revoke all on table public.reads from PUBLIC, anon, authenticated;
grant all on table public.reads to service_role;

-- ─── Identity sequence: no client access ────────────────────────────────────
do $$
declare s text;
begin
  s := pg_get_serial_sequence('public.situation_turns', 'seq');
  if s is not null then
    execute format('revoke all on sequence %s from PUBLIC, anon, authenticated', s);
    execute format('grant usage, select on sequence %s to service_role', s);
  end if;
end
$$;

-- ─── take_follow_up ─────────────────────────────────────────────────────────
-- One statement: takes the next follow-up only while fewer than 2 were asked.
-- Returns the new count, or null when the cap is reached or the situation is
-- not this founder's. The server may call it with supabase.rpc instead of its
-- compare-and-swap update; the CHECK above holds either way.
-- SECURITY INVOKER: only service_role may execute it, and it already has the
-- table grants and bypasses RLS.
create or replace function public.take_follow_up(
  p_situation_id uuid,
  p_user_id uuid,
  p_now timestamptz default now()
) returns integer
language sql
security invoker
set search_path = ''
as $$
  update public.situations
     set follow_up_count = follow_up_count + 1,
         last_activity_at = p_now
   where id = p_situation_id
     and user_id = p_user_id
     and follow_up_count < 2
  returning follow_up_count;
$$;

revoke all on function public.take_follow_up(uuid, uuid, timestamptz) from PUBLIC, anon, authenticated;
grant execute on function public.take_follow_up(uuid, uuid, timestamptz) to service_role;
