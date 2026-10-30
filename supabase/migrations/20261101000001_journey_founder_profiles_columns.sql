-- Journey 1 of 9: sign-up answers and the first reading on founder_profiles.
--
-- NOT APPLIED. Read supabase/MIGRATION_PLAN.md first. Verify against a fresh
-- read-only dump of the live main schema before pushing.
--
-- Depends on 20261013000003_create_founder_profiles.sql (the table). Adds
-- columns only; changes no existing column, constraint, grant or policy.
-- Idempotent: every statement is guarded.
--
-- ROLLBACK (only if no founder has signed up through the new app, or after an
-- export, because it removes stored answers):
--   alter table public.founder_profiles drop constraint if exists founder_profiles_signup_answers_object;
--   alter table public.founder_profiles drop constraint if exists founder_profiles_first_reading_object;
--   then remove the two columns by hand.

-- All 13 sign-up answers, keyed by question key (server/journey/signup.js).
alter table public.founder_profiles
  add column if not exists signup_answers jsonb not null default '{}'::jsonb;

-- The first reading, so reopening the app shows the same text without a
-- second model call. Nothing writes it yet (schema_needs.md: recommended).
alter table public.founder_profiles
  add column if not exists first_reading jsonb;

-- Already created by 20261013000003; repeated as guards in case live drifted.
-- report_time_local is the check-in time (written by PUT /api/settings/reminders,
-- read by the Move commit); timezone is the founder's IANA zone.
alter table public.founder_profiles
  add column if not exists report_time_local time;
alter table public.founder_profiles
  add column if not exists timezone text;

alter table public.founder_profiles drop constraint if exists founder_profiles_signup_answers_object;
alter table public.founder_profiles add constraint founder_profiles_signup_answers_object
  check (jsonb_typeof(signup_answers) = 'object');

alter table public.founder_profiles drop constraint if exists founder_profiles_first_reading_object;
alter table public.founder_profiles add constraint founder_profiles_first_reading_object
  check (first_reading is null or jsonb_typeof(first_reading) = 'object');
