# Axiom codebase audit

## 1. Summary

Axiom today is a Vite/React web app backed by one Express server, two Supabase projects and OpenAI. Its real product is still the old one: onboarding leads to a Three.js Founder Brain, then into a large chat runtime that performs RAG, artifacts, memory, experiments and warning behavior. The new Read Back -> Seek -> Learn -> Act -> Report -> Peer Map loop does not exist as a screen, API or data architecture. [A1-01, A2-01, A2-02, A1-03]

Health is mixed. Authentication, owner checks, deterministic experiment validation, source retrieval and existing experiment persistence are valuable. But core logic is concentrated in three frontend monoliths, critical writes happen in the browser, checked-in schemas are incomplete, model calls fan out, and the guiding documents mandate the product now being retired. [A6-01, A5-03, A2-10, A3-01, A3-02, A4-01, H-04]

The three biggest problems:

1. **Wrong product architecture.** Brain and Chat remain the product shell; six required steps and Peer Map are absent. [A2-01, A2-02, A6-10]
2. **No durable new-loop model.** Founder context, seeks, structured lessons, commits, reports, consented peer outcomes, unlocks and matching are missing. [A3-03, A6-02, A6-03, A6-10]
3. **Too much intelligence in UI monoliths.** Chat orchestrates persistence, retrieval, prompts, experiments, memory and rendering; browser writes bypass server validation; ordinary turns can invoke many models. [A2-10, A1-02, A3-02, A4-01]

The three most valuable things to keep:

1. Deterministic experiment validator and server-owned experiment API. [A6-01]
2. Six-pillar source corpus, embeddings, HNSW retrieval and source-level title/author metadata. [A5-03, A5-04, A5-05]
3. Authenticated Express proxy, Supabase ownership checks and personal memory primitives. [A3-05, A3-07, A1-03]

## 2. Verified system map

```text
Vercel: Vite/React SPA
  |-- Supabase anon client -> Auth + direct main DB reads/writes
  |-- bearer-token /api calls
        Railway: Express
          |-- OpenAI chat + embeddings
          |-- Exa live search
          |-- main Supabase service client
          `-- knowledge Supabase service client
```

[A1-01, A1-02, A1-04]

```text
Onboard: local questions -> profile AI -> browser users/session write -> Welcome/Brain
Chat: browser message write -> route/RAG/search -> streamed AI -> browser message write
Act: model-tagged JSON -> server validator -> experiments insert -> card inside Chat
Report: Chat action/text -> status API -> outcome/counters -> optional memory/wiki sync
```

[A1-02, A1-03, A6-01, A6-08]

## 3. Keep, Change, Cut

| Feature/component | Verdict | Reason | Files / IDs |
|---|---|---|---|
| Google/Supabase auth | Keep | Working owner identity | `App.jsx`, `AuthCallback.jsx`; A3-07 |
| Express auth/API proxy | Keep | Correct server boundary; extend it | `server/index.js`; A1-03, A3-07 |
| Current onboarding sequence | Change | Correct 7+3 count; missing voice and explicit context | `Onboarding.jsx`; A2-03 |
| Profile/readback generators | Change | Useful seed, not durable pattern detection | `openai.js`, `Welcome.jsx`; A2-04, A4-03 |
| Chat input/stream transport | Change | Extract for Seek and optional Chat | `Chat.jsx`, `openai.js`; A2-05, A2-10 |
| RAG/vector search | Keep, simplify | Useful corpus; retrieval path is too complex | `rag.js`, knowledge schema; A5-03, A5-08 |
| Six pillar mapping | Keep | Fits early Learn direction | `seed.js`, schema; A5-05 |
| Learning-map states | Change later | Model-inferred, not mastery evidence | `rag.js`; A5-06 |
| Experiment validator/API | Keep | Strong deterministic core | `experimentQuality.js`, server routes; A6-01 |
| Experiment card | Change | Data reusable; needs dedicated Act screen | `ExperimentCard.jsx`; A6-02 |
| Outcome status API | Change | Base for Report; UI/status contract wrong | `Chat.jsx`, server routes; A6-04 |
| Personal memory | Keep, constrain | Useful personalization; move boundary updates server-side | `personalMemory.js`; A3-05, A4-03 |
| Founder Brain/Three.js | Cut after navigation move | Out of core, 1,700-line hub | `Brain.jsx`, `brainThemes.js`; A2-09, A7-02 |
| Personal wiki graph | Cut/defer | Mostly serves Brain | `personalWiki.js`, API routes; A5-07 |
| Artifact system | Cut/defer | Explicitly out of core; large and call-heavy | renderer/registry/builder; A7-03 |
| Live web search | Cut | Explicitly out of core; fully entangled | `liveSearch*`, Exa route; A7-04 |
| Weekly read | Cut/defer | Old Brain front door | `sessionReads.js`; A7-05 |
| Warning/closure behavior | Cut | Out of core; threat without closure implementation | prompts/counters/copy; A6-05, A6-06, H-05 |
| Peer Map | Build | No UI, API or schema exists | A3-03, A6-10 |
| Payment | Do not build | No executable paywall; only stale docs | H-13 |
| Unused components | Cut now | Zero imports | `OnboardingQuestion.jsx`, `WarningCard.jsx`; A7-01 |

## 4. Strip plan

**Safe now**

1. Remove unused `OnboardingQuestion.jsx` and `WarningCard.jsx`. Confirm import search stays empty. [A7-01]
2. Delete closure-warning prompt/copy paths while retaining neutral report outcomes. Confirm warning language cannot render. [A6-06, H-05]
3. Remove live search end to end: Chat branch, clients/triggers, server route, Exa setup/dependency and prompt modules. Confirm grounded library answers still work. [A7-04]

**Needs care**

1. Build new navigation/account/thread shell, then remove Brain route, Three.js/postprocessing, graph CSS and `brainThemes`. Confirm login, resume, optional Chat and thread access. [A2-09, A7-02]
2. Remove artifact routing/build/render bundle and Recharts after Learn has its own components. Confirm no model tags or pending artifact promises remain. [A7-03]
3. Remove weekly reads and personal wiki sync only after checking deployed consumers and data retention. [A7-05, A5-07]

**Do later**

1. Drop old tables/columns only after a live schema/dependency dump and export. [A3-01, A3-04]
2. Remove learning-map machinery only after structured lessons provide explicit progress events. [A5-06]
3. Verify candidate dependencies through lockfile/peer checks before removal. [H-11]

No removals were performed in this read-only audit.

## 5. New loop

| Direction | Exists | Change | New work |
|---|---|---|---|
| 1. Onboard | 7 taps + 3 text prompts | Add voice and normalized fields | country, customer markets, model, stage, goal, deadline [A2-03] |
| 2. Read Back | One-time Welcome sentence | Durable evidence-backed read; accept correction | pattern record/evidence/feedback [A2-04, A4-03] |
| 3. Seek | Unlimited Chat + incident heuristics | Dedicated state; max 2 follow-ups | seek record and hard stop [A2-05, A4-04] |
| 4. Learn | RAG prose/artifacts | Structured attributed stack | lesson schema/UI, inline taps, founder voices [A2-06, A4-05] |
| 5. Act | Embedded experiment card | Dedicated review/commit route | mission, script, prep list, commit [A6-02] |
| 6. Report | Chat status/text classification | Evening due event and exact choices | voice/text note and atomic unlock [A6-03, A6-04] |
| 7. Peer Map | Missing | None reusable beyond experiment outcomes | consent, anonymize, match, cases, intros [A6-08, A6-10] |
| 8. Global/free | No executable paywall | Remove stale payment claims | market/language context [A5-09, H-13] |
| 9. Chat behind tap | Guarded behind Brain | Put behind new shell | retain optional general chat only [A2-01] |

## 6. Data model

Keep auth users, sessions during transition, messages for optional Chat, experiments, personal memories, source/chunk tables and model usage. Change experiments to explicit draft/committed/report-due/reported states and normalize founder profile fields. Defer/drop weekly reads, graph tables, warning counters and learning-map state only after dependencies move. [A3-03, A6-02, A6-03, A7-02, A7-05]

Minimal additions: `founder_profiles`, `seeks`, `lessons`, `experiment_commits`, `experiment_reports`, `peer_outcomes`, `peer_unlocks`, `peer_matches`, `consent_snapshots`, `intro_requests`. Full field proposal is in A3. Founder-owned rows require owner SELECT/UPDATE; lesson generation, anonymization, peer outcomes, matches and unlocks require server-only writes; clients may read only assigned publishable anonymized cases. Identity links must be isolated from peer-visible rows. [A3-03, A3-06, H-12]

Before migration work, obtain schema dumps for both projects. The checked-in main schema is incomplete and deployed knowledge RLS is unknown. [A3-01, A3-04, H-07]

## 7. AI layer

Current normal flow can perform route classification, embedding, query expansion, main answer, concept update and memory update; artifact turns add more. Prompt targets range from 25k to 55k characters before history. Actual GPT-5 cost is unknown, and the logger applies GPT-4.1-mini fallback rates to GPT-5 IDs. [A4-01, A4-02, H-08, H-10]

Target flow:

```text
Onboard: 1 structured profile/readback call
Seek: 1 structured state call per user answer, maximum 3 user turns
Learn: 1 retrieval + 1 structured lesson-stack call
Act: deterministic transform/validation; model only if script needs generation
Report: deterministic write + optional 1 extraction/anonymization call
```

This cuts routine fan-out from roughly 4-7 model operations to 1-2 per product step. Dollar cost remains UNVERIFIED until official model pricing and real usage aggregates are available. [A4-01, A4-09, H-10]

Required lesson JSON: `lesson_id`, `kind`, `author`, `source_id`, `chunk_ids`, `book_title`, `chapter_or_location`, `argument`, `founder_connection`, `action`, `follow_up_taps[]`, and for founder voices `peer_outcome_id`. Server must verify IDs and strip unsupported attribution. [A4-05, A4-06, H-14]

## 8. Knowledge readiness

Author lessons are only partly possible now. The system can retrieve stored passage text, title, author and pillar. It cannot prove chapter/page/location, and its RPC provenance is incomplete. Add edition/source identity plus chapter, section, page and offsets per chunk; pass source/chunk IDs through retrieval and validate citations server-side. [A5-02, A5-03, H-14]

The six pillars are ready to carry early Learn. Market-aware lessons are not: source rows have no country, market or language tags. Founder voices need a separate consented peer-outcome corpus, not ad hoc podcast classification. Deployed counts and the claimed 1,760 concepts remain UNVERIFIED. [A5-05, A5-09, A5-10, H-02]

## 9. Ranked risks

1. **High: product mismatch.** Building on Brain/Chat deepens the wrong shell. [A2-01, A2-02]
2. **High: missing/unknown schema and RLS state.** Main base schema is absent; knowledge-project live policy is unknown. [A3-01, A3-04]
3. **High: client-owned critical writes.** Sessions/messages and state mutation bypass server validation. [A3-02]
4. **High: peer privacy not designed.** No consent snapshot, anonymization boundary or identity isolation exists. [A3-03, A6-10]
5. **Medium: unsupported attribution.** No chapter/location provenance. [A5-02, H-14]
6. **Medium: AI cost/latency fan-out.** Many calls and oversized prompts; cost accounting is unreliable. [A4-01, A4-02, H-08]
7. **Medium: silent state loss.** Multiple user-state paths swallow failures. [A7-08]
8. **Medium: stale product authority.** Architecture, design, brand and agent guidance mandate old behavior. [H-04]
9. **Low now: operational logs.** Raw provider/database errors may expose internals. [A7-09]

## 10. Build order to December 1

**Sep 29-Oct 5:** Freeze the new contracts. Dump both schemas read-only; decide report timing, consent, unlock and intro rules. Rewrite runtime/product docs. Add focused unit tests around experiment validation and state transitions. [A3-01, H-04, A7-07]

**Oct 6-12:** Add founder profile and seek schema/API. Move onboarding/session/message writes behind server endpoints. Add explicit fields and text-only Seek first. [A2-03, A3-02, A3-03]

**Oct 13-19:** Ship Read Back and Seek end to end. Enforce at most two follow-ups in persisted state. Instrument corrections and completion rate. [A4-03, A4-04]

**Oct 20-26:** Add chunk provenance fields and structured lesson contract. Build a simple lesson stack using six pillars; no founder voices yet. [A4-05, A5-02, A5-05]

**Oct 27-Nov 2:** Build separate Act screen around existing validator/API. Add draft, prep checklist, script and explicit commit. [A6-01, A6-02]

**Nov 3-9:** Build Report screen with Done/Couldn't/Didn't and text note. Add report-due scheduler/event; test timezone semantics. [A6-03, A6-04]

**Nov 10-16:** Add browser voice capture/transcription for onboarding, Seek and Report. Keep text fallback. Build consent snapshot and anonymization pipeline behind a flag. [A2-08, A3-03]

**Nov 17-23:** Build give-to-get and basic peer matching by stage, customer market and business model. Serve anonymized founder cases; defer intros. [A6-10]

**Nov 24-Dec 1:** User testing and hardening. Remove Brain/live/artifact/warning front-door code after replacement navigation works. Fix observed loop drop-offs; audit RLS and privacy; no new features. [A7-02, A7-03, A7-04, A6-06]

## 11. Portability

Expo is the lower-cost mobile path because the product is already React/JavaScript. Reuse pure parsing, validators and API contracts after extracting them from UI files. Rewrite CSS screens, browser storage/auth adapters, audio capture, DOM artifacts and Three.js. With Brain/artifacts removed, the rewrite shrinks materially. SwiftUI requires a full UI/state/network rewrite and reimplementation of JavaScript-only helpers; only contracts and behavior can be shared. [A2-09, A2-10, A1-01]

Build the web loop first with server-owned contracts. A mobile client should consume those APIs; it should not port `Chat.jsx` or browser Supabase writes. [A1-02, A3-02]

## 12. Founder decisions

1. Does Read Back replace Welcome, and can founders correct or reject a detected pattern?
2. What exact fields/options define stage, customer market and business model globally?
3. What counts as the one concrete detail that ends Seek?
4. Must every author lesson have chapter/page provenance, or is book-level attribution acceptable temporarily?
5. What qualifies a founder voice as “one stage ahead”?
6. What local time triggers Report, and which notification channel is allowed?
7. Does Couldn't automatically offer a replacement experiment?
8. How many founder cases does one report unlock, and for how long?
9. Is sharing consent per report, persistent with review, or both; how does withdrawal work?
10. What anonymization standard and human review threshold are required before a peer outcome is served?
11. What event permits an intro, and must both founders opt in for each introduction?
12. Expo or web-only through December 1?

## Handoffs

- Product/design: replace Brain-first, premium and closure-warning guidance in `PRODUCT.md`, `DESIGN.md`, `BRAND.md`, `CLAUDE.md` and `ARCHITECTURE.md`. [H-04, H-13]
- Data/security: obtain read-only dumps of both Supabase projects before schema or removal work. [A3-01, A3-04]
- AI/knowledge: define provenance and lesson JSON before rebuilding Learn. [A4-05, A5-02, H-14]

## Open questions

Live schemas/policies/counts, deployed hosting config, actual model billing, source licenses, market bias, notification mechanics and peer-consent rules remain UNVERIFIED. The exact decisions needed are listed above.

## Coverage

This final report incorporates A1-A7 and the two-round head cross-check. All application, server, migration, script, config and root guidance files were read or targeted by full symbol/import/schema searches. Every folder was inventoried. Vendor trees, compiled output, virtual environment files, generated backup bodies, binary Brand Kit assets and copyrighted source PDFs were skipped for stated reasons; tracked status and ownership were checked. No runtime, build, migration, database or external API command was executed.
