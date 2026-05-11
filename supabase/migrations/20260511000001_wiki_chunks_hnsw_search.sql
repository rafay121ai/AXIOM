create extension if not exists vector;

create index if not exists wiki_chunks_embedding_hnsw_idx
on wiki_chunks
using hnsw (embedding vector_cosine_ops)
with (m = 16, ef_construction = 64);

create index if not exists wiki_chunks_pillar_idx
on wiki_chunks (pillar);

create or replace function match_wiki_chunks(
  query_embedding vector(1536),
  match_count int,
  filter_pillar text default null
)
returns table (
  id uuid,
  pillar text,
  title text,
  author text,
  key_frameworks text,
  similarity float
)
language plpgsql
stable
as $$
begin
  if filter_pillar is null then
    return query
      select
        wc.id,
        wc.pillar,
        wc.title,
        wc.author,
        wc.key_frameworks,
        1 - (wc.embedding <=> query_embedding) as similarity
      from wiki_chunks wc
      order by wc.embedding <=> query_embedding
      limit match_count;
  end if;

  return query
    select
      wc.id,
      wc.pillar,
      wc.title,
      wc.author,
      wc.key_frameworks,
      1 - (wc.embedding <=> query_embedding) as similarity
    from wiki_chunks wc
    where wc.pillar = filter_pillar
    order by wc.embedding <=> query_embedding
    limit match_count;
end;
$$;

analyze wiki_chunks;
