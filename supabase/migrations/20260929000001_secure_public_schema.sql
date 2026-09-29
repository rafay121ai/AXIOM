-- Restrict knowledge-source reads to authenticated clients. The service role bypasses RLS.
ALTER TABLE public.wiki_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read wiki sources"
ON public.wiki_sources
FOR SELECT
TO authenticated
USING (true);

-- Functions are executable by PUBLIC by default. Revoke PUBLIC as well as anon
-- so the anon role cannot retain EXECUTE through role inheritance.
REVOKE EXECUTE ON FUNCTION public.find_similar_personal_memory(public.vector, uuid, text, double precision)
FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.match_personal_memories(public.vector, uuid, integer, double precision)
FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.mark_personal_memories_used(uuid[])
FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_personal_wiki_graph(uuid)
FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.match_wiki_chunks(public.vector, integer, text)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.match_personal_memories(public.vector, uuid, integer, double precision)
TO authenticated;

DROP INDEX public.experiments_session_status_idx;
DROP INDEX public.wiki_sources_source_key_idx;
