CREATE UNIQUE INDEX IF NOT EXISTS sessions_user_id_unique_idx
  ON sessions (user_id);
