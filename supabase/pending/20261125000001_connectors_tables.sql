-- Connectors 1 of 3: the connector tables (tasks/connectors-plan.md, Phase 1 and "Acting on approval").
-- DRAFT IN supabase/pending/: NOT APPLIED. Needs Rafay's explicit approval; move into supabase/migrations/ only then.
-- Written Nov 25 2026 after a read-only check of live main (zmzrrmqqxqzmmfovpqjt): none of these tables exist.
--
--   connector_accounts  which tools a founder connected (Composio holds the tokens; we store only its account id)
--   watch_sources       newsletters and senders the founder chose to watch (or muted)
--   connector_jobs      the work queue: one row per incoming event, idempotent on (user, toolkit, external id)
--   signals             what Axiom found worth telling the founder. No raw email body, ever
--   connector_actions   work Axiom prepared; runs only after the founder approves (decisions.md, Nov 25)
--
-- Server only, like every journey table: RLS on, no policies, no client grants. Rows go with the founder
-- (on delete cascade, and delete_account in 20261125000003). No existing table is changed. Idempotent.
--
-- ROLLBACK: supabase/rollback/20261125_rollback.sql (roll the server code back first).

-- The foreign keys lock auth.users and situations briefly; never queue behind a long transaction.
set lock_timeout = '5s';

create table if not exists public.connector_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  toolkit text not null constraint connector_accounts_toolkit_check check (toolkit in ('gmail', 'googlecalendar', 'notion')),
  composio_account_id text not null constraint connector_accounts_composio_len check (char_length(composio_account_id) between 1 and 200),
  status text not null default 'active' constraint connector_accounts_status_check check (status in ('active', 'needs_reconnect')),
  -- What the founder granted: Rafay's own development account uses Composio's default (full) Google scopes, everyone else our own app.
  scopes text[] not null default '{}',
  connected_at timestamptz not null default now(),
  last_sync_at timestamptz,
  last_error_code text constraint connector_accounts_error_len check (last_error_code is null or char_length(last_error_code) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- One connection per founder and tool. Disconnect revokes at Composio and deletes the row (plan, Phase 2).
  constraint connector_accounts_user_toolkit_key unique (user_id, toolkit)
);

create table if not exists public.watch_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null constraint watch_sources_kind_check check (kind in ('newsletter', 'sender')),
  identifier text not null constraint watch_sources_identifier_len check (char_length(identifier) between 3 and 320),
  display_name text constraint watch_sources_display_len check (display_name is null or char_length(display_name) <= 120),
  status text not null default 'suggested' constraint watch_sources_status_check check (status in ('suggested', 'watching', 'muted')),
  rank_score numeric(6, 3),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint watch_sources_user_identifier_key unique (user_id, identifier)
);

create table if not exists public.connector_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  toolkit text not null constraint connector_jobs_toolkit_check check (toolkit in ('gmail', 'googlecalendar', 'notion')),
  -- The idempotency key: Composio's webhook id for an event, or the item id plus its updated time for a poll or
  -- backfill, so an edited meeting or page is queued again. The worker fetches the content; the job never holds it.
  external_id text not null constraint connector_jobs_external_len check (char_length(external_id) between 1 and 300),
  kind text not null constraint connector_jobs_kind_check check (kind in ('event', 'backfill', 'poll')),
  status text not null default 'queued' constraint connector_jobs_status_check check (status in ('queued', 'running', 'done', 'failed', 'dropped')),
  attempts smallint not null default 0 constraint connector_jobs_attempts_check check (attempts between 0 and 5),
  run_after timestamptz not null default now(),
  locked_at timestamptz,
  last_error_code text constraint connector_jobs_error_len check (last_error_code is null or char_length(last_error_code) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Webhooks repeat: the same event is queued once.
  constraint connector_jobs_item_key unique (user_id, toolkit, external_id)
);
create index if not exists connector_jobs_queue_idx on public.connector_jobs (run_after) where status = 'queued';

create table if not exists public.signals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lane text not null constraint signals_lane_check check (lane in ('people', 'time', 'world')),
  toolkit text not null constraint signals_toolkit_check check (toolkit in ('gmail', 'googlecalendar', 'notion')),
  -- A hash of the source item, never the item: the same news from two newsletters becomes one signal.
  external_ref_hash text not null constraint signals_ref_len check (char_length(external_ref_hash) between 16 and 128),
  facts jsonb not null default '{}'::jsonb,
  impact text constraint signals_impact_len check (impact is null or char_length(impact) <= 500),
  urgency smallint not null default 0 constraint signals_urgency_check check (urgency between 0 and 3),
  status text not null default 'new' constraint signals_status_check check (status in ('new', 'pushed', 'shown', 'acted', 'dismissed', 'expired')),
  situation_id uuid references public.situations(id) on delete set null,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint signals_user_ref_key unique (user_id, external_ref_hash)
);
create index if not exists signals_user_status_idx on public.signals (user_id, status, created_at desc);

create table if not exists public.connector_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  toolkit text not null constraint connector_actions_toolkit_check check (toolkit in ('gmail', 'googlecalendar', 'notion')),
  -- The closed write list (decisions.md, Nov 25). DELETE_EVENT is only an approved "cancel this meeting". A new write tool is a deliberate migration, never a model's choice.
  tool_slug text not null constraint connector_actions_tool_check check (tool_slug in (
    'GMAIL_SEND_EMAIL', 'GMAIL_REPLY_TO_THREAD',
    'GOOGLECALENDAR_CREATE_EVENT', 'GOOGLECALENDAR_PATCH_EVENT', 'GOOGLECALENDAR_DELETE_EVENT',
    'NOTION_CREATE_NOTION_PAGE', 'NOTION_ADD_MULTIPLE_PAGE_CONTENT')),
  constraint connector_actions_tool_toolkit_check check (
    (toolkit = 'gmail' and tool_slug like 'GMAIL\_%')
    or (toolkit = 'googlecalendar' and tool_slug like 'GOOGLECALENDAR\_%')
    or (toolkit = 'notion' and tool_slug like 'NOTION\_%')),
  args jsonb not null,
  preview text not null constraint connector_actions_preview_len check (char_length(preview) between 1 and 20000),
  -- sha256 of the canonical args: what the founder approved is exactly what runs.
  content_hash text not null constraint connector_actions_hash_len check (content_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'proposed' constraint connector_actions_status_check check (status in ('proposed', 'approved', 'done', 'failed', 'rejected', 'expired')),
  signal_id uuid references public.signals(id) on delete set null,
  situation_id uuid references public.situations(id) on delete set null,
  proposed_at timestamptz not null default now(),
  approved_at timestamptz,
  done_at timestamptz,
  expires_at timestamptz not null,
  composio_log_id text constraint connector_actions_log_len check (composio_log_id is null or char_length(composio_log_id) <= 120),
  error_code text constraint connector_actions_error_len check (error_code is null or char_length(error_code) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Nothing runs or finishes without an approval time.
  constraint connector_actions_approved_check check (status in ('proposed', 'rejected', 'expired') or approved_at is not null)
);
create index if not exists connector_actions_user_status_idx on public.connector_actions (user_id, status, proposed_at desc);

alter table public.connector_accounts enable row level security;
revoke all on table public.connector_accounts from PUBLIC, anon, authenticated;
grant all on table public.connector_accounts to service_role;

alter table public.watch_sources enable row level security;
revoke all on table public.watch_sources from PUBLIC, anon, authenticated;
grant all on table public.watch_sources to service_role;

alter table public.connector_jobs enable row level security;
revoke all on table public.connector_jobs from PUBLIC, anon, authenticated;
grant all on table public.connector_jobs to service_role;

alter table public.signals enable row level security;
revoke all on table public.signals from PUBLIC, anon, authenticated;
grant all on table public.signals to service_role;

alter table public.connector_actions enable row level security;
revoke all on table public.connector_actions from PUBLIC, anon, authenticated;
grant all on table public.connector_actions to service_role;

reset lock_timeout;
