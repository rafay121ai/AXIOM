# A3: Data and security

## Findings

- **A3-01. The repository does not contain a complete main-database schema.** Migrations alter or reference `users`, `sessions`, `messages`, `weekly_reads`, `personal_memories`, `personal_wiki_nodes`, `personal_wiki_edges` and `wiki_sources` without creating their base tables. Column types, original constraints and original RLS cannot be fully audited from this checkout. **UNVERIFIED:** need both projects' schema dumps and migration history before 2026-05-05. Evidence: `supabase/migrations/20260505000002_add_rls_policies.sql:1-40`, `supabase/migrations/20260505000005_messages_reads_rls.sql:1-21`, `supabase/migrations/20260505000007_wiki_source_dates.sql:1-5`.
- **A3-02. Critical profile, session and message writes still happen in the browser.** Onboarding can upsert `users` and insert sessions; Chat inserts, updates and deletes messages and updates sessions. Server validation is bypassed for these operations. Evidence: `src/pages/Onboarding.jsx:219-270`, `src/pages/Chat.jsx:899-915`, `src/pages/Chat.jsx:1022-1087`, `src/pages/Chat.jsx:1155-1161`, `src/pages/Chat.jsx:1298-1309`, `src/pages/Chat.jsx:2443-2552`.
- **A3-03. The new loop's data model is absent.** There are no columns/tables for country, customer market, business model, structured stage/goal/deadline, sharing consent, anonymized peer outcomes, matching, founder voices, voice notes, unlock state or introductions. The existing onboarding is stored as generic JSON question/answer pairs. Evidence: `src/pages/Onboarding.jsx:250-265`, `supabase/migrations/20260505000006_experiment_status_actions.sql:1-23`, `supabase/migrations/20260511000002_axiom_knowledge_schema.sql:12-100`.
- **A3-04. Knowledge-project RLS is incomplete in the checked-in schema.** The migration creates `wiki_sources`, `wiki_chunks`, `source_learning_maps` and `user_concept_states` but does not enable RLS or create policies there. A prior main-project migration enables authenticated reads only for `wiki_chunks`, but that predates the separate knowledge schema. **UNVERIFIED:** deployed knowledge-project policies require a live schema dump. Evidence: `supabase/migrations/20260505000002_add_rls_policies.sql:33-40`, `supabase/migrations/20260511000002_axiom_knowledge_schema.sql:12-100`.
- **A3-05. Personal memory was correctly moved to server-owned writes.** The later migration removes browser `FOR ALL` and leaves owner SELECT only; API writes overwrite `user_id` from the verified token. Evidence: `supabase/migrations/20260514000001_personal_memories_read_only_rls.sql:1-5`, `server/index.js:954-1025`.
- **A3-06. Other owner policies use broad `FOR ALL`.** Sessions, messages, weekly reads, wiki nodes/edges, experiments, app sessions and conversation threads let the owner perform every operation. This is broader than least privilege and enables client mutation/deletion where the product may expect server control. Evidence: `supabase/migrations/20260505000002_add_rls_policies.sql:1-31`, `supabase/migrations/20260505000005_messages_reads_rls.sql:1-21`, `supabase/migrations/20260505000006_experiment_status_actions.sql:56-71`, `supabase/migrations/20260508000001_usage_sessions_threads.sql:31-45`, `supabase/migrations/20260508000001_usage_sessions_threads.sql:68-81`, `supabase/migrations/20260508000001_usage_sessions_threads.sql:117-130`.
- **A3-07. Auth is consistent on API prefixes, but public health leaks no detail.** Bearer tokens are resolved through Supabase `auth.getUser`; every `/api/*` prefix is guarded and `/health` returns only `{ok:true}`. Evidence: `server/index.js:205-280`.
- **A3-08. CORS is allowlisted but depends on deployment configuration.** Startup fails without `FRONTEND_URL`; optional `FRONTEND_URLS` extends the exact-origin set. Evidence: `server/index.js:18-43`, `server/index.js:247-267`.
- **A3-09. Service keys remain server/script-only in source, with one dangerous test variable name.** Production code reads non-`VITE_` service role names. Smoke tests also read `VITE_KNOWLEDGE_SUPABASE_SERVICE_ROLE_KEY`; setting that in Vite would expose a service key. Evidence: `server/index.js:97-131`, `scripts/smoke.test.js:27-55`, `.env.example:5-16`.
- **A3-10. User text is deliberately interpolated into multiple model prompts.** Security instructions tell the model to ignore instruction-like text, but enforcement is prompt-only; no content boundary or structured trust label prevents prompt injection. Evidence: `src/lib/openai.js:1117-1138`, `src/lib/openai.js:1518-2038`, `src/lib/rag.js:430-493`, `src/lib/rag.js:1017-1149`.
- **A3-11. Rate limits exist on expensive/write endpoints, but not every API operation.** Chat, embeddings, live search, experiments, concept/memory writes have dedicated limits; personal wiki and jailbreak endpoints rely only on auth. Evidence: `server/index.js:82-96`, `server/index.js:857-954`, `server/index.js:1096-1364`, `server/index.js:1448-1696`, `server/index.js:1825-1860`.

## Verified tables

| Table | Purpose / access | Verified columns or delta |
|---|---|---|
| `model_usage_logs` | Server usage accounting; owner RLS | Full schema in `20260508000001...sql:1-46`; `call_type` extended in `20260513000001...sql:1-7` |
| `app_sessions` | Browser activity telemetry; owner all | Full schema `20260508000001...sql:48-83` |
| `conversation_threads` | Browser-owned thread index | Full schema and indexes `20260508000001...sql:85-132` |
| `experiments` | Actions/outcomes | Full schema/index/RLS `20260505000006...sql:1-71`; reason delta `20260508000002...sql:1-12` |
| `wiki_sources` | Canonical source metadata | Full knowledge schema `20260511000002...sql:12-46` |
| `wiki_chunks` | 1536-dimension embedded chunks | `20260511000002...sql:48-70` |
| `source_learning_maps` | Per-source concepts | `20260511000002...sql:72-85` |
| `user_concept_states` | User learning state | `20260511000002...sql:87-100` |
| `users`, `sessions`, `messages`, `weekly_reads`, `personal_memories`, `personal_wiki_nodes`, `personal_wiki_edges` | Main product state | **UNVERIFIED base schema**; only deltas/policies are checked in |

RLS policy inventory: owner `FOR ALL` on sessions, messages, weekly reads, personal wiki nodes/edges, model usage, app sessions, conversation threads and experiments; owner SELECT-only on personal memories; authenticated SELECT on the old/main `wiki_chunks`. Evidence: migration ranges cited in A3-04 through A3-06.

## Minimal new schema

```text
founder_profiles
  user_id PK/FK, country_code, customer_market_codes[], business_model,
  stage, primary_goal, goal_deadline, sharing_consent bool,
  intro_consent bool, created_at, updated_at

seeks
  id, user_id, situation_text, situation_audio_path nullable,
  concrete_detail, follow_up_count check 0..2, status, created_at

lessons
  id, seek_id, ordinal, kind check(author|founder_voice), author,
  source_id, chapter_or_location, argument, founder_connection, action, payload jsonb

experiment_commits
  experiment_id PK/FK, committed_at, mission, success_condition,
  script, prep_checklist jsonb

experiment_reports
  id, experiment_id, user_id, result check(done|couldnt|didnt),
  note_text, note_audio_path, created_at

peer_outcomes
  id, source_report_id restricted, stage, customer_markets[], business_model,
  anonymized_situation, anonymized_action, anonymized_outcome,
  consent_snapshot_id, publishable bool, created_at

peer_unlocks(user_id, report_id, stack_id, unlocked_at)
peer_matches(user_id, peer_outcome_id, score, reason_codes[], served_at)
intro_requests(id, requester_id, peer_user_id restricted, both_consented_at, status)
```

RLS: founders read/update only their profile, seeks, commits and reports; server-only writes for lessons, anonymization, outcomes, matches and unlocks; clients read only publishable anonymized outcomes assigned to them; identity mapping and consent snapshots must never be client-readable through peer rows.

## Out-of-core data

Personal wiki tables, weekly reads, graph-related memory pillar columns, jailbreak/warning counters, and artifact payloads primarily support out-of-core surfaces. Do not drop yet: Chat and Brain still read/write them. Dependency evidence: `src/pages/Brain.jsx:978-1087`, `src/lib/sessionReads.js:34-84`, `src/lib/personalWiki.js:1-495`, `server/index.js:1096-1364`.

## Cross area notes

- A4: structured Learn output needs source IDs and chapter/location metadata absent from chunks.
- A5: knowledge-project policies and actual row counts need deployed-schema/database access.
- A6: reporting and peer unlocks need normalized rows rather than status fields alone.
- A7: out-of-core tables cannot be removed while Brain/Chat dependencies remain.

## Open questions

- **UNVERIFIED:** complete schemas, active RLS policies, grants, storage buckets and row counts in both Supabase projects. Need read-only schema dumps.
- **UNVERIFIED:** Supabase Auth provider settings, JWT lifetime and redirect allowlist. Need project dashboard/config export.
- **UNVERIFIED:** storage design for future voice notes; no bucket policy exists in this repository.

## Coverage

Read every SQL file in `supabase/migrations`; all Supabase client constructors; every `.from(...)` use in `src`, `server` and `scripts`; server auth, CORS, rate-limit, validation and route sections; `.env.example`; auth/onboarding/message write paths. Skipped `supabase/.temp` generated CLI state and any live project inspection because database access is forbidden. Base schema files were not present, explicitly recorded as UNVERIFIED.
