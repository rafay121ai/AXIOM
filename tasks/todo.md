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
- [ ] Commit Stage 1 only.

## Stage 2: Brain, graph, and weekly reads

- [ ] Add a temporary product Home and route former brain entry paths to it.
- [ ] Remove Brain/Three.js/postprocessing/theme/graph code, CSS, and assets.
- [ ] Make app-session entry tracking use `direct`, not `brain`.
- [ ] Remove personal-wiki graph routes, RPC usage, table references, and cleanup script.
- [ ] Remove weekly-read runtime code.
- [ ] Stop using `sessions.active_experiments`; keep `experiments` as the source of truth.
- [ ] Verify installs, build, frontend start, backend start, static searches, and changed code paths.
- [ ] Commit Stage 2 only.

## Stage 3: Artifacts

- [ ] Remove artifact routing, builder, renderer, registry, and artifact prompt code.
- [ ] Strip artifact tags from remaining model output safely.
- [ ] Remove Recharts only if no remaining runtime imports exist.
- [ ] Verify installs, build, frontend start, backend start, static searches, and changed code paths.
- [ ] Commit Stage 3 only.

## Stage 4: Prompts and copy

- [ ] Remove prompt and product-copy references to deleted features.
- [ ] Remove paid, premium, paywall, refund, and account-removal language that conflicts with the current free product.
- [ ] Measure and record prompt characters before and after.
- [ ] Verify installs, build, frontend start, backend start, static searches, and changed code paths.
- [ ] Commit Stage 4 only.

## Stage 5: Tests and repository cleanup

- [ ] Update smoke coverage to the retained product without running live-data operations.
- [ ] Remove dependencies, dead files, stale environment names, and stale comments made obsolete by Stages 1-4.
- [ ] Run final installs, build, frontend start, backend start, static searches, code-path walkthrough, and `git diff --check`.
- [ ] Run only tests proven not to access live services; record all skipped tests and reasons.
- [ ] Record final LOC and prompt-character metrics.
- [ ] Write `audit/CLEANUP_REPORT.md` with evidence, residual risks, handoffs, open questions, and full coverage.
- [ ] Commit Stage 5 only; do not merge.
