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
  `underlines jsonb` (array, at most 2), `closing_question text`
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
