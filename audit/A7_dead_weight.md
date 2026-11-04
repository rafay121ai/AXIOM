# A7: Dead weight and quality

## Findings

- **A7-01. Two components are definitively unused.** `OnboardingQuestion.jsx` and `WarningCard.jsx` have no imports. Evidence: `src/components/OnboardingQuestion.jsx:1-28`, `src/components/WarningCard.jsx:1-16`, repository import search across `src` returned zero references.
- **A7-02. The out-of-core Brain is a 1,700-line dependency hub.** It pulls Three.js/postprocessing, personal wiki, weekly reads, DB messages/sessions and shared theme logic. Removing it cleanly requires moving chat entry, account and thread controls first. Evidence: `src/pages/Brain.jsx:1-12`, `src/pages/Brain.jsx:928-1700`.
- **A7-03. Artifact polish is 2,668+ lines before CSS.** `ArtifactRenderer.jsx`, `artifacts.js` and `artifactRegistry.js` implement a large secondary rendering system and extra model calls. It is explicitly out of core. Evidence: `src/components/ArtifactRenderer.jsx:1-1929`, `src/lib/artifacts.js:1-379`, `src/lib/artifactRegistry.js:1-360`.
- **A7-04. Live web search remains fully wired despite being out of core.** Trigger logic, client, route, Exa dependency, prompt modules and retrieval fallback all remain active. Evidence: `src/lib/liveSearchTriggers.js:1-76`, `src/lib/liveSearch.js:1-90`, `server/index.js:66-80`, `server/index.js:857-923`, `src/pages/Chat.jsx:1587-1607`.
- **A7-05. Weekly reads remain a Brain front-door feature.** Opening Brain can generate and insert a weekly read, consuming an AI call and DB write. This conflicts with “daily briefing/front door out of core.” Evidence: `src/pages/Brain.jsx:9-10`, `src/pages/Brain.jsx:1020-1087`, `src/lib/sessionReads.js:46-84`.
- **A7-06. Root manifest has probable unused/directly misplaced dependencies.** No source import exists for root `express-rate-limit`; `@types/three` is runtime despite a JavaScript codebase; `react-is` has no direct import. **UNVERIFIED:** transitive peer needs require package-manager analysis before removal. Evidence: `package.json:24-43`, source import inventory across `src`, `server`, `scripts`.
- **A7-07. Only one test suite exists, and it is an integration smoke test that writes to both databases.** There are no unit/component tests for onboarding, seek stopping, prompt assembly, RAG normalization or experiment report transitions. It was not run under read-only rules. Evidence: `package.json:22`, `scripts/smoke.test.js:1-647`, especially destructive cleanup/writes `scripts/smoke.test.js:202-220`, `scripts/smoke.test.js:392-554`.
- **A7-08. Silent failures are common in user-state paths.** Weekly reads, app session telemetry, memory saves, personal wiki cache and post-response jobs swallow errors, making missing state look successful. Evidence: `src/lib/sessionReads.js:41-83`, `src/lib/appSessionTracker.js:34-81`, `src/lib/personalMemory.js:140-163`, `src/pages/Chat.jsx:2048-2063`.
- **A7-09. Server logging can emit internal error objects/details.** Routes log raw errors; usage logging stores up to 1,000 characters of provider error detail and logs inserted usage rows. No direct secret logging was found, but provider/database messages may expose operational detail. Evidence: `server/index.js:138-198`, `server/index.js:920-949`, `server/index.js:1543-1545`, `server/index.js:1682-1692`, `server/index.js:1802-1812`.
- **A7-10. Architecture and product docs are stale enough to mislead implementation.** They describe Next/FastAPI/Claude, premium Circle/payment, account removal and Brain-first product behavior. Evidence: `ARCHITECTURE.md:7-33`, `ARCHITECTURE.md:1582-1611`, `PRODUCT.md:200-249`, `PRODUCT.md:395-492`.
- **A7-11. Generated and local-environment weight is checked into the workspace.** `dist`, root/server `node_modules`, `.venv`, `.DS_Store` files and three ~57k-line knowledge backup JSON files are present. **UNVERIFIED:** tracked status of each beyond the inventory; do not delete without `git ls-files` confirmation. Evidence: repository folder inventory; `scripts/output/knowledge_archived_sources_backup_2026-05-11T12-01-23-394Z.json:1-56939`, sibling backups `:1-57104` and `:1-57302`.
- **A7-12. Large files hide cross-layer logic.** Files over 500 lines: Chat 2,821; openai 2,038; ArtifactRenderer 1,929; server 1,874; Brain 1,700; rag 1,233; smoke test 647. Chat's send pipeline alone spans over 800 lines and server is a single route module. Evidence: `src/pages/Chat.jsx:1212-2077`, line-count ranges listed above.
- **A7-13. No TODO/FIXME backlog exists, but comments preserve obsolete assumptions.** The absence of markers does not indicate cleanliness; behavior is encoded in monoliths and stale docs. Evidence: repository search across `src`, `server`, `scripts` found no source TODO/FIXME markers; old assumptions appear in `src/pages/Chat.jsx:797-798` and `src/components/WarningCard.jsx:1-8`.

## Duplication and fragile areas

- Experiment validation is correctly single-sourced by re-export, not duplicated: `src/lib/experimentQuality.js:1-4` and `server/experimentQuality.js:1-194`.
- Experiment outcome interpretation exists both as regex code and prompt instructions, which can disagree: `src/pages/Chat.jsx:573-655`, `src/lib/openai.js:1812-1845`.
- Session ownership is checked in many route handlers instead of one resource middleware: `server/index.js:406-416`, `server/index.js:1096-1364`, `server/index.js:1448-1650`.
- Source metadata appears in both chunks and source rows: `supabase/migrations/20260511000002_axiom_knowledge_schema.sql:12-59`.

## Removal list

**HIGH confidence now**

- `src/components/OnboardingQuestion.jsx`: no imports; removal breaks nothing found.
- `src/components/WarningCard.jsx`: no imports; removal breaks nothing found.
- Closure-warning prompt blocks after product decision: remove flags/context/copy together; otherwise warnings still surface in AI prose.
- Live search as a feature bundle: remove Chat imports/call, `liveSearch*`, server route/Exa setup, Exa dependency and prompt rules together.

**MEDIUM confidence after moving required controls**

- Brain bundle: route/page, Three/postprocessing dependencies, `shared/brainThemes.js`, personal wiki UI sync and Brain CSS. Wrong ordering would remove the only chat/account/thread entry.
- Artifact bundle: renderer, registry, builder, Recharts and prompt/router branches. Wrong removal would leave tagged payloads or hanging build promises.
- Weekly reads: `sessionReads.js`, Brain UI/call, `weekly_reads` only after confirming no external consumer.
- Knowledge maintenance for live/current signals: RSS importer and date-oriented prompt logic after live search removal.

**LOW confidence / verify first**

- Database tables and columns tied to graph/warnings/artifacts; deployed consumers and analytics are unknown.
- `react-is`, `@types/three`, root `express-rate-limit`; confirm lockfile/peer behavior.
- Generated folders/backups; confirm tracked status and operational recovery needs.

## Cross area notes

- A1: deployment docs must be rewritten from executable config.
- A2: move account/thread/chat entry before deleting Brain.
- A3: table removal needs deployed dependency/schema checks.
- A4: remove corresponding prompt modules whenever a feature bundle is cut.
- A6: warning behavior must be removed as code, prompt and schema concern.

## Open questions

- **UNVERIFIED:** which generated/vendor files are tracked and required by deployment. Need `git ls-files` plus CI settings.
- **UNVERIFIED:** dynamic imports or external scripts consuming exports. No dynamic local imports were found, but external consumers cannot be ruled out.
- **UNVERIFIED:** test coverage/CI outside this repository. Need CI dashboard/workflow source.

## Coverage

Read/import-searched every application file under `src`, `server`, `scripts`, `shared` and every migration; read package manifests and test entry; inventoried `dist`, `node_modules`, `server/node_modules`, `.venv`, `scripts/output`, `sources`, Brand Kit and root docs. Skipped vendor/generated file bodies, binary assets/PDFs and backup JSON bodies because they are not hand-maintained application logic. Did not run tests because the sole smoke suite writes and deletes database rows.
