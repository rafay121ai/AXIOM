-- Lean lessons table for the Axiom Knowledge project. WRITTEN, NOT RUN.
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
create index if not exists lessons_pillar_idx on public.lessons (pillar);
create index if not exists lessons_pillars_gin_idx on public.lessons using gin (pillars);

-- Same access model as wiki_chunks and wiki_sources: public read, no anon writes.
-- Writes come only through the service role (which bypasses RLS) from upload_lessons.py.
alter table public.lessons enable row level security;

drop policy if exists "Public read lessons" on public.lessons;
create policy "Public read lessons" on public.lessons
  for select to anon using (true);

revoke insert, update, delete, truncate on public.lessons from anon, authenticated;

-- Nearest lessons with the cited paragraphs, so the app builds "what the author argues" at answer time.
create or replace function public.match_lessons(
  query_embedding halfvec(512),
  match_count integer default 5,
  filter_pillar text default null
)
returns table (
  lesson_id text, source_id text, source_title text, author text, pillar text, pillars text[],
  chapter text, page_start integer, page_end integer,
  title text, author_argues text, principle text, evidence text, caveat text, short_quote text,
  applies_when text, example_questions jsonb, lesson_type text,
  paragraph_ids text[], paragraphs jsonb, similarity double precision
)
language sql stable
as $$
  select l.lesson_id, l.source_id, l.source_title, l.author, l.pillar, l.pillars,
         l.chapter, l.page_start, l.page_end,
         l.title, l.author_argues, l.principle, l.evidence, l.caveat, l.short_quote,
         l.applies_when, l.example_questions, l.lesson_type,
         l.paragraph_ids, l.paragraphs,
         1 - (l.embedding <=> query_embedding) as similarity
  from public.lessons l
  where filter_pillar is null or l.pillar = filter_pillar or filter_pillar = any (l.pillars)
  order by l.embedding <=> query_embedding
  limit least(match_count, 50);
$$;

grant execute on function public.match_lessons(halfvec, integer, text) to anon, authenticated;
