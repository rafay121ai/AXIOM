alter table personal_memories
add column if not exists primary_pillar text check (
  primary_pillar in (
    'human_mind',
    'money_game',
    'how_companies_win',
    'whats_coming',
    'think_sharper',
    'move_people'
  )
);

alter table personal_memories
add column if not exists secondary_pillars text[] not null default '{}'::text[];

alter table personal_memories
add column if not exists pillar_confidence float not null default 0.7
check (pillar_confidence >= 0 and pillar_confidence <= 1);

create index if not exists personal_memories_user_primary_pillar_idx
on personal_memories (user_id, primary_pillar, updated_at desc);

drop function if exists match_personal_memories(vector, uuid, integer, double precision);
drop function if exists match_personal_memories(vector, uuid, int, float);

create or replace function match_personal_memories(
  query_embedding vector(1536),
  match_user_id uuid,
  match_count int default 5,
  similarity_threshold float default 0.35
)
returns table (
  id uuid,
  session_id uuid,
  user_id uuid,
  type text,
  content text,
  primary_pillar text,
  secondary_pillars text[],
  pillar_confidence float,
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
    pm.user_id,
    pm.type,
    pm.content,
    pm.primary_pillar,
    pm.secondary_pillars,
    pm.pillar_confidence,
    pm.importance,
    pm.confidence,
    pm.use_count,
    pm.last_used_at,
    1 - (pm.embedding <=> query_embedding) as similarity
  from personal_memories pm
  where pm.user_id = match_user_id
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
  match_user_id uuid,
  match_type text,
  similarity_threshold float default 0.82
)
returns table (
  id uuid,
  content text,
  importance int,
  confidence float,
  primary_pillar text,
  secondary_pillars text[],
  pillar_confidence float,
  similarity float
)
language sql stable
as $$
  select
    pm.id,
    pm.content,
    pm.importance,
    pm.confidence,
    pm.primary_pillar,
    pm.secondary_pillars,
    pm.pillar_confidence,
    1 - (pm.embedding <=> query_embedding) as similarity
  from personal_memories pm
  where pm.user_id = match_user_id
    and pm.type = match_type
    and 1 - (pm.embedding <=> query_embedding) >= similarity_threshold
  order by pm.embedding <=> query_embedding
  limit 1;
$$;
