# Old-product cleanup report

Branch: `cleanup/remove-old-product` (not merged). Date: 2026-09-29.
Pre-cleanup reference commit: `10b7217`.

| Stage | Commit | Subject |
|---|---|---|
| 1 | `6c2d300` | Remove warning system and live search |
| 2 | `fe2e7df` | Replace Brain with temporary Home and remove graph and weekly reads |
| 3 | `44c84bb` | Remove artifact system and Recharts |
| 4 | `6491a87` | Remove prompt and copy references to removed features |
| 5 | see `git log` | Update smoke test and remove leftover dead code |

Stage 1 was done in an earlier session and committed without its checkbox ticked. This session reviewed it, checked it off in `tasks/todo.md`, and continued from Stage 2.

No migrations were written or run, and no database or Supabase command was executed. `supabase/migrations/`, `supabase/pending/`, `DESIGN.md` and `BRAND.md` are untouched. Your uncommitted edits to `CLAUDE.md`, `PRODUCT.md` and `ARCHITECTURE.md` were left out of every commit.

## Review first

1. **HIGH, UNVERIFIED: `public.user_conversations` may expose every user's messages.** The live view joins `users`, `sessions` and `messages` and has `GRANT ALL ... TO anon, authenticated` (`audit/schema_main.sql:485-500`, `:1453-1455`). It is declared without `security_invoker`, so Postgres runs it with the owner's rights and bypasses RLS on the base tables. If `public` is exposed through PostgREST, the anon key can read all emails and message content. No app code uses the view. This is not in the audit findings, and `20260929000001_secure_public_schema.sql` does not address it. Verify with a read-only role test, then revoke the grants or set `security_invoker = true` in a migration.
2. **Deploy before applying the pending drop migration.** Tabs still running the old bundle write `active_experiments`, `warning_level` and similar fields, and the old API writes the counters and graph tables. Apply `supabase/pending/20260929000002_drop_legacy_brain_and_warnings.sql` only after both Vercel and Railway run this branch, and after the backup.
3. **The live end-to-end smoke test was not run.** It creates auth users and writes and deletes live rows. Only its two pure tests were run (see Verification).

## Files by stage

### Stage 1: safe removals (`6c2d300`)
Deleted: `src/components/OnboardingQuestion.jsx`, `src/components/WarningCard.jsx`, `src/lib/liveSearch.js`.
Renamed: `src/lib/liveSearchTriggers.js` -> `src/lib/currentFacts.js`. It now only feeds the RAG router's current-fact rule.
Changed: `.env.example`, `server/index.js`, `server/package.json`, `server/package-lock.json`, `src/lib/openai.js`, `src/lib/rag.js`, `src/pages/Chat.jsx`, `src/pages/Onboarding.jsx`, `tasks/todo.md`.

### Stage 2: Brain, graph, weekly reads (`fe2e7df`)
Added: `src/pages/Home.jsx`. It is the temporary home screen: start a conversation, resume past threads, see active experiments (existing `ExperimentCard` plus `GET /api/experiments`), account email, and sign out.
Deleted: `src/pages/Brain.jsx`, `shared/brainThemes.js`, `src/lib/personalWiki.js`, `src/lib/sessionReads.js`, `scripts/cleanup_personal_wiki_nodes.js`.
Changed:
- `src/App.jsx`: `/home` route; the `/brain` route was removed; the entry point is now `resume` or `direct` only.
- `src/pages/Onboarding.jsx`, `src/pages/Welcome.jsx`, `src/pages/AuthCallback.jsx`: redirects go to `/home`. Onboarding also no longer writes `active_experiments`.
- `src/pages/Chat.jsx`: Home link, no node entry, no wiki sync. Experiments come only from the experiments table.
- `src/lib/openai.js`: removed the Brain overlay, weekly read and node opening generators.
- `src/lib/artifacts.js`: removed later in Stage 3.
- `server/index.js`: removed the graph constants, helpers and `/api/personal-wiki/*` routes.
- `src/styles/global.css`: removed Brain CSS; added minimal Home CSS.
- `package.json`, `package-lock.json`, `tasks/todo.md`.

### Stage 3: artifacts (`44c84bb`)
Deleted: `src/components/ArtifactRenderer.jsx`, `src/lib/artifactRegistry.js`, `src/lib/artifacts.js`.
Changed:
- `src/pages/Chat.jsx`: removed the artifact plan, build, render, loading preview and interactive handlers. Added `stripArtifactMarkup`, which runs on streamed display, the final parse and saved-message load.
- `src/components/MessageBubble.jsx`: removed the `artifactNode` injection. The `safeContent` render-time strip stays as a final guard.
- `src/lib/openai.js`: removed the artifact generators, the artifact and book_ref prompt modules, the artifact flag and budget, and the artifact lines in other modules.
- `src/lib/rag.js`: removed the `artifact_strategy` field, artifact-only helpers, and the router-prompt artifact rules and route line.
- `src/styles/global.css`: removed 52 artifact-only rules and their keyframes.
- `server/index.js`: fixed a stale comment.
- `package.json`, `package-lock.json`, `tasks/todo.md`.

### Stage 4: prompts and copy (`6491a87`)
Changed:
- `src/lib/openai.js`: removed the "Warning language" line, the "dim/unresolved graph nodes" sentence, and "no strike and".
- `src/lib/rag.js`: removed the Brain node input to the router (parameter, cache key and "Selected node" prompt line) and the always-null `nodePillar`, and dropped "live" from one rationale.
- `src/pages/Chat.jsx`: removed "That is not a strike."
- `src/pages/Onboarding.jsx`: removed "and brain graph" from the sign-in note.
- `tasks/todo.md`.

The app contained no payment claims, pricing copy or premium gates, which matches audit H-13, so there was nothing to remove.

### Stage 5: tests and dead weight
Changed:
- `scripts/smoke.test.js`: removed the graph and weekly-read cleanup, the dropped session fields, the artifact and live-search prompt flags, and the Brain graph test.
- `src/lib/currentFacts.js`: removed `isForecastAsk`, which only served live search.
- `src/styles/global.css`: removed the remaining `.warning-card` rules.
- `package.json`, `package-lock.json`, `tasks/todo.md`.

Added: this report.

## Dependencies removed

| Package | Manifest | Stage | Evidence |
|---|---|---|---|
| `exa-js` | server | 1 | only the removed Exa route used it |
| `three` | root | 2 | only `Brain.jsx` |
| `@types/three` | root | 2 | only typed Three.js |
| `postprocessing` | root | 2 | only `Brain.jsx` |
| `recharts` | root | 3 | only `ArtifactRenderer.jsx` |
| `react-is` | root | 5 | no imports; the lockfile showed Recharts as its only dependent |

None of these remain in either lockfile. npm audit: root has 16 advisories (17 before cleanup) and server has 6 (unchanged). None were introduced.

## Size

| Measure | Before (`10b7217`) | After |
|---|---:|---:|
| Lines of app code* | 23,266 | 14,501 |
| Production JS bundle | 1,076 kB | 535 kB |
| Vite modules transformed | 818 | 93 |

\* Tracked `.js/.jsx/.css/.html/.py` under `src/`, `server/*.js`, `scripts/`, `shared/`, plus `seed.js`, `index.html` and `vite.config.js`. By stage: 22,852 -> 18,648 -> 14,602 -> 14,590 -> 14,501.

## Prompt size (characters)

Static prompt text is the characters in template literals of 200+ chars across the prompt-bearing files, measured by parsing. The assembled figures are real `buildSystemPrompt` output for the same fixture session and turns, before and after.

| Measure | Before | After |
|---|---:|---:|
| Static prompt text | 73,025 | 50,959 |
| Assembled: plain turn | 24,877 | 24,354 |
| Assembled: experiment report | 24,018 | 23,698 |
| Assembled: structured request | 25,492 | 24,875 |
| Assembled: artifact turn | 30,500 | 24,489 |
| Assembled: ghosted history | 25,186 | 23,800 |

No prompt was reworded and no new prompt was added. Text was only deleted, except one visible-response line that lost the words "artifact tags," and a precedence list that was renumbered after one item was removed.

## Env variables you can delete

No code references these any more. Delete them wherever they are set:
- `EXA_API_KEY` (Railway)
- `LIVE_SEARCH_CACHE_TTL_MS` (Railway, if set)
- `LIVE_SEARCH_MAX_RESULTS` (Railway, if set)
- `WIKI_LABEL_MODEL` (only used by the deleted graph cleanup script; likely local only)

I cannot see the Vercel or Railway settings, so check that nothing else sets them. Every other variable in `.env.example` is still used.

## Pending drop migration: code status

Checked against `supabase/pending/20260929000002_drop_legacy_brain_and_warnings.sql`, with a static search of `src/`, `server/`, `scripts/`, `seed.js` and the configs.

| Item dropped or changed | Code reads or writes it? |
|---|---|
| `app_sessions.entry_point = 'brain'` (update + new check) | No. `entryPointForLocation` returns only `resume` or `direct` (`src/App.jsx:56-59`); the tracker defaults to `direct`. Both are allowed by the new check. |
| `get_personal_wiki_graph(uuid)` | No references. |
| `personal_wiki_edges` | No references (the server routes, client and smoke cleanup are gone). |
| `personal_wiki_nodes` | No references. |
| `weekly_reads` | No references. |
| `sessions.ghost_count` | No references. |
| `sessions.warning_level` | No references. |
| `sessions.consecutive_miss_count` | No references. |
| `sessions.active_experiments` | No reads or writes of the column. |

Notes:
- `src/pages/Chat.jsx:683-684` and the smoke test use `select('*')` on `sessions`. This returns the old columns until they are dropped, but nothing uses them, and after the drop it keeps working.
- `server/index.js:709` returns an admin diagnostics JSON key named `active_experiments`. It counts `experiments` rows and does not touch the session column.
- `user_conversations` (the only view on `sessions`) uses none of the dropped columns, so it will not block the `DROP COLUMN`.

## Not removed, and why

- `'artifact'` in `USAGE_CALL_TYPES` (`server/index.js:78`): part of the model usage logger, which a separate task owns, and it matches a DB check constraint. New code no longer produces that call type.
- Root `express-rate-limit`: `server/index.js` imports it and the root `npm start` runs that file. Whether Railway installs from the root or from `server/` is unverified.
- The admin diagnostics key `active_experiments`: renaming it would change an admin API response that something outside the repo may read.
- `src/lib/currentFacts.js`: still drives the router's current-fact rule, which is RAG routing.
- `wantsSignalMap` and the "signal map" phrases in `rag.js`: these match what the founder types, to pick the four-pillar mode. They are not artifact code.
- `EXPLICIT_STRUCTURE_RE` in `sessionTurnContext.js`: follow-up detection for the retrieval cache.
- The experiment `ghosted` status and the check in `Chat.jsx` that marks overdue experiments ghosted: it is a neutral experiment state, and the counters that fed warnings are gone.
- `scripts/import_rss_signals.js`: knowledge ingestion. The audit listed it as a later candidate once live search was gone, but it is outside this task.
- `clearSessionTurnContext` (an unused export) and `.onboarding__answer--selected` (unused CSS): both were already unused before this cleanup and are not tied to removed features. The CSS belongs to Onboarding, which is protected.
- Learning-map prompt text, the jailbreak termination flow and the "Not as a warning" voice rule: all out of scope or not part of the warning system.
- `audit.md` at the repo root (the earlier report): untouched.

## Risky or worth a look

- **Browser-side writes remain, all pre-existing:**
  - `messages` insert, update and delete (`Chat.jsx`)
  - `sessions` insert (`Onboarding.jsx`) and updates (`Chat.jsx` `last_active`, `personalMemory.js` notes and `concept_progress`)
  - `users` upsert (`Onboarding.jsx`)
  - `app_sessions` (`appSessionTracker.js`)
  - `conversation_threads` insert (`conversationThreads.js`)
  - `experiments` ghosting update (`Chat.jsx`)

  No new browser write was added; this was checked against `10b7217`. They still break the "all writes through the API" rule.
- **Routing behaviour changed slightly.** Current-fact questions always take the prose route; the "unless they ask for a table" exception is gone. Query expansion no longer triggers just because a route used to carry an artifact strategy. Four-pillar and all-pillar routes and source-depth questions still expand.
- **Old saved replies:** stored messages that contained artifact tags are unchanged in the database and are stripped at display. A reply whose whole content was an artifact now shows as an empty assistant bubble. The effect is cosmetic, and no data was changed.
- **Home screen styling** uses only existing tokens and mirrors the chat header button. It is temporary and not in `DESIGN.md`.
- **The Home "Report" button** opens a new chat, because experiments have no `thread_id`. The opener then asks about the active or unresolved experiment. The in-chat card keeps its Report, Done and Cancel buttons.
- **The build still warns** that the chunk is over 500 kB (535 kB). This warning existed before the cleanup, when the bundle was 1,076 kB.

## Verification

Each stage was checked after its changes:
- `npm install` in the root and `server/`, then `npm run build`.
- The backend started with dummy loopback env values, so it could not reach any live service. `/health` returned ok, `/api/personal-wiki/graph` returned 404, and `/api/experiments` without a token returned 401.
- The Vite dev server served `/` and compiled every page module.
- A static search for every removed name.
- A code-path walkthrough of these flows:
  - New founder: OAuth -> `/` onboarding -> `/welcome` -> `/home`.
  - Returning founder: OAuth callback -> `/home` -> thread -> `/chat` loads that thread without a new opener.
  - Chat: route -> `searchWikiForRoute` (RAG unchanged) -> prompt -> stream -> strip and parse -> save.
  - Experiment: the `<experiment>` tag -> validator -> `POST /api/experiments` -> shown on Home -> reported in chat via `POST /api/experiments/:id/status`.

Tests run:
- `node --test --test-name-pattern="validator|prompt budgets" scripts/smoke.test.js` with dummy env: 2/2 pass.
- A tag-stripping test on the real Chat functions: 6/6 cases pass (saved artifact reply, inline marker, book_ref, partial stream, standalone artifact JSON, plain prose). An experiment tag next to an artifact block still parses and passes the validator.
- A router test through Vite's module loader: it returns only mode, pillars and rationale, and the route context contains no artifact line.

Not run: the live end-to-end smoke test, because it writes to and deletes from live Supabase.

Details for each stage are in `tasks/todo.md`.
