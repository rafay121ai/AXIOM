create extension if not exists vector;
create extension if not exists pgcrypto;

do $$
begin
  create type concept_learning_state as enum ('encountered', 'partial', 'absorbed');
exception
  when duplicate_object then null;
end;
$$;

create table if not exists wiki_sources (
  id uuid primary key default gen_random_uuid(),
  pillar text not null,
  content_type text not null,
  title text not null,
  author text,
  source_url text,
  source_key text,
  summary_for_retrieval text,
  source_quality text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  enrichment_status text,
  enrichment_version text,
  enriched_at timestamptz,
  source_claims jsonb,
  axiom_interpretation jsonb,
  source_claims_confidence double precision,
  axiom_interpretation_confidence double precision,
  published_at timestamptz,
  is_core_library boolean not null default true
);

create unique index if not exists wiki_sources_source_key_idx
  on wiki_sources (source_key)
  where source_key is not null;

create index if not exists wiki_sources_pillar_idx
  on wiki_sources (pillar);

create index if not exists wiki_sources_published_at_idx
  on wiki_sources (published_at desc);

create index if not exists wiki_sources_core_pillar_idx
  on wiki_sources (is_core_library, pillar);

create table if not exists wiki_chunks (
  id uuid primary key default gen_random_uuid(),
  pillar text not null,
  content_type text,
  title text,
  author text,
  key_frameworks text,
  embedding vector(1536) not null,
  created_at timestamptz not null default now(),
  chunk_index integer,
  source_id uuid references wiki_sources(id) on delete set null
);

create index if not exists wiki_chunks_embedding_hnsw_idx
  on wiki_chunks
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

create index if not exists wiki_chunks_pillar_idx
  on wiki_chunks (pillar);

create index if not exists wiki_chunks_source_id_idx
  on wiki_chunks (source_id);

create table if not exists source_learning_maps (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references wiki_sources(id) on delete cascade,
  concept_index integer not null,
  concept_name text not null,
  concept_description text not null,
  why_it_matters text not null,
  absorbed_signal text not null,
  created_at timestamptz not null default now(),
  unique (source_id, concept_index)
);

create index if not exists source_learning_maps_source_id_idx
  on source_learning_maps (source_id);

create table if not exists user_concept_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  concept_id uuid not null references source_learning_maps(id) on delete cascade,
  state concept_learning_state not null default 'encountered',
  updated_at timestamptz not null default now(),
  unique (user_id, concept_id)
);

create index if not exists user_concept_states_user_id_idx
  on user_concept_states (user_id);

create index if not exists user_concept_states_concept_id_idx
  on user_concept_states (concept_id);

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
