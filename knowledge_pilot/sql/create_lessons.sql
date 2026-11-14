-- Lean lessons table for the Axiom Knowledge project. Written for the live DB, not run by an agent.
-- Change Nov 14: match_lessons filters by filter_sources (wiki_sources.id uuids) instead of filter_books (author|title
-- spellings differ between local and live). A live DB that has the old 4-arg version: run migrate_match_lessons_by_source.sql.
-- Run only after EVAL.md is accepted and a schema dump of the live Knowledge project has been compared.
-- pgvector 0.8.0 is installed there, so halfvec is available (half the storage of vector).

create table if not exists public.lessons (
  lesson_id          text primary key,
  source_id          text not null,                 -- local library slug, e.g. how-companies-win-books-crossing-the-chasm
  wiki_source_id     uuid references public.wiki_sources(id) on delete set null,
  source_title       text not null,
  author             text,
  pillar             text,                          -- source pillar
  pillars            text[] not null default '{}',  -- pillars the lesson itself belongs to
  chapter            text,
  page_start         integer,
  page_end           integer,
  title              text not null,
  author_argues      text not null,
  principle          text not null,
  evidence           text,
  caveat             text,
  short_quote        text,
  applies_when       text not null,
  example_questions  jsonb not null default '[]',
  lesson_type        text,
  origin             text,                          -- extract | sweep
  paragraph_ids      text[] not null,
  paragraphs         jsonb not null,                -- [{id, text}] the cited source text, verbatim
  extraction_version text not null,
  prompt_version     text,
  editor_version     text,
  model              text,
  embedding          halfvec(512) not null,         -- text-embedding-3-small, 512 dims
  created_at         timestamptz not null default now()
);

create index if not exists lessons_embedding_hnsw_idx
  on public.lessons using hnsw (embedding halfvec_cosine_ops) with (m = 16, ef_construction = 64);
create index if not exists lessons_source_id_idx on public.lessons (source_id);
create index if not exists lessons_wiki_source_id_idx on public.lessons (wiki_source_id);
create index if not exists lessons_pillar_idx on public.lessons (pillar);
create index if not exists lessons_pillars_gin_idx on public.lessons using gin (pillars);

-- Server only (changed Nov 14): the table holds verbatim book paragraphs, so the anon key must not read it.
-- The server reads it with the service role, which bypasses RLS. RLS on, no policy, no client grants.
-- Writes come only through the service role from upload_lessons.py.
alter table public.lessons enable row level security;

revoke all on table public.lessons from public, anon, authenticated;
grant all on table public.lessons to service_role;

-- Nearest lessons with the cited paragraphs, so the app builds "what the author argues" at answer time.
create or replace function public.match_lessons(
  query_embedding halfvec(512),
  match_count integer default 5,
  filter_pillar text default null,
  filter_sources uuid[] default null
)
returns table (
  lesson_id text, source_id text, wiki_source_id uuid, source_title text, author text, pillar text, pillars text[],
  chapter text, page_start integer, page_end integer,
  title text, author_argues text, principle text, evidence text, caveat text, short_quote text,
  applies_when text, example_questions jsonb, lesson_type text,
  paragraph_ids text[], paragraphs jsonb, similarity double precision
)
language sql stable
as $$
  select l.lesson_id, l.source_id, l.wiki_source_id, l.source_title, l.author, l.pillar, l.pillars,
         l.chapter, l.page_start, l.page_end,
         l.title, l.author_argues, l.principle, l.evidence, l.caveat, l.short_quote,
         l.applies_when, l.example_questions, l.lesson_type,
         l.paragraph_ids, l.paragraphs,
         1 - (l.embedding <=> query_embedding) as similarity
  from public.lessons l
  where (filter_pillar is null or l.pillar = filter_pillar or filter_pillar = any (l.pillars))
    and (filter_sources is null or l.wiki_source_id = any (filter_sources))
  -- "+ 0" keeps the planner off the HNSW index, which would stop at its first ~40 nearest rows of ALL lessons and
  -- let the source filter leave too few. The filtered set is a few thousand rows, so an exact sort is fast, and this
  -- needs no session setting (the SQL editor role may not set hnsw.iterative_scan).
  order by (l.embedding <=> query_embedding) + 0
  limit least(match_count, 50);
$$;

revoke execute on function public.match_lessons(halfvec, integer, text, uuid[]) from public, anon, authenticated;
grant execute on function public.match_lessons(halfvec, integer, text, uuid[]) to service_role;
