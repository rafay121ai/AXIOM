create table public.product_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event text not null,
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index product_events_user_created_idx
  on public.product_events (user_id, created_at desc);

create index product_events_event_created_idx
  on public.product_events (event, created_at desc);

alter table public.product_events enable row level security;

revoke all on table public.product_events from anon, authenticated;
grant all on table public.product_events to service_role;
