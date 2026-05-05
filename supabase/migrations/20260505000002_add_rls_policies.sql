-- SESSIONS
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own their sessions"
  ON sessions FOR ALL
  USING (auth.uid() = user_id);

-- PERSONAL MEMORIES
ALTER TABLE personal_memories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own their memories"
  ON personal_memories FOR ALL
  USING (auth.uid() = user_id);

-- PERSONAL WIKI NODES
ALTER TABLE personal_wiki_nodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own their wiki nodes"
  ON personal_wiki_nodes FOR ALL
  USING (
    auth.uid() = (
      SELECT user_id FROM sessions WHERE id = personal_wiki_nodes.session_id
    )
  );

-- PERSONAL WIKI EDGES
ALTER TABLE personal_wiki_edges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own their wiki edges"
  ON personal_wiki_edges FOR ALL
  USING (
    auth.uid() = (
      SELECT user_id FROM sessions WHERE id = personal_wiki_edges.session_id
    )
  );

-- WIKI CHUNKS (read only for authenticated users)
ALTER TABLE wiki_chunks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can read wiki chunks"
  ON wiki_chunks FOR SELECT
  USING (auth.role() = 'authenticated');

-- SERVICE ROLE BYPASS (seed.js needs to write wiki_chunks)
-- This is handled automatically by the service role key, no policy needed.
