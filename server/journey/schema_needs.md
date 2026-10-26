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
