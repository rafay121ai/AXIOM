-- Journey 5 of 9: moves.
--
-- NOT APPLIED. Read supabase/MIGRATION_PLAN.md first. Verify against a fresh
-- read-only dump of the live main schema before pushing.
--
-- Shapes: server/journey/schema_needs.md (B6). Depends on 20261101000003 and
-- 20261101000004. A new table, not the old public.experiments: experiments
-- has session_id NOT NULL with a foreign key to the old sessions, the old
-- status values, and the old web app still reads it. experiments is untouched.
-- Server only: RLS on, no policies, no anon/authenticated grants.
-- Idempotent: every statement is guarded.
--
-- ROLLBACK: only before any founder data is stored (founder memory afterwards).

create table if not exists public.moves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  situation_id uuid not null references public.situations(id) on delete cascade,
  learn_id uuid not null references public.learn_conversations(id) on delete cascade,
  status text not null
    constraint moves_status_check check (status in ('draft', 'committed', 'report_due', 'reported', 'closed_no_report', 'swapped')),
  -- Shown to the founder
  title text not null,
  mission text not null,
  success_condition text not null,
  words text not null default '',
  checklist jsonb not null
    constraint moves_checklist_check check (jsonb_typeof(checklist) = 'array' and jsonb_array_length(checklist) between 2 and 4),
  prediction text not null,
  start_minutes integer not null
    constraint moves_start_minutes_check check (start_minutes between 1 and 10),
  -- Server only
  hypothesis text not null,
  validation jsonb not null,
  swap_reason text,
  -- One swap allowed
  swap_count integer not null default 0
    constraint moves_swap_count_check check (swap_count between 0 and 1),
  swapped_from uuid references public.moves(id),
  -- The cap of 2 committed moves: slot 1 or 2, unique per founder (index below).
  active_slot smallint
    constraint moves_active_slot_check check (active_slot is null or active_slot in (1, 2)),
  committed_at timestamptz,
  report_due_at timestamptz,
  report_time_local text
    constraint moves_report_time_local_check check (report_time_local is null or report_time_local ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  time_zone text
    constraint moves_time_zone_len check (time_zone is null or char_length(time_zone) <= 64),
  closes_at timestamptz,
  closed_at timestamptz,
  swapped_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- NEEDED: a third concurrent commit fails with 23505 (max 2 active moves).
create unique index if not exists moves_user_active_slot_key
  on public.moves (user_id, active_slot) where active_slot is not null;
-- One replacement per move (a repeated swap returns it).
create unique index if not exists moves_swapped_from_key
  on public.moves (swapped_from) where swapped_from is not null;
-- One first move per Learn conversation (a repeated create returns it).
create unique index if not exists moves_learn_first_key
  on public.moves (learn_id) where swapped_from is null;
create index if not exists moves_user_status_created_idx
  on public.moves (user_id, status, created_at);
create index if not exists moves_learn_created_idx
  on public.moves (learn_id, created_at desc);
-- The push scheduler.
create index if not exists moves_status_report_due_idx
  on public.moves (status, report_due_at);
create index if not exists moves_situation_idx
  on public.moves (situation_id);

alter table public.moves enable row level security;
revoke all on table public.moves from PUBLIC, anon, authenticated;
grant all on table public.moves to service_role;
