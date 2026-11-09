# Axiom: Architecture Document

Updated November 2026 to match PRODUCT.md, `tasks/decisions.md` and the code on branch `feature/journey-v1`.

## Status of This Document
This document describes the code as it is on `feature/journey-v1`, plus what
is still to come (see PRODUCT.md).

- **Current** means it exists in the code today.
- **Target** means it is planned and not built yet.
- **VERIFY** means the repo does not prove it. Check the live system before
  relying on it.

The previous version of this document described a Next.js, FastAPI and Claude
API stack. That stack does not exist. Ignore any older references to it.

---

## System Overview

### Stack
| Layer     | Current                                      | Target |
|-----------|----------------------------------------------|--------|
| Client    | **Native app (Expo, React Native) for iOS and Android**, with push notifications. | Same. |
| Backend   | Express (Node.js) on Render (`render.yaml`, deploys from `main`) | Same. One API serves the app. |
| Database  | Supabase, two projects                       | Same. |
| Auth      | Supabase Auth (Google OAuth)                 | Same (Google sign-in, native flow on the app). |
| AI        | OpenAI (chat models + text-embedding-3-small)| Same. Model IDs live in `server/config.js`, one setting per step. Do not hardcode. |
| Push      | Expo push sender (`server/push/`), off until `EXPO_PUSH=on` | Same. Needs the phone build. |
| Scheduler | Inside the API process (`push/scheduler.js`), ticks every minute; the host must stay on | Same. |

### Supabase projects
- **Main (Axiom):** users, founder profiles, situations, reads, learn turns,
  moves, reports, consents, settings, push tokens, notification log, model
  usage, plus the old product's tables (data kept; the app that wrote them is gone).
- **Knowledge (axiom-knowledge):** sources, chunks and embeddings. The server
  reads it through `match_wiki_chunks` (vectors stored as `halfvec(1536)`).
  The verified lesson tables are not there yet. Writes to this project are
  gated: see "Gated changes".

### Infrastructure map
```
App (Expo, iOS and Android)
   |  Supabase Auth only (sign in, session token)
   |  HTTPS + bearer token
   v
Express API (Render)
   |-- Care screen (runs first on every founder message)
   |-- OpenAI (chat, embeddings, transcription later)
   |-- Main Supabase (service client, server side writes)
   |-- Knowledge Supabase (service client, retrieval, quote picking)
   |-- Scheduler (reminders, quiet check, 14-day pause)
   `-- Expo push service (reminders)
```

### Core principle
**All writes go through the Express API.** The client uses Supabase only for
authentication, and a test fails the build if the app calls `supabase.from` or
`rpc`.

---

## The Founder Journey: Request Flow (current)

Every endpoint below is authenticated, rate limited per user, checks that the
founder owns the row (404 otherwise) and returns generic errors. **Every
endpoint that accepts founder text runs the care check first (see Care).**

```
Sign-up (once)
  GET  /api/signup                 -> saved answers and the next question
  PUT  /api/signup/answers/:key    -> save one answer (resumable, 13 questions)
  POST /api/first-reading          -> 1 structured call: first reading + hook.
                                      Stored in founder_profiles.first_reading;
                                      a repeat returns the stored one. The first
                                      reading may carry up to 2 underlined
                                      phrases. No feedback endpoint exists.
  GET  /api/loading-hint           -> one verified quote, book name only. No
                                      model call. Empty (null) until the
                                      verified lesson library is loaded.

Home
  GET  /api/home                   -> greeting, pending items, reminder state.
                                      Deterministic, no model call.
  POST /api/home/checkin           -> the founder's reply to the greeting

Situation
  GET  /api/situations/open        -> open situations
  POST /api/situations             -> create (text); daily limit of 5 new
                                      situations (test accounts skip it)
  GET  /api/situations/:id
  POST /api/situations/:id/turn    -> one structured call per founder answer,
                                      returns follow_up | ready. The server
                                      counts follow-ups (max 2) and ignores
                                      filler replies.

Read
  POST /api/situations/:id/read    -> 1 structured call: headline, body, one
                                      closing question. No underlines.
  POST /api/situations/:id/read/answer
                                   -> stores the answer (or "skipped"); then
                                      up to 2 more questions (followup step,
                                      kind read_talk), then Learn. answered_at
                                      is set when the talk ends.

Learn (a conversation)
  POST /api/situations/:id/learn   -> start; retrieval + 1 structured call
  GET  /api/learn/:id
  POST /api/learn/:id/turn         -> retrieval + 1 structured reply call;
                                      returns the reply, optional picture,
                                      tappable follow-ups and a move offer
                                      (none | first | second), at most 2
                                      offers in total, decided by the server
  POST /api/learn/:id/followup/:n  -> answers a tapped follow-up, once

Move
  POST /api/learn/:id/move         -> draft, deterministic validator, return
                                      mission, success condition, words,
                                      checklist, prediction
  GET  /api/moves/active
  GET  /api/moves/:id
  POST /api/moves/:id/commit       -> committed; schedules the evening report
  POST /api/moves/:id/swap         -> one swap, real reason required

Report
  GET  /api/reports/due            -> moves waiting for a report
  POST /api/moves/:id/report       -> Done | Couldn't | Didn't + note;
                                      deterministic write, prediction check,
                                      reply, unlock for founder cases
  GET  /api/reports/:id
  GET  /api/reports/:id/story      -> one approved, consented founder story
                                      that fits (or none; then nothing is said)
  POST /api/reports/:id/consent    -> Share | Keep private (asked every time)
  POST /api/reports/:id/withdraw   -> take a shared story back

Settings and history
  GET  /api/history, GET /api/history/:id        (read only)
  GET/PUT /api/settings            -> mentor style, lock-screen mode, keep
                                      items on screen, and the other settings
  GET/PUT /api/settings/reminders  -> check-in time, morning and evening on
                                      or off, quiet hours
  GET/PUT /api/settings/sharing    -> "share automatically" (default off)
  POST   /api/push/token           -> save the device push token
  DELETE /api/push/token
  POST   /api/account/export       -> one JSON file of what is stored about
                                      the founder; reads only their rows, and
                                      leaves out evidence, model usage, push
                                      tokens and anything about other founders
  DELETE /api/account              -> delete request (see Account deletion)

Review queue (reviewers only)
  GET  /review                     -> the review page (404 unless
                                      REVIEWER_USER_IDS is set and the signed-in
                                      user is on it)
  GET  /api/review/outcomes        -> stories waiting (pending_review), with no
                                      user id, report id or author link
  POST /api/review/outcomes/:id/draft
                                   -> the model drafts story and lesson
                                      (step report); a person edits it
  POST /api/review/outcomes/:id    -> approve (story + lesson) or reject
```

Also: `GET /health` (no sign-in) for the host's health check.

Voice input is later. When it exists, the app uploads audio, the server
transcribes it, and the transcript follows the same path as text.

### Offline and retries
- The app keeps a local queue. Every write carries an idempotency key
  (for example `turn_seq`), so a retry never double-counts a follow-up or
  double-spends a model call.
- A message that could not be sent shows "Waiting to send" and is sent when
  the connection returns. The evening check-in is saved locally and sent
  later.
- If a model call fails or takes too long, the founder's message is already
  saved; the app shows the error line and "Try again".

---

## Care (runs before everything)
- A classifier sits in front of every route that takes founder text, before
  any retrieval or lesson. Three outcomes:
  - **clear**: care screen. The step stops; no lesson, no move.
  - **unclear**: Axiom replies from the conversation context, or asks softly.
    No lesson or move that turn. Repeated or worsening signals escalate to
    **clear**.
  - **none**: carry on.
- Rules plus a model, tuned to catch rather than miss. False alarms
  ("kill the feature", "burn rate") are handled by a test set that is part of
  the build.
- While a care event is open: pushes for that founder are paused, nothing
  mentions moves or reports, and the next open starts with a gentle check-in.
- Care text is private. It is never used in founder stories, sharing,
  analytics or later prompts for motivation.
- Help block: one website for now, findahelpline.com (`care/copy.js`). Numbers
  per country, verified by a person and reviewed yearly, are still to come.
  **No phone number is written in code until a person verifies it.**

---

## Data Model

### Before any schema change
The checked in main schema is incomplete, and live RLS on the knowledge
project is unknown. **Dump both live schemas read only before writing any
migration.** Never run raw SQL in production. All changes go through
migration files in the repo, applied only with Rafay's explicit approval.

### Old product tables (data kept, nothing writes to them)
`sessions`, `messages`, `conversation_threads`, `app_sessions`, `experiments`,
`personal_memories`, `product_events`, `users` (read for first names; nothing
writes it now). `model_usage_logs` dates from then too and is still written. The new journey does not use `experiments`: moves live in their own table (`experiments.session_id` points
at the old `sessions`). Knowledge sources, chunks and embeddings stay in the
Knowledge project.

### Current tables (main project, migrations in `supabase/migrations/`)
| Table              | Purpose | Key fields |
|--------------------|---------|------------|
| founder_profiles   | One row per founder | user_id, signup_answers jsonb (all 13 answers), open_answers jsonb, first_reading jsonb, stage, business_model, customer_markets[], country, goal, deadline, report_time_local, timezone |
| situations         | One per situation | id, user_id, title, status (open, paused, closed), follow_up_count (CHECK 0 to 2), create_turn_id, care_flag, last_activity_at |
| situation_turns    | Founder and Axiom messages | id, seq, situation_id, role, text, filler, client_turn_id (repeat-safe), result (result.read_talk marks the talk after the Read) |
| reads              | Axiom's read | id, situation_id (unique), headline, body (one text), closing_question, source (model, fallback), closing_answer, skipped, answered_at |
| learn_conversations | One per situation | id, situation_id (unique), user_id, offers int[] (CHECK at most 2), move_subject, move_fact, lock_token |
| learn_turns        | Lesson conversation | id, seq, conversation_id, role, kind (lesson, reply, followup), text, filler, evidence and validation (server only), sources, picture, follow_ups, move_offer (none, first, second), parent_turn_id, followup_index |
| lesson_citations   | What the checker verified | id, learn_turn_id, chunk_ids[], author, book_title, quote (nullable, verified word for word) |
| moves              | The move | id, user_id, situation_id, learn_id, status (draft, committed, report_due, reported, closed_no_report, swapped), title, mission, success_condition, words, checklist, prediction, hypothesis, start_minutes (1 to 10), swap_count (CHECK 0 to 1), swapped_from, active_slot (1 or 2; unique per founder, so at most 2 active), committed_at, report_due_at, closes_at |
| reports            | Evening report | id, user_id, move_id (unique), situation_id, outcome (done, couldnt, didnt), note, prediction, prediction_check, reply, share_state (asked, shared, private, withdrawn, not_offered), share_automatic, share_decided_at, consent_wording_version |
| consent_log        | Each consent decision | id, user_id, report_id (null for the settings switch), action (asked, share, auto_share, keep_private, withdraw, auto_share_on, auto_share_off), wording_version, decided_at |
| peer_outcomes      | Anonymized founder stories | id, status (pending_review, approved, rejected, withdrawn), stage, customer_market, business_model, outcome, draft jsonb, story, lesson, reviewed_by, reviewed_at. No user_id. A trigger clears `draft` on approve or reject and rounds `created_at` to the day. |
| outcome_author_links | Private, server only | peer_outcome_id, user_id, report_id, withdrawn_at |
| peer_unlocks       | Give to get | id, user_id, granted_by_report_id, kind (report, share), used_on_situation_id |
| founder_lesson_log | Author lessons already shown | id, user_id, source_key (unique per founder), slot (1 or 2) |
| user_settings      | Settings | user_id, share_auto (default false), morning_on, evening_on, lock_screen (full, short, hidden), quiet_start, quiet_end, mentor_style (calm, direct, hard), keep_items, last_greeting |
| push_tokens        | Devices | id, user_id, token (unique), platform (ios, android), timezone |
| notification_log   | The push cap and dedupe | id, user_id, kind (morning, quiet_check, evening, reminder), slot (morning, evening), local_day, status (sending, sent, failed), attempts, dedupe_key. Unique per founder, day and slot: at most 2 a day. |
| care_events        | Private | id, user_id, level (unclear, clear), scope_id, created_at, resolved_at. No message text. |
| account_requests   | Export and delete requests | id, user_id, kind (export, delete), status, delete_after |

Not built: a separate theory table, a daily usage table (the new-situation
limit counts `situations.created_at` for the day), and introduction requests
(introductions are a later plan).

### Privacy boundary
- `peer_outcomes` never stores a user_id. Founders can read only approved
  peer outcomes, and only through the API.
- **DECIDED (Rafay): option B, a separate server-only link table.** Peer
  outcome rows still never hold a user_id. A private table, readable only by
  the server, links an outcome to its author. It exists for two reasons:
  1. a founder can withdraw and have past outcomes taken down (and it helps
     with legal deletion requests);
  2. the future plan to connect complementary founders. An introduction needs
     to know who is behind an outcome so the server can ask **both** founders.
     Introductions stay **double opt in**: nothing is revealed unless both say
     yes. The link is never exposed to the client or to other founders.
- The founder-facing wording must stay honest: "with no name" means no name is
  shown to others. The Privacy page says plainly that a private link exists so
  they can take a share back and so introductions can happen only if both
  people agree.
- Care events and care text are excluded from sharing, analytics and prompts.

### Drop later (only after replacements work and data is exported)
Weekly reads, personal wiki graph tables, node and edge data, warning
counters, removal and reapplication fields, learning map state.

### Row Level Security and access
- RLS is on for every founder table, with no client policies. The app has no
  direct read or write on them; everything goes through the Express API with
  the service role.
- `founder_profiles` is server only too (migration `20261103103416` removed
  its owner SELECT). The app uses Supabase for sign-in only.
- The service role key exists only on Render. Never in the app.

---

## AI Layer

### Principles
- Every step makes **one structured call** where possible.
- All outputs that drive the product are JSON, validated on the server. On
  invalid JSON: retry once with the schema appended, then fail gracefully.
- The model can never invent: author and book come from the database row,
  quotes are checked as exact pieces of retrieved text, numbers in pictures are
  from the founder or from our code.
- The Read and first reading may only quote the founder's own words; the
  checker verifies each quote against what they wrote. The Read has no
  underlined phrases; only the first reading has them (max 2).

### Models per step (`server/config.js`)
Each step reads `MODEL_<STEP>` from the environment and falls back to the
default. The server picks the model, never the request.

| Step     | Default model | Used for |
|----------|---------------|----------|
| read     | gpt-5.2-2025-12-11 | the Read |
| learn    | gpt-5.4-mini-2026-03-17 | Learn replies |
| followup | gpt-4.1-mini | tapped follow-ups |
| move     | gpt-5.4-mini-2026-03-17 | the words of the move |
| care     | gpt-5.4-mini-2026-03-17 | care classifier |
| report   | gpt-5.4-mini-2026-03-17 | report reply, and the reviewer's draft of a shared story |

Embeddings: `text-embedding-3-small`. Limits in code: 2 follow-ups, 2 active
moves, 2 pushes a day.

### Calls per step
| Step        | Calls |
|-------------|-------|
| First reading | 1 structured call |
| Situation   | 1 structured call per founder answer (max 2 follow-ups) |
| Read        | 1 structured call |
| Learn       | 1 retrieval + 1 structured reply call per turn |
| Lesson tap  | 1 call per follow up |
| Loading hint | None (picked from the library; fast) |
| Move        | Deterministic validator; a model writes the words |
| Report      | Deterministic write + a call for the reply text |
| Review draft | 1 call when a reviewer asks for a draft of a shared story |
| Care        | A fast classifier plus rules, before everything |

### Learn reply JSON (target)
```
reply_text (100 to 150 words, hard cap 200, enforced),
sources[] { source_id, chunk_ids[], author, book_title, quote? (verified) },
picture? { type (split_bar | before_after_bars | side_by_side_table |
           timeline | two_by_two), data, interactive? },
follow_up_taps[],
move_offered (none | first | second),
hook_to_next
```
The server checks every `source_id` and `chunk_id` exists and matches the
author and title. Anything that cannot be verified is stripped before the
reply reaches the founder. With fewer than 2 verifiable sources the reply is
built from the founder's own facts only, with no source line and no mention
that anything is missing. It never uses the model's memory for sources.

### Retrieval
Learn embeds the founder's text and calls `match_wiki_chunks` on the Knowledge
project (`server/journey/learn/retrieve.js`). Attribution is book level today:
author and title from the chunk row, and never a quote, chapter or page of
ours. The verified lesson tables are not built, so the loading hint provider
is empty and `GET /api/loading-hint` returns nothing until the library is
loaded.

### Prompt rules that must be enforced in code, not only in prompts
- Max 2 follow-ups in Situation (persisted count with a database CHECK).
- Filler replies never count (a shared filter used by Situation, Learn, Read
  answer and Report).
- Move appears only after two real replies or the "what do I do next" intent.
- Move validator (existing deterministic validator: hypothesis, named real
  target, binary success, startable in 10 minutes).
- Citation validation and quote verification.
- Swap limit of 1. Max 2 active moves.
- At most 2 underlined phrases; at most one picture; reply length cap.
- Push cap of 2 a day (one per slot, enforced by a unique index).
- Daily cap of 5 new situations per founder (test accounts skip it).

### Cost
- Every call is logged to `model_usage_logs` with its step as the call type
  (migrations `20260930000001` and `20261101000009`). VERIFY the prices applied
  to each model ID before real users arrive.
- Two daily limits protect a free product: 5 new situations per founder, and
  $1 of model cost per founder (`server/dailyCap.js`), summed from
  `model_usage_logs` since 00:00 UTC. Over the cap, routes that would call a
  model answer 429 `daily_cost_cap`. Never capped: the care check, which always
  runs first; the Report; replaying anything already stored
  (`server/journey/storedAnswers.js`); the review queue. Test accounts skip it.

---

## Knowledge Base

### Current
- Six pillar source corpus with embeddings and vector retrieval.
- Source level title, author and pillar metadata.
- Stored passage text is retrievable.

### Verified lesson library (not in the live DB, not read by the code)
- About 15,700 lessons from 66 books, produced in `knowledge_pilot/`, each
  with a verified short quote, author, book, chapter and page.
- Planned tables in the Knowledge project (gated, see below):
  `library_lessons`, `chunk_lessons`, `source_crosswalk`. None exist in the
  code or migrations yet. Until they do, Learn cites at book level and the
  loading hint is empty.

### Needed for the new product
- Source and chunk IDs passed through retrieval to the reply call.
- Market, country and language tags per source.
- A separate corpus for peer outcomes. Do not mix founder voices into the book
  corpus.
- Source licenses are VERIFY. Check before quoting source text in the product.

---

## Scheduling and Notifications (current, off until EXPO_PUSH=on)
- **Push** (Expo push to iOS and Android) from `server/push/`. The morning move
  and the evening check-in. **At most 2 a day** per founder, one per slot,
  recorded in `notification_log`. If nothing is due, nothing is sent. The
  "quiet for 3 days" check replaces the morning one.
- Fires at the founder's local time (timezone stored per founder) and respects
  quiet hours. Failed sends are retried up to 3 attempts.
- The lock-screen text follows the founder's setting (full names the move,
  short is generic, hidden is just "Axiom").
- A situation with no activity for 14 days is paused by the scheduler. Nothing
  is deleted.
- Pushes pause for a founder while a care event is open, and while a delete
  request is pending.
- Phone permission is not stored (push_tokens holds only tokens that exist).

---

## Security
- Supabase JWT checked on every API request.
- CORS limited to the allowed frontends (`FRONTEND_URL`, `FRONTEND_URLS`).
- Secrets only in Render environment settings. Only public keys in
  the client.
- User message content is never sent to external logging services. Logs hold
  metadata only.
- Raw provider and database errors are not returned to the client.
- Text reaching prompts is treated as untrusted input.

---

## Account deletion
Plan: `supabase/DELETION_PLAN.md`. The founder types `DELETE` in Settings.
With `ACCOUNT_DELETE` off (today), the request is recorded and nothing is
removed. With it on, the account is marked pending with a 7-day grace period
(the founder can cancel). An hourly check on the server then bans the sign-in,
runs the SQL function `delete_account` (all founder tables in one
transaction), and removes the sign-in. If any step fails, the request stays and
the next hourly run repeats it. Shared outcomes that were approved stay, with
no link to the founder.

---

## Environment variables
Names only; values live in Render (`render.yaml`) and a local `.env`.
- `NODE_VERSION`, `NODE_ENV`, `PORT`: runtime.
- `VITE_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`: main project URL and server key.
- `VITE_KNOWLEDGE_SUPABASE_URL`, `KNOWLEDGE_SUPABASE_SERVICE_ROLE_KEY`: Knowledge project.
- `VITE_SUPABASE_ANON_KEY`: public key for the review page sign-in.
- `OPENAI_API_KEY`: model calls.
- `MODEL_<STEP>`: optional model override per step (READ, LEARN, FOLLOWUP, MOVE, CARE, REPORT, MEMORY).
- `FRONTEND_URL` (required; the server stops without it), `FRONTEND_URLS`: allowed origins.
- `ADMIN_USER_IDS`, `ADMIN_EMAILS`: test accounts that skip the daily situation limit.
- `REVIEWER_USER_IDS`: who may use `/review`; empty turns the page off.
- `EXPO_PUSH`: `on` starts the push scheduler (off today).
- `EXPO_ACCESS_TOKEN`: Expo push sender token.
- `ACCOUNT_DELETE`: `on` makes account deletion real (off today).
- `PRIVACY_URL`, `TERMS_URL`: links shown in Settings.

---

## Gated changes (never run without Rafay's explicit approval)
- Read-only dump of both live schemas (G0).
- The main project migrations for the journey tables (G1): applied.
- Creating the Knowledge lesson tables (G2), reading live chunks to build the
  chunk-to-lesson mapping (G3), uploading lessons (G4). A backup runs first
  (`knowledge_pilot/backup_knowledge.py`). Not done.
- Turning account deletion on: the plan exists and `delete_account` is live;
  only the `ACCOUNT_DELETE` switch remains.
- Any OpenAI spend beyond tests.
- Connected accounts (Stripe, Shopify, Gmail, Notion, CRM, calendar) are
  parked; see PRODUCT.md and `tasks/decisions.md`.

---

## Removed Components
Being removed. Do not extend, do not build on. Remove only after the
replacement screen works.
- Founder Brain, Three.js and postprocessing, brain themes, graph CSS
- Personal wiki graph and node/edge creation
- The old artifact rendering system (the new picture library is a different,
  smaller, checked system)
- Live web search (Exa), its route, clients and prompt modules
- Weekly reads
- Warning, removal, refund and reapplication logic and copy
- Payment integration and any paywall claims
- `POST /api/reads/:id/feedback` and read feedback fields
- Browser side retrieval (`src/lib/rag.js`) and the old chat prompt
- Unused components with zero imports

---

## Deployment
- App: built with Expo, distributed through the app stores (TestFlight and
  internal tracks first).
- Backend: Render (`render.yaml`), deploys from `main`, region Singapore, free
  plan while testing (it sleeps after 15 minutes idle). Move to Starter (always
  on) before `EXPO_PUSH` goes on, because the scheduler runs inside the process.
  Railway is no longer used. The old web app is removed.
- Migrations: committed to the repo, applied through the Supabase CLI.
- Deployment details beyond this are VERIFY from the live configuration.
