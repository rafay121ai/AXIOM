-- Create public.founder_profiles (structured onboarding profile, one row per user).
--
-- ROLLBACK: drop table public.founder_profiles;  (no other object depends on it)
--
-- WRITTEN AGAINST the checked-in baseline, NOT a live schema dump.
-- CLAUDE.md requires a plan based on a live dump before this is pushed.
-- DO NOT PUSH until that is recorded in tasks/todo.md.
--
-- Depends on 20261013000001 (default privileges revoked), so the grants
-- below are explicit. Writes go through the Express API (service_role);
-- the browser only gets own-row SELECT. No other tables touched.

create table if not exists public.founder_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stage text check (stage in ('idea','validating','first_paying_customer','first_10_customers','repeatable_sales','scaling')),
  business_model text check (business_model in ('b2b','b2c','marketplace','services','other')),
  customer_markets text[] not null default '{}',
  country text,
  goal text,
  deadline date,
  report_time_local time,
  timezone text,
  open_answers jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.founder_profiles drop constraint if exists founder_profiles_customer_markets_max;
alter table public.founder_profiles add constraint founder_profiles_customer_markets_max
  check (cardinality(customer_markets) <= 10);

alter table public.founder_profiles drop constraint if exists founder_profiles_open_answers_array;
alter table public.founder_profiles add constraint founder_profiles_open_answers_array
  check (jsonb_typeof(open_answers) = 'array');

alter table public.founder_profiles drop constraint if exists founder_profiles_country_len;
alter table public.founder_profiles add constraint founder_profiles_country_len
  check (country is null or char_length(country) <= 80);

alter table public.founder_profiles drop constraint if exists founder_profiles_goal_len;
alter table public.founder_profiles add constraint founder_profiles_goal_len
  check (goal is null or char_length(goal) <= 1000);

alter table public.founder_profiles drop constraint if exists founder_profiles_timezone_len;
alter table public.founder_profiles add constraint founder_profiles_timezone_len
  check (timezone is null or char_length(timezone) <= 64);

alter table public.founder_profiles enable row level security;

drop policy if exists founder_profiles_select_own on public.founder_profiles;
create policy founder_profiles_select_own on public.founder_profiles
  for select to authenticated
  using (auth.uid() = user_id);

revoke all on public.founder_profiles from anon, PUBLIC;
revoke all on public.founder_profiles from authenticated;
grant select on public.founder_profiles to authenticated;
grant all on public.founder_profiles to service_role;
