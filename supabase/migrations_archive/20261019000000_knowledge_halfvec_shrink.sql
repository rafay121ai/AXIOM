-- ALREADY APPLIED MANUALLY on 2026-10-19 to the Axiom Knowledge project (ref ecbcwyjvswgvbiicnynw).
-- DO NOT PUSH. DO NOT APPLY. This file only records what was done.
-- It is kept in migrations_archive/ on purpose: running it against the main Axiom project would alter
-- a different wiki_chunks table. Backup taken before the change:
--   /Users/rafayessani/AXIOM-backups/2026-10-19/knowledge/ (wiki_chunks, wiki_sources, source_learning_maps, with sha256 manifest)
--
-- Result: database 511 MB -> 223 MB. wiki_chunks embedding column 123 MB -> 62 MB, HNSW index 205 MB -> 82 MB.
--
-- Also done that day, as data cleanup (not repeated here): 8 duplicate wiki_sources and their 1,338 wiki_chunks
-- were deleted (source_learning_maps rows went with them by cascade); the ids are listed in
-- AXIOM-wt/KNOWLEDGE_SHRINK.md. wiki_chunks.source_id is ON DELETE SET NULL, so chunks were deleted explicitly first.
--
-- Order actually used: 1) drop old index, 2) alter column + replace function in one transaction,
-- 3) rebuild index (maintenance_work_mem 128MB), analyze, 4) function replaced again to add set_config
-- for hnsw.ef_search (recall on off-distribution queries was 0.953 at the default 40, 0.987 at 200).

-- 1. The old full precision index (vector_cosine_ops, m=16, ef_construction=64) was dropped first.
drop index if exists wiki_chunks_embedding_hnsw_idx;

-- 2. Embeddings to half precision. Done in one transaction with statement_timeout = 15min.
alter table public.wiki_chunks
  alter column embedding type halfvec(1536) using embedding::halfvec(1536);

-- 3. Search function: same signature and return columns, copied exactly from the live database
--    (pg_get_functiondef, 2026-10-19). The query vector arrives as vector and is cast to halfvec(1536).
CREATE OR REPLACE FUNCTION public.match_wiki_chunks(query_embedding vector, match_count integer, filter_pillar text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, pillar text, title text, author text, key_frameworks text, similarity double precision)
 LANGUAGE plpgsql
 STABLE
AS $function$
begin
  perform set_config('hnsw.ef_search', '200', true);
  if filter_pillar is null then
    return query
      select
        wc.id,
        wc.pillar,
        wc.title,
        wc.author,
        wc.key_frameworks,
        1 - (wc.embedding <=> query_embedding::halfvec(1536)) as similarity
      from wiki_chunks wc
      join wiki_sources ws on ws.id = wc.source_id
      where ws.is_core_library = true
      order by wc.embedding <=> query_embedding::halfvec(1536)
      limit match_count;
    return;
  end if;

  return query
    select
      wc.id,
      wc.pillar,
      wc.title,
      wc.author,
      wc.key_frameworks,
      1 - (wc.embedding <=> query_embedding::halfvec(1536)) as similarity
    from wiki_chunks wc
    join wiki_sources ws on ws.id = wc.source_id
    where ws.is_core_library = true
      and wc.pillar = filter_pillar
    order by wc.embedding <=> query_embedding::halfvec(1536)
    limit match_count;
end;
$function$;

-- 4. Search index on half precision vectors. Built with maintenance_work_mem = '128MB', statement_timeout = '15min'.
create index wiki_chunks_embedding_hnsw_idx
  on public.wiki_chunks using hnsw (embedding halfvec_cosine_ops);

analyze public.wiki_chunks;
