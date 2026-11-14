-- Memory layer 4 of 4: the founder's birthday, month and day ONLY (tasks/memory-plan.md,
-- Revision 3). APPLIED to live on Nov 10 2026 (Rafay approved).
--
-- THIS CHANGES AN EXISTING TABLE, additively: two nullable columns on
-- public.founder_profiles. Nothing is dropped, renamed or rewritten, and no
-- stored row changes (both columns start null). No year is stored anywhere:
-- that avoids the age question entirely. Nothing reads the columns yet; they
-- are for a dry birthday greeting once its wording is approved.
--
-- Rules the database enforces:
--   both or neither (a month without a day is refused, and the reverse)
--   month 1 to 12, day 1 to 31, and the day must exist in that month
--   (Feb 29 is allowed; Feb 30 and Apr 31 are not)
--
-- The columns are server only like the rest of founder_profiles (RLS already on,
-- no client grants), and are in the account export. Rows go with the founder
-- (existing cascade and delete_account). Idempotent.
--
-- ROLLBACK: supabase/rollback/20261109_rollback.sql. Rolling back deletes the
-- stored birthdays.

alter table public.founder_profiles add column if not exists birth_month smallint;
alter table public.founder_profiles add column if not exists birth_day smallint;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'founder_profiles_birthday_valid'
                   and conrelid = 'public.founder_profiles'::regclass) then
    alter table public.founder_profiles add constraint founder_profiles_birthday_valid check (
      (birth_month is null and birth_day is null)
      or (birth_month between 1 and 12 and birth_day >= 1
          and birth_day <= case when birth_month = 2 then 29
                                when birth_month in (4, 6, 9, 11) then 30
                                else 31 end)
    );
  end if;
end $$;
