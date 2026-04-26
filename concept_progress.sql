-- Add structured learning roadmap progress to sessions.
-- Tracks which concepts have been confirmed understood vs. remaining,
-- so Axiom can resume mid-roadmap across session boundaries.

alter table sessions
add column if not exists concept_progress jsonb not null default '[]'::jsonb;
