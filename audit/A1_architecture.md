# A1: Architecture and runtime

## Verified system

```text
Browser: Vite 5 + React 18 + React Router
  |-- Supabase JS (anon key): Auth and direct main-database reads/writes
  |-- HTTPS /api: bearer token
        Express 4 on Railway
          |-- OpenAI chat completions + embeddings
          |-- Exa live search
          |-- main Supabase service role
          `-- knowledge Supabase service role
Vercel serves the SPA and rewrites /api/* to Railway.
```

- **A1-01. The architecture document describes a different application.** It says Next.js, FastAPI, Claude and background jobs; the executable manifests define Vite/React and Node/Express/OpenAI. Treat `ARCHITECTURE.md` as historical, not operational documentation. Evidence: `ARCHITECTURE.md:7-33`, `package.json:6-43`, `server/package.json:6-20`, `server/index.js:9-15`.
- **A1-02. The browser is both UI and application layer.** It writes users, sessions and messages directly through the anon Supabase client while also calling Express for privileged operations. This splits authorization, validation and orchestration across two runtimes. Evidence: `src/pages/Onboarding.jsx:219-270`, `src/pages/Chat.jsx:1022-1087`, `src/pages/Chat.jsx:1298-1309`, `src/lib/api.js:1-42`.
- **A1-03. The route surface has no new-loop resources.** There are no seek, lesson, report, peer outcome, consent, match or introduction routes. Existing routes are health, AI proxy, live search, concepts, personal memory/wiki, diagnostics, experiments and jailbreak tracking. Evidence: `server/index.js:269-280`, `server/index.js:857-925`, `server/index.js:954-1364`, `server/index.js:1448-1825`.
- **A1-04. Deployment is hard-wired to one production API hostname.** Vercel rewrites every `/api/*` request to a literal Railway URL; `VITE_API_URL` is used for direct API calls in development/alternate deployments. Evidence: `vercel.json:1-11`, `.env.example:25-26`, `src/lib/api.js:1-5`.
- **A1-05. Frontend and server install different Supabase JS versions.** Root requests `^2.45.0`; server requests `^2.104.1`. This duplicates the package and makes behavior/version audits harder. Evidence: `package.json:24-38`, `server/package.json:10-17`.

## Stack and entry points

| Area | Verified implementation | Entry/config |
|---|---|---|
| Frontend | React 18.3.1, React DOM, React Router 6.27, Vite 5.4 | `index.html:1-13`, `src/main.jsx:1-10`, `src/App.jsx:118-151`, `vite.config.js:1-9` |
| Backend | Node >=20, Express 4.21, CORS, rate limit | `server/package.json:6-20`, `server/index.js:9-18`, `server/index.js:265-280` |
| Main data/auth | Supabase/Postgres via browser anon client and server service client | `src/lib/supabase.js:1-30`, `server/index.js:97-131` |
| Knowledge data | Separate Supabase project; browser reads, server writes | `src/lib/knowledgeSupabase.js:1-18`, `server/index.js:127-131` |
| AI | OpenAI chat completions and embeddings | `src/lib/openai.js:4-7`, `server/index.js:1652-1822` |
| Search | Exa, server-side | `server/index.js:11-12`, `server/index.js:66-80`, `server/index.js:857-923` |
| Hosting | Vercel SPA; Railway API | `vercel.json:1-11` |
| Automation | Manual npm scripts; no cron or n8n definition found | `package.json:6-22` |

Repository folders: `src/pages` screens; `src/components` rendering widgets; `src/lib` client orchestration/data/AI helpers; `server` Express API; `supabase/migrations` SQL deltas; `scripts` maintenance/import/test programs; `scripts/output` generated backups; `sources` local source corpus; `shared` brain-label helpers; `Brand Kit` binary/vector brand exports; `dist` generated frontend build; `.claude` local agent metadata; `.venv` local Python environment.

## Backend routes

All `/api/openai`, `/api/session`, `/api/live-search`, `/api/knowledge`, `/api/experiments`, `/api/personal-memories`, `/api/personal-wiki`, and `/api/admin` paths pass `requireAuth`; `/health` is public. Evidence: `server/index.js:269-280`.

| Method/path | Purpose and calls |
|---|---|
| GET `/health` | Process/config health; no auth (`server/index.js:280-294`) |
| POST `/api/live-search` | Exa search with cache/rate limit (`server/index.js:857-923`) |
| POST `/api/knowledge/concept-states` | Service-role concept-state upsert (`server/index.js:925-952`) |
| POST/GET `/api/personal-memories` | Upsert/list memories (`server/index.js:954-1055`) |
| POST `/api/personal-memories/mark-used` | Update use counters (`server/index.js:1057-1094`) |
| POST `/api/personal-wiki/nodes` | Node upsert (`server/index.js:1096-1173`) |
| POST `/api/personal-wiki/edges` | Edge upsert (`server/index.js:1175-1249`) |
| GET `/api/personal-wiki/graph` | Owned graph (`server/index.js:1251-1267`) |
| POST `/api/personal-wiki/sync` | Derive graph from memories/experiments (`server/index.js:1269-1326`) |
| POST `/api/personal-wiki/nodes/:id/accessed` | Access metadata (`server/index.js:1328-1362`) |
| GET `/api/admin/diagnostics` | Admin allowlist metrics (`server/index.js:1364-1446`) |
| POST/GET `/api/experiments` | Validate/create or list experiments (`server/index.js:1448-1576`) |
| POST `/api/experiments/:id/status` | Outcome/status update (`server/index.js:1578-1650`) |
| POST `/api/openai/embeddings` | OpenAI embedding proxy (`server/index.js:1652-1694`) |
| POST `/api/openai/chat` | OpenAI chat proxy, streaming or JSON (`server/index.js:1696-1822`) |
| POST `/api/session/:id/jailbreak` | Increment owned session counter (`server/index.js:1825-1860`) |

## Four flows

```text
Chat: Chat.handleSend -> browser inserts user message -> RAG/embedding/search helpers
 -> buildSystemPrompt -> /api/openai/chat -> streamed text -> browser inserts assistant message
 -> optional server experiment write + concept/memory/wiki background writes.
```
Evidence: `src/pages/Chat.jsx:1270-1309`, `src/pages/Chat.jsx:1342-1795`, `src/pages/Chat.jsx:1810-2059`.

```text
Onboarding: 10 local questions -> generateAxiomProfile via /api/openai/chat
 -> browser upserts users -> browser inserts sessions -> localStorage session token
 -> /welcome or /brain.
```
Evidence: `src/pages/Onboarding.jsx:194-278`, `src/lib/openai.js:289-321`.

```text
Experiment create: model emits tagged JSON in chat -> Chat parses it
 -> POST /api/experiments -> server verifies session owner and deterministic quality
 -> service-role insert -> card remains embedded in chat.
```
Evidence: `src/pages/Chat.jsx:134-161`, `src/pages/Chat.jsx:1852-1999`, `src/pages/Chat.jsx:2138-2174`, `server/index.js:1448-1546`.

```text
Outcome: report/done/cancel action inside chat -> POST /api/experiments/:id/status
 -> service-role update + selected session counters -> memory/wiki follow-up.
No scheduler initiates an evening check-in.
```
Evidence: `src/components/ExperimentCard.jsx:94-111`, `src/pages/Chat.jsx:2184-2370`, `server/index.js:1578-1649`.

## Environment variables

Frontend-exposed: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_KNOWLEDGE_SUPABASE_URL`, `VITE_KNOWLEDGE_SUPABASE_ANON_KEY`, `VITE_API_URL`, and Vite's `DEV`. Server/script-only: `FRONTEND_URL`, `FRONTEND_URLS`, `PORT`, `SUPABASE_SERVICE_ROLE_KEY`, `KNOWLEDGE_SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `EXA_API_KEY`, `LIVE_SEARCH_CACHE_TTL_MS`, `LIVE_SEARCH_MAX_RESULTS`, `ADMIN_EMAILS`, `ADMIN_USER_IDS`, `OPENAI_LEARNING_MAP_MODEL`, `OPENAI_SOURCE_ENRICH_MODEL`, `WIKI_LABEL_MODEL`, `WIKI_SOURCE_ENRICH_BATCH`, `RSS_PER_FEED_LIMIT`, `KNOWLEDGE_VERIFY_QUERY`, `EMBEDDING_MODEL`, `SMOKE_TEST_PORT`, `SMOKE_API_URL`, `SMOKE_TEST_TIMEOUT_MS`, `PYTHON_BIN`, `JINA_READER_BASE_URL`. A suspicious test-only name, `VITE_KNOWLEDGE_SUPABASE_SERVICE_ROLE_KEY`, is referenced but not documented; a service-role value must never use a `VITE_` name. Evidence: `.env.example:1-26`, `server/index.js:18-131`, `scripts/smoke.test.js:12-55`, `seed.js:33-53`, `seed.js:1950-2191`.

## Dependencies

Used: Supabase, React/DOM/router, Three/postprocessing, Recharts, Axios, Cheerio, OpenAI, pdf-parse, Express, CORS, rate limit, Exa, dotenv. `@types/three` is a runtime dependency despite no TypeScript; `react-is` has no direct source import; root `express-rate-limit` has no root-runtime import; these are removal candidates, not proven safe without lockfile/package-resolution testing. Evidence: `package.json:24-43`, `server/package.json:10-17`, `src/pages/Brain.jsx:1-8`, `src/components/ArtifactRenderer.jsx:1-1929`, `seed.js:1-60`, `server/index.js:9-15`.

Top center-of-gravity files by line count: `Chat.jsx` 2,821; `openai.js` 2,038; `ArtifactRenderer.jsx` 1,929; `server/index.js` 1,874; `Brain.jsx` 1,700; `rag.js` 1,233; `smoke.test.js` 647; `personalWiki.js` 495; `migrate_axiom_knowledge.js` 412; `Onboarding.jsx` 396. Evidence: repository `wc -l` measurement; file ranges are respectively `src/pages/Chat.jsx:1-2821`, `src/lib/openai.js:1-2038`, `src/components/ArtifactRenderer.jsx:1-1929`, `server/index.js:1-1874`, `src/pages/Brain.jsx:1-1700`, `src/lib/rag.js:1-1233`, `scripts/smoke.test.js:1-647`, `src/lib/personalWiki.js:1-495`, `scripts/migrate_axiom_knowledge.js:1-412`, `src/pages/Onboarding.jsx:1-396`.

## Cross area notes

- A2: the route and state design makes Brain the front door and Chat the main interaction surface.
- A3: direct browser writes and the dual-Supabase design need policy-level review.
- A4: AI orchestration is mostly client-side and creates many calls per turn.
- A7: manifests, lockfiles and generated folders contain duplication and likely dead weight.

## Open questions

- **UNVERIFIED:** actual Vercel and Railway project settings, deployed environment values, and scheduled jobs outside this repository. Need hosting dashboards.
- **UNVERIFIED:** exact installed production versions because caret ranges and lockfiles may differ from deployed artifacts. Need deployment lockfile/build logs.

## Coverage

Read: `package.json`, `package-lock.json` dependency metadata, `server/package.json`, `server/package-lock.json` dependency metadata, `vite.config.js`, `vercel.json`, `.env.example`, `requirements.txt`, `index.html`, `src/main.jsx`, `src/App.jsx`, `src/lib/api.js`, `src/lib/supabase.js`, route and flow ranges in `server/index.js`, `src/pages/Onboarding.jsx`, `src/pages/Chat.jsx`, `src/components/ExperimentCard.jsx`, and repository folder/file inventory. Skipped content of `node_modules`, `server/node_modules`, `.venv`, `dist`, binary Brand Kit files, source PDFs, and generated JSON backups because they are generated/vendor/binary rather than architecture source; their presence and folder role were inventoried.
