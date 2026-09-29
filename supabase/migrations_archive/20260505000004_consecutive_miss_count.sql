ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS consecutive_miss_count integer not null default 0;
