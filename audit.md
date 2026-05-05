# AXIOM BETA READINESS AUDIT
**Audit date:** 2026-05-05  
**Auditor:** Post-fix re-audit (second pass)  
**Scope:** Full codebase — all src/, server/, supabase/migrations/, schema SQL files  
**Context:** This audit follows a first-pass that identified 13 critical/high issues. All C-01 through C-13 from that audit have been addressed. This report audits the current state only.

---

## SCORES

| Area | Score /10 | Verdict |
|------|-----------|---------|
| Frontend / UI | 7/10 | Solid foundation, two dead-code gaps |
| Backend / API | 7/10 | Auth and rate limiting in place; embeddings still unvalidated |
| Security | 8/10 | Major holes closed; .env git-exposure risk remains |
| OpenAI / RAG Pipeline | 7/10 | Good architecture; session notes unbounded |
| Performance | 5/10 | N+1 sync on every Brain open; no pagination on messages |
| Experiment System | 6/10 | Reset logic missing; multi-tab bypass still possible |
| Session Continuity | 7/10 | Thread model solid; silent write failures unresolved |
| Onboarding | 7/10 | Idempotent now; upsert has data-loss edge case |
| Data Integrity | 5/10 | Original schema file still broken; messages/reads have no RLS |
| Production Readiness | 7/10 | Start script added; no crash handlers or monitoring |
| **OVERALL** | **7/10** | **READY WITH FIXES — 8 items before beta** |

---

## CRITICAL ISSUES (must fix before beta)

---

### [A-01] `personal_wiki.sql` still has the 2-pillar constraint
- **File:** [personal_wiki.sql:29](personal_wiki.sql)
- **What:** `pillar text check (pillar in ('psychology', 'economics'))` — the migration file `20260505000001_fix_pillar_constraint.sql` fixes the live DB, but the original schema file is unchanged. Any developer who sets up a fresh environment from `personal_wiki.sql` gets the broken constraint. All wiki node writes for the 6 active pillars fail silently.
- **In production:** New developer environments are broken from setup. The brain graph never writes persistent nodes in any fresh install.
- **Severity: HIGH**

**Fix:** In [personal_wiki.sql](personal_wiki.sql), replace line 29:
```sql
-- OLD:
pillar text check (pillar in ('psychology', 'economics')),
-- NEW:
pillar text check (pillar in ('psychology','economics','human_mind','money_game','how_companies_win','whats_coming','think_sharper','move_people')),
```

---

### [A-02] Embeddings endpoint passes `req.body` directly to OpenAI — no validation
- **File:** [server/index.js:102](server/index.js)
- **What:** `openai.embeddings.create(req.body)` — the chat route now validates model and strips to a `safePayload`, but the embeddings route does not. A client can send any model name, any input format, or arbitrary OpenAI parameters.
- **In production:** Any authenticated user can use any OpenAI embedding model. Depending on what OpenAI allows, this could be abused for model cost manipulation.
- **Severity: HIGH**

**Fix:** In [server/index.js](server/index.js), replace the embeddings route body:
```js
const { input, model } = req.body
if (!input || (model && model !== 'text-embedding-3-small')) {
  return res.status(400).json({ error: 'Invalid embedding request' })
}
const response = await openai.embeddings.create({ model: 'text-embedding-3-small', input })
```

---

### [A-03] `consecutive_miss_count` never resets — consecutive logic is not implemented
- **File:** [src/pages/Chat.jsx:219](src/pages/Chat.jsx)
- **What:** `consecutive_miss_count++` is called when an experiment is ghosted, but it is never reset to `0` on experiment completion. There is no experiment completion tracking in the codebase — experiments only transition to `ghosted`, never to `completed` in client code. The counter behaves identically to the cumulative `ghost_count`.
- **In production:** The warning system does not actually track consecutive misses. A user who ghosts 2 experiments, completes 3, then ghosts 2 more still hits Warning 2 because the counter never reset after the completions. The PRODUCT.md promise ("miss 2 consecutive") is not kept.
- **Severity: HIGH**

**Fix:** Add a `consecutive_miss_count` reset path. The minimum viable fix: in `assignExperiment` in [Chat.jsx](src/pages/Chat.jsx), after successfully saving the new experiment, also update `consecutive_miss_count: 0` in Supabase when the previous slot was ghosted. Longer term: track `completed` experiment status explicitly.

---

### [A-04] Onboarding upsert overwrites existing user's session data
- **File:** [src/pages/Onboarding.jsx:470–472](src/pages/Onboarding.jsx)
- **What:** `supabase.from('sessions').upsert(sessionPayload, { onConflict: 'user_id' })` — the `sessionPayload` includes `axiom_profile`, `pillar_weights`, `active_experiments: []`, `ghost_count: 0`, `warning_level: 0`. If an existing user reaches this code path (localStorage cleared, auth state confused, or any future bug that bypasses the redirect), their entire session is overwritten with blank defaults.
- **In production:** A user who clears their browser storage and re-signs-in could trigger a second onboarding completion, losing all session notes, experiment history, warning levels, and their personalized profile. This is data loss.
- **Severity: HIGH**

**Fix:** In [Onboarding.jsx:processOnboardingComplete](src/pages/Onboarding.jsx), before calling `upsert`, check whether a session already exists for this `user_id`:
```js
const { data: existing } = await supabase
  .from('sessions')
  .select('id')
  .eq('user_id', activeUser.id)
  .maybeSingle()
if (existing) {
  setStoredSessionToken(existing.session_token)  // need to also select session_token
  navigate('/brain')
  return
}
// Only insert if truly new
await supabase.from('sessions').insert(sessionPayload)
```

---

### [A-05] `messages` and `weekly_reads` tables have no RLS policies
- **File:** [supabase/migrations/20260505000002_add_rls_policies.sql](supabase/migrations/20260505000002_add_rls_policies.sql)
- **What:** The RLS migration enables security on `sessions`, `personal_memories`, `personal_wiki_nodes`, `personal_wiki_edges`, and `wiki_chunks` — but NOT on `messages` or `weekly_reads`. The `messages` table contains the full conversation history. Without RLS, any authenticated user can query any other user's conversation history via the Supabase REST API using the anon key.
- **In production:** User A can read User B's entire conversation history. Weekly reads (Axiom's private read of each user) are also exposed.
- **Severity: HIGH**

**Fix:** Append to [supabase/migrations/20260505000002_add_rls_policies.sql](supabase/migrations/20260505000002_add_rls_policies.sql):
```sql
-- MESSAGES
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own their messages"
  ON messages FOR ALL
  USING (
    auth.uid() = (SELECT user_id FROM sessions WHERE id = messages.session_id)
  );

-- WEEKLY READS
ALTER TABLE weekly_reads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users own their weekly reads"
  ON weekly_reads FOR ALL
  USING (
    auth.uid() = (SELECT user_id FROM sessions WHERE id = weekly_reads.session_id)
  );
```
Then run this in Supabase. Also run both policies as a new migration so the sequence is clear.

---

### [A-06] `.env` production credentials — verify not committed to git history
- **File:** [.env](.env)
- **What:** The `.env` file contains live production credentials (Supabase URLs, keys, and OpenAI API key). The `.gitignore` correctly excludes `.env`, but if this file was ever committed before the gitignore was added, the credentials are in git history and must be rotated regardless of gitignore state.
- **In production:** Exposed credentials in git history are permanently accessible to anyone with repo access. The OpenAI key alone can run up charges with no daily cap.
- **Severity: CRITICAL if in history, HIGH if not**

**Fix:**
```bash
git log --all --full-history -- .env
```
If any commits appear: rotate all keys immediately (`OPENAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `VITE_SUPABASE_ANON_KEY`). Then use `git filter-repo` or BFG to scrub history. Do this before any external collaborator gets repo access.

---

### [A-07] No process crash handlers on the API server
- **File:** [server/index.js](server/index.js)
- **What:** No `process.on('uncaughtException', ...)` or `process.on('unhandledRejection', ...)` handlers. The jailbreak auto-increment after `res.end()` fires a floating Promise chain (`.then().catch()`). If an unrelated async operation throws after `res.end()`, the process crashes without logging the cause.
- **In production:** Server crashes are silent. On Railway, the process restarts but the crash reason is lost. A subtle bug in the jailbreak detection (e.g., null dereference in the `.then()` chain) takes down the server.
- **Severity: HIGH**

**Fix:** Add to the bottom of [server/index.js](server/index.js) before `app.listen`:
```js
process.on('unhandledRejection', (reason) => {
  console.error('[Server] Unhandled rejection:', reason)
})
process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught exception:', err)
  process.exit(1)
})
```

---

### [A-08] `RequireSession` and `RequireChatEntry` render `null` during auth loading
- **File:** [src/App.jsx:37–40](src/App.jsx)
- **What:** `if (loading) return null` — both route guards return nothing (blank white page) while the auth state is being determined. On a slow connection, this can be a visible flash of nothing before the real content appears.
- **In production:** Users on slow connections or returning via browser back-button see a blank page for 200-800ms before content loads. Combined with no error boundary, any React error here also shows a blank page with no recovery path.
- **Severity: MEDIUM**

**Fix:** Replace `return null` with a minimal loading indicator:
```jsx
if (loading) return <div className="onboarding"><div className="pulse-dot" /></div>
```
Also add a React error boundary around `<BrowserRouter>` in [main.jsx](src/main.jsx).

---

## SUMMARY OF ISSUES FOUND

### Frontend / UI
Strong foundation. The streaming renderer correctly strips partial tags mid-stream, event listeners are cleaned up, and the auth subscription is properly unsubscribed. Two gaps stand out: `RequireSession` and `RequireChatEntry` return `null` during loading — a blank page flash that gets worse on slow connections. `ArtifactLoadingPreview` is defined and has complex step-cycling logic, but `showArtifactPending` is hardcoded to `false` at [Chat.jsx:879](src/pages/Chat.jsx), making the component permanently dead code. The Onboarding render guard is convoluted — an outer `if` that catches `!user` but falls through without doing anything, then an inner `if (!user)` that handles it — functionally correct but a logic trap for the next developer. One `console.log('Stream aborted.')` at [Chat.jsx:765](src/pages/Chat.jsx) ships in production but is harmless.

### Backend / API
The major gaps from the first audit are closed: auth middleware on all routes, rate limiting (20/min chat, 60/min embeddings), model whitelist validation, session ownership verification on the jailbreak route, and server-side jailbreak token detection. What remains: the embeddings endpoint at [server/index.js:102](server/index.js) passes `req.body` directly to OpenAI without any field extraction or model validation — an oversight from when the chat route was hardened. There are no request timeouts configured, so a hanging OpenAI call will hold the connection and count against rate limits indefinitely. `max_completion_tokens` is capped at 4000 server-side, which could silently truncate complex multi-pillar responses that run long — the system prompt alone is ~1,600 tokens.

### Security
The security posture improved significantly. `OPENAI_API_KEY` is off the client, CORS is locked to `FRONTEND_URL` with startup exit if missing, RLS is in place for user-owned tables, and the jailbreak counter is now server-side with ownership verification. The `.env` git history question is the remaining critical unknown — if the file was ever committed before `.gitignore` was configured, the live credentials need immediate rotation. The `messages` and `weekly_reads` tables have no RLS policies yet, which means conversation history is readable cross-user via the Supabase REST API.

### OpenAI / RAG Pipeline
Solid architecture. Confidence thresholds are enforced, query expansion is reasonable, the embedding model is consistent (`text-embedding-3-small`), and the `console.log` spam was cleaned from production paths. The open issue is `session_notes` — the AI is instructed to keep them under 900 characters, but nothing in code enforces this. After 50+ sessions, session notes could balloon to 3,000+ characters, significantly expanding the system prompt on every request. No check is in place for total context size before the API call is made.

### Performance
The biggest category concern. `syncPersonalWiki` fires on every Brain page load ([Brain.jsx:842](src/pages/Brain.jsx)) and runs sequential N+1 Supabase operations: a SELECT + UPDATE or INSERT for every seed node, memory node, and experiment node — potentially 20-30 sequential DB round-trips before each Brain session. The `messages` query in Brain.jsx fetches the entire conversation history without pagination — a user with 500 messages pulls all of them on every Brain open. `formatWikiContext` fires parallel OpenAI calls per retrieved source, which for a four-pillar synthesis could mean 6-8 simultaneous synthesis requests on a single user message. Three.js module-level textures (`_glowTexture`, `_haloTexture`) are never disposed across component lifecycle.

### Experiment System
The ghost counting logic was renamed but not fixed. `consecutive_miss_count` increments on every ghost but never resets — there is no experiment completion event in the client code. An experiment's status transitions are: `active → ghosted` (tracked). `completed` is mentioned in `generateMemoryUpdate` as a memory type but is never written back to `active_experiments[*].status`. The practical result: `consecutive_miss_count` is cumulative, identical to the old `ghost_count`. Warning thresholds are now correctly tracked per-count-value, but the "consecutive" semantics promised to users don't exist yet.

### Session Continuity
Thread separation by `thread_id` is sound. Opening messages are saved correctly and thread context is properly isolated. Two persistent issues: session notes grow without any code-enforced truncation, and write failures for session notes and memories are silently swallowed with `console.warn`. A user who loses their session note update gets no feedback and no retry — their next session starts from stale context without knowing it.

### Onboarding
Substantially improved. The `upsert` prevents duplicate sessions and the auth guard correctly blocks questions from rendering without auth. The remaining concern is the upsert's conflict resolution: the full `sessionPayload` (including blank `active_experiments`, zeroed `ghost_count`, and freshly-generated `axiom_profile`) is the upsert body. If an existing user triggers this path, everything is overwritten. The fix should be a pre-check before calling `upsert`. The error message on catch still reads "Check your API keys and Supabase connection" — this is developer diagnostic text exposed to end users.

### Data Integrity
`personal_wiki.sql` — the canonical schema setup file — still contains the old two-pillar constraint. The migration file patches the live database but a fresh install from the schema file is broken from the start. The `personal_memories` table uses `session_id` as the FK with `ON DELETE CASCADE`, which means deleting a session wipes all memories for that session, even though memories are designed to persist per `user_id` across sessions. This is a data loss risk if old sessions are ever pruned.

### Production Readiness
Strong improvements: `npm start` script added, CORS locked, `FRONTEND_URL` required at startup, only one `console.log` in src/ (non-critical). What remains: no process crash handlers, no error monitoring (Sentry / Datadog / equivalent), `VITE_API_URL` is not validated at startup — if unset, all API calls silently hit the frontend origin's `/api/*` path (works same-origin but fails silently in split deployments). No alerting mechanism if the RAG pipeline degrades — you'd find out from a user report, not a dashboard.

---

## SUMMARY OF FIXES

### [A-01] Fix `personal_wiki.sql` pillar constraint
In [personal_wiki.sql:29](personal_wiki.sql), replace the `pillar` CHECK with the 8-value list matching the migration file. This is a one-line change.

### [A-02] Validate the embeddings endpoint
In [server/index.js](server/index.js) in the `/api/openai/embeddings` handler: extract `{ input, model }` from `req.body`, reject anything that isn't `text-embedding-3-small`, and pass a `safePayload` instead of `req.body`.

### [A-03] Implement `consecutive_miss_count` reset
In [Chat.jsx:assignExperiment](src/pages/Chat.jsx), after successfully writing the new experiment to Supabase, also write `consecutive_miss_count: 0` if the prior experiment in that slot was `ghosted`. This closes the loop without requiring full completion-tracking infrastructure.

### [A-04] Guard the onboarding upsert against existing users
In [Onboarding.jsx:processOnboardingComplete](src/pages/Onboarding.jsx), add a `maybeSingle()` select on `sessions` by `user_id` before upsert. If a row exists, restore the session token from it and navigate to Brain without touching any session data.

### [A-05] Add RLS to `messages` and `weekly_reads`
Create [supabase/migrations/20260505000005_messages_reads_rls.sql](supabase/migrations/20260505000005_messages_reads_rls.sql) with `ENABLE ROW LEVEL SECURITY` and ownership policies for both tables using a sub-select through `sessions.user_id`. Run in Supabase SQL editor.

### [A-06] Audit git history for `.env`
Run `git log --all --full-history -- .env`. If commits appear: rotate all credentials immediately, then run `git filter-repo --path .env --invert-paths` to scrub history. New keys go in `.env` only (already gitignored).

### [A-07] Add crash handlers to server
Add `process.on('unhandledRejection', ...)` and `process.on('uncaughtException', ...)` at the bottom of [server/index.js](server/index.js), before `app.listen`. Both should log with `console.error`. `uncaughtException` should call `process.exit(1)` to allow the process manager to restart.

### [A-08] Replace `null` loading returns with spinner
In [App.jsx:37](src/App.jsx) and [:48](src/App.jsx), replace `return null` with the pulse-dot spinner div used elsewhere. Add a `<ErrorBoundary>` wrapper in [main.jsx](src/main.jsx).

---

**Additional MEDIUM items (not blockers, but fix before load increases):**

| Item | File | Fix |
|------|------|-----|
| `session_notes` not truncated | [personalMemory.js:167](src/lib/personalMemory.js) | Add `.slice(0, 900)` after the AI returns `session_notes` |
| `syncPersonalWiki` on every Brain open | [Brain.jsx:842](src/pages/Brain.jsx) | Gate with a session-scoped timestamp; skip if synced in last 5 minutes |
| Brain fetches all messages unpaginated | [Brain.jsx:786](src/pages/Brain.jsx) | Add `.limit(200)` to the messages query |
| Error message exposes API context to users | [Onboarding.jsx:483](src/pages/Onboarding.jsx) | Replace catch message with "Something went wrong. Try again." |
| `ArtifactLoadingPreview` is dead code | [Chat.jsx:879](src/pages/Chat.jsx) | Either enable `showArtifactPending` or delete the component |
| No timeout on OpenAI requests | [server/index.js](server/index.js) | Add `AbortSignal.timeout(90_000)` to both OpenAI client calls |
| `VITE_API_URL` not validated at startup | [src/lib/openai.js:8](src/lib/openai.js) | Add a build-time check or a runtime console.error if `API_BASE` is empty |

---

## BETA LAUNCH RECOMMENDATION

**READY WITH MINOR FIXES** — fix these 8 things first:

1. **[A-01]** Fix `personal_wiki.sql` pillar constraint — any fresh install is broken without this
2. **[A-02]** Validate the embeddings endpoint — closes the last unvalidated server input
3. **[A-03]** Implement `consecutive_miss_count` reset — the warning system doesn't work as designed without it
4. **[A-04]** Guard the onboarding upsert — risk of wiping existing user data on edge case
5. **[A-05]** RLS on `messages` and `weekly_reads` — conversation history is cross-readable right now
6. **[A-06]** Check git history for `.env` — if committed, rotate all credentials before any external access
7. **[A-07]** Process crash handlers on server — silent crashes on Railway
8. **[A-08]** Replace null loading returns with spinners — blank page on auth check is visible on slow connections

None of these require more than 30 minutes each. The core product loop (onboarding → brain → chat → memory → brain) is functional and secure after the fixes in this session. The experiment system gap ([A-03]) is the only one that affects the core product promise directly.

Do not launch until [A-05] (RLS on messages) and [A-06] (git history check) are resolved. Those are live security issues, not UX polish.

---

*This audit reflects the state of the codebase as of 2026-05-05 after the first-pass fix session. The overall security posture improved from 3/10 to 8/10. The primary remaining risk category is data integrity — the schema file gap and the two missing RLS policies.*
