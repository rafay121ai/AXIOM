-- Attach Axiom sessions to Supabase Auth users.
-- Run this in the Supabase SQL editor.

alter table sessions
add column if not exists user_id uuid references auth.users(id) on delete cascade;

create index if not exists sessions_user_id_created_at_idx
on sessions (user_id, created_at desc);
