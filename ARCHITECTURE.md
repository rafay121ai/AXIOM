# Axiom: Architecture Document

Updated October 2026 to match PRODUCT.md and `tasks/decisions.md`.

## Status of This Document
This document describes the real codebase as found by the September 2026
audit, plus the target architecture for the new product (see PRODUCT.md).

- **Current** means it exists in the code today.
- **Target** means it is planned and not built yet.
- **VERIFY** means the repo does not prove it. Check the live system before
  relying on it.
- **DECISION NEEDED** means Rafay has to confirm before it is built.

The previous version of this document described a Next.js, FastAPI and Claude
API stack. That stack does not exist. Ignore any older references to it.

---

## System Overview

### Stack
| Layer     | Current                                      | Target |
|-----------|----------------------------------------------|--------|
| Client    | Vite + React SPA on Vercel                   | **Native app (Expo, React Native) for iOS and Android**, with push notifications. The Vite app stays only as the old product until replaced. **DECISION NEEDED:** CLAUDE.md says web first, native later. Rafay now says "directly an app". |
| Backend   | Express (Node.js) on Railway                 | Same. One API serves the app. |
| Database  | Supabase, two projects                       | Same, plus the new tables below. |
| Auth      | Supabase Auth (Google OAuth)                 | Same (Google sign-in, native flow on the app). |
| AI        | OpenAI (chat models + text-embedding-3-small)| Same. Model IDs live in server config, one setting per step. Do not hardcode. |
| Push      | None                                         | Expo push (APNs and FCM) sent by the server. |
| Scheduler | None                                         | A server-side scheduler (Railway cron or a queue) for reminders. |

### Supabase projects
- **Main (Axiom):** users, founder profile and theory, situations, reads,
  learn turns, moves, reports, consents, settings, notifications, model usage.
- **Knowledge (axiom-knowledge):** sources, chunks, embeddings, and the
  verified lesson library. Shrunk in October 2026 (vectors stored as
  `halfvec(1536)`, search function `match_wiki_chunks`). Writes to this
  project are gated: see "Gated changes".

### Infrastructure map (target)
```
App (Expo, iOS and Android)
   |  Supabase Auth only (sign in, session token)
   |  HTTPS + bearer token
   v
Express API (Railway)
   |-- Care screen (runs first on every founder message)
   |-- OpenAI (chat, embeddings, transcription later)
   |-- Main Supabase (service client, server side writes)
   |-- Knowledge Supabase (service client, retrieval, quote picking)
   |-- Scheduler (reminders, 14-day pause, daily caps)
   `-- Expo push service (reminders)
```

### Core principle
**All writes go through the Express API.** The client uses Supabase only for
authentication. The audit found sessions, messages and some state still
written from the browser; the new journey never does this, and a test fails
the build if the new client code calls `supabase.from` or `rpc`.

---

## The Founder Journey: Request Flow (target)

Every endpoint is authenticated, rate limited, checks that the founder owns
the row (404 otherwise) and returns generic errors. **Every endpoint that
accepts founder text runs the care check first (see Care).**

```
Sign-up (once)
  POST /api/onboarding            -> save answers 1..13 (resumable, saved
                                     per answer) into founder_profiles
  POST /api/read/initial          -> 1 structured call: first reading + hook.
                                     No feedback endpoint exists.

Home
  GET  /api/home                  -> greeting kind, pending items (move to
                                     do, check-in due, next step), reminder
                                     state. Deterministic, no model call.

Situation
  POST /api/situations            -> create (text)
  POST /api/situations/:id/turn   -> one structured call per founder answer
                                     returns follow_up | ready. The server
                                     counts follow-ups (max 2) and ignores
                                     filler replies.

Read
  POST /api/situations/:id/read   -> 1 structured call: headline, 3 to 4
                                     sentences, evidence, one closing
                                     question, max 2 underlined phrases
  POST /api/situations/:id/read/answer
                                  -> stores the answer (or "skipped") so
                                     Learn can use it

Learn (a conversation)
  POST /api/situations/:id/learn/turn
                                  -> retrieval + 1 structured call; returns
                                     the reply, optional picture, optional
                                     tappable follow-ups, and
                                     move_offered: none | first | second.
                                     The server decides move_offered: after
                                     two real replies, or when the intent
                                     check says the founder asked what to do
                                     next. At most 2 offers in total.
  POST /api/lessons/:id/followup  -> 1 call, answer appears in place
  POST /api/hint                  -> loading hint: one verified quote (book
                                     name only) picked from the library by
                                     the situation. No model call, fast.

Move
  POST /api/situations/:id/move   -> generate draft, run the deterministic
                                     validator, return mission, success
                                     condition, words, checklist, prediction
  POST /api/moves/:id/commit      -> committed; schedule the evening check-in
  POST /api/moves/:id/swap        -> one swap, real reason required
  POST /api/push/register         -> save the device push token and whether
                                     the phone granted permission

Report
  POST /api/moves/:id/report      -> Done | Couldn't | Didn't + note
                                     -> deterministic write, update theory,
                                     check the prediction, offer next step
  GET  /api/reports/:id/story     -> one approved, consented founder story
                                     that fits (or none; then nothing is said)
  POST /api/reports/:id/consent   -> Share | Keep private (asked every time)

Settings and history
  GET/PATCH /api/settings         -> check-in time, morning and evening on or
                                     off, lock-screen mode, mentor style, keep
                                     items on screen, share automatically
  GET  /api/history, /api/history/:id (read only)
  POST /api/account/delete        -> needs its own plan first (see Gated)
```

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
- While a care event is open: all pushes for that founder are paused, nothing
  mentions moves or reports, and the next open starts with a gentle check-in.
- Care text is private. It is never used in founder stories, sharing,
  analytics or later prompts for motivation.
- Help numbers come from a table verified by a person and reviewed yearly
  (country from sign-up). Fallback: a worldwide directory. **No number is
  written in code until a person verifies it.**

---

## Data Model

### Before any schema change
The checked in main schema is incomplete, and live RLS on the knowledge
project is unknown. **Dump both live schemas read only before writing any
migration.** Never run raw SQL in production. All changes go through
migration files in the repo, applied only with Rafay's explicit approval.

### Keep (current)
- Auth users
- `sessions`, `messages`: kept only during the transition
- `experiments`: kept, states change (see below)
- Personal memories
- Knowledge sources, chunks, embeddings
- Model usage logging (fix cost calculation, see AI Layer)

### Change
- **experiments** states become:
  `draft -> committed -> report_due -> reported | closed_no_report`, with a
  `swap_count` (max 1) and a `prediction` field. Maximum 2 active per founder.

### New tables (target)
| Table              | Purpose | Key fields |
|--------------------|---------|------------|
| founder_profiles   | One row per founder, from the 13 answers | user_id, stage, months_in, commitment, business_model, country, customer_market (own country / abroad / both), team, goal, goal_when, background, why, strengths[], avoid[], tried[], building_text, stuck_text, onboarding_step (for resuming) |
| founder_theory     | Private theory behind Reads | user_id, contradictions, blind_spots, say_do_gaps, patterns, version, updated_at |
| situations         | One per situation | id, user_id, title, status (open, paused, closed), follow_up_count (CHECK <= 2), last_activity_at, linked_situation_id, started_by (founder, axiom later) |
| situation_turns    | Founder and Axiom messages | id, situation_id, turn_seq (unique), role, text, filler (bool), created_at |
| reads              | Axiom's read | id, situation_id, headline, body[], underlines[] (max 2), closing_question, closing_answer, skipped |
| learn_turns        | Lesson conversation | id, situation_id, seq, reply, picture jsonb, taps[], real_reply_count, move_offered |
| lesson_citations   | What the checker verified | id, learn_turn_id, source_id, chunk_ids[], author, book_title, quote (nullable, verified), validation_report |
| move_reports       | Evening report | id, experiment_id, outcome (done, couldnt, didnt), note, prediction_matched, created_at |
| consents           | Each share choice | id, user_id, report_id, shared (bool), decided_at |
| user_settings      | Settings | user_id, checkin_time_local, timezone, morning_on, evening_on, lock_screen (full, short, nothing), quiet_hours, mentor_style (calm, direct, hard), keep_items, share_auto (default false) |
| push_tokens        | Devices | id, user_id, token, platform, permission_granted, updated_at |
| notification_log   | The 2 a day cap | id, user_id, kind, sent_at (the cap is counted from this) |
| care_events        | Private | id, user_id, level (unclear, clear), created_at, resolved_at (minimal, no message text unless needed for review) |
| usage_daily        | Daily caps | user_id, day, new_situations, model_calls, cost_estimate |
| peer_outcomes      | Anonymized founder stories | id, stage, customer_market, business_model, topic, story, outcome, lesson, status (draft, approved, rejected), reviewed_by, reviewed_at |
| peer_unlocks       | Give to get | id, user_id, granted_by_report_id, used_on_situation_id |
| intro_requests     | Double opt in intros (later) | id, from_user_id, to_user_id, reason, from_accepted, to_accepted, status |

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

### Row Level Security
- RLS on every table.
- Founder owned rows: owner SELECT only from the client. Writes go through the
  API.
- Server only writes: lessons, reads, peer outcomes, unlocks, theory,
  notification and care tables.
- The service role key exists only on Railway. Never in the app.

---

## AI Layer

### Principles
- Every step makes **one structured call** where possible. The audit found 4
  to 7 model operations per ordinary chat turn. Target is 1 to 2 per step.
- All outputs that drive the product are JSON, validated on the server. On
  invalid JSON: retry once with the schema appended, then fail gracefully.
- The model can never invent: author and book come from the database row,
  quotes are checked as exact pieces of retrieved text, numbers in pictures are
  from the founder or from our code.
- The Read and first reading may only quote the founder's own words; the
  checker verifies each quote and underlined phrase against what they wrote.

### Target calls
| Step        | Calls |
|-------------|-------|
| First reading | 1 structured call |
| Situation   | 1 structured call per founder answer (max 2 follow-ups) |
| Read        | 1 structured call |
| Learn       | 1 retrieval + 1 structured reply call per turn |
| Lesson tap  | 1 call per follow up |
| Loading hint | None (picked from the library by tags; fast) |
| Move        | Deterministic transform + validator; a model only to write the words |
| Report      | Deterministic write + optional cheap call for the reply text, theory update, anonymization draft |
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

### Retrieval (Version C, from the library work)
The existing search picks passages. Verified lessons attach through a
precomputed passage-to-lesson table. Passages with no lesson stay at book
level (author and title, no quote). The library holds about 15,700 lessons from
66 books, each with a verified short quote, author, book and page.

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
- Push cap of 2 a day.
- Daily cap on new situations per founder.

### Cost
- The current logger applies wrong prices to some model IDs. Fix this before
  real users arrive.
- Log cost per call, per step and per active founder.
- Daily cap on situations and calls per founder to protect a free product.
- Cheaper models for non critical calls; the loading hint costs nothing.

---

## Knowledge Base

### Current
- Six pillar source corpus with embeddings and vector retrieval.
- Source level title, author and pillar metadata.
- Stored passage text is retrievable.

### Verified lesson library (built in October 2026, not yet in the live DB)
- About 15,700 lessons from 66 books, produced in `knowledge_pilot/`, each
  with a verified short quote, author, book, chapter and page.
- Planned tables in the Knowledge project (gated, see below):
  `library_lessons`, `chunk_lessons`, `source_crosswalk`.
- The same library is the source of the loading hint quotes (the stored short
  quote, verified word for word, shown with the book name only).

### Needed for the new product
- Source and chunk IDs passed through retrieval to the reply call.
- Market, country and language tags per source.
- A separate corpus for peer outcomes. Do not mix founder voices into the book
  corpus.
- Source licenses are VERIFY. Check before quoting source text in the product.

---

## Scheduling and Notifications (target)
- **Push** (Expo push to iOS and Android). The morning move and the evening
  check-in. **At most 2 a day** per founder, counted from `notification_log`.
  If nothing is due, nothing is sent. The "quiet for 3 days" check replaces the
  morning one.
- Fires at the founder's chosen local time (default 8 pm for the check-in).
  Quiet hours. Timezone stored per founder; test around daylight saving.
- The lock-screen text follows the founder's setting (Full names the move,
  Short is generic, Nothing is just "Axiom").
- One reminder per move if there is no report, then the situation closes
  quietly. No warnings.
- A situation with no activity for 14 days is paused by the scheduler. Nothing
  is deleted.
- If the phone denies notification permission the server records it. The
  app then keeps the evening item on the home screen until they report.
- Pushes pause for a founder while a care event is open.

---

## Security
- Supabase JWT checked on every API request.
- CORS limited to the production frontend and localhost (web) and the app.
- Secrets only in Railway and Vercel environment settings. Only public keys in
  the client.
- User message content is never sent to external logging services. Logs hold
  metadata only.
- Raw provider and database errors are not returned to the client.
- Text reaching prompts is treated as untrusted input.

---

## Gated changes (never run without Rafay's explicit approval)
- Read-only dump of both live schemas (G0).
- Applying the main project migration for the new tables (G1).
- Creating the Knowledge lesson tables (G2), reading live chunks to build the
  chunk-to-lesson mapping (G3), uploading lessons (G4). A backup runs first
  (`knowledge_pilot/backup_knowledge.py`).
- The account deletion flow needs its own deletion plan before it is built.
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
- Backend: Railway, deploys from the main branch.
- Old web app: Vercel, until it is retired.
- Migrations: committed to the repo, applied through the Supabase CLI.
- Deployment details beyond this are VERIFY from the live configuration.
