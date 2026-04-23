-- Personal memory layer for Axiom.
-- Run this in the Supabase SQL editor after pgvector is enabled.

create extension if not exists vector;

alter table sessions
add column if not exists session_notes text;

create table if not exists personal_memories (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  type text not null check (
    type in (
      'goal',
      'pattern',
      'belief',
      'experiment_result',
      'preference',
      'decision',
      'fact'
    )
  ),
  content text not null,
  importance int not null default 3 check (importance between 1 and 5),
  embedding vector(1536) not null,
  confidence float not null default 0.7 check (confidence >= 0 and confidence <= 1),
  use_count int not null default 0,
  last_used_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table personal_memories
add column if not exists confidence float not null default 0.7 check (confidence >= 0 and confidence <= 1);

alter table personal_memories
add column if not exists use_count int not null default 0;

alter table personal_memories
add column if not exists last_used_at timestamptz;

alter table personal_memories
add column if not exists updated_at timestamptz not null default now();

create index if not exists personal_memories_session_created_idx
on personal_memories (session_id, created_at desc);

create index if not exists personal_memories_embedding_idx
on personal_memories
using ivfflat (embedding vector_cosine_ops)
with (lists = 100);

drop function if exists match_personal_memories(vector, uuid, integer, double precision);
drop function if exists match_personal_memories(vector, uuid, int, float);

create or replace function match_personal_memories(
  query_embedding vector(1536),
  match_session_id uuid,
  match_count int default 5,
  similarity_threshold float default 0.35
)
returns table (
  id uuid,
  session_id uuid,
  type text,
  content text,
  importance int,
  confidence float,
  use_count int,
  last_used_at timestamptz,
  similarity float
)
language sql stable
as $$
  select
    pm.id,
    pm.session_id,
    pm.type,
    pm.content,
    pm.importance,
    pm.confidence,
    pm.use_count,
    pm.last_used_at,
    1 - (pm.embedding <=> query_embedding) as similarity
  from personal_memories pm
  where pm.session_id = match_session_id
    and 1 - (pm.embedding <=> query_embedding) >= similarity_threshold
  order by
    pm.embedding <=> query_embedding,
    pm.importance desc,
    pm.confidence desc,
    pm.created_at desc
  limit match_count;
$$;

drop function if exists find_similar_personal_memory(vector, uuid, text, double precision);
drop function if exists find_similar_personal_memory(vector, uuid, text, float);

create or replace function find_similar_personal_memory(
  query_embedding vector(1536),
  match_session_id uuid,
  match_type text,
  similarity_threshold float default 0.82
)
returns table (
  id uuid,
  content text,
  importance int,
  confidence float,
  similarity float
)
language sql stable
as $$
  select
    pm.id,
    pm.content,
    pm.importance,
    pm.confidence,
    1 - (pm.embedding <=> query_embedding) as similarity
  from personal_memories pm
  where pm.session_id = match_session_id
    and pm.type = match_type
    and 1 - (pm.embedding <=> query_embedding) >= similarity_threshold
  order by pm.embedding <=> query_embedding
  limit 1;
$$;

drop function if exists mark_personal_memories_used(uuid[]);

create or replace function mark_personal_memories_used(memory_ids uuid[])
returns void
language sql
as $$
  update personal_memories
  set
    use_count = use_count + 1,
    last_used_at = now(),
    updated_at = now()
  where id = any(memory_ids);
$$;
