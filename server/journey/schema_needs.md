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
