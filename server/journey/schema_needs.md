# Schema needs for the journey (sign-up answers and first reading)

Migration `20261013000003_create_founder_profiles.sql` is NOT changed. The code
reuses what it has and needs the following that it lacks.

## Needed (the sign-up API will fail to save without it)
- `founder_profiles.signup_answers jsonb not null default '{}'::jsonb`
  (check: `jsonb_typeof(signup_answers) = 'object'`). Holds all 13 answers,
  keyed by question key (`stage`, `months_in`, `commitment`, `business_model`,
  `where`, `team`, `goal`, `background`, `why`, `strengths`, `tried`,
  `building`, `stuck`). Needed because the existing columns cover only 5 of
  the 13 questions and lose detail (for example `stage` has 6 values for 5
  options, `open_answers` allows 3 items and requires an input_mode).

## Existing columns the code also fills (mirrors, written with each answer)
- `stage` (Q1), `business_model` (Q4, null for "No one yet"), `country` (Q5),
  `goal` (Q7, text such as "My first customer, in 3 months"), `deadline` (Q7,
  a date: the picked date, or end of this month, or today plus 3 or 6 months).

## Not stored in existing columns (live only in `signup_answers`)
- `months_in`, `commitment`, `team`, `background` (and its write-in), `why`,
  `strengths` (both lists), `tried`, `building`, `stuck`, customers location
  (`where.customers`; `customer_markets` is a region list with a different
  meaning, so it is not filled).

## Recommended, not needed yet
- `founder_profiles.first_reading jsonb` to store the reading so reopening the
  app shows the same text and costs no second model call. Today
  `POST /api/first-reading` generates a new reading on each call.
- Q10 limit: the app limits each list to 5 options; no DB constraint needed.

## Not covered by the new flow
- The old `/api/onboarding/complete` writes `sessions.onboarding_answers`,
  `pillar_weights` and `axiom_profile`, which the old web app and RAG routing
  still read. It stays until that app is replaced.

# Schema needs for Situation and the Read (B4)

None of these tables exist in `supabase/migrations/` yet. They follow
ARCHITECTURE.md; the code only needs the columns below. RLS on, server-only
(service role) access, no client policies: all writes go through Express.

## situations
- `id uuid pk default gen_random_uuid()`, `user_id uuid not null references auth.users`
- `title text null`, `status text not null default 'open'` (open, paused, closed)
- `follow_up_count int not null default 0 check (follow_up_count between 0 and 2)`
  (the database backstop for the 2 follow-up cap; the code moves it only with
  a compare-and-swap update)
- `create_turn_id uuid null`, unique `(user_id, create_turn_id)`: makes
  `POST /api/situations` safe to repeat
- `created_at timestamptz not null`, `last_activity_at timestamptz not null`
- index `(user_id, status, last_activity_at desc)`

## situation_turns
- `id uuid pk`, `seq bigint generated always as identity` (the order of a conversation)
- `situation_id uuid not null references situations on delete cascade`
- `role text not null check (role in ('founder','axiom'))`, `text text not null`
- `filler boolean not null default false`
- `client_turn_id uuid null`, unique `(situation_id, client_turn_id)` where not
  null: a repeated turn id hits this and the code returns the stored `result`
- `result jsonb null`: the answer sent for a founder turn, replayed on a repeat
- `created_at timestamptz not null`

## reads
- `id uuid pk`, `situation_id uuid not null unique references situations on delete cascade`
- `headline text`, `body text` (ARCHITECTURE.md says body[]; the Read body is stored as one text),
  `closing_question text` (the Read has no underlines; only the first reading keeps up to 2, and that is not stored here)
- `source text` ('model' or 'fallback')
- `closing_answer text null`, `skipped boolean not null default false`,
  `answered_at timestamptz null` (first answer or skip wins)
- `created_at timestamptz not null`

## Optional, stronger
- A SQL function `take_follow_up(situation_id uuid, user_id uuid) returns int`
  doing `update ... set follow_up_count = follow_up_count + 1 where ... and
  follow_up_count < 2 returning follow_up_count`. One statement, no retry loop.
  The code would call it with `supabase.rpc`.
- The daily new-situation limit counts `situations.created_at` for today (UTC),
  so it needs no `usage_daily` row. Limit: 5 (`MAX_NEW_SITUATIONS_PER_DAY`),
  number still to be set by Rafay.

# Schema needs for Learn (B5b)

None of these tables exist in `supabase/migrations/` yet. Same rules as above:
RLS on, server-only (service role) access, no client policies. Evidence and
validation flags are server-only and are never returned by the API.

## learn_conversations
- `id uuid pk`, `situation_id uuid not null unique references situations on delete cascade`
  (one Learn conversation per situation; a second start hits this and the
  code returns the stored lesson)
- `user_id uuid not null references auth.users` (ownership check)
- `offers int[] not null default '{}'`: the real-reply count at each move
  offer; `check (cardinality(offers) <= 2)` is the database backstop for the
  cap of 2 move cards
- `move_subject text null`, `move_fact text null`: the newest checked subject
  and fact from the founder's own words, used by the move cards
- `after_cap_said boolean not null default false`
- `lock_token uuid null`, `locked_at timestamptz null`: one turn at a time
  (taken by a conditional update `where lock_token is null`; a lock older than
  2 minutes is taken over)
- `created_at timestamptz not null`, `updated_at timestamptz not null`

## learn_turns
- `id uuid pk`, `seq bigint generated always as identity`
- `conversation_id uuid not null references learn_conversations on delete cascade`
- `role text not null check (role in ('founder','axiom'))`
- `kind text null check (kind in ('lesson','reply','followup'))` (null for founder turns)
- `text text not null`, `filler boolean not null default false`
- `client_turn_id uuid null`, unique `(conversation_id, client_turn_id)` where
  not null: a repeated founder turn returns the stored `result`
- `result jsonb null`: the response sent for a founder turn
- `evidence jsonb null` (server only): the evidence pack the reply was given,
  `[{handle, chunk_id, author, source_title, pillar, text, similarity}]`;
  a tapped follow-up reuses it
- `sources jsonb not null default '[]'`: verified sources `[{handle, author, book, quote?}]`
- `picture jsonb null`, `follow_ups jsonb not null default '[]'`
- `validation jsonb not null default '[]'` (server only): citation check flags
- `move_offer text not null default 'none' check (move_offer in ('none','first','second'))`,
  `move_notice jsonb null`
- `parent_turn_id uuid null references learn_turns`, `followup_index int null`,
  unique `(parent_turn_id, followup_index)` where not null: a tap is answered once
- `created_at timestamptz not null`

## lesson_citations
- `id uuid pk`, `learn_turn_id uuid not null references learn_turns on delete cascade`
- `chunk_ids uuid[] not null` (Knowledge project `wiki_chunks.id`; no foreign key across projects)
- `author text not null`, `book_title text not null` (from the chunk row)
- `quote text null` (only when verified word for word)
- `created_at timestamptz not null`

## Knowledge project (read only, no change)
- `match_wiki_chunks(query_embedding vector, match_count int, filter_pillar text)`
  as recorded in `supabase/migrations_archive/20261019000000_knowledge_halfvec_shrink.sql`.
  Learn uses `id, author, title, key_frameworks (the passage text), similarity`.

# Schema needs for the Move (B6)

New table `moves`. Same rules as above: RLS on, server-only (service role)
access, no client policies. ARCHITECTURE.md says the old `experiments` table
gets the new states; it is not reused here because `experiments.session_id` is
NOT NULL with a foreign key to the old `sessions`, its status check has the old
values, and the old web app still reads it. To be confirmed by Rafay.

## moves
- `id uuid pk default gen_random_uuid()`, `user_id uuid not null references auth.users`
- `situation_id uuid not null references situations on delete cascade`
- `learn_id uuid not null references learn_conversations on delete cascade`
- `status text not null check (status in ('draft','committed','report_due','reported','closed_no_report','swapped'))`
  (`reported` is set by the Report step; nothing here deletes a move)
- Shown: `title text not null`, `mission text not null`, `success_condition text not null`,
  `words text not null default ''`, `checklist jsonb not null` (2 to 4 strings),
  `prediction text not null`, `start_minutes int not null check (start_minutes between 1 and 10)`
- Server only: `hypothesis text not null`, `validation jsonb not null` (the
  experiment validator's result), `swap_reason text null`
- `swap_count int not null default 0 check (swap_count between 0 and 1)`
- `swapped_from uuid null references moves`, unique `(swapped_from)` where not
  null: one replacement per move (a repeated swap returns it)
- unique `(learn_id)` where `swapped_from is null`: one first move per Learn
  conversation (a repeated or concurrent create returns it)
- `active_slot smallint null check (active_slot in (1,2))`, **unique
  `(user_id, active_slot)` where `active_slot is not null`**. NEEDED: this is
  the cap of 2 committed moves. A commit takes slot 1 or 2 by a conditional
  update; the unique index makes a third concurrent commit fail with 23505.
  The slot is cleared when a move is swapped or closed (and must be cleared by
  the Report step when it marks a move `reported`).
- `committed_at timestamptz null`, `report_due_at timestamptz null` (the
  check-in time; the push scheduler reads it), `report_time_local text null`
  ('HH:MM'), `time_zone text null` (IANA), `closes_at timestamptz null`
  (commit + 48 hours), `closed_at timestamptz null`, `swapped_at timestamptz null`
- `created_at timestamptz not null`, `updated_at timestamptz not null`
- indexes `(user_id, status, created_at)`, `(learn_id, created_at desc)`,
  `(status, report_due_at)` for the scheduler

## Existing columns read
- `founder_profiles.report_time_local` and `founder_profiles.timezone` (from
  migration 20261013000003): the founder's check-in time and zone. When the
  zone is empty, the phone's zone sent with the commit is used, then UTC.

# Schema needs for the Report and sharing (B7)

New tables. Same rules as above: RLS on, server-only (service role) access,
no client policies; all writes go through Express. ARCHITECTURE.md names
`move_reports` and `consents`; the code uses `reports` and `consent_log`
(an append-only log of every ask and decision, not one row per report). To be
confirmed by Rafay. Nothing here deletes a report; there is no strike,
warning or removal column anywhere.

## reports
- `id uuid pk default gen_random_uuid()`, `user_id uuid not null references auth.users`
- `move_id uuid not null references moves`, **unique `(move_id)`**. NEEDED: one
  report per move. The row is inserted (claimed) before the model is called;
  a repeated or concurrent report hits 23505, waits for the reply and returns
  the stored one, so a double tap costs one model call.
- `situation_id uuid not null references situations on delete cascade`
- `outcome text not null check (outcome in ('done','couldnt','didnt'))`
- `note text null` (the founder's answer; it passed the care gate)
- `client_turn_id uuid not null`
- `prediction text not null` (the move's prediction when it was reported)
- `prediction_check text not null check (prediction_check in ('right','wrong','unclear','not_tested'))`
- `reply text not null` (Axiom's reply, checked, or the fixed line)
- `reply_pending boolean not null default false` (true from the claim until
  the checked reply is written; the fixed line holds the place meanwhile)
- `share_state text null check (share_state in ('asked','shared','private','withdrawn','not_offered'))`
  (null only between the insert and the sharing decision a moment later;
  'not_offered' when the care check touched the situation)
- `share_automatic boolean not null default false`, `share_decided_at timestamptz null`
- `consent_wording_version text null` (the question that was asked)
- `consent_versions text[] null` (the consent question versions offered with
  this report: `share-alone-v1`, plus `share-after-story-v1` only when a
  founder story was offered. A consent naming any other version is refused.
  Null on older rows means the plain question only)
- `created_at timestamptz not null`, `updated_at timestamptz not null`
- index `(user_id, created_at desc)`
- **Must never hold a peer outcome id.** Founders may later SELECT their own
  reports; that must not reveal which peer outcome is theirs.

## situations (existing table, one new column)
- `care_flag boolean not null default false`. Set by the report route when
  the care gate stops a report note, so sharing fails closed for the
  situation even if the gate could not write its care event.

## Moves (existing table from B6, no new column)
- The report sets `status = 'reported'` and `active_slot = null` (the slot is
  free for a new commit). A `closed_no_report` move can still be reported.

## consent_log (server only, append only)
- `id uuid pk`, `user_id uuid not null references auth.users`
- `report_id uuid null references reports` (null for the settings switch)
- `action text not null check (action in ('asked','share','auto_share','keep_private','withdraw','auto_share_on','auto_share_off'))`
- `wording_version text not null` (for example `share-alone-v1`,
  `share-after-story-v1`, `settings-share-auto-v1`, `withdraw-v1`; the words are
  in `server/journey/report/wording.js`)
- `decided_at timestamptz not null`
- index `(user_id, decided_at)`, `(report_id)`

## share_outcome / unshare_outcome (NEEDED for production, SQL functions)
supabase-js cannot run several statements in one transaction. The server
calls these two functions with `supabase.rpc` and, while they do not exist
(PGRST202), runs the same steps in a safe order instead
(`server/journey/report/shareDb.js`). Both are `security definer`, owned by the
service role, `execute` revoked from `anon` and `authenticated`. Each returns
the report row after the change, or no row when `share_state` was no longer
`p_from` (nothing written).

```sql
create function share_outcome(p_user_id uuid, p_report_id uuid, p_from text,
  p_automatic boolean, p_action text, p_wording_version text, p_peer jsonb,
  p_now timestamptz) returns setof reports language plpgsql security definer
  set search_path = public as $$
declare r reports; peer_id uuid;
begin
  select * into r from reports where id = p_report_id and user_id = p_user_id for update;
  if not found or r.share_state is distinct from p_from or p_from in ('shared','not_offered') then return; end if;
  insert into consent_log (user_id, report_id, action, wording_version, decided_at)
    values (p_user_id, p_report_id, p_action, p_wording_version, p_now);
  insert into peer_outcomes (status, stage, customer_market, business_model, outcome, draft,
      story, lesson, reviewed_by, reviewed_at, withdrawn_at, created_at)
    values ('pending_review', p_peer->>'stage', p_peer->>'customer_market', p_peer->>'business_model',
      p_peer->>'outcome', p_peer->'draft', null, null, null, null, null, p_now)
    returning id into peer_id;
  insert into outcome_author_links (peer_outcome_id, user_id, report_id, created_at, withdrawn_at)
    values (peer_id, p_user_id, p_report_id, p_now, null);
  return query update reports set share_state = 'shared', share_automatic = p_automatic,
      share_decided_at = p_now, updated_at = p_now
    where id = p_report_id returning *;
end $$;

create function unshare_outcome(p_user_id uuid, p_report_id uuid, p_from text,
  p_to text, p_action text, p_wording_version text, p_now timestamptz)
  returns setof reports language plpgsql security definer
  set search_path = public as $$
declare r reports;
begin
  select * into r from reports where id = p_report_id and user_id = p_user_id for update;
  if not found or r.share_state is distinct from p_from or p_to not in ('private','withdrawn','not_offered') then return; end if;
  update peer_outcomes set status = 'withdrawn', draft = null, story = null, lesson = null, withdrawn_at = p_now
    where id in (select peer_outcome_id from outcome_author_links
      where report_id = p_report_id and user_id = p_user_id and withdrawn_at is null);
  update outcome_author_links set withdrawn_at = p_now
    where report_id = p_report_id and user_id = p_user_id and withdrawn_at is null;
  if p_action is not null then
    insert into consent_log (user_id, report_id, action, wording_version, decided_at)
      values (p_user_id, p_report_id, p_action, p_wording_version, p_now);
  end if;
  return query update reports set share_state = p_to, share_automatic = false,
      share_decided_at = p_now, updated_at = p_now
    where id = p_report_id returning *;
end $$;
```
`p_action` null is the care check closing sharing (`not_offered`), which is
not a founder decision and writes no consent row. The row lock serialises a
share and a withdraw on the same report, so a live peer outcome never outlasts
a report that is not shared, and a share never exists without its consent row.

## user_settings (only the column this step needs)
- `user_id uuid pk references auth.users`
- `share_auto boolean not null default false` ("Share with other founders",
  meaning share automatically; off means Axiom asks after every check-in)
- `updated_at timestamptz not null`

## peer_outcomes (server only; founders see approved stories only through the API)
- `id uuid pk default gen_random_uuid()`
- **No `user_id`, no `report_id`, no `move_id`, no `situation_id`**, nothing
  that points back to the founder.
- `status text not null check (status in ('pending_review','approved','rejected','withdrawn'))`
- `stage text null`, `customer_market text null`, `business_model text null` (matching tags)
- `outcome text not null check (outcome in ('done','couldnt','didnt'))`
- `draft jsonb null`: raw material for the reviewer (`{ move: {title, mission,
  success}, prediction, prediction_check, note }`), never shown as it is.
  Not yet anonymised: anonymising and human review are a later step.
- `story text null`, `lesson text null` (the reviewed, anonymised text; the
  only fields a founder ever sees, and only when `status = 'approved'`)
- `reviewed_by text null`, `reviewed_at timestamptz null`
- `withdrawn_at timestamptz null` (withdrawing sets status 'withdrawn' and
  clears draft, story and lesson)
- `created_at timestamptz not null`
- index `(status, stage)`

## outcome_author_links (PRIVATE, server only, never exposed)
- `peer_outcome_id uuid pk references peer_outcomes on delete cascade`
- `user_id uuid not null references auth.users`
- `report_id uuid not null references reports`
- `created_at timestamptz not null`, `withdrawn_at timestamptz null`
- index `(report_id)`, `(user_id)`
- RLS on with **no policies at all** (not even owner SELECT). Read only by the
  server to take a share down, to keep a founder's own outcome out of their
  stories, and later for double opt-in introductions.

## peer_unlocks (give to get)
- `id uuid pk`, `user_id uuid not null references auth.users`
- `granted_by_report_id uuid not null references reports`
- `kind text not null check (kind in ('report','share'))`, unique `(granted_by_report_id, kind)`
- `used_on_situation_id uuid null references situations`
- `created_at timestamptz not null`
- A report grants one ('report'); the first share of a report grants one
  more ('share'). Never taken away. Nothing reads them yet: founder cases
  come once approved outcomes exist.

## care_events (existing, read only here)
- Read: `level, scope_id, created_at, resolved_at`. A clear event still open,
  an event scoped to the situation, or any event since the situation started
  stops sharing and stories for that report. `GET /api/reports/due` returns
  nothing while a clear event is open.

# Schema needs for pushes and reminders (B8)

None of these exist in `supabase/migrations/` yet. Same rules as above: RLS
on, server-only (service role) access, no client policies. The scheduler runs
only when `EXPO_PUSH=on` (index.js).

## push_tokens
- `id uuid pk default gen_random_uuid()`, `user_id uuid not null references auth.users on delete cascade`
- `token text not null unique` (Expo token, `ExponentPushToken[...]`, checked
  by the API). NEEDED unique: one row per device; registering it from another
  account moves the row to that account
- `platform text not null check (platform in ('ios','android'))`
- `timezone text null check (timezone is null or char_length(timezone) <= 64)`
  (the phone's zone; used when `founder_profiles.timezone` is empty)
- `created_at timestamptz not null`, `updated_at timestamptz not null`
- index `(user_id, updated_at desc)`
- ARCHITECTURE.md lists `permission_granted`: not needed, a token is only sent
  after the phone grants permission, and a refused phone sends none.
- Rows are deleted on sign-out (`DELETE /api/push/token`) and when Expo says
  the device is gone (DeviceNotRegistered).

## notification_log (the 2 a day cap)
- `id uuid pk default gen_random_uuid()`, `user_id uuid not null references auth.users on delete cascade`
- `kind text not null check (kind in ('morning','quiet_check','evening','reminder'))`
- `dedupe_key text not null` (`morning:<local day>`, `evening:<move id>`,
  `reminder:<move id>`, `quiet:<situation id>:<last activity>`),
  **unique `(user_id, dedupe_key)`. NEEDED:** the row is inserted before the
  push is sent; a second tick or process that hits this sends nothing
- `local_day date not null` (the founder's local date at send; the cap counts
  rows of today with status sending or sent)
- `status text not null check (status in ('sending','sent','failed'))`
- `attempts smallint not null default 1 check (attempts between 1 and 3)`
- `error text null` (an Expo error code only, never push text)
- `move_id uuid null references moves on delete set null`,
  `situation_id uuid null references situations on delete set null`
- `created_at timestamptz not null`, `sent_at timestamptz null`, `updated_at timestamptz not null`
- index `(user_id, created_at desc)`
- The push text is not stored.

## user_settings (columns for Settings > Reminders, added to the table above)
- `morning_on boolean not null default true`, `evening_on boolean not null default true`
- `lock_screen text not null default 'short' check (lock_screen in ('full','short','hidden'))`
  (ARCHITECTURE.md says `nothing`; decisions and Settings say Hidden. To confirm.)
- `quiet_start time not null default '22:00'`, `quiet_end time not null default '06:00'`
  (ARCHITECTURE.md has one `quiet_hours` field; two columns are simpler to check)
- Defaults are needed: the sharing setting inserts a row with only `share_auto`.

## Existing columns used
- `founder_profiles.report_time_local` is the check-in time. `PUT
  /api/settings/reminders` writes it there (not a new `checkin_time_local`
  column) because the Move already reads it when a move is committed.
- `founder_profiles.timezone`, then the newest device's zone, then the move's
  zone, then UTC: the zone for quiet hours, the local day and the 8 am push.
- Read by the scheduler: `moves (status, title, committed_at, report_due_at,
  closes_at, learn_id, time_zone)`, `learn_conversations.move_subject`,
  `situations (status, title, last_activity_at)`, `care_events` (through
  `isCareOpen`). The scheduler writes nothing to moves or situations.

# Schema needs for Home, History and Settings (B9)

No new table. Columns added to `user_settings` (same rules as above).

- `last_greeting text null`: the id of the greeting shown last, so the same
  line is not shown twice in a row (an id like `morning:a`, never founder text)
- `keep_items boolean not null default false`: Settings > On screen, "keep my
  open items on screen"
- `mentor_style text not null default 'direct' check (mentor_style in ('calm','direct','hard'))`:
  Settings > How Axiom talks. Stored only; nothing reads it yet
- Defaults matter: other code inserts a `user_settings` row with only the
  column it needs.

Existing columns read: `users.first_name` (the name in the greeting, then the
sign-in name), `founder_profiles (country, timezone, deadline,
signup_answers)`, `push_tokens` (is any device registered), `situations`,
`reads`, `learn_conversations`, `learn_turns.sources`, `moves`, `reports`.

## account_requests (new table, B9)
- `id uuid pk default gen_random_uuid()`, `user_id uuid not null references auth.users`
- `kind text not null check (kind in ('export','delete'))`
- `status text not null default 'queued'`, `created_at timestamptz not null`
- RLS on, server only. `POST /api/account/export` and `DELETE /api/account` only
  insert here (one waiting row per kind) and delete NOTHING. A deletion plan
  (what goes, what stays, the private outcome link, the order) must be written
  from a dump of the live schema and approved before any deletion is built.
- Env (optional): `PRIVACY_URL`, `TERMS_URL` fill Settings > Privacy and Terms.
