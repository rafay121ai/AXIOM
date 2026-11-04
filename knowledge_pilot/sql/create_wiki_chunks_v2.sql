-- create_wiki_chunks_v2.sql
-- Target: Axiom - Knowledge project (ecbcwyjvswgvbiicnynw).
-- STATUS: WRITTEN, NOT RUN. Review on cutover day. Do not apply from an agent.
--
-- Based on a read-only inspection (2026-10-13) of the live project:
--   pgvector 0.8.0 installed in schema public (halfvec supported, needs >= 0.7)
--   wiki_chunks: 22,308 rows, 496 MB total, embedding vector(1536), HNSW cosine
--   RLS on, one policy: "Public read wiki_chunks" SELECT to anon using (true)
--   match_wiki_chunks(query_embedding, match_count, filter_pillar) returns
--   id, pillar, title, author, key_frameworks, similarity (no text)
--   Note: anon/authenticated hold INSERT/UPDATE/DELETE/TRUNCATE table grants
--   (only RLS blocks them). v2 revokes those grants explicitly.
--
-- This is a new table. Nothing existing is altered or dropped.

begin;


create table public.wiki_chunks_v2 (
  id               uuid primary key default gen_random_uuid(),
  chunk_key        text not null unique,        -- '<source_id>_<seq>', stable across reruns
  source_id        text not null,
  book             text not null,
  author           text,
  pillar           text not null,               -- book_pillar (folder pillar)
  pillars          text[] not null default '{}',-- pillars the passage serves
  chapter          text,
  section          text,
  page_start       integer,
  page_end         integer,
  position         integer,                     -- order within source
  prev_id          text,                        -- chunk_key of previous chunk
  next_id          text,                        -- chunk_key of next chunk
  continues        boolean not null default false,
  word_count       integer not null,
  flags            text[] not null default '{}',
  text             text not null,
  context_line     text,
  summary          text,
  key_takeaway     text,                        -- null when lesson_strength = 'none'
  example_questions text[] not null default '{}',
  chunk_type       text check (chunk_type in ('argument','story','data')),
  applies_when     text[] not null default '{}',
  lesson_strength  text check (lesson_strength in ('strong','weak','none')),
  pipeline_version text not null,
  embedding        halfvec(512) not null,
  created_at       timestamptz not null default now()
);

create index wiki_chunks_v2_embedding_hnsw_idx
  on public.wiki_chunks_v2
  using hnsw (embedding halfvec_cosine_ops)
  with (m = 16, ef_construction = 64);
create index wiki_chunks_v2_pillar_idx   on public.wiki_chunks_v2 (pillar);
create index wiki_chunks_v2_source_idx   on public.wiki_chunks_v2 (source_id, position);
create index wiki_chunks_v2_strength_idx on public.wiki_chunks_v2 (lesson_strength);

alter table public.wiki_chunks_v2 enable row level security;

-- Same read access as wiki_chunks: public read. No write policy exists, so
-- anon and authenticated cannot write; service_role bypasses RLS.
create policy "Public read wiki_chunks_v2"
  on public.wiki_chunks_v2 for select to anon using (true);
create policy "Authenticated read wiki_chunks_v2"
  on public.wiki_chunks_v2 for select to authenticated using (true);

-- Belt and braces: remove the write grants the old table still carries.
revoke all on public.wiki_chunks_v2 from anon, authenticated;
grant select on public.wiki_chunks_v2 to anon, authenticated;
grant all on public.wiki_chunks_v2 to service_role;

-- Retrieval. Query embedding is 512 dimensions (text-embedding-3-small with
-- dimensions=512), cast to halfvec by the caller or implicitly by PostgREST.
-- Rows with lesson_strength = 'none' are excluded by default: they have no
-- key_takeaway and should not be taught from.
create or replace function public.match_wiki_chunks_v2(
  query_embedding  halfvec(512),
  match_count      integer default 8,
  filter_pillar    text default null,
  include_none     boolean default false
)
returns table (
  id               uuid,
  chunk_key        text,
  text             text,
  summary          text,
  key_takeaway     text,
  context_line     text,
  book             text,
  author           text,
  pillar           text,
  pillars          text[],
  chapter          text,
  page_start       integer,
  page_end         integer,
  chunk_type       text,
  applies_when     text[],
  lesson_strength  text,
  prev_id          text,
  next_id          text,
  continues        boolean,
  similarity       double precision
)
language sql
stable
set search_path = public
as $$
  select
    c.id, c.chunk_key, c.text, c.summary, c.key_takeaway, c.context_line,
    c.book, c.author, c.pillar, c.pillars, c.chapter, c.page_start, c.page_end,
    c.chunk_type, c.applies_when, c.lesson_strength, c.prev_id, c.next_id,
    c.continues,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.wiki_chunks_v2 c
  where (filter_pillar is null or c.pillar = filter_pillar or filter_pillar = any (c.pillars))
    and (include_none or c.lesson_strength <> 'none')
  order by c.embedding <=> query_embedding
  limit least(greatest(match_count, 1), 50);
$$;

revoke all on function public.match_wiki_chunks_v2(halfvec, integer, text, boolean) from public;
grant execute on function public.match_wiki_chunks_v2(halfvec, integer, text, boolean)
  to anon, authenticated, service_role;

commit;

-- Rollback (cutover day, if needed): drop function public.match_wiki_chunks_v2(halfvec, integer, text, boolean);
-- drop table public.wiki_chunks_v2;
