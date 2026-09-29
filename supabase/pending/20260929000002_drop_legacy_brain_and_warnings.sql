-- DO NOT APPLY until every runtime reference listed in the preparation summary
-- has been removed and an offline backup has been verified.

-- Preserve app-session rows before narrowing the allowed entry points.
UPDATE public.app_sessions
SET entry_point = 'direct'
WHERE entry_point = 'brain';

ALTER TABLE public.app_sessions
  DROP CONSTRAINT app_sessions_entry_point_check;

ALTER TABLE public.app_sessions
  ADD CONSTRAINT app_sessions_entry_point_check
  CHECK (entry_point IN ('direct', 'resume', 'experiment'));

-- The graph RPC depends on the graph tables.
DROP FUNCTION public.get_personal_wiki_graph(uuid);

-- Drop the edge table first because it references the node table.
DROP TABLE public.personal_wiki_edges;
DROP TABLE public.personal_wiki_nodes;
DROP TABLE public.weekly_reads;

ALTER TABLE public.sessions
  DROP COLUMN ghost_count,
  DROP COLUMN warning_level,
  DROP COLUMN consecutive_miss_count,
  DROP COLUMN active_experiments;
