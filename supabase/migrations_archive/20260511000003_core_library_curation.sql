alter table wiki_sources
  add column if not exists is_core_library boolean not null default true;

create index if not exists wiki_sources_core_pillar_idx
  on wiki_sources (is_core_library, pillar);

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
      join wiki_sources ws on ws.id = wc.source_id
      where ws.is_core_library = true
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
    join wiki_sources ws on ws.id = wc.source_id
    where ws.is_core_library = true
      and wc.pillar = filter_pillar
    order by wc.embedding <=> query_embedding
    limit match_count;
end;
$$;

analyze wiki_sources;
analyze wiki_chunks;
