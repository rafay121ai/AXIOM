# A2: Frontend and UX

## Findings

- **A2-01. The frontend still makes the out-of-core brain graph the home screen.** Returning users are forced to `/brain`; Chat can only be entered with transient router state from Brain. Evidence: `src/App.jsx:36-60`, `src/App.jsx:132-149`, `src/pages/Onboarding.jsx:141-168`, `src/pages/Brain.jsx:1440-1445`.
- **A2-02. The new loop has no screen architecture.** Routes are only onboarding, auth callback, welcome, brain and chat. There are no dedicated Read Back, Seek, Learn, Act, Report or Peer Map screens. Evidence: `src/App.jsx:118-150`.
- **A2-03. Onboarding has the required 7 tap + 3 open count, but open answers are text-only and key founder context is absent.** The question list has seven `tap` and three `text` entries. It captures stage indirectly, but has no country, customer location/market, business model, explicit goal or deadline field and no voice control. Evidence: `src/pages/Onboarding.jsx:8-82`, `src/pages/Onboarding.jsx:326-385`.
- **A2-04. Read Back exists only as a one-time generated welcome sentence.** It is client-generated from `onboarding_answers` and `axiom_profile`, cached in localStorage, then bypassed forever after the welcome flag. It is not a durable pattern record or a first-class step. Evidence: `src/pages/Welcome.jsx:7-35`, `src/pages/Welcome.jsx:81-164`, `src/lib/openai.js:323-379`.
- **A2-05. Seek's stopping contract is not represented in UI state.** Chat accepts an unlimited sequence. It has incident-detection heuristics, but no per-seek follow-up counter and no hard stop after two questions. Evidence: `src/pages/Chat.jsx:711-766`, `src/pages/Chat.jsx:1212-2113`, `src/pages/Chat.jsx:2571-2679`.
- **A2-06. Learn is free-form chat plus optional artifacts, not attributed lesson stacks.** Message rendering supports prose, artifacts and experiment cards, but there is no lesson component/schema with author, exact book, chapter, founder connection, action and in-place tap follow-ups. Evidence: `src/pages/Chat.jsx:1852-1963`, `src/pages/Chat.jsx:2684-2783`, `src/components/MessageBubble.jsx:129-288`, `src/components/ArtifactRenderer.jsx:1913-1929`.
- **A2-07. Act and Report are embedded in Chat.** Experiment cards expose Report, Done and Cancel. There is no mission/prep/commit screen and no evening Done/Couldn't/Didn't voice-or-text report UI. Evidence: `src/components/ExperimentCard.jsx:46-122`, `src/pages/Chat.jsx:2138-2370`.
- **A2-08. There is no audio capture or transcription frontend.** No `MediaRecorder`, microphone permission, audio input or transcription call appears in `src`. Evidence: `src/pages/Onboarding.jsx:340-385`, `src/pages/Chat.jsx:2571-2679`, repository search across `src:1` for `MediaRecorder|transcri|microphone|getUserMedia` returned no implementation.
- **A2-09. Three.js is deeply embedded in a 1,700-line page but removable at the route boundary.** `Brain.jsx` owns graph data fetching, Three renderer, camera, bloom, labels, gestures, navigation and account/thread UI. Removing the route also removes access to chat and thread selection, so those controls must move first. Evidence: `src/pages/Brain.jsx:1-12`, `src/pages/Brain.jsx:928-1087`, `src/pages/Brain.jsx:1088-1445`, `src/pages/Brain.jsx:1446-1699`.
- **A2-10. Frontend logic is concentrated in oversized components.** `Chat.jsx` is 2,821 lines, `ArtifactRenderer.jsx` 1,929 and `Brain.jsx` 1,700. Chat owns parsing, routing, RAG orchestration, persistence, experiment state, memory and rendering. Evidence: `src/pages/Chat.jsx:1-2821`, `src/components/ArtifactRenderer.jsx:1-1929`, `src/pages/Brain.jsx:1-1700`.
- **A2-11. The design system is partly centralized but implementation is ad hoc.** Global CSS defines color/font/radius tokens and mobile media rules, but pages use raw class-heavy global styles and some inline styling. No reusable input/button/layout primitives exist. Evidence: `src/styles/global.css:2-46`, `src/styles/global.css:93-467`, `src/pages/Onboarding.jsx:389-392`.
- **A2-12. Mobile has explicit breakpoints, but the main experience is pointer/canvas-heavy.** Onboarding and chat have responsive rules; Brain detects coarse pointers and uses full-window WebGL plus custom gesture handling. This is mobile-aware, not verified mobile-ready. Evidence: `src/styles/global.css:384-434`, `src/pages/Brain.jsx:83-84`, `src/pages/Brain.jsx:1088-1317`.

## Screens and components

| File | User surface / state / calls |
|---|---|
| `src/pages/Onboarding.jsx` | Google sign-in, 10 questions, local answer state; direct user/session writes; profile AI call (`97-283`) |
| `src/pages/AuthCallback.jsx` | Exchanges OAuth code, restores session token, routes to Brain (`5-57`) |
| `src/pages/Welcome.jsx` | One-time generated readback and suggested question; session/user reads (`74-212`) |
| `src/pages/Brain.jsx` | Three.js graph, weekly read, threads, account, text entry; DB and personal-wiki calls (`928-1699`) |
| `src/pages/Chat.jsx` | Entire conversational runtime and embedded experiment lifecycle (`921-2821`) |
| `MessageBubble.jsx` | Assistant/user prose, source references and copy/regenerate affordances (`129-288`) |
| `ExperimentCard.jsx` | Embedded experiment detail/actions (`46-122`) |
| `ArtifactRenderer.jsx` | Many interactive artifact renderers selected by type (`1913-1929`) |
| `OnboardingQuestion.jsx` | Simple tap-question component; unused (`1-28`) |
| `WarningCard.jsx` | Closure warning component; unused (`1-16`) |

State is React local state plus localStorage/sessionStorage caches. Supabase is the durable store. There is no global state library. Chat messages/session state live in `Chat.jsx`; onboarding answers in `Onboarding.jsx`; experiments are fetched through API then merged into chat messages; prompt/turn caches use `sessionTurnContext.js`. Evidence: `src/pages/Chat.jsx:921-966`, `src/pages/Onboarding.jsx:97-111`, `src/lib/sessionTurnContext.js:1-142`.

## New-loop reuse map

| Point | Verdict | Reuse/change/build |
|---|---|---|
| Onboard | EXISTS BUT NEEDS CHANGE | Keep sequencing and answer persistence shape; add voice and explicit founder context in `Onboarding.jsx` |
| Read Back | EXISTS BUT NEEDS CHANGE | Reuse `generateWelcomeRead`; make durable and first-class in new screen/service |
| Seek | EXISTS BUT NEEDS CHANGE | Extract input/streaming from `Chat.jsx`; add seek state and enforced stop |
| Learn | MISSING | RAG and `MessageBubble` are inputs; build structured lesson stack and inline tap answers |
| Act | EXISTS BUT NEEDS CHANGE | Reuse experiment validation/API/card data; build separate route and commit state |
| Report | EXISTS BUT NEEDS CHANGE | Reuse status endpoint; build evening screen, exact statuses and voice/text note |
| Peer Map | MISSING | No reusable UI beyond generic artifact charts |
| Global/free | PARTIAL | No paywall route; country/market localization missing |
| Chat behind tap | EXISTS BUT NEEDS CHANGE | Guard exists, but Brain is the tap source and Chat is still the core runtime |

## Portability

Business helpers in `src/lib` are plain JavaScript but many depend on browser storage, browser Supabase clients, DOM fetch and UI-owned orchestration. React Native/Expo could reuse parsing, experiment validation and pure routing helpers after extraction; screens, CSS, Three renderer, DOM artifact interactions and auth storage require rewrites. SwiftUI would reuse only contracts/algorithms conceptually. Evidence: `src/lib/experimentQuality.js:1-4`, `src/lib/sessionTurnContext.js:1-142`, `src/pages/Chat.jsx:34-918`, `src/components/ArtifactRenderer.jsx:298-322`, `src/pages/Brain.jsx:1088-1317`.

## Cross area notes

- A3: onboarding fields and peer consent/outcomes require schema changes.
- A4: Read Back and Learn need structured model outputs and enforceable seek state.
- A6: current report actions and warnings conflict with the new loop.
- A7: unused components and out-of-core renderers are removal candidates.

## Open questions

- **UNVERIFIED:** visual correctness and accessibility on physical mobile devices. Need browser/device testing, which this read-only pass did not run.
- **UNVERIFIED:** whether product intends Read Back to replace or extend the current Welcome page.

## Coverage

Read all files in `src/pages`, component interfaces and main render paths in every file under `src/components`, `src/App.jsx`, `src/main.jsx`, `src/styles/global.css`, and frontend state/data helpers under `src/lib`. Skipped pixel-by-pixel review of the 1,929-line artifact renderer and full CSS property-by-property inventory because artifact polish is explicitly out of core; all exports, stateful regions and use sites were inspected.
