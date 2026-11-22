-- moves.checklist accepts one item: the Move now carries one first step
-- ("Start with"), commit dde7d85 (Nov 19 2026). The old CHECK required 2 to 4
-- items, so every new move was refused on insert (500 on POST
-- /api/learn/:id/move) from Nov 19.
--
-- APPLIED to main on Nov 22 2026 (Rafay's yes), recorded in supabase_migrations.schema_migrations. Written Nov 22 2026 after a read-only check of live main
-- (zmzrrmqqxqzmmfovpqjt): moves_checklist_check there is exactly
-- "jsonb_typeof(checklist) = 'array' and jsonb_array_length(checklist) between 2 and 4",
-- as in 20261101000005_journey_moves.sql.
--
-- Widens the CHECK: every value allowed before stays allowed. NOT VALID, so
-- existing rows are never re-checked. No column, no data change. Idempotent.
--
-- ROLLBACK (only while no row has a one-item checklist):
--   alter table public.moves drop constraint if exists moves_checklist_check;
--   alter table public.moves add constraint moves_checklist_check
--     check (jsonb_typeof(checklist) = 'array' and jsonb_array_length(checklist) between 2 and 4) not valid;

set lock_timeout = '5s';
alter table public.moves drop constraint if exists moves_checklist_check;
alter table public.moves add constraint moves_checklist_check
  check (jsonb_typeof(checklist) = 'array' and jsonb_array_length(checklist) between 1 and 4) not valid;
reset lock_timeout;
