create table if not exists experiments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  user_id uuid not null,
  title text,
  description text not null,
  status text not null default 'active',
  pillar text,
  topic text,
  window_hours integer not null default 48,
  reference_count integer not null default 0,
  how_to_do_it text,
  real_world_example text,
  what_to_notice text,
  success_condition text,
  assigned_at timestamptz not null default now(),
  due_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  ghosted_at timestamptz,
  outcome text,
  metadata jsonb not null default '{}'::jsonb
);

alter table experiments
  add column if not exists cancelled_at timestamptz,
  add column if not exists ghosted_at timestamptz,
  add column if not exists outcome text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select conname
    from pg_constraint
    where conrelid = 'public.experiments'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.experiments drop constraint if exists %I', constraint_name);
  end loop;
end $$;

alter table experiments
  add constraint experiments_status_check
  check (status in ('active', 'completed', 'cancelled', 'ghosted', 'reset', 'replaced'));

create index if not exists experiments_user_status_idx
  on experiments (user_id, status, assigned_at desc);

create index if not exists experiments_session_status_idx
  on experiments (session_id, status, assigned_at desc);

alter table experiments enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'experiments'
      and policyname = 'Users own their experiments'
  ) then
    create policy "Users own their experiments"
      on experiments for all
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;
