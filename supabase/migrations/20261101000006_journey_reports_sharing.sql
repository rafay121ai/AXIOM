-- Journey 6 of 9: reports, consent_log, peer_outcomes, outcome_author_links,
-- peer_unlocks, share_outcome(), unshare_outcome().
--
-- Applied to main (zmzrrmqqxqzmmfovpqjt) on Oct 31 2026, after a fresh
-- read-only dump of the live main schema before pushing. This file holds
-- consent and peer outcome privacy objects (CLAUDE.md: never touch without
-- explicit instruction): it needs Rafay's approval.
--
-- Shapes: server/journey/schema_needs.md (B7). Depends on 20261101000003 and
-- 20261101000005.
-- Server only: RLS on, no policies, no anon/authenticated grants.
-- Functions are SECURITY INVOKER: only service_role may execute them, and it
-- already has the table grants and bypasses RLS.
--
-- Privacy rules held here:
--   * peer_outcomes has NO user_id, report_id, move_id or situation_id.
--   * The only link from an outcome to its author is outcome_author_links:
--     RLS on, no policies at all, no client grants. Never exposed.
--   * reports never holds a peer outcome id.
--   * peer_outcomes.created_at is rounded to the UTC day (trigger), so it never
--     matches reports.share_decided_at, consent_log.decided_at or
--     outcome_author_links.created_at.
--   * peer_outcomes.draft (the raw note and prediction) is cleared when a
--     reviewer approves or rejects (trigger), and when the founder withdraws.
--   * No strike, warning or removal column anywhere.
-- Idempotent: every statement is guarded.
--
-- ROLLBACK: only before any report is stored. Afterwards reports and the
-- consent log are founder memory and consent evidence: never remove them.

-- ─── reports ────────────────────────────────────────────────────────────────
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  move_id uuid not null references public.moves(id),
  situation_id uuid not null references public.situations(id) on delete cascade,
  outcome text not null constraint reports_outcome_check check (outcome in ('done', 'couldnt', 'didnt')),
  note text,
  client_turn_id uuid not null,
  prediction text not null,
  prediction_check text not null
    constraint reports_prediction_check_check check (prediction_check in ('right', 'wrong', 'unclear', 'not_tested')),
  reply text not null,
  reply_pending boolean not null default false,
  share_state text
    constraint reports_share_state_check check (share_state is null or share_state in ('asked', 'shared', 'private', 'withdrawn', 'not_offered')),
  share_automatic boolean not null default false,
  share_decided_at timestamptz,
  consent_wording_version text,
  consent_versions text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- NEEDED: one report per move. The claim insert of a repeat hits 23505.
create unique index if not exists reports_move_key
  on public.reports (move_id);
create index if not exists reports_user_created_idx
  on public.reports (user_id, created_at desc);
create index if not exists reports_situation_idx
  on public.reports (situation_id);

alter table public.reports enable row level security;
revoke all on table public.reports from PUBLIC, anon, authenticated;
grant all on table public.reports to service_role;

-- ─── consent_log (append only) ──────────────────────────────────────────────
create table if not exists public.consent_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  report_id uuid references public.reports(id),   -- null for the settings switch
  action text not null
    constraint consent_log_action_check check (action in ('asked', 'share', 'auto_share', 'keep_private', 'withdraw', 'auto_share_on', 'auto_share_off')),
  wording_version text not null,
  decided_at timestamptz not null default now()
);

create index if not exists consent_log_user_decided_idx
  on public.consent_log (user_id, decided_at);
create index if not exists consent_log_report_idx
  on public.consent_log (report_id);

alter table public.consent_log enable row level security;
revoke all on table public.consent_log from PUBLIC, anon, authenticated;
grant all on table public.consent_log to service_role;

-- ─── peer_outcomes (no link back to the founder) ────────────────────────────
create table if not exists public.peer_outcomes (
  id uuid primary key default gen_random_uuid(),
  status text not null
    constraint peer_outcomes_status_check check (status in ('pending_review', 'approved', 'rejected', 'withdrawn')),
  stage text,
  customer_market text,
  business_model text,
  outcome text not null constraint peer_outcomes_outcome_check check (outcome in ('done', 'couldnt', 'didnt')),
  draft jsonb,              -- raw material for the reviewer, never shown as it is
  story text,               -- reviewed and anonymised; shown only when approved
  lesson text,
  reviewed_by text,
  reviewed_at timestamptz,
  withdrawn_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists peer_outcomes_status_stage_idx
  on public.peer_outcomes (status, stage);

alter table public.peer_outcomes enable row level security;
revoke all on table public.peer_outcomes from PUBLIC, anon, authenticated;
grant all on table public.peer_outcomes to service_role;

-- Held on every write path (share_outcome, the server's step-by-step fallback,
-- and a reviewer working with the service role):
--   * created_at is the UTC day only, so no exact time links an outcome to its
--     report, consent row or private link.
--   * Approving or rejecting removes the raw draft; only the reviewed story
--     and lesson stay. Review is done by a person (Rafay or a named reviewer)
--     with the service role, setting status, story, lesson, reviewed_by and
--     reviewed_at; there is no client path to it.
create or replace function public.peer_outcomes_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.created_at := date_trunc('day', coalesce(new.created_at, now()), 'UTC');
  if new.status in ('approved', 'rejected') then
    new.draft := null;
  end if;
  return new;
end
$$;

revoke all on function public.peer_outcomes_guard() from PUBLIC, anon, authenticated;
grant execute on function public.peer_outcomes_guard() to service_role;

drop trigger if exists peer_outcomes_guard on public.peer_outcomes;
create trigger peer_outcomes_guard
  before insert or update on public.peer_outcomes
  for each row execute function public.peer_outcomes_guard();

-- ─── outcome_author_links (PRIVATE, server only, never exposed) ─────────────
create table if not exists public.outcome_author_links (
  peer_outcome_id uuid primary key references public.peer_outcomes(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  report_id uuid not null references public.reports(id),
  created_at timestamptz not null default now(),
  withdrawn_at timestamptz
);

create index if not exists outcome_author_links_report_idx
  on public.outcome_author_links (report_id);
create index if not exists outcome_author_links_user_idx
  on public.outcome_author_links (user_id);

-- RLS on with no policies at all, not even owner SELECT.
alter table public.outcome_author_links enable row level security;
revoke all on table public.outcome_author_links from PUBLIC, anon, authenticated;
grant all on table public.outcome_author_links to service_role;

-- ─── peer_unlocks (give to get; never taken away) ───────────────────────────
create table if not exists public.peer_unlocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  granted_by_report_id uuid not null references public.reports(id),
  kind text not null constraint peer_unlocks_kind_check check (kind in ('report', 'share')),
  used_on_situation_id uuid references public.situations(id),
  created_at timestamptz not null default now()
);

create unique index if not exists peer_unlocks_report_kind_key
  on public.peer_unlocks (granted_by_report_id, kind);
create index if not exists peer_unlocks_user_idx
  on public.peer_unlocks (user_id);

alter table public.peer_unlocks enable row level security;
revoke all on table public.peer_unlocks from PUBLIC, anon, authenticated;
grant all on table public.peer_unlocks to service_role;

-- ─── share_outcome ──────────────────────────────────────────────────────────
-- One transaction: consent row, pending peer outcome, private link, report
-- marked shared. Returns the report after the change, or no row when
-- share_state was no longer p_from or the care check touched the situation
-- (nothing written: fails closed). The row lock serialises a share and a
-- withdraw on the same report, and the care check runs under it (same rule as
-- server/journey/report/sharing.js careTouched).
create or replace function public.share_outcome(
  p_user_id uuid,
  p_report_id uuid,
  p_from text,
  p_automatic boolean,
  p_action text,
  p_wording_version text,
  p_peer jsonb,
  p_now timestamptz
) returns setof public.reports
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r public.reports;
  s public.situations;
  peer_id uuid;
begin
  if p_action is null or p_action not in ('share', 'auto_share') then
    raise exception 'share_outcome: p_action must be share or auto_share' using errcode = '22023';
  end if;
  if p_automatic is distinct from (p_action = 'auto_share') then
    raise exception 'share_outcome: p_automatic must match p_action' using errcode = '22023';
  end if;

  select * into r from public.reports
   where id = p_report_id and user_id = p_user_id
   for update;
  if not found or r.share_state is distinct from p_from or p_from in ('shared', 'not_offered') then
    return;
  end if;

  -- Care check, under the lock: a care flag on the situation, an open clear
  -- event, an event scoped to the situation, or any event since it started.
  select * into s from public.situations where id = r.situation_id;
  if not found or s.care_flag then
    return;
  end if;
  if exists (
    select 1 from public.care_events e
     where e.user_id = p_user_id
       and ((e.level = 'clear' and e.resolved_at is null)
            or e.scope_id = s.id
            or e.created_at >= s.created_at)
  ) then
    return;
  end if;

  insert into public.consent_log (user_id, report_id, action, wording_version, decided_at)
  values (p_user_id, p_report_id, p_action, p_wording_version, p_now);

  insert into public.peer_outcomes (status, stage, customer_market, business_model, outcome, draft,
      story, lesson, reviewed_by, reviewed_at, withdrawn_at, created_at)
  values ('pending_review', p_peer->>'stage', p_peer->>'customer_market', p_peer->>'business_model',
      p_peer->>'outcome', p_peer->'draft', null, null, null, null, null, p_now)
  returning id into peer_id;

  insert into public.outcome_author_links (peer_outcome_id, user_id, report_id, created_at, withdrawn_at)
  values (peer_id, p_user_id, p_report_id, p_now, null);

  return query
    update public.reports
       set share_state = 'shared', share_automatic = p_automatic,
           share_decided_at = p_now, updated_at = p_now
     where id = p_report_id
    returning *;
end
$$;

revoke all on function public.share_outcome(uuid, uuid, text, boolean, text, text, jsonb, timestamptz) from PUBLIC, anon, authenticated;
grant execute on function public.share_outcome(uuid, uuid, text, boolean, text, text, jsonb, timestamptz) to service_role;

-- ─── unshare_outcome ────────────────────────────────────────────────────────
-- Takes every live share of the report down (status withdrawn, content
-- cleared, link closed), logs the decision, sets the report's new state.
-- p_action null is the care check closing sharing (not_offered): not a founder
-- decision, so no consent row. Every other move is a founder decision and must
-- carry its action, so a decision is never recorded without a consent row.
create or replace function public.unshare_outcome(
  p_user_id uuid,
  p_report_id uuid,
  p_from text,
  p_to text,
  p_action text,
  p_wording_version text,
  p_now timestamptz
) returns setof public.reports
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r public.reports;
begin
  if p_to is null or p_to not in ('private', 'withdrawn', 'not_offered') then
    raise exception 'unshare_outcome: p_to must be private, withdrawn or not_offered' using errcode = '22023';
  end if;
  if (p_action is null) is distinct from (p_to = 'not_offered') then
    raise exception 'unshare_outcome: only not_offered goes without a consent action' using errcode = '22023';
  end if;

  select * into r from public.reports
   where id = p_report_id and user_id = p_user_id
   for update;
  if not found or r.share_state is distinct from p_from then
    return;
  end if;

  update public.peer_outcomes
     set status = 'withdrawn', draft = null, story = null, lesson = null, withdrawn_at = p_now
   where id in (
     select peer_outcome_id from public.outcome_author_links
      where report_id = p_report_id and user_id = p_user_id and withdrawn_at is null
   );

  update public.outcome_author_links
     set withdrawn_at = p_now
   where report_id = p_report_id and user_id = p_user_id and withdrawn_at is null;

  if p_action is not null then
    insert into public.consent_log (user_id, report_id, action, wording_version, decided_at)
    values (p_user_id, p_report_id, p_action, p_wording_version, p_now);
  end if;

  return query
    update public.reports
       set share_state = p_to, share_automatic = false,
           share_decided_at = p_now, updated_at = p_now
     where id = p_report_id
    returning *;
end
$$;

revoke all on function public.unshare_outcome(uuid, uuid, text, text, text, text, timestamptz) from PUBLIC, anon, authenticated;
grant execute on function public.unshare_outcome(uuid, uuid, text, text, text, text, timestamptz) to service_role;
