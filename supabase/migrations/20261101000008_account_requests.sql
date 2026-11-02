-- Journey 8 of 9: account_requests (export and delete requests, B9).
--
-- Applied to main (zmzrrmqqxqzmmfovpqjt) on Oct 31 2026, after a fresh
-- read-only check of live (audit/schema_live_2026-10-31.md).
--
-- POST /api/account/export and DELETE /api/account only insert a waiting row
-- here. Nothing removes founder data; a deletion plan must be written from a
-- live dump and approved first. Server only: RLS on, no policies, no client
-- grants. Idempotent: every statement is guarded.
--
-- ROLLBACK: only while no request has been stored.

create table if not exists public.account_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  kind text not null constraint account_requests_kind_check check (kind in ('export', 'delete')),
  status text not null default 'queued',
  created_at timestamptz not null default now()
);

-- One waiting request per kind: a double tap or a race cannot queue two.
create unique index if not exists account_requests_user_kind_queued_key
  on public.account_requests (user_id, kind) where status = 'queued';

alter table public.account_requests enable row level security;
revoke all on table public.account_requests from PUBLIC, anon, authenticated;
grant all on table public.account_requests to service_role;
