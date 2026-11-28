-- DRAFT IN supabase/pending/: NOT APPLIED. Move to supabase/migrations/ after Rafay's yes.
-- Lock screen default is Full for new founders (Rafay, Nov 28 2026: signal pushes carry how an email connects to the founder).
-- Changes only the column DEFAULT. Existing rows keep their value; founders change it in Settings.
-- ROLLBACK: alter table public.user_settings alter column lock_screen set default 'short'; delete from supabase_migrations.schema_migrations where version = '20261128000001';
set lock_timeout = '5s';
alter table public.user_settings alter column lock_screen set default 'full';
reset lock_timeout;
