# Axiom: Architecture Document

## Status of This Document
This document describes the real codebase as found by the September 2026
audit, plus the target architecture for the new product (see PRODUCT.md).

- **Current** means it exists in the code today.
- **Target** means it is planned and not built yet.
- **VERIFY** means the repo does not prove it. Check the live system
  before relying on it.

The previous version of this document described a Next.js, FastAPI and
Claude API stack. That stack does not exist. Ignore any older references
to it.

---

## System Overview

### Stack (current)
| Layer     | Technology                                   | Hosting  |
|-----------|----------------------------------------------|----------|
| Frontend  | Vite + React SPA                             | Vercel   |
| Backend   | Express (Node.js)                            | Railway  |
| Database  | Supabase, two projects (see below)           | Supabase |
| Auth      | Supabase Auth (Google OAuth)                 | Supabase |
| AI        | OpenAI (chat models + text-embedding-3-small)| OpenAI   |

Model IDs live in server config. Do not hardcode them in new code.

### Supabase projects
- **Main (Axiom):** users, sessions, messages, experiments, personal
  memories, model usage, and all new founder journey tables.
- **Knowledge (axiom-knowledge):** sources, chunks, embeddings, concepts.

### Infrastructure map (target)
```
Browser (Vite/React on Vercel)
   |  Supabase Auth only (sign in, session token)
   |  HTTPS + bearer token
   v
Express API (Railway)
   |-- OpenAI (chat, embeddings, transcription)
   |-- Main Supabase (service client, server side writes)
   |-- Knowledge Supabase (service client, retrieval)
   |-- Scheduler (report reminders)
   `-- Email provider (report reminders)
```

### Core principle (target)
**All writes go through the Express API.** The browser uses Supabase only
for authentication. The audit found sessions, messages and some state
still written from the browser. Moving these behind the server is a
priority.

---

## The Founder Journey: Request Flow (target)

```
Onboarding (once)
  POST /api/onboarding        -> save profile fields + answers
  POST /api/read/initial      -> 1 structured call: first Read + hook

Situation
  POST /api/situations        -> create situation (text or transcript)
  POST /api/situations/:id/turn
                              -> 1 structured call per founder answer
                                 returns: follow_up | ready
                                 server enforces max 2 follow ups

Read
  POST /api/situations/:id/read
                              -> 1 structured call: read, evidence,
                                 hook into Learn
  POST /api/reads/:id/feedback -> "right" | "not_quite" + correction

Learn
  POST /api/situations/:id/lessons
                              -> retrieval + 1 structured call:
                                 lesson stack + hook into Move
                              -> server validates every citation
  POST /api/lessons/:id/followup
                              -> 1 call, answer appears in place

Move
  POST /api/situations/:id/move
                              -> generate draft, run deterministic
                                 validator, return mission, success
                                 condition, script, checklist,
                                 prediction
  POST /api/moves/:id/commit  -> state: committed, schedule report
  POST /api/moves/:id/swap    -> one swap allowed, reason required

Report
  POST /api/moves/:id/report  -> Done | Couldn't | Didn't + note
                                 consent choice
                              -> deterministic write, update theory,
                                 grant unlock, queue anonymization if
                                 consented
```

Voice input: the browser records audio, uploads it to the API, the server
transcribes it, and the transcript follows the same path as text.

---

## Data Model

### Before any schema change
The checked in main schema is incomplete, and live RLS on the knowledge
project is unknown. **Dump both live schemas read only before writing any
migration.** Never run raw SQL in production. All changes go through
migration files in the repo.

### Keep (current)
- Auth users
- `sessions`, `messages`: kept during transition, and for the optional
  chat behind a tap
- `experiments`: kept, states change (see below)
- Personal memories
- Knowledge sources, chunks, embeddings
- Model usage logging (fix cost calculation, see AI Layer)

### Change
- **experiments** states become:
  `draft -> committed -> report_due -> reported | closed_no_report`,
  with a `swap_count` (max 1) and a `prediction` field.
- **Founder profile fields** normalized into their own table (below)
  instead of loose onboarding answers.

### New tables (target)
| Table              | Purpose | Key fields |
|--------------------|---------|------------|
| founder_profiles   | One row per founder | user_id, country, customer_markets[], business_model, stage, goal, deadline, report_time_local, timezone |
| founder_theory     | Private theory behind Reads | user_id, contradictions, blind_spots, say_do_gaps, patterns, version, updated_at |
| situations         | One per situation | id, user_id, raw_text, transcript, follow_up_count, status, linked_situation_id, created_at |
| reads              | Axiom's read of a situation | id, situation_id, text, evidence, hook, feedback, correction |
| lessons            | Structured lesson stack | id, situation_id, position, kind (author, founder_voice), payload jsonb |
| move_reports       | Evening report | id, experiment_id, outcome, note, prediction_matched, consent_to_share, created_at |
| consent_snapshots  | Exact consent given | id, user_id, report_id, scope, granted_at, withdrawn_at |
| peer_outcomes      | Anonymized founder voices | id, stage, customer_market, business_model, topic, story, outcome, lesson, status (draft, approved, rejected), reviewed_by, reviewed_at |
| peer_unlocks       | Give to get | id, user_id, granted_by_report_id, used_on_situation_id |
| intro_requests     | Double opt in intros | id, from_user_id, to_user_id, reason, from_accepted, to_accepted, status |

### Privacy boundary
- `peer_outcomes` never stores a user_id. The link between an outcome and
  its author lives in a separate server only table.
- Founders can read only approved peer outcomes, and only through the
  API.

### Drop later (only after replacements work and data is exported)
Weekly reads, personal wiki graph tables, node and edge data, warning
counters, removal and reapplication fields, learning map state (only
after lessons record explicit progress).

### Row Level Security
- RLS on every table.
- Founder owned rows: owner SELECT only from the browser. Writes go
  through the API.
- Server only writes: lessons, reads, peer outcomes, unlocks, matches,
  theory.
- The service role key exists only on Railway. Never in the frontend.

---

## AI Layer

### Principles
- Every step makes **one structured call** where possible. The audit
  found 4 to 7 model operations per ordinary chat turn. Target is 1 to 2
  per step.
- All outputs that drive the product are JSON, validated on the server.
  On invalid JSON: retry once with the schema appended, then fail
  gracefully.
- Every step output includes its **hook** into the next screen. Hooks
  follow the rules in PRODUCT.md and pass the anti generic gate.

### Target calls
| Step        | Calls |
|-------------|-------|
| Onboarding  | 1 structured call: profile read + first Read |
| Situation   | 1 structured call per founder answer (max 3 answers) |
| Read        | 1 structured call |
| Learn       | 1 retrieval + 1 structured lesson stack call |
| Lesson tap  | 1 call per follow up |
| Move        | Deterministic transform + validator; model only if the script needs generating |
| Report      | Deterministic write + optional 1 call for theory update and anonymization draft |

### Lesson JSON (target)
```
lesson_id, kind (author | founder_voice),
author, book_title, source_id, chunk_ids[],
chapter_or_location (null unless verified),
argument, founder_connection, action,
follow_up_taps[],
peer_outcome_id (founder voices only),
hook_to_next
```
The server checks every `source_id` and `chunk_id` exists and matches the
author and title. Any attribution that cannot be verified is stripped
before the lesson reaches the founder.

### Prompt rules that must be enforced in code, not only in prompts
- Max 2 follow ups in Situation (persisted count).
- Move validator (existing deterministic validator: hypothesis, named
  real target, binary success, startable in 10 minutes).
- Citation validation.
- Swap limit of 1.

### Cost
- The current logger applies wrong prices to some model IDs. Fix this
  before real users arrive.
- Log cost per call, per step and per active founder.
- Daily cap on situations per founder to protect a free product.
- Use cheaper models for non critical calls (theory updates, anonymization
  drafts).

---

## Knowledge Base

### Current
- Six pillar source corpus with embeddings and vector retrieval.
- Source level title, author and pillar metadata.
- Stored passage text is retrievable.
- Claimed concept counts are VERIFY.

### Needed for the new product
- Per chunk: edition or source identity, chapter, section, page or
  location, character offsets.
- Source and chunk IDs passed through retrieval to the lesson call.
- Market, country and language tags per source, so lessons can say what
  carries over between markets.
- A separate corpus for peer outcomes. Do not mix founder voices into the
  book corpus.
- Simplify the retrieval path. Remove query paths that only served
  artifacts or live search.
- Source licenses are VERIFY. Check before quoting source text directly
  in the product.

---

## Scheduling and Notifications (target)
- Report reminders fire at each founder's chosen local time.
- Channel: email and in app for the web product. Push only once a native
  app exists.
- One reminder per move. No further follow ups, no warnings.
- Timezones stored per founder. Test around daylight saving changes.

---

## Security
- Supabase JWT checked on every API request.
- CORS limited to the production frontend and localhost.
- Secrets only in Railway and Vercel environment settings. Only public
  keys in the frontend.
- User message content is never sent to external logging services. Logs
  hold metadata only.
- Raw provider and database errors are not returned to the browser.
- User text reaching prompts is treated as untrusted input.

---

## Removed Components
Being removed. Do not extend, do not build on. Remove only after the
replacement screen works.
- Founder Brain, Three.js and postprocessing, brain themes, graph CSS
- Personal wiki graph and node/edge creation
- Artifact routing, building and rendering, and Recharts if unused
- Live web search (Exa), its route, clients and prompt modules
- Weekly reads
- Warning, removal, refund and reapplication logic and copy
- Payment integration and any paywall claims
- Unused components with zero imports

---

## Deployment
- Frontend: Vercel, deploys from the main branch.
- Backend: Railway, deploys from the main branch.
- Migrations: committed to the repo, applied through the Supabase CLI.
- Deployment details beyond this are VERIFY from the live configuration.