-- Stored weekly Axiom reads per session.
-- Run this in the Supabase SQL editor.

create table if not exists weekly_reads (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  week_start date not null,
  content text not null,
  source_message_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists weekly_reads_session_week_idx
on weekly_reads (session_id, week_start);

create index if not exists weekly_reads_session_created_idx
on weekly_reads (session_id, created_at desc);
