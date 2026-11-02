-- Journey 10 of 10: founder_lesson_log (give to get: which founder lessons a
-- founder has been shown).
--
-- Applied to main (zmzrrmqqxqzmmfovpqjt) on Oct 31 2026, after a fresh
-- read-only dump of the live main schema before pushing. Touches the give-to-get
-- rule (CLAUDE.md: consent and peer outcome logic): it needs Rafay's approval.
--
-- Shapes: server/journey/schema_needs.md (founder_lesson_log). Depends on nothing
-- but auth.users. Server only: RLS on, no policies, no anon/authenticated grants.
-- Idempotent.
--
-- One row per approved story actually shown, plus one 'closed_notice' row when
-- the founder was told once that the free lessons are used up.
--   source_key: 'report:<report id>' or 'learn:<learn conversation id>': a
--     repeat of the same request hits the unique key and counts nothing.
--   slot: 1 or 2 for the two free lessons. unique (user_id, slot) is the
--     compare-and-swap: two simultaneous requests cannot both take slot 2.
--     null for a lesson shown while sharing was on (not counted).
-- Access is never stored: the server derives it on every request from this
-- table, user_settings.share_auto and peer_unlocks.
--
-- ROLLBACK: supabase/rollback/20261101_rollback.sql, step 10.

create table if not exists public.founder_lesson_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  source_key text not null,
  slot smallint constraint founder_lesson_log_slot_check check (slot in (1, 2)),
  created_at timestamptz not null default now()
);

create unique index if not exists founder_lesson_log_source_key
  on public.founder_lesson_log (user_id, source_key);
create unique index if not exists founder_lesson_log_slot_key
  on public.founder_lesson_log (user_id, slot);

alter table public.founder_lesson_log enable row level security;
revoke all on table public.founder_lesson_log from PUBLIC, anon, authenticated;
grant all on table public.founder_lesson_log to service_role;
