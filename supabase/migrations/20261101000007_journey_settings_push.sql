-- Journey 7 of 9: user_settings, push_tokens, notification_log.
--
-- Applied to main (zmzrrmqqxqzmmfovpqjt) on Oct 31 2026, after a fresh
-- read-only check of live (audit/schema_live_2026-10-31.md).
--
-- Shapes: server/journey/schema_needs.md (B7 share_auto, B8 reminders and
-- pushes, B9 home and settings). Depends on 20261101000003 and 20261101000005.
-- Server only: RLS on, no policies, no anon/authenticated grants.
-- Idempotent: every statement is guarded. user_settings uses
-- add column if not exists for every column, so a partial live table is
-- completed rather than skipped.
--
-- ROLLBACK: only before any founder has saved a setting or a device.

-- ─── user_settings ──────────────────────────────────────────────────────────
-- Every column has a default: each part of the server inserts a row with only
-- the column it needs.
create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id),
  updated_at timestamptz not null default now()
);

alter table public.user_settings add column if not exists share_auto boolean not null default false;
alter table public.user_settings add column if not exists morning_on boolean not null default true;
alter table public.user_settings add column if not exists evening_on boolean not null default true;
alter table public.user_settings add column if not exists lock_screen text not null default 'short';
alter table public.user_settings add column if not exists quiet_start time not null default '22:00';
alter table public.user_settings add column if not exists quiet_end time not null default '06:00';
alter table public.user_settings add column if not exists last_greeting text;
alter table public.user_settings add column if not exists keep_items boolean not null default false;
alter table public.user_settings add column if not exists mentor_style text not null default 'direct';
alter table public.user_settings add column if not exists created_at timestamptz not null default now();

-- The checks are NOT VALID: a live user_settings that already holds other
-- values (ARCHITECTURE.md once named lock_screen 'nothing') cannot abort this
-- file. New and updated rows are checked; old rows are not until someone runs
-- `alter table public.user_settings validate constraint ...` after fixing them
-- (MIGRATION_PLAN.md, before applying, step 7).
alter table public.user_settings drop constraint if exists user_settings_lock_screen_check;
alter table public.user_settings add constraint user_settings_lock_screen_check
  check (lock_screen in ('full', 'short', 'hidden')) not valid;

alter table public.user_settings drop constraint if exists user_settings_mentor_style_check;
alter table public.user_settings add constraint user_settings_mentor_style_check
  check (mentor_style in ('calm', 'direct', 'hard')) not valid;

alter table public.user_settings drop constraint if exists user_settings_last_greeting_len;
alter table public.user_settings add constraint user_settings_last_greeting_len
  check (last_greeting is null or char_length(last_greeting) <= 64) not valid;

alter table public.user_settings enable row level security;
revoke all on table public.user_settings from PUBLIC, anon, authenticated;
grant all on table public.user_settings to service_role;

-- ─── push_tokens ────────────────────────────────────────────────────────────
create table if not exists public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null,
  platform text not null constraint push_tokens_platform_check check (platform in ('ios', 'android')),
  timezone text constraint push_tokens_timezone_len check (timezone is null or char_length(timezone) <= 64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- NEEDED: one row per device; registering it from another account moves it.
create unique index if not exists push_tokens_token_key
  on public.push_tokens (token);
create index if not exists push_tokens_user_updated_idx
  on public.push_tokens (user_id, updated_at desc);

alter table public.push_tokens enable row level security;
revoke all on table public.push_tokens from PUBLIC, anon, authenticated;
grant all on table public.push_tokens to service_role;

-- ─── notification_log (the 2 a day cap) ─────────────────────────────────────
-- The row is claimed before the push is sent. The push text is never stored.
create table if not exists public.notification_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null
    constraint notification_log_kind_check check (kind in ('morning', 'quiet_check', 'evening', 'reminder')),
  dedupe_key text not null,
  -- The founder's local date at send; the cap counts today's sending/sent rows.
  local_day date not null,
  -- The daily slot this push uses. With the partial unique index below the
  -- database, not memory, enforces at most 2 pushes a day.
  slot text not null constraint notification_log_slot_check check (slot in ('morning', 'evening')),
  status text not null
    constraint notification_log_status_check check (status in ('sending', 'sent', 'failed')),
  attempts smallint not null default 1
    constraint notification_log_attempts_check check (attempts between 1 and 3),
  error text,               -- an Expo error code only, never push text
  move_id uuid references public.moves(id) on delete set null,
  situation_id uuid references public.situations(id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  updated_at timestamptz not null default now()
);

-- NEEDED: a second tick or process that hits this sends nothing.
create unique index if not exists notification_log_user_dedupe_key
  on public.notification_log (user_id, dedupe_key);
-- NEEDED: one live push per slot per local day (the cap of 2, in the database).
create unique index if not exists notification_log_user_day_slot_key
  on public.notification_log (user_id, local_day, slot) where status in ('sending', 'sent');
create index if not exists notification_log_user_created_idx
  on public.notification_log (user_id, created_at desc);

alter table public.notification_log enable row level security;
revoke all on table public.notification_log from PUBLIC, anon, authenticated;
grant all on table public.notification_log to service_role;
