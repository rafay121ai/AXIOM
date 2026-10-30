-- Journey 4 of 9: learn_conversations, learn_turns, lesson_citations.
--
-- NOT APPLIED. Read supabase/MIGRATION_PLAN.md first. Verify against a fresh
-- read-only dump of the live main schema before pushing.
--
-- Shapes: server/journey/schema_needs.md (B5b). Depends on 20261101000003.
-- Server only: RLS on, no policies, no anon/authenticated grants. evidence and
-- validation are server-only and are never returned by the API.
-- Idempotent: every statement is guarded.
--
-- ROLLBACK: only before any founder data is stored (founder memory afterwards).

-- ─── learn_conversations ────────────────────────────────────────────────────
create table if not exists public.learn_conversations (
  id uuid primary key default gen_random_uuid(),
  situation_id uuid not null references public.situations(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  -- The real-reply count at each move offer; at most 2 move cards.
  offers integer[] not null default '{}'
    constraint learn_conversations_offers_max check (cardinality(offers) <= 2),
  move_subject text,
  move_fact text,
  after_cap_said boolean not null default false,
  lock_token uuid,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One Learn conversation per situation; a second start returns the stored one.
create unique index if not exists learn_conversations_situation_key
  on public.learn_conversations (situation_id);
create index if not exists learn_conversations_user_idx
  on public.learn_conversations (user_id, situation_id);

alter table public.learn_conversations enable row level security;
revoke all on table public.learn_conversations from PUBLIC, anon, authenticated;
grant all on table public.learn_conversations to service_role;

-- ─── learn_turns ────────────────────────────────────────────────────────────
create table if not exists public.learn_turns (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  conversation_id uuid not null references public.learn_conversations(id) on delete cascade,
  role text not null constraint learn_turns_role_check check (role in ('founder', 'axiom')),
  kind text constraint learn_turns_kind_check check (kind is null or kind in ('lesson', 'reply', 'followup')),
  text text not null,
  filler boolean not null default false,
  client_turn_id uuid,
  result jsonb,
  evidence jsonb,                                  -- server only
  sources jsonb not null default '[]'::jsonb,
  picture jsonb,
  follow_ups jsonb not null default '[]'::jsonb,
  validation jsonb not null default '[]'::jsonb,   -- server only
  move_offer text not null default 'none'
    constraint learn_turns_move_offer_check check (move_offer in ('none', 'first', 'second')),
  move_notice jsonb,
  parent_turn_id uuid references public.learn_turns(id),
  followup_index integer,
  created_at timestamptz not null default now()
);

-- A repeated founder turn returns the stored result.
create unique index if not exists learn_turns_conversation_client_turn_key
  on public.learn_turns (conversation_id, client_turn_id) where client_turn_id is not null;
-- A follow-up tap is answered once.
create unique index if not exists learn_turns_parent_followup_key
  on public.learn_turns (parent_turn_id, followup_index) where parent_turn_id is not null and followup_index is not null;
create unique index if not exists learn_turns_seq_key
  on public.learn_turns (seq);
create index if not exists learn_turns_conversation_seq_idx
  on public.learn_turns (conversation_id, seq);

alter table public.learn_turns enable row level security;
revoke all on table public.learn_turns from PUBLIC, anon, authenticated;
grant all on table public.learn_turns to service_role;

-- ─── lesson_citations ───────────────────────────────────────────────────────
-- chunk_ids point at wiki_chunks.id in the separate Knowledge project, so
-- there is no foreign key across projects.
create table if not exists public.lesson_citations (
  id uuid primary key default gen_random_uuid(),
  learn_turn_id uuid not null references public.learn_turns(id) on delete cascade,
  chunk_ids uuid[] not null,
  author text not null,
  book_title text not null,
  quote text,                                      -- only when verified word for word
  created_at timestamptz not null default now()
);

create index if not exists lesson_citations_turn_idx
  on public.lesson_citations (learn_turn_id);

alter table public.lesson_citations enable row level security;
revoke all on table public.lesson_citations from PUBLIC, anon, authenticated;
grant all on table public.lesson_citations to service_role;

-- ─── Identity sequence: no client access ────────────────────────────────────
do $$
declare s text;
begin
  s := pg_get_serial_sequence('public.learn_turns', 'seq');
  if s is not null then
    execute format('revoke all on sequence %s from PUBLIC, anon, authenticated', s);
    execute format('grant usage, select on sequence %s to service_role', s);
  end if;
end
$$;
