-- For the live Knowledge DB that already has the 4-arg match_lessons(..., filter_books text[]). WRITTEN, NOT RUN.
-- Idempotent. Switches the book filter to wiki source ids.
drop function if exists public.match_lessons(halfvec, integer, text, text[]);

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

create index if not exists lessons_wiki_source_id_idx on public.lessons (wiki_source_id);
