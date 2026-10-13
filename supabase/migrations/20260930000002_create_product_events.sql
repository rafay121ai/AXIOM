-- Internal product analytics only. Never joined to peer outcomes and never
-- shown to other founders.
-- RLS is enabled with no policies on purpose: only service_role (the Express
-- API) writes and reads this table; anon and authenticated have no access.
create table if not exists public.product_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event text not null,
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Must match PRODUCT_EVENTS in server/productEvents.js exactly.
alter table public.product_events
  drop constraint if exists product_events_event_check;

alter table public.product_events
  add constraint product_events_event_check
  check (event in (
    'onboarding_completed',
    'chat_started',
    'message_sent',
    'experiment_created',
    'experiment_committed',
    'experiment_reported',
    'thread_resumed'
  ));

create index if not exists product_events_user_created_idx
  on public.product_events (user_id, created_at desc);

create index if not exists product_events_event_created_idx
  on public.product_events (event, created_at desc);

alter table public.product_events enable row level security;

revoke all on table public.product_events from anon, authenticated;
grant all on table public.product_events to service_role;
