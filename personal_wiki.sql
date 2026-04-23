-- Axiom-authored personal wiki graph.
-- Run this in Supabase SQL editor after personal_memories.sql.

create extension if not exists vector;

alter table messages
add column if not exists thread_id uuid;

create index if not exists messages_session_thread_created_idx
on messages (session_id, thread_id, created_at);

create table if not exists personal_wiki_nodes (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  label text not null,
  type text not null check (
    type in (
      'pillar',
      'concept',
      'pattern',
      'goal',
      'blind_spot',
      'experiment',
      'belief',
      'decision',
      'contradiction'
    )
  ),
  pillar text check (pillar in ('psychology', 'economics')),
  summary text,
  status text not null default 'dim' check (
    status in ('seed', 'dim', 'active', 'bright', 'ghosted', 'resolved')
  ),
  importance int not null default 3 check (importance between 1 and 5),
  confidence float not null default 0.7 check (confidence >= 0 and confidence <= 1),
  x float not null default 0,
  y float not null default 0,
  z float not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_activated_at timestamptz
);

create unique index if not exists personal_wiki_nodes_session_label_type_idx
on personal_wiki_nodes (session_id, lower(label), type);

create index if not exists personal_wiki_nodes_session_status_idx
on personal_wiki_nodes (session_id, status, updated_at desc);

create table if not exists personal_wiki_edges (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  source_node_id uuid not null references personal_wiki_nodes(id) on delete cascade,
  target_node_id uuid not null references personal_wiki_nodes(id) on delete cascade,
  relationship text not null check (
    relationship in (
      'belongs_to',
      'causes',
      'shows_up_as',
      'tested_by',
      'tests',
      'contradicts',
      'strengthens',
      'resolved_by',
      'related_to'
    )
  ),
  weight float not null default 0.5 check (weight >= 0 and weight <= 1),
  confidence float not null default 0.7 check (confidence >= 0 and confidence <= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists personal_wiki_edges_unique_idx
on personal_wiki_edges (session_id, source_node_id, target_node_id, relationship);

create or replace function get_personal_wiki_graph(match_session_id uuid)
returns jsonb
language sql stable
as $$
  select jsonb_build_object(
    'nodes',
    coalesce(
      (
        select jsonb_agg(to_jsonb(n) order by n.importance desc, n.updated_at desc)
        from personal_wiki_nodes n
        where n.session_id = match_session_id
      ),
      '[]'::jsonb
    ),
    'edges',
    coalesce(
      (
        select jsonb_agg(to_jsonb(e) order by e.weight desc, e.updated_at desc)
        from personal_wiki_edges e
        where e.session_id = match_session_id
      ),
      '[]'::jsonb
    )
  );
$$;
