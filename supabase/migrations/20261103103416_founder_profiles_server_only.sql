-- founder_profiles is read and written by the server only (service_role).
--
-- 20261013000003 granted table-level SELECT to authenticated, so a signed-in
-- founder could read their own row (including signup_answers and
-- first_reading from 20261101000001) straight through Supabase. No app or
-- browser code reads it; the API does. Approved by Rafay on Nov 3 2026.
--
-- Removes the grant and the select policy that only served it. No data
-- changes. service_role keeps its grant. Idempotent.
--
-- ROLLBACK: re-run lines 57-64 of 20261013000003.

revoke select on public.founder_profiles from authenticated;

drop policy if exists founder_profiles_select_own on public.founder_profiles;
