# Plan: update the four documents to match every decision (from tasks/decisions.md)

Source of truth for what was decided: tasks/decisions.md, tasks/voice.md, tasks/walkthrough.md, tasks/design/*.html.
Old versions stay in git history. Nothing is deleted without being rewritten. Where a decision conflicts with a hard rule, it is flagged in the doc and listed at the end of tasks/decisions.md.

- [x] 1. PRODUCT.md: onboarding (13 questions, no personality tests, taps with max 5 options), first reading (no rating), Situation, Read, Learn (conversation first, move after two real replies), Move, Report (push, taps, story before sharing), home (greeting, drawer, fading items), care (two outcomes), settings, history, push rules (max 2 a day), voice summary, measures (remove Read accuracy), removed list.
- [x] 2. ARCHITECTURE.md: native app (Expo) instead of web only, push notifications and scheduling, the new endpoints (no feedback endpoint), citation checking and loading quotes from verified library, care classifier, daily caps, states (queueing offline), data model additions, privacy (sharing, no user_id on peer outcomes), the parked proactive layer noted as future.
- [x] 3. DESIGN.md: replace with the new visual language (black base with faint gold wash, bright stone writing, serif for Axiom, glass on floating things only, thin lines, small marks, drawer, loading hint, motion).
- [x] 4. BRAND.md: update voice (link to tasks/voice.md content), logo (emblem allowed in-app), remove the "Axiom will remove you" and warning language, tagline parked.
- [x] 5. Check: read each doc back, search for leftover old-product terms, list every conflict with CLAUDE.md for Rafay.

## Result (October 2026)
All four documents rewritten or updated. Old versions are in git history (PRODUCT.md, ARCHITECTURE.md, DESIGN.md and BRAND.md were tracked).
BRAND.md: kept the name, the person, distribution, the pillar posts and the writing test; rewrote tagline (parked), what Axiom is, the one-liner, voice, tone, logo, imagery, app icon, positioning edits, launch, pricing (free), growth; retired campaigns 2 and 4 and the removal and Axiom Circle sections. Marketing typography still open.
Not touched on purpose: CLAUDE.md (instructions file). It now disagrees with the documents in the places listed below and Rafay must decide.

## CLAUDE.md vs the new documents (settled by Rafay and CLAUDE.md updated, see decisions.md)
1. Stack: CLAUDE.md says web first (Vite + React on Vercel), native later. Documents now say the app is native (Expo) with push.
2. "Returning founders land on their last open loop, never a blank prompt": the home is now a greeting plus chat bar, with the left-off items fading after about 8 seconds.
3. "Every Learn screen ends in a Move": Learn now leads into the move (after two real replies or when asked) and ends in a conversation first.
4. "Author lessons always name the author and book": the loading hint shows the book name only (lessons still name both).
5. "Consent to share is asked at every report. Default is not shared": a Settings switch "share automatically" (off by default) now exists.
6. "Peer outcome rows never store a user_id": kept; open whether a separate server-only link may exist for taking down past shares (ARCHITECTURE.md).
7. Onboarding: CLAUDE.md and old PRODUCT.md imply 7 + 3; now 13 questions.
8. Deprecated list: "artifact rendering system" is deprecated but a new, smaller, checked picture library is planned.

---

# Build plan v1 (setup approved by Rafay; the build starts when he says go)

Spec: PRODUCT.md, ARCHITECTURE.md, DESIGN.md, tasks/voice.md, tasks/decisions.md and the approved mocks in tasks/design/.
Nothing below has started. No live system, no push, no merge to main.

## What already exists (found in the repo, not assumed)
- `main` already has the old-product cleanup. `feature/knowledge-rechunk-pilot` (this branch) is main + 38 commits: the lesson library work and the new documents.
- **`feature/backend-hardening`** (worktree `/Users/rafayessani/AXIOM-wt/backend`, 39 commits ahead of main, not merged, includes `feature/cost-tracking`): server hardening (rate limits, auth, input caps, CORS, errors), all browser writes moved behind the API, a daily cost cap per founder, model usage logging, product events, request and write validation, a `founder_profiles` migration and endpoints, and node tests. This is most of "M0: server foundation". Migrations there (including a pending "revoke browser writes") are written, **not known to be applied live (VERIFY)**.
- The two branches have diverged (39 vs 38 commits).

## Proposed base
New branch `feature/journey-v1` in a new worktree `/Users/rafayessani/AXIOM-wt/journey`, created from `feature/backend-hardening`, then bring in the documents and the library scripts from the pilot branch (merge locally; report any conflicts, never force). Main is not touched. The new Expo app lives in a new `app/` folder of the same repo.

## Milestones (each ends with tests passing and a short report in tasks/build_log.md)
B0 Setup: create the branch and worktree, bring in the pilot work, run install, build and the existing tests, record the baseline. Read the existing server code before changing anything and list what to reuse (daily cap, usage logging, validation, founder_profiles).
B1 Server foundation: an app factory so the API can be tested without starting it, config for model IDs per step, one structured-call helper (JSON schema, retry once, usage row), fakes for the model, push and clock, test harness. Fix the usage price table (needs Rafay's prices).
B2 Care: three-outcome check in front of every route that takes founder text, with a test set (including "kill the feature", "burn rate", "i wanna dieee", explicit words), a flag that pauses pushes, a verified-help table with placeholders only (no real numbers until a person verifies).
B3 Sign-up: 13 answers saved as they go and resumable, reconciled with the existing `founder_profiles` migration; first reading call; checker that every quote and underlined phrase is the founder's own words; no feedback endpoint.
B4 Situation and Read: persisted follow-up count (CHECK 2), filler filter, idempotent turns, the Read (headline, short body, max 2 or 0 underlines, one closing question), the answer or skip.
B5 Learn: retrieval with the existing search, citation validator (author and book from the database row, quotes as exact substrings), reply length cap, no-source behaviour (say nothing), the five picture types with server-checked numbers, "move offered" rule (two real replies or the what-do-I-do-next intent, max 2), tappable follow-ups, loading-hint endpoint. Book-level attribution only until the lesson tables exist.
B6 Move: existing validator, commit, one swap with a real reason, max 2 active.
B7 Report: Done, Couldn't, Didn't, prediction check, story offer (none until approved outcomes exist), consent every time plus the share-automatically setting, unlock.
B8 Push and scheduler: tokens, the 2-a-day cap from a log, quiet hours, lock-screen modes, 14-day pause, check-in time. Tested with a fake push service. No real device is pinged.
B9 Home, History, Settings, account endpoints (delete is a stub until its plan exists).
B10 Migrations: one consolidated, ordered set written and statically checked, **not applied**. Includes the private author-link table for shared outcomes.
B11 Expo app: scaffold, then the screens in the approved order, each compared to its mock: sign-in, 13 questions, wait, first reading, situation, Read, Learn with the move card and Move sheet, Report, home, drawer, History, Settings, care, loading hint and in-between states. The app talks only to the API (a test fails the build if it calls Supabase tables). Offline queue and retries. Runs against fake API data first. Checked in the iOS Simulator with screenshots.
B12 Review: security and quality review of the whole branch, a clean run of every test, a walkthrough 0 to 1, and a list of everything left for Rafay.

## Limits for the long run (proposed)
Spending: real model calls only for testing, **$6 in total**, in at most 3 runs approved one by one (the first at most $2). Everything else uses fakes. Cost per run is logged. Hard stop at $6.
May do alone: create the new branch and worktree, edit and add code and tests in it, run installs, builds, tests and the simulator, write migration files (not apply them), update the documents, lessons, decisions and build log, commit locally to the new branch, use at most 2 helpers at a time.
Never without asking: touch or merge to main, push, apply a migration or run SQL on any live database (main or knowledge), upload lessons, deploy, send a real push, change the AI model or provider, spend beyond the cap, delete anything in `knowledge_pilot/_archive` or the backups, kill processes I didn't start, print any key.
Checkpoints (I stop, report in plain words and wait): after B1, after B9 (server done), after B10 (migrations ready, needs the live schema dump first), after the first three app screens, before the first real-model run, and at the end.
Stop at once if: the same test fails twice for the same reason, code and documents disagree (CLAUDE.md rule), a step needs a secret or a live system, or a hard rule would be broken.

## Answers from Rafay
1. Base: build on `feature/backend-hardening`. YES.
2. The Expo app lives in `app/` of this repo. YES.
3. Read-only look at the live main project (the URL Rafay gave matches `VITE_SUPABASE_URL`): **the backend-hardening migrations are NOT live.** Asking for zero rows showed `founder_profiles` and `product_events` do not exist; the old tables (`sessions`, `messages`, `experiments`, `model_usage_logs`, ...) exist and are publicly readable under RLS. So the migrations are written as one clean set (B10) and applied only with a specific yes (gate G1). No data was read; no key was printed.

## Standing rules for the run (from Rafay)
- Fix every problem from the ROOT. No patches. Delete dead code in the same change. (CLAUDE.md, Bug fixing.)
- A learning-loop agent runs after every milestone and after any correction, failed test or review finding: root cause, a lesson in `tasks/lessons.md`, a regression test or check where possible.
- When every screen exists, write the plain-English report `tasks/build_report.md` (what was built, what each screen does, what was checked and how, cost, what is left, what needs Rafay).
- Keep `tasks/build_status.json` current with `python3 tasks/status.py`; the "Axiom build" panel (mod `axiom-build-monitor`, command `/axiom-build`) shows it live. Copy of the mod: `tasks/tools/axiom-build-monitor/`.
- If a usage limit stops the work: wait for the reset and resume by myself from `tasks/build_status.json` and this file. (Mechanism proposed below, needs Rafay's yes.)

## Who does what (I am the conductor, final decision maker, creative app developer and software engineer)
Every helper returns the same report (STATUS, what changed, test evidence, root cause of anything found, dead code removed, what it is unsure about). Helpers never commit to the build branch, never merge, push or touch live systems. I read the diff, run the tests myself, and accept or send it back.
| Agent | Job | When |
|---|---|---|
| builder (existing) | writes server code and tests for one scoped task | B1 to B10 |
| app-builder (new) | builds one Expo screen from its approved mock, in `app/` only | B11 |
| care-tester (new) | writes and runs the distress test set, including false alarms | B2 and whenever the care rules change |
| voice-checker (new) | checks all founder-facing text against `tasks/voice.md` and the banned list | after B3, B5, B7, B8, B11 |
| test-runner (existing) | install, build and all tests, reports only failures | after every change |
| backend-auditor (existing) | security, correctness and cost review of the server | after B9 and in B12 |
| migration-checker (existing) | checks every migration for safety | B10 |
| dead-code-hunter (existing) | finds unused code | each milestone and B12 |
| axiom-reviewer (existing) | reviews the branch diff against CLAUDE.md, PRODUCT.md, ARCHITECTURE.md | before any checkpoint report and in B12 |
| learning-loop (new) | root causes, lessons, regression tests, repeat-mistake check | after every milestone and correction |
Not used in this build: chunker, chunk-auditor, enrichment-checker, source-triage (library pipeline; they come back for the lesson upload).
Parallel runs: at most 3 helpers at once, on files that do not overlap (for example care-tester next to a builder on a different folder, or two app-builders on different screens). Anything that edits the same files runs one at a time. The iOS Simulator checks and screenshots are done by me.

## Sessions (proposed)
One conductor session (this cockpit: decisions, status, reviews, merges into the build branch) plus two worker sessions, each in its own worktree and branch so they cannot step on each other: **Server track** (B1 to B10) and **App track** (B11, built against fake API data from the endpoint contract in ARCHITECTURE.md). I write the contract and fixtures first (end of B1) so both can run in parallel. The conductor merges the tracks into `feature/journey-v1`. This keeps each session's memory small and lets a limit or crash hit only one track.

## Rate-limit resume (proposed, needs Rafay's yes before it is created)
A scheduled task every 20 minutes starts a fresh session with a self-contained prompt: read `tasks/build_status.json`; act only if `mode` is `running` and `updated` is more than 25 minutes old; then resume from the first unfinished step in this file, set `rate` back to ok, and keep going. Caveats: it runs only while the Claude app is open (otherwise on next launch) and the machine is awake; the status file is the lock, so the watcher never starts a second builder while the first is alive. A deliberate pause is `mode paused`.

---

# Earlier plans (history, kept unchanged)

# Migration baseline and security fix

- [x] Confirm the checked-in live dump is internally complete and identify statements that must be excluded from the baseline.
- [x] Search frontend, backend, and scripts for the five RPC call sites and record which calls originate in the browser.
- [x] Trace knowledge ingestion and retrieval to determine where chunk passage text is stored.
- [x] Archive the 15 drifted migrations under `supabase/migrations_archive/` and add an archive README.
- [x] Create one baseline migration reproducing the live public application schema without extension-owned vector routines or data.
- [x] Create a later security migration for `wiki_sources` RLS, RPC grants, and duplicate indexes.
- [x] Validate migration SQL statically and compare its object inventory with `audit/schema_main.sql`.
- [x] Mark this checklist complete and report every created/moved file, the unexecuted repair command, and passage-text evidence.

## Legacy data cleanup preparation

- [x] Search executable code for every read and write of the legacy graph tables, weekly reads, session fields, graph RPC, and `brain` app-session entry point.
- [x] Create a separate destructive migration after the baseline and security migration.
- [x] Normalize existing `brain` entry points before replacing the check constraint.
- [x] Verify retained tables and retained session columns are not dropped.
- [x] Document all remaining runtime blockers and an offline backup command without applying either migration or backup command.

## Pending migration correction

- [x] Move the unapplied legacy cleanup migration from active migrations to `supabase/pending/` using Git.
- [x] Add pending-migration lifecycle instructions.
- [x] Keep `sessions.pillar_weights`; leave every other cleanup statement unchanged.
- [x] Confirm active migrations contain exactly the baseline and security files.
- [x] Review every security migration statement for application impact.
- [x] Run `git diff --check` and commit the migration correction on the cleanup branch.

# Old-product code cleanup

Branch: `cleanup/remove-old-product`

## Baseline

- [x] Read `CLAUDE.md`, `PRODUCT.md`, `ARCHITECTURE.md`, and the files under `audit/`.
- [x] Run root `npm install`: passed; dependencies already current.
- [x] Run `server/npm install`: passed; dependencies already current.
- [x] Run `npm run build`: passed with Vite 5.4.21; 819 modules transformed; existing bundle-size warning only.
- [x] Inspect the available test command before running it.
- [x] Skip baseline `npm run test:smoke`: `scripts/smoke.test.js` creates auth users and reads, writes, and deletes live Supabase data. Running it would violate the no-database rule.
- [x] Record baseline source LOC and prompt-character metrics: 20,746 lines across tracked source/script file types (excluding dependencies); 9,472 characters on source lines containing `prompt`/`Prompt`/`PROMPT` (stable lexical proxy for before/after comparison).
- [x] Replace the metrics above with reproducible ones (session 2). Pre-cleanup reference is commit `10b7217`.
  - LOC: tracked `.js/.jsx/.css/.html/.py` under `src/`, `server/*.js`, `scripts/`, `shared/`, plus `seed.js`, `index.html`, `vite.config.js`. `10b7217`: 23,266. After Stage 1 (`6c2d300`): 22,852.
  - Prompt size: (a) static prompt text = characters in template literals of 200+ chars in the prompt-bearing files, parsed with `@babel/parser`; (b) assembled `buildSystemPrompt` output for four fixed fixture turns (plain, experiment report, structured request, ghosted history). `10b7217`: static 73,025; assembled 24,877 / 24,018 / 25,492 / 25,186 (plain / experiment report / structured request / ghosted history); a fifth fixture, artifact turn (route context carries `Required artifact strategy`), added in Stage 3: 30,500.
  - Scripts live in the session scratchpad (`loc.sh`, `prompt_measure.mjs`, `verify.sh`); the method is recorded here so the next session can recreate them.
- Verification method: backend started with dummy env values (`PORT=3999`, loopback Supabase URLs, dummy keys, `FRONTEND_URL`) so it cannot reach live services; probe `/health`, a removed route (expect 404) and an auth route (expect 401). Frontend: `vite` dev server, fetch `/` and transform each page module.

## Protected boundaries

- Do not change validator/API contracts, auth behavior, RAG core behavior, `sessions.pillar_weights`, personal-memory behavior, learning maps, onboarding behavior except writes to explicitly dropped session fields, model usage logging, `supabase/migrations/`, `supabase/pending/`, live databases, `DESIGN.md`, or `BRAND.md`.
- Do not apply migrations or run Supabase/database commands.
- Do not run tests that access live Supabase. Mark them skipped with the reason above.
- Keep `supabase/pending/20260929000002_drop_legacy_brain_and_warnings.sql` pending until all runtime references are gone, deployment is complete, and the affected data is backed up.

## Stage 1: Dead code and warning system

- [x] Inventory and remove unused components, starting with `OnboardingQuestion`; `WarningCard` was also unreferenced.
- [x] Remove account warning, removal, refund, and reapplication code and UI; no refund or reapplication runtime was present.
- [x] Remove application reads/writes of `ghost_count`, `warning_level`, and `consecutive_miss_count` while retaining experiment `ghosted` status.
- [x] Remove live web search, Exa integration, stale environment names, and its dependency without changing core RAG retrieval.
- [x] Verify installs, build, frontend start, backend start, static searches, and changed code paths: both installs passed; build passed (818 modules); frontend returned HTTP 200; backend `/health` returned `{"ok":true}` using dummy startup configuration; deprecated-field and Exa searches returned no runtime hits. Smoke test skipped because it mutates live Supabase data.
- [x] Commit Stage 1 only: `6c2d300 Remove warning system and live search`.

## Stage 2: Brain, graph, and weekly reads

- [x] Add a temporary Home (`src/pages/Home.jsx`): start conversation, resume threads, active experiments via `ExperimentCard` + `GET /api/experiments`, account email, sign out. Minimal CSS from existing tokens only.
- [x] Route former Brain paths to `/home`: Onboarding, Welcome, AuthCallback, Chat header and jailbreak exit, `RequireChatEntry`. `/brain` route removed; the catch-all sends old bookmarks to `/`, which forwards signed-in founders to `/home`.
- [x] Remove `Brain.jsx`, `shared/brainThemes.js`, Brain CSS, `three`, `@types/three`, `postprocessing`. No sphere assets existed (no `public/` or `src/assets/`).
- [x] `entryPointForLocation` returns only `resume` or `direct`; `appSessionTracker.js` never had a `brain` literal.
- [x] Remove graph code: server constants/helpers/routes (`/api/personal-wiki/*`), `src/lib/personalWiki.js`, Chat wiki sync, node-context chat entry, `generateNodeOpeningMessage`, `generateBrainOverlayMessage`, `scripts/cleanup_personal_wiki_nodes.js`.
- [x] Remove weekly reads: `src/lib/sessionReads.js`, `generateWeeklyRead`.
- [x] Stop reading/writing `sessions.active_experiments`: Onboarding no longer writes it; Chat/openai/artifacts hydrate `session.experiments` from the experiments table only. Nothing depended on the column that could not use the table.
- [x] Verify: build passed (802 modules, existing chunk-size warning only); backend `/health` ok, `/api/personal-wiki/graph` 404, `/api/experiments` 401 without auth; frontend `/` 200 and every page module transforms. Static search: zero runtime hits for graph tables/RPC, weekly reads, `active_experiments` column, `three`, `postprocessing`, `/brain`. No new browser writes vs `10b7217`. Flow walk: login -> `/` -> `/home`; onboarding -> `/welcome` -> `/home`; Home thread -> `/chat` with `threadId` loads that thread without a new opener; Home report -> fresh chat, opener sees unresolved experiment. Prompt: static 65,231; assembled 24,476 / 23,834 / 25,091 / 23,922.
  - Deferred to Stage 4 (prompt/copy): `rag.js` router `nodeContext` param and "Selected node" prompt line (always null now); Onboarding sign-in copy mentioning "brain graph".
  - Kept: admin diagnostics JSON key `active_experiments` counts `experiments` rows, not the session column.
- [x] Commit Stage 2 only.

## Stage 3: Artifacts

- [x] Remove artifact routing, builder, renderer, registry, and artifact prompt code: deleted `ArtifactRenderer.jsx`, `artifactRegistry.js`, `artifacts.js`; removed `generateStructuredArtifact`, `streamStructuredArtifact`, `buildArtifactRules`, `buildBookRefRules`, the artifact prompt flag/budget, "Artifact required" control line, artifact lines in the route contract, precedence list, learning mode and anti-generic rules; Chat artifact plan, build promise, loading preview, interactive answer handlers; MessageBubble `artifactNode`; rag.js `artifact_strategy` field, artifact-only helpers, router-prompt artifact rules and `Required artifact strategy` route line.
- [x] Strip artifact tags from model output safely: `stripArtifactMarkup` in Chat (complete blocks, unterminated tails, `<artifact_here/>`, `<book_ref>`) runs on streamed display, final parse and saved-message load; MessageBubble `safeContent` stays as a final render-time guard. Replies that contained artifact markup are saved as clean text.
- [x] Remove Recharts: no remaining imports; uninstalled. `react-is` was only its peer, removal deferred to Stage 5.
- [x] Remove artifact CSS (52 rules + their keyframes), found with a dead-class analyzer and cross-checked against `fe2e7df`: every removed class was used only by ArtifactRenderer or the artifact loading preview.
- [x] Verify: build passed (93 modules, JS 1,076 kB -> 536 kB; existing chunk-size warning only); backend/frontend start and probes pass; tag-stripping test on real Chat functions passes 6 cases (saved artifact reply, inline marker, book_ref, partial stream, standalone artifact JSON, plain prose) and an experiment tag next to an artifact block still parses and passes the validator; router returns mode/pillars/rationale only and route context has no artifact line. Chat path: route -> `searchWikiForRoute` (RAG unchanged) -> `formatRouteContext` -> prompt -> stream -> strip/parse -> save. No new browser writes. Prompt: static 51,172; assembled 24,354 / 23,712 / 24,875 / artifact turn 24,489 / 23,800. LOC 14,603.
  - Behaviour changes to note: current-fact questions always take the prose route (the "unless they ask for a table" exception is gone); query expansion no longer triggers just because a route had an artifact strategy (four/all-pillar routes and source-depth questions still expand).
  - Kept: `'artifact'` in server `USAGE_CALL_TYPES` (model usage logger is out of scope; DB check constraint lists it).
- [x] Commit Stage 3 only.

## Stage 4: Prompts and copy

- [x] Remove prompt text that references removed features (removal only, no rewording): opening-message "Warning language" line; memory-update sentence about "dim/unresolved graph nodes"; "no strike and" in the report rules; router `nodeContext` parameter, cache key field and "Selected node" prompt line, plus the always-null `nodePillar` in router rules (each rule keeps its existing default pillar); "live" in the current-fact route rationale. Artifact, signal-map and book_ref prompt text went in Stage 3; Brain/weekly/node generators in Stage 2.
- [x] Remove copy: "That is not a strike." from the blocked-experiment reply; "and brain graph" from the sign-in note.
- [x] Payment, pricing and premium: searched prompts, UI copy, `index.html` and server; no payment claims, pricing copy or premium gates exist in the app (matches audit H-13). Nothing to remove.
- [x] Prompt size: static 50,959 (from 73,025 before cleanup); assembled plain 24,354 (24,877), experiment report 23,698 (24,018), structured request 24,875 (25,492), artifact turn 24,489 (30,500), ghosted history 23,800 (25,186).
- [x] Verify: build passed (93 modules); backend/frontend start and probes pass (one run showed "build was canceled" in the Vite log because the probe stopped Vite while it re-optimized deps after the Recharts removal; rerun clean); router test returns the same modes/pillars as Stage 3; tag-stripping test 6/6. LOC 14,590.
  - Kept on purpose: "Not as a warning." in the cost-of-inaction voice rule (voice guidance, not the warning system); `EXPLICIT_STRUCTURE_RE` in `sessionTurnContext.js` (follow-up cache detection); learning-map prompt text (protected); jailbreak termination flow (security, not the removal system).
- [x] Commit Stage 4 only.

## Stage 5: Tests and repository cleanup

- [x] Update `scripts/smoke.test.js`: removed `personal_wiki_edges`/`personal_wiki_nodes`/`weekly_reads` cleanup deletes; removed `active_experiments`, `ghost_count`, `warning_level`, `consecutive_miss_count` from the session insert, the prompt fixture session (now `experiments: []`) and the `warning_level` assertion; removed `requiredArtifactType`, `includeArtifactRules`, `includeLiveCurrentRules` from the prompt-control fixture and `Artifact strategy: none` from the route fixture; deleted the `Brain graph` test. Every other test (validator, prompt budgets, auth/session, chat, RAG, personal memories, concept states, experiments) kept.
- [x] Remove unused dependencies: `react-is` (root; lockfile showed no other dependent once Recharts was gone). Earlier stages removed `three`, `@types/three`, `postprocessing`, `recharts` (root) and `exa-js` (server). Kept root `express-rate-limit`: imported by `server/index.js`, and the root `start` script runs that file, so removal depends on how Railway installs (unverified).
- [x] Remove dead code: `isForecastAsk` (live-search helper, no callers); remaining `.warning-card` CSS including two shared mobile selectors. Dead-code scan of every top-level function/export in `src/` and `server/` found nothing else left behind by removed features.
- [x] Env references for removed services: none left. Names no longer referenced anywhere: `EXA_API_KEY`, `LIVE_SEARCH_CACHE_TTL_MS`, `LIVE_SEARCH_MAX_RESULTS`, `WIKI_LABEL_MODEL`.
- [x] Commented-out blocks: none found for removed features; stale comments fixed in earlier stages.
- [x] Final verify: root and server `npm install` pass; build passes (93 modules; JS 535 kB; existing chunk-size warning only); backend `/health` ok, removed route 404, auth route 401; frontend serves and transforms every page; static search: zero code references to every removed name except the admin diagnostics response key `active_experiments` (counts `experiments` rows); removed packages absent from both lockfiles; `git diff --check` clean; npm audit root 16 (was 17 before cleanup), server 6 (unchanged), none introduced.
- [x] Tests: `node --test --test-name-pattern="validator|prompt budgets" scripts/smoke.test.js` with dummy loopback env: 2/2 pass. `smoke: minimum deploy flows work end to end` not run: it creates auth users and writes/deletes live Supabase rows. Tag-stripping 6/6, router test unchanged.
- [x] Final metrics: LOC 23,266 -> 14,501. Static prompt 73,025 -> 50,959. Assembled prompt: plain 24,877 -> 24,354; experiment report 24,018 -> 23,698; structured request 25,492 -> 24,875; artifact turn 30,500 -> 24,489; ghosted history 25,186 -> 23,800.
- [x] Write `audit/CLEANUP_REPORT.md`.
- [x] Commit Stage 5 only; do not merge.

# Cost logging and product event tracking

Branch: `feature/cost-and-tracking`

- [x] Inventory the model usage logger, every call site, current model IDs, emitted call types, and the live-dump constraints.
- [x] Centralize per-model input/output pricing as explicit TODO values; make unknown or unpriced models warn and persist a null estimated cost.
- [x] Add focused unit tests for known-model calculation, unknown-model warning/null behavior, and zero-token usage.
- [x] Add post-`20260930000000` migrations for nullable model cost, the current call-type constraint, and server-only `product_events` with indexes and RLS but no browser policies.
- [x] Add a best-effort server `trackEvent` helper and unit test that database failures are logged and swallowed.
- [x] Wire authenticated event tracking for onboarding completion, chat start, message send, experiment creation/commit/report, and thread resume wherever those moments exist today, without browser database writes.
- [x] Run focused unit tests, `npm run build`, static checks, and start the backend with dummy loopback environment values; do not run `scripts/smoke.test.js` or any Supabase/database command.
- [x] Review the diff, mark completed items, and summarize files, migrations, current call types, models needing prices, wired events, and future events.

# Knowledge rechunk pilot

Branch: `feature/knowledge-rechunk-pilot`

Rules for this branch:

- No database writes. No Supabase commands. Do not modify ingestion code or the existing knowledge tables.
- Do not touch the cost and tracking work; it lives on `feature/cost-tracking`.
- All generated outputs go in `/knowledge_pilot/`, which is already gitignored.
- One commit per stage. Update this checklist after each stage.

## Stage 1: environment

- [x] Removed the yanked `supabase==2.22.0` from `scripts/knowledge_pilot_requirements.txt`; the pilot does not need the Python Supabase client for local extraction/chunking, and Supabase commands are forbidden.
- [x] Retried `docling-slim==2.131.0` and `docling-parse==7.22.1` install once in `knowledge_pilot/.venv`; sandboxed install failed due network resolution, escalated retry succeeded.
- [x] Docling packages installed, but Stage 2 required PyMuPDF because importing `DocumentConverter` failed on missing `scipy`; no further Docling repair attempted.

## Stage 2: extract and chunk one book, then stop

- [x] Started with The Everything Store.
- [x] Used PyMuPDF fallback for extraction after Docling installed but `DocumentConverter` import failed on missing `scipy`; did not spend more time on Docling dependency repair.
- [x] Extracted PDF pages 6-298 with chapter headings represented in metadata; excluded front/back matter, photos, notes, newsletter, copyright pages, page numbers, and full part-title divider pages. Section-break ornaments are not headings; `section` is null throughout this book.
- [x] Replaced lexical/word-limit splitting with a `gpt-4.1-mini` boundary pass over all ordered paragraphs in each of the 12 chapter/prologue units. Cached responses, validated coverage and dependent openings, and refined oversized ranges using complete narrower episodes/ideas rather than sentence cuts.
- [x] Strip superscript numeric note references using PDF span metadata, preserving prices, dates and decimals; `Rambler.12` now reads `Rambler.`. Recognize curly closing quotes when reconstructing paragraphs across pages.
- [x] Rename folder provenance to `book_pillar`; add `pillars: []` pending Stage 4 enrichment. Every chunk also records book, author, chapter, real section or null, and PDF page range.
- [x] Wrote chunks to `/knowledge_pilot/everything_store/chunks.jsonl`.
- [x] Revised The Everything Store only: 310 chunks; words min 45, p25 243, median 357, p75 476, max 699, mean 367.3. 49 below 200 words, 196 at 200-500, 65 at 501-700, zero above 700. Keep short complete ideas rather than padding them with unrelated topics.
- [x] Usage-based cost estimate: $0.216465 for responses used by the final boundary workflow; $0.652997 total for this book including discarded attempts. Rates: $0.40 input / $0.10 cached input / $1.60 output per million tokens, verified at https://developers.openai.com/api/docs/models/gpt-4.1-mini. No enrichment or embeddings run.
- [x] Recorded failures for the later report: model ranges sometimes skipped paragraphs or grouped broad initiatives; an additional semantic reviewer incorrectly rejected independent named topics and was discarded. Derive range ends from selected starts to guarantee coverage. Direct source review and model validation were needed for ten scopes, saved in `/knowledge_pilot/everything_store/boundary_review.json`; retain this ignored file when reproducing the final output.
- [x] Verification: 7 focused unit tests pass; all 1,214 source paragraphs / 113,875 words appear exactly once in order; complete sentence endings; valid metadata; zero joined note references and zero detected dangling pronoun/demonstrative starts; zero chunks over 700 words. Book-level semantic quality still requires the user's review.
- [x] Saved the two requested passages and three seeded random passages in full to `/knowledge_pilot/everything_store/sample_chunks.jsonl` and readable `/knowledge_pilot/everything_store/review_samples.md`. Final applied ranges are in `final_boundaries.jsonl`; usage/model decisions are in `boundary_audit.json`; stats in `summary.json`; checks in `quality_checks.json`.
- [x] Stopped after this revision; awaiting approval before doing the other 9 books. No database writes, Supabase commands, ingestion changes, or cost/tracking changes.

## Stage 3: all 10 books

- [x] Extracted the remaining nine books locally with PyMuPDF and completed cached `gpt-4.1-mini` chapter boundary passes. All ten have draft `chunks.jsonl` exports; no database/Supabase/ingestion/cost-tracking operations.
- [x] Added `scripts/knowledge_pilot_stage3.py`; capped each API attempt at 40 seconds without retries, preserved caches, backtracked omitted review IDs to individual requests, and discarded invalid boundary IDs without losing source paragraphs.
- [x] Corrected observed extraction failures: mixed-font emphasis misclassified as headings, chapter-title substring deletion, drop-cap placement, table/choice labels, footnote markers, and negative scientific exponents. Source limitations remain documented in ignored QA files and `knowledge_pilot/ROOT_ISSUES.md`.
- [x] Applied content-reviewed short-chunk merges to Everything Store, 7 Powers, Lean Startup, Never Split, Thinking in Bets, and selected observed failures in other books. Everything Store is now 309 chunks / 12 under 120 words. Manual decisions and pre-merge backups remain under `knowledge_pilot/` for reproduction.
- [x] Wrote per-book counts, word distributions, suspected size-only boundaries, under-120 counts, oversized ranges and incomplete audits in `knowledge_pilot/STAGE3.md`. Requested full samples are in `stage3_review_samples.md` and `.jsonl`; these are explicitly draft, not approved final chunks.
- [x] API credits exhausted during independent audits. Replayed completed chapter requests locally; conservatively merged short passages with uncached reviews and explicitly marked uncached boundary audits pending. Returned-usage Stage 3 cost estimate: $4.104255, including discarded attempts; not a provider invoice. No further API calls, enrichment or embeddings.
- [x] Checkpoint verification: 8 Stage 3 tests plus 7 Stage 2 tests pass; local structural checks pass for all ten books. Draft total: 4,027 chunks, 1,680 pending boundary audits, 77 oversized chunks. These counts are diagnostic, not a Stage 3 approval.
- [ ] Finish Stage 3 semantic validation: pending boundary audits, model false positives for self-contained short chunks, and chunks over 700 words remain unresolved. Passing structural coverage/metadata checks is not a semantic-quality pass. Root causes and follow-up are documented; do not start Stage 4.

## Stage 4: enrich

- [ ] For each chunk, add `context_line`, `chunk_type`, `idea`, `applies_when`, `lesson_strength`, and `pillars` using `gpt-4.1-mini`.
- [ ] Set `lesson_strength` to `strong`, `weak`, or `none`; a story without a transferable lesson is `none`.
- [ ] Fill `pillars` with zero or more of the six pillar IDs (`how_companies_win`, `human_mind`, `money_game`, `move_people`, `think_sharper`, `whats_coming`); allow multiple pillars per chunk and retain `book_pillar` as fixed folder provenance.
- [ ] Estimate the cost for all chunks before running and wait for approval if it is over $5.

## Stage 5: embed

- [ ] Embed `context_line` plus chunk text with `text-embedding-3-small`.

## Stage 6: evaluate

- [ ] Write 20 realistic founder situations in `/knowledge_pilot/eval_queries.md` across all six pillars and different stages.
- [ ] Compare top 5 read-only results from existing `wiki_chunks` limited to the same 10 books against top 5 from new chunks.
- [ ] Score each result as relevant, partly relevant, or irrelevant; flag starts/ends mid-sentence.
- [ ] Write `/knowledge_pilot/eval.md` with side-by-side results.

## Stage 7: report

- [ ] Write `/knowledge_pilot/REPORT.md` covering what changed, old vs new scores, failures, total cost, and a recommendation on rechunking the full 127-source library.

# Knowledge library: lesson-based rebuild (2026-10-14)

Replaces the chunk design. Unit = lesson grounded in paragraph ids. Test set: Rich Dad Poor Dad, Crossing the Chasm (argument heavy book), plain-english-ai-economics (transcript; no article/paper sources exist in sources/).

- [ ] Agent definitions updated (chunker, enrichment-checker)
- [ ] 1. Paragraph detection (general rule, stable ids, strip back matter) + tests; run on 3 test sources, report paragraph counts
- [ ] 2. Reading windows (~2000 words, 2 paragraphs context)
- [ ] 3. Lesson extraction (one call per window, structured output, model param)
- [ ] 4. Deterministic validation + dropped.jsonl
- [ ] 5. Dedupe (>0.92 embedding similarity)
- [ ] 6. Embed (512 dims) + lessons.jsonl with evidence text
- [ ] 7. A/B gpt-4.1-mini vs gpt-4.1 on the 3 test sources, cost per source each
- [ ] Checks: enrichment-checker 20 lessons/source/model (blind), chunk-auditor recall on 2 Rich Dad chapters
- [ ] STOP and report; no batch until approved

# Knowledge library v3 (2026-10-14): verified extraction, golden set, judge-tuned lessons
Spend baseline $1.8994; hard cap $6.90 (ask before exceeding). Judge = gpt-4.1, extraction = gpt-4.1-mini.

- [ ] P1.1 extract.py on every non-duplicate source (general paragraph rule, dictionary hyphen rule, exclude non-author forewords, note them), no API
- [ ] P1.2 visual check: 4 random pages x 8 sources + worst source, chunk-auditor vs page images; <1 error/page; max 3 rounds of general-rule fixes
- [ ] P1.3 freeze extraction_version, EXTRACTION_REPORT.md
- [ ] P2.1 golden set (~12 windows, ~25k words, 5 source types), reference lessons core/minor
- [ ] P2.2 judge.py (gpt-4.1): grounded, specific, one idea, attributed, findable; core recall by paragraph overlap
- [ ] P3 lesson prompt v3 (principle field, verbatim evidence/caveat, 1-3 paragraphs, 3 good/3 bad examples) + validation + dedupe; tune on golden set (<=6 rounds, <20c each, target judge >=90% and core recall >=70%)
- [ ] P4 full Rich Dad, Chasm, transcript; judge 30/source; enrichment-checker 20 blind sign off
- [ ] P5 Batch API bulk setup (not run), core-library-first order, LIBRARY_REPORT.md, full cost estimate
- [ ] STOP and report (7 items)

---
## Notes collected for B10 (migrations) and later steps
- founder_profiles needs `signup_answers jsonb not null default '{}'` and `first_reading jsonb` (so a reopened app shows the same reading). Consider per-answer rows instead of one rewritten jsonb (two saves in the same instant could lose one).
- `care_events` table (id, user_id, level, scope_id, created_at, resolved_at; RLS on, no policies) from `supabase/pending/care_events_PROPOSED.sql`.
- `model_usage_logs.call_type` has no 'read' value; widen the CHECK for read, learn, followup, move, care, report.
- Old `/api/onboarding/complete` stays until the old web app is retired; then delete it with `sessions.onboarding_answers` readers.
- `resolveCare` is not called from any route yet: needed after the "how are you" check-in (home screen, B9).
- Push scheduler (B8) must treat `isCareOpen` failure as paused, and the care_events table must exist first.
- Care screen layout (do in B11, when wiring the real client): the mock puts the help rows between paragraph 3 and 4 of the care message, but the server sends one `message` string. Root fix: server sends `{ care:'clear', heading, before[], after[], help }` so the app does not need to know which paragraph comes where. Update server/care/middleware.js, copy.js, app CareScreen and tests together.
- Needs Rafay's OK (copy not in mocks): `returnCheckIn` "How are you doing today?"; server validation and API error lines ("Pick one of the options", "Failed to build the first reading", ...) must be mapped to plain app copy in B11 (app never shows raw server errors).
- App leftovers (do in B11): resume half-way through questions using GET /api/signup `next`; persist the offline queue (AsyncStorage) so unsent answers survive a restart; handle a rejected save in onSave (no unhandled rejection); `sendMessage` on the interface throws today because the server has no free-message route: either build the route (Situation turns, B4) and implement it, or remove it; real Google sign-in not run against real keys.
- Open (B9, home): while a care event is open, Learn start/taps and moves must be refused and the next open starts with the gentle check-in; `resolveCare` is called after it. Cap of 2 active moves is enforced in B6 and must be checked when a move is offered in Learn. Filler in Learn gets "Say a bit more." (mock rephrases the question: Rafay's call).
- tasks/ exists in two places now (this checkout on the pilot branch, and the journey worktree). When the build ends, make journey the one copy: bring lessons, decisions and todo across.
- Needs Rafay's OK (new wording): daily-limit line "That is the limit for new situations today. Pick one that is still open."; Read-failed line "I couldn't answer that just now."; suggestion chip fills the chat bar instead of sending in one tap (follows his rule that a tap never writes the founder's message).
- Integration check (B12): the server Read body must separate paragraphs with a blank line (the app splits on newlines); "Still open" list on Situation needs GET /api/situations/open wired when Home/drawer are built (B11).
- Move sheet leftovers: the mock's "Want a reminder tonight? Yes / No thanks" push-permission ask is not built (comes with push setup in B8/B11); after Commit the mock goes home after a short delay (needs the home screen); server 409 `move_not_ready` is a plain message, give it a code so the app can map it; `copy.move.noRoom` hard-codes "2".
- Needs Rafay's OK: "Before" / "After" labels, the move wording above.
- Report screen leftovers: "You can close the app." omitted from the offline state because the queue is in memory only (true after B11 persists the queue: decide then); header label "Report" is an internal term, Rafay may want a plainer word; due-reports fetch failure at sign-in is not handled (handle in Home); push tap while app is open not wired (B11 with push setup); withdraw and sharing settings calls land with Settings.

# Plan: finish the incomplete items (started 2026-10-31, after the simulator walkthrough)
## Report re-audit leftovers (fix after the push/home audit fixes finish, same files)
- MEDIUM: in the step-by-step fallback (used until the SQL functions exist), if the claim or re-read throws after publish, a pending_review outcome and its link stay while the report is only 'asked'. Root fix: any error after publish takes the outcome down (try/finally) and the share fails closed.
- LOW: set STALE_MS above the worst-case model time (60s x 2 attempts x retry); a stale writer's paid reply should not be thrown away.
- LOW: care that begins AFTER a share should take that situation's shares down (today it only blocks future sharing).
- LOW: withdraw/re-share interleave can say 'shared' with nothing live (fails closed); number check misses plurals like 'hundreds' and ordinals; markCare fails open when the care_flag column is missing (migration adds it).

Order set by Rafay: give-to-get, founder voices, Calm/Direct/Hard prompt, account delete and export, Google sign-in. Then: apply migrations (needs a live schema dump and a specific yes), care wording and verified help numbers, approve new wording, review Home/History/Settings, and whatever is left.
## B10 follow-ups
- modelUsage.js records journey calls as call_type 'chat' because the code passes `step`, not `call_type`: cost per step is not recorded yet (the call is recorded). Root fix: pass call_type from callStructured so the widened CHECK is used (do before the first real-model run).
- ARCHITECTURE.md must be updated to match the code (table names moves/reports/consent_log/learn_conversations, situation_turns seq, reads.body text, no underlines, signup_answers jsonb, user_settings columns, push routes, hidden lock-screen value). List of disagreements is in the B10 report and supabase/MIGRATION_PLAN.md.
- Migration 7 (notification_log.slot NOT NULL) must not be applied before the new push scheduler code is deployed.
- Founder-data tables have no cascade from auth.users on purpose: deleting a user is blocked until a deletion plan exists.
- After the report builder finishes: `shareDb.js` must treat a PGRST202 signature mismatch as an ERROR once the SQL functions are applied (today any PGRST202 silently falls back to the non-transactional steps). Do with a config flag `SHARE_DB_FUNCTIONS=on` set after migration 6 is applied.
- Before applying anything: fresh read-only live dump; confirm none of the 18 new tables/3 functions exist; confirm 20261013000001 and 20261013000003 are applied; `supabase db push --dry-run` from a linked checkout; Rafay approves file 6 (consent and privacy logic); resolve the ARCHITECTURE.md differences (docs updated to match the code).
- Needs Rafay's decision before applying migrations: `founder_profiles` has a table-level SELECT grant to `authenticated` (from 20261013000003), so the new `signup_answers` and `first_reading` columns would be readable by their owner directly through Supabase. Postgres cannot narrow it by revoking two columns; the real fix is to replace the table-level grant with a column list (or remove it, since the app uses the API only). Recommendation: remove it. This changes an existing grant, so it needs your yes.
- `shareDb.js` fallback (used only until the SQL functions exist) has no care check under a lock; the SQL function does.

- [ ] 1. Give to get + founder voices (one change; they share the Learn path). Rule from Rafay: the first 2 founder lessons are free, each followed by the share ask. After the 2nd, if the founder has not shared, no more founder lessons; Axiom says so once and says sharing from Settings brings them back. Turning on sharing in Settings unlocks them at once.
- [ ] 2. Calm / Direct / Hard: the saved setting is read by the prompts.
- [ ] 3. Account export and delete (real, tested on fakes; never run live).
- [ ] 4. Google sign-in on phones (native flow).
- [x] 0. Simulator walkthrough: logo box gone, chat bar slim and capped at 3 lines, care screen no longer dropped mid-transition, wait-screen quote marks a cut with an ellipsis.
## App leftovers after Home/History/Settings (B11 integration)
- Server must add a code for `move_not_ready` (and `quiet_hours` clash on settings PUT) so the app can show specific lines; `move_id` in history action targets; a call to fetch earlier turns when resuming a situation.
- Reminders-off row shows for founders never asked (wording slightly off). Notification-tap while open not wired; app.json needs expo.extra.eas.projectId for real push tokens (needs Rafay's Expo account).
- New wording needing OK: "No title yet", "I couldn't open that just now.", "Quiet hours", "From", "Until", "Export my data", "I couldn't save that just now."
- Settings name editing is read-only in the app (mock), the server allows editing: Rafay decides.
- Settings has a Calm / Direct / Hard setting that no server prompt reads (every founder gets Direct). Rafay decides: wire it into the prompts or remove it from Settings.
- Voice check: mock-approved lines that break the plain rule ("Every founder has one thing they keep circling", "No pressure. Some pressure.", "That is fine, things changed") stay unless Rafay says; the Settings lock-screen note ('Axiom: tonight's check-in') must match the real short push; server error texts must never be shown by the app (the app maps codes).

## Sign-up intro v2 (Rafay, Oct 31)
- [x] Fonts for the intro only: Newsreader (words, wordmark) and Manrope (small tagline). The app keeps Source Serif 4 and the system sans.
- [x] Film: emblem draws under a warm gold rise, AXIOM lands letter by letter (gold, letters close in from wide), the camera zooms through, then "See." "Learn." "Become." each zoom in and out, then pull back to emblem, wordmark and tagline; the button fades in last. Tap skips, reduced motion shows the end.
- [x] Plays on every open until sign-up (sign-in screen only), never after.
- [x] Old lines (axiom, year, "Start today.") removed.
- [x] Test the beat order; watch it in the simulator.
- [x] Returning founders skip sign-in: the app checks for a saved sign-in on open (api.isSignedIn), so the film never plays after sign-up.

## Sign-up intro v3 (Rafay approved, Oct 31)
- [x] Skia + Reanimated port of tasks/design/intro-v3.html: light point, streak, emblem drawn from its tip, faint spider web, glow and sweep, settle, tagline in place, Google button rises with one shine.
- [x] Newsreader removed; Manrope loaded by Skia for the tagline only. Web loads Skia's engine first (src/boot.web.ts, public/canvaskit.wasm).
- [ ] Check frame rate on a real mid-range Android phone.
## Resume Claude migration deployment (Codex, 2026-10-31)

## Live test fixes, round 2 (Rafay, Nov 2)
- [x] Step change is visible: a short title card (SITUATION / READ / LEARN, small spaced caps) on entering each step, then the step name stays beside the menu logo. Skipped with reduce motion.
- [x] Learn names the author (and work) of a passage it cites, in the sentence that uses it. The model sees author and title; the server keeps a name only if it belongs to a cited passage, and drops any sentence naming an uncited author or book.
- [x] A verified exact quote shows set apart, with the author. Unverified quotes never show.
- [x] The first line of a screen is not dimmed by the top fade when the screen opens.
- [ ] Confirm authenticated access to main Supabase and re-read live migration history/schema.
- [x] Review remaining approved migration prerequisites in /Users/rafayessani/AXIOM-wt/journey (audit complete; deletion copy-test and deployed scheduler compatibility remain to verify).
- [ ] Apply only outstanding migrations in order, recording file versions.
- [ ] Verify live tables, permissions, constraints and RPCs; run server regression tests.
- [ ] Record completion or exact remaining access/deployment blockers and learning-loop review.

Resume evidence: server suite in journey/server passes 535/535 after allowing local loopback (initial sandbox listen EPERM was environmental). Supabase connector is not available in Codex; CLI reports no access token. User connection requested. No live database changes performed by Codex. Last Claude log reports 6/15 applied; re-read live history before resuming. Migration 11 requires copy test before live application; ACCOUNT_DELETE stays off. Migration 7 needs deployed scheduler compatibility evidence.

---

# Plan: retire the old web app (Nov 5 2026, branch feature/retire-web-app)

Why: 21 old write routes sit outside the care hold, and the old experiments
route sits outside the 2-move limit, so a founder in care could still get a
lesson or move through them. The Oct 31 report said this is fine only if the
web app is gone before real users.

Checked Nov 5: the old site is already dead (its API points at Railway, which
returns 404; the account is banned). Last old-app activity on live was Oct 20.
The native app calls none of the old routes. The Vercel project has no custom
domain, only axiom-delta-pied.vercel.app.

## What stays untouched
- All stored data. `messages`, `sessions`, `app_sessions`, `conversation_threads`,
  `experiments`, `personal_memories`, `product_events` keep every row. No
  migration. Export and `delete_account` keep covering them. The message trigger
  stays. Dropping old tables is a separate decision, not part of this.
- `server/experimentQuality.js` (the validator): the Move step uses it. Unchanged.
- `server/llm.js`, `modelUsage.js`, `writeValidation.js`: the journey uses them.
- Root `package.json` scripts for the knowledge pipeline, `scripts/`, `knowledge_pilot/`.

## Steps
- [ ] Server: remove every old route from `server/app.js` (about 1,100 of its
      1,694 lines): events, concept-states, personal-memories, admin/diagnostics,
      experiments, openai/chat and embeddings, onboarding/complete, founder-profile,
      app-sessions, session touch and memory, threads, messages. Check that no
      journey route shares a helper before removing it.
- [ ] Delete what only they used: `usageSummary.js`, `productEvents.js`,
      `requestValidation.js`, and `dailyCap.js` unless Rafay chooses it below, with
      their tests.
- [ ] Tests: shrink the NOT_HELD list in `care/hold.test.js` (no old-app entries
      left), rewrite `testing/app.test.js` and `care/middleware.test.js` for what remains.
- [ ] Add a test: every remaining `/api/` route is either in the app's contract or
      on a short written list (health, review), so an old route cannot come back unseen.
- [ ] Front end: delete `src/`, `index.html`, `vite.config.js`, `vercel.json`, `dist/`,
      and the Vite dependencies and scripts from the root `package.json`.
- [ ] Docs: CLAUDE.md (stack, deprecated list), ARCHITECTURE.md (old routes,
      infrastructure), PRODUCT.md, `tasks/decisions.md`.
- [ ] Review with axiom-reviewer, run all tests, merge to main.
- [ ] Rafay: pause the Vercel project, then remove the old site's address from the
      Supabase redirect URLs. Pausing can be undone.

## Decision for Rafay: a daily cost cap for the journey
The $1-a-day cap per founder (`dailyCap.js`) only guards the old chat and
embeddings routes. The journey has none: only 5 new situations a day and rate
limits, so Learn replies have no spending ceiling. Removing the old routes
removes the only cap.
- Option A (recommended): move the cap to `callStructured`, so every model call
  in the journey counts. Needs one new line of wording for a founder who hits it.
- Option B: drop it and rely on the 5-a-day limit and rate limits.

## Not in this plan
`FRONTEND_URL` stays required for now (the server refuses to start without it);
removing it is a small follow-up once the old site is gone.
