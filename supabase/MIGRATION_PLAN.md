# Journey migration plan (B10)

Eleven migration files for everything the new server needs. **None of them is
applied.** Nothing here was run against any database. They must not be pushed
until the steps in "Before applying" are done and Rafay approves.

## What the basis is, and what it is not

The files were written from:

- `server/journey/schema_needs.md` (B3 to B9) and the server code itself
  (`server/journey`, `server/care`, `server/push`): every `.from(...)`, every
  column, every `rpc`.
- The existing migrations in `supabase/migrations/` and the care proposal
  that was in `supabase/pending/`.
- `audit/schema_main.sql` and `audit/schema_main.md` in the main repo: a dump of
  the live main schema taken on **29 September 2026**. It is the best basis we
  have but it is **not a fresh dump**. CLAUDE.md requires a fresh live dump as
  the basis. That is why every statement is guarded (`if not exists`,
  `add column if not exists`, `create or replace`, `drop constraint if exists`
  before re-adding) and why the checks below must be done first.

In the September dump none of the new tables exist, `model_usage_logs` has the
old `call_type` check, and `founder_profiles` does not exist yet (it comes from
`20261013000003`, not yet confirmed as pushed).

## Order and what each file does

All files are in `supabase/migrations/` and run in this order, after every
existing migration.

1. `20261101000001_journey_founder_profiles_columns.sql`
   Adds `signup_answers jsonb not null default '{}'` (all 13 sign-up answers;
   check: a JSON object) and `first_reading jsonb` (nullable; nothing writes it
   yet) to `founder_profiles`. Repeats `report_time_local` and `timezone` as
   `add column if not exists` guards (they already come from `20261013000003`).
   Needs `20261013000003` applied first.
2. `20261101000002_care_events.sql`
   `care_events` (level, optional scope id, times; never any message text).
   Replaces `supabase/pending/care_events_PROPOSED.sql`, which is removed.
3. `20261101000003_journey_situations_reads.sql`
   `situations` (with `follow_up_count` CHECK 0 to 2, `care_flag`, unique
   `(user_id, create_turn_id)`), `situation_turns` (unique
   `(situation_id, client_turn_id)`), `reads` (one per situation), and the
   function `take_follow_up(situation_id, user_id, now)`.
4. `20261101000004_journey_learn.sql`
   `learn_conversations` (one per situation, at most 2 move offers),
   `learn_turns` (unique founder turn id, unique follow-up tap),
   `lesson_citations`.
5. `20261101000005_journey_moves.sql`
   `moves`: status check, one swap, `active_slot` 1 or 2 with unique
   `(user_id, active_slot)` (the cap of 2 committed moves), one replacement per
   move, one first move per Learn conversation. The old `experiments` table is
   not touched.
6. `20261101000006_journey_reports_sharing.sql`
   `reports` (one per move), `consent_log` (append only), `peer_outcomes`
   (no `user_id`, `report_id`, `move_id` or `situation_id`),
   `outcome_author_links` (the only private link from an outcome to its
   author), `peer_unlocks` (unique per report and kind), and the functions
   `share_outcome` and `unshare_outcome`.
   - `share_outcome` raises unless `p_action` is `share` or `auto_share` and
     `p_automatic = (p_action = 'auto_share')`. After locking the report row
     it runs the care check (same rule as `careTouched` in
     `server/journey/report/sharing.js`): `situations.care_flag`, an open
     clear care event, an event scoped to the situation, or any care event
     since the situation started. If any holds, or the situation is missing,
     it writes nothing and returns no row (fails closed).
   - `unshare_outcome` raises on a null or unknown `p_to`, and unless
     `(p_action is null) = (p_to = 'not_offered')`: only the care check's
     `not_offered` goes without a consent row; every founder decision has one.
   - Trigger `peer_outcomes_guard` (before insert or update): `created_at` is
     rounded to the UTC day, so it never equals `reports.share_decided_at`,
     `consent_log.decided_at` or `outcome_author_links.created_at`; and the
     raw `draft` (note, prediction, move) is set to null when `status` becomes
     `approved` or `rejected`. It holds on every write path, including the
     server's step-by-step fallback in `shareDb.js`.
   - Who approves: a person (Rafay or a reviewer he names) working with the
     service role sets `status`, `story`, `lesson`, `reviewed_by` and
     `reviewed_at`. There is no client path and no review screen yet.
   - Known, not changed here: `peer_outcomes.withdrawn_at` is set to the same
     time as the withdraw's `reports.share_decided_at`. A withdrawn outcome
     has its draft, story and lesson cleared, so only its tags and outcome
     remain. Rounding it too is a one-line change in the trigger if wanted.
7. `20261101000007_journey_settings_push.sql`
   `user_settings` (share automatically, reminders, quiet hours, lock screen,
   last greeting, keep items, mentor style; every column has a default),
   `push_tokens` (unique token), `notification_log` (unique
   `(user_id, dedupe_key)`, a `slot` of morning or evening, and a partial unique
   `(user_id, local_day, slot)` while the row is sending or sent: the 2 a day
   push cap is held by the database, not by memory). The three
   `user_settings` CHECKs (`lock_screen`, `mentor_style`, `last_greeting`
   length) are `NOT VALID`: a live table holding other values (for example
   `lock_screen = 'nothing'` from ARCHITECTURE.md) cannot abort the file. New
   and updated rows are checked; see "Before applying", step 7.
8. `20261101000008_account_requests.sql`
   `account_requests` (export and delete requests; nothing is deleted). Partial
   unique `(user_id, kind)` while `status = 'queued'`: one waiting request per
   kind.
9. `20261101000009_model_usage_call_types.sql`
   Widens the `model_usage_logs.call_type` CHECK with the journey steps
   (`read`, `learn`, `followup`, `move`, `care`, `report`, `memory`). Every
   value allowed before stays allowed. `NOT VALID`, as before: old rows are
   not checked. The swap runs under `set lock_timeout = '5s'` (reset after),
   so a busy `model_usage_logs` makes the file fail fast instead of queueing
   every insert behind it.
10. `20261101000010_founder_lesson_log.sql`
    `founder_lesson_log`: one row per approved founder story shown (unique
    `(user_id, source_key)` makes a repeat count nothing), `slot` 1 or 2 for the
    two free lessons with unique `(user_id, slot)` (the cap is held by the
    database: two simultaneous requests cannot both take slot 2), and one
    `closed_notice` row so the "no more founder lessons" notice is said once.
    No access flag is stored: access is worked out on each request from this
    table, `user_settings.share_auto` and any `peer_unlocks` row of kind
    `share`. Needs Rafay's approval (give-to-get rule).
11. `20261101000011_account_deletion.sql`
    Account deletion. `account_requests.delete_after` and a partial unique
    index `(user_id)` while `kind = 'delete' and status = 'pending'` (one
    grace period per founder). The function `delete_account(p_user_id)`
    removes everything stored about one founder in one transaction, in the
    order written in `supabase/DELETION_PLAN.md`; the server then removes the
    sign-in account. SECURITY INVOKER, empty search_path, service role only.
    **It deletes founder data**, so it needs Rafay's explicit approval, a test
    on a copy of the database first, and the server switch `ACCOUNT_DELETE=on`
    stays off until then. The migrations test lets this one file contain
    `delete from`, and checks every delete is filtered to the founder.

## Access rules in every file

- Every new table: `enable row level security`, **no policies**,
  `revoke all ... from PUBLIC, anon, authenticated`, `grant all ... to
  service_role`. The new app reads and writes nothing directly; everything
  goes through the Express API with the service role. (ARCHITECTURE.md allows
  owner SELECT for founder-owned rows; none is added because nothing in the
  new app needs it.)
- Identity sequences (`situation_turns.seq`, `learn_turns.seq`): client
  privileges revoked, `service_role` granted usage.
- `outcome_author_links`: no policies at all, not even owner SELECT.
- Functions `take_follow_up`, `share_outcome`, `unshare_outcome` and the
  trigger function `peer_outcomes_guard`: `security invoker` (only
  `service_role` may execute them, and it already has the table grants and
  bypasses RLS, so definer rights would add nothing but risk),
  `set search_path = ''` (every table is schema-qualified), `execute` revoked
  from `PUBLIC`, `anon`, `authenticated`, granted to `service_role` only.

### founder_profiles client read

`20261013000003` runs `grant select on public.founder_profiles to authenticated`
(table level) with an own-row policy. So the new `signup_answers` and
`first_reading` columns are readable by their owner through Supabase, not
only through the API. A column-level `revoke select (signup_answers,
first_reading)` does not narrow a table-level grant in Postgres, so it is not
in migration 1. The only real fix is to revoke the table-level select and
grant select on a named column list instead (or revoke it entirely, since the
new app reads nothing directly). That changes an existing grant, so it is left
for Rafay's decision. Exposure: owner only, own answers only; no other
founder's row is readable.

## What is destructive

Nothing. No table, column, view, function or row is removed; no column type
changes. The only `drop` statements are `drop constraint if exists` right
before the same constraint is added again (`founder_profiles` jsonb checks,
`user_settings` checks, `model_usage_logs_call_type_check`), and
`drop trigger if exists peer_outcomes_guard` right before it is created. The
static test
`server/migrations/migrations.test.js` fails if a journey migration contains
`drop table`, `drop column`, `drop view`, `drop function`, `drop schema`,
`delete from`, `truncate`, a rename or a column type change.

One file outside `supabase/migrations/` is removed: the proposal
`supabase/pending/care_events_PROPOSED.sql`, now migration 2.

## How to roll back

Each file has a ROLLBACK note at the top. In short:

- Before any founder data is stored: `supabase/rollback/20261101_rollback.sql`
  removes, in reverse order (9 to 1), only what the journey files created:
  the new tables, functions and trigger, `founder_profiles.signup_answers`
  and `first_reading` with their checks. It keeps `report_time_local` and
  `timezone` (from `20261013000003`) and leaves the wider `call_type` check.
  It is run by hand, with Rafay's approval, and destroys the data in those
  new objects. It is outside `supabase/migrations/` so it is never pushed,
  and the static test checks that it names only objects created in
  `20261101*`.
- After founder data is stored: do **not** remove anything. Situations,
  turns, reads, Learn, moves, reports and the consent log are founder memory
  and consent evidence (CLAUDE.md). Fix forward with a new migration.
- Migration 9: re-run the constraint statements of `20260930000001`.
- Migration 1: the two new columns hold sign-up answers once used; export
  before any change.

## Before applying (must be checked against a fresh LIVE dump)

Take a read-only schema dump of the live main project and check:

1. **Objects that might already exist live** (created by hand, by an earlier
   branch, or by Supabase): `founder_profiles` (and whether
   `signup_answers`, `first_reading`, `report_time_local`, `timezone` exist
   with the types used here), `care_events`, `situations`,
   `situation_turns`, `reads`, `learn_conversations`, `learn_turns`,
   `lesson_citations`, `moves`, `reports`, `consent_log`, `peer_outcomes`,
   `outcome_author_links`, `peer_unlocks`, `user_settings`, `push_tokens`,
   `notification_log`, `account_requests`, and functions `take_follow_up`,
   `share_outcome`, `unshare_outcome`. `create table if not exists` silently
   skips a table that exists with a different shape: its columns, CHECKs
   and foreign keys would then NOT be what this plan says. Any table found
   live must be compared column by column, and a different file written.
2. **Index names**: every unique index here is `create unique index if not
   exists <name>`. A live index with the same name but different columns
   would be kept as it is.
3. `model_usage_logs.call_type`: the current constraint name is
   `model_usage_logs_call_type_check` and no live row needs a value outside
   the new list for future inserts.
4. `20261013000001` (default privileges revoked) and `20261013000003`
   (`founder_profiles`) are applied first. The explicit revokes in these
   files hold even if they are not, but `founder_profiles` must exist for
   migration 1.
5. `gen_random_uuid()` is available (pg 13+ or pgcrypto) and `auth.users`
   exists.
6. The migration role can grant to `service_role` and create triggers on the
   new tables.
7. `user_settings`, if it exists live: any row with a `lock_screen`,
   `mentor_style` or `last_greeting` outside the new checks. Such rows keep
   working for reads but an update to them fails until fixed. After fixing,
   run `alter table public.user_settings validate constraint <name>` for each.
8. Decide the `founder_profiles client read` question above.

Then push in order, with Rafay's approval, and run the server tests and a
manual journey check (sign-up, situation with 2 follow-ups, Read, Learn,
commit a move, report, share and withdraw, a push tick).

## Assumptions

- Foreign keys to `auth.users` have no `on delete cascade` on founder data
  (`situations`, `learn_conversations`, `moves`, `reports`, `consent_log`,
  `outcome_author_links`, `peer_unlocks`, `user_settings`,
  `account_requests`): removing an auth user is blocked until the deletion
  plan exists. `care_events`, `push_tokens` and `notification_log` cascade,
  as their specs say.
- Child rows cascade from their situation (turns, reads, Learn, moves) as in
  `schema_needs.md`, except `reports`, which reference `moves` without
  cascade, so a situation with a report cannot be removed by accident.
- `reads.body` is one text, not `body[]` (schema_needs.md).
- `moves.report_time_local` is `'HH:MM'` text (the server writes the
  normalised time); `founder_profiles.report_time_local` stays `time`.
- `moves.checklist` is a JSON array of 2 to 4 items (the move schema and the
  check require it).
- `care_events.scope_id` has no foreign key (it can be a thread or a
  situation id).
- `lesson_citations.chunk_ids` are Knowledge project `wiki_chunks.id` values
  (uuid); no foreign key across projects.
- `user_settings` gained a `created_at` column (not used yet) for audit.
- `notification_log.slot` is `not null`: the push scheduler must write it
  (another builder is changing `server/push` to claim a slot in the database).
  Until that lands, the current scheduler's claim insert would fail on this
  column. Do not apply migration 7 before that change is merged.
- `account_requests`: the partial unique index means a racing second request
  gets a unique violation; the server should treat it as the existing waiting
  request.
- `take_follow_up` exists for the server to call; today the server moves the
  count with a compare-and-swap update. The CHECK is the backstop either way.

## Conflicts between the server code and ARCHITECTURE.md

The migrations follow the server code (schema_needs.md). These differ from
ARCHITECTURE.md and need Rafay's decision, then a doc update:

- `moves` is a new table; ARCHITECTURE.md says the old `experiments` table
  gets the new states.
- `reports` and `consent_log` (an append-only log) instead of `move_reports`
  and `consents` (one row per choice).
- `learn_conversations` is not in ARCHITECTURE.md; `learn_turns` hangs off it,
  not off `situation_id`, and has different fields.
- `situation_turns.seq` instead of `turn_seq`; `situations` has no
  `linked_situation_id` or `started_by`, and has `care_flag` and
  `create_turn_id`.
- `reads.body` is text, not `body[]`; no `underlines[]` (only the first
  reading has underlines).
- `founder_profiles` keeps the 13 answers in `signup_answers` jsonb instead of
  separate columns (`months_in`, `commitment`, `team`, ...).
- `user_settings`: `quiet_start` and `quiet_end` instead of `quiet_hours`;
  `lock_screen` value `hidden` instead of `nothing`; no `checkin_time_local`
  or `timezone` (they live on `founder_profiles`).
- `push_tokens` has no `permission_granted`.
- `notification_log` has more fields (dedupe key, local day, slot, status).
- `peer_outcomes.status` is `pending_review, approved, rejected, withdrawn`
  (ARCHITECTURE.md: `draft, approved, rejected`); no `topic` column; adds
  `draft` and `withdrawn_at`.
- `peer_unlocks` adds `kind`.
- `care_events` adds `scope_id`.
- Not built here (in ARCHITECTURE.md, not used by the code): `founder_theory`,
  `usage_daily` (the daily situation cap counts `situations.created_at`),
  `intro_requests`.
- ARCHITECTURE.md allows owner SELECT on founder-owned rows; no client access
  is granted because the new app reads only through the API.
- `model_usage_logs`: every journey model call logs `call_type` as its step
  (read, learn, followup, move, care, report, memory; `server/llm.js`). The
  live CHECK rejects those until `20261101000009` is applied, so apply it
  before the new server goes live, or cost rows for the journey fail to insert.
