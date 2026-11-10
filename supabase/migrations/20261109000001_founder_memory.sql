-- Memory layer 1 of 3: the founder memory tables (tasks/memory-plan.md,
-- Revision 2). NOT APPLIED. Needs Rafay's explicit approval, then the
-- migration-checker agent, then apply. Written against the live schema dump of
-- Nov 9 2026 (audit/schema_live_2026-11-09.md): none of these tables exist.
--
-- What Axiom learns about a founder, and the receipt for each piece:
--   founder_beliefs     business facts, behaviour patterns, how they want to be spoken to
--   founder_traits      how they decide, from a CLOSED list (the database refuses any other)
--   founder_world       people, companies, products and channels they mention
--   founder_vocabulary  their shorthand and what it means
--   founder_threads     storylines that run across situations
--   memory_evidence     the verbatim snippet and source behind each item above
--   memory_runs         one row per extraction pass, so nothing is counted twice
--   founder_corrections what the founder marked wrong, so it is not rebuilt
--
-- Personality rule (decisions.md, Nov 9): how the founder works and decides,
-- from what they said or did. Never mood, health, money, family, age,
-- religion, politics or labels. The closed trait list below is how the
-- database itself holds that line.
--
-- There is no stored brief: the short text that goes into prompts is built live by code from these rows.
--
-- Server only, like every journey table: RLS on, no policies, no client
-- grants. Rows go with the founder (on delete cascade, and delete_account in
-- 20261109000003). No existing table is changed. Idempotent.
--
-- ROLLBACK: supabase/rollback/20261109_rollback.sql. Rolling back deletes what
-- was learned; the founder's situations, moves and reports are not touched.

create table if not exists public.founder_beliefs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  belief text not null constraint founder_beliefs_belief_len check (char_length(belief) between 3 and 240),
  kind text not null constraint founder_beliefs_kind_check check (kind in ('fact', 'pattern', 'preference')),
  confidence numeric(3, 2) not null constraint founder_beliefs_confidence_check check (confidence between 0 and 1),
  status text not null default 'active' constraint founder_beliefs_status_check check (status in ('active', 'superseded')),
  superseded_by uuid references public.founder_beliefs(id),
  source text not null constraint founder_beliefs_source_check check (source in ('signup', 'conversation', 'report')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint founder_beliefs_superseded_check check (superseded_by is null or status = 'superseded')
);
create index if not exists founder_beliefs_user_idx on public.founder_beliefs (user_id, status, kind);

create table if not exists public.founder_traits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  dimension text not null,
  value text not null,
  confidence numeric(3, 2) not null constraint founder_traits_confidence_check check (confidence between 0 and 1),
  origin text not null constraint founder_traits_origin_check check (origin in ('self_report', 'observed')),
  status text not null default 'active' constraint founder_traits_status_check check (status in ('active', 'superseded')),
  superseded_by uuid references public.founder_traits(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint founder_traits_superseded_check check (superseded_by is null or status = 'superseded'),
  -- The closed list. A new dimension or value is a deliberate migration, never a model's choice.
  constraint founder_traits_closed_list check (
    (dimension = 'decision_speed' and value in ('fast', 'deliberate', 'waits_until_forced'))
    or (dimension = 'evidence_basis' and value in ('numbers_first', 'gut_first', 'asks_others'))
    or (dimension = 'after_setback' and value in ('changes_approach', 'digs_into_why', 'pauses', 'pushes_harder'))
    or (dimension = 'move_size' and value in ('small_steps', 'big_swings'))
    or (dimension = 'detail_level' and value in ('big_picture', 'detail'))
    or (dimension = 'pace_of_follow_through' and value in ('same_day', 'within_48h', 'drifts'))
  )
);
create unique index if not exists founder_traits_one_active
  on public.founder_traits (user_id, dimension) where status = 'active';

create table if not exists public.founder_world (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null constraint founder_world_name_len check (char_length(name) between 1 and 80),
  kind text not null constraint founder_world_kind_check check (kind in ('person', 'company', 'product', 'channel')),
  role text constraint founder_world_role_len check (role is null or char_length(role) <= 120),
  mention_count integer not null default 1 constraint founder_world_mentions_check check (mention_count >= 1),
  last_mentioned_at timestamptz not null default now(),
  status text not null default 'active' constraint founder_world_status_check check (status in ('active', 'superseded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists founder_world_one_active
  on public.founder_world (user_id, lower(name)) where status = 'active';

create table if not exists public.founder_vocabulary (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  term text not null constraint founder_vocabulary_term_len check (char_length(term) between 1 and 60),
  meaning text not null constraint founder_vocabulary_meaning_len check (char_length(meaning) between 1 and 200),
  confidence numeric(3, 2) not null constraint founder_vocabulary_confidence_check check (confidence between 0 and 1),
  mention_count integer not null default 1 constraint founder_vocabulary_mentions_check check (mention_count >= 1),
  status text not null default 'active' constraint founder_vocabulary_status_check check (status in ('active', 'superseded')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists founder_vocabulary_one_active
  on public.founder_vocabulary (user_id, lower(term)) where status = 'active';

create table if not exists public.founder_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null constraint founder_threads_title_len check (char_length(title) between 3 and 160),
  kind text not null constraint founder_threads_kind_check check (kind in ('goal', 'bet', 'open_question')),
  status text not null default 'open' constraint founder_threads_status_check check (status in ('open', 'done', 'dropped')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists founder_threads_user_idx on public.founder_threads (user_id, status);

-- The receipt. item_id points at a row of item_table (no foreign key: one
-- table serves five). A sign-up answer has no row id, so it carries its
-- question key in source_key instead.
create table if not exists public.memory_evidence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_table text not null constraint memory_evidence_item_table_check
    check (item_table in ('founder_beliefs', 'founder_traits', 'founder_world', 'founder_vocabulary', 'founder_threads')),
  item_id uuid not null,
  source_kind text not null constraint memory_evidence_source_kind_check
    check (source_kind in ('signup', 'situation', 'read', 'learn', 'move', 'swap', 'report')),
  source_id uuid,
  source_key text,
  snippet text not null constraint memory_evidence_snippet_len check (char_length(snippet) between 1 and 200),
  created_at timestamptz not null default now(),
  constraint memory_evidence_source_check check (
    (source_kind = 'signup' and source_key is not null) or (source_kind <> 'signup' and source_id is not null)
  )
);
create index if not exists memory_evidence_item_idx on public.memory_evidence (user_id, item_table, item_id);

create table if not exists public.memory_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_kind text not null constraint memory_runs_source_kind_check check (source_kind in ('signup', 'report', 'move', 'situation')),
  source_id uuid not null,             -- the report, move or situation; the founder's own id for the sign-up seed
  mode text not null constraint memory_runs_mode_check check (mode in ('signup_seed', 'full', 'facts_only')),
  status text not null constraint memory_runs_status_check check (status in ('done', 'failed', 'skipped_care')),
  model text,
  created_at timestamptz not null default now()
);
-- A failed run does not count, so the same report or move can be tried again.
create unique index if not exists memory_runs_once on public.memory_runs (source_kind, source_id, mode)
  where status <> 'failed';
create index if not exists memory_runs_user_idx on public.memory_runs (user_id, created_at desc);

create table if not exists public.founder_corrections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_table text not null constraint founder_corrections_item_table_check
    check (item_table in ('founder_beliefs', 'founder_traits', 'founder_world', 'founder_vocabulary', 'founder_threads')),
  item_text text not null constraint founder_corrections_text_len check (char_length(item_text) between 1 and 240),
  reason text not null constraint founder_corrections_reason_check check (reason in ('wrong', 'outdated')),
  created_at timestamptz not null default now()
);
create index if not exists founder_corrections_user_idx on public.founder_corrections (user_id);

-- Server only: RLS on, no policies, nothing for the browser roles.
alter table public.founder_beliefs enable row level security;
revoke all on table public.founder_beliefs from PUBLIC, anon, authenticated;
grant all on table public.founder_beliefs to service_role;

alter table public.founder_traits enable row level security;
revoke all on table public.founder_traits from PUBLIC, anon, authenticated;
grant all on table public.founder_traits to service_role;

alter table public.founder_world enable row level security;
revoke all on table public.founder_world from PUBLIC, anon, authenticated;
grant all on table public.founder_world to service_role;

alter table public.founder_vocabulary enable row level security;
revoke all on table public.founder_vocabulary from PUBLIC, anon, authenticated;
grant all on table public.founder_vocabulary to service_role;

alter table public.founder_threads enable row level security;
revoke all on table public.founder_threads from PUBLIC, anon, authenticated;
grant all on table public.founder_threads to service_role;

alter table public.memory_evidence enable row level security;
revoke all on table public.memory_evidence from PUBLIC, anon, authenticated;
grant all on table public.memory_evidence to service_role;

alter table public.memory_runs enable row level security;
revoke all on table public.memory_runs from PUBLIC, anon, authenticated;
grant all on table public.memory_runs to service_role;

alter table public.founder_corrections enable row level security;
revoke all on table public.founder_corrections from PUBLIC, anon, authenticated;
grant all on table public.founder_corrections to service_role;
