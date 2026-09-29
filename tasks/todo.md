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

- [ ] Update smoke coverage to the retained product without running live-data operations.
- [ ] Remove dependencies, dead files, stale environment names, and stale comments made obsolete by Stages 1-4.
- [ ] Run final installs, build, frontend start, backend start, static searches, code-path walkthrough, and `git diff --check`.
- [ ] Run only tests proven not to access live services; record all skipped tests and reasons.
- [ ] Record final LOC and prompt-character metrics.
- [ ] Write `audit/CLEANUP_REPORT.md` with evidence, residual risks, handoffs, open questions, and full coverage.
- [ ] Commit Stage 5 only; do not merge.
