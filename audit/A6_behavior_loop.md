# A6: Behavior loop

## Findings

- **A6-01. Experiment quality validation is the strongest reusable core.** The same deterministic validator is imported client-side and enforced server-side. It requires a `whether` hypothesis, specific action verb, non-hypothetical real-world example, binary success condition, real-world anchor and token overlap between hypothesis and success. Evidence: `server/experimentQuality.js:1-194`, `src/lib/experimentQuality.js:1-4`, `server/index.js:1486-1494`.
- **A6-02. Act is generated and committed implicitly inside chat.** A parsed model payload is posted immediately; there is no separate review screen, prep checklist or explicit Commit action. Evidence: `src/pages/Chat.jsx:1852-1999`, `src/pages/Chat.jsx:2138-2174`, `src/components/ExperimentCard.jsx:46-122`.
- **A6-03. Report is reactive chat, not an evening check-in.** The only automatic check-in occurs every third assistant message while an experiment is active. There is no clock, job, push/email notification or evening route. Evidence: `src/pages/Chat.jsx:1654-1666`, `src/lib/sessionReads.js:1-85`, repository search across `server`, `src`, `vercel.json` for cron/scheduler/reminder definitions found none.
- **A6-04. Done/Couldn't/Didn't exists semantically but not as the required UI.** Text heuristics classify reports; status stores completed/cancelled and `outcome_reason` stores `couldnt|didnt|ghosted`. The card buttons are Report/Done/Cancel, not Done/Couldn't/Didn't, and no voice/text note field is attached to the card. Evidence: `src/pages/Chat.jsx:573-655`, `src/components/ExperimentCard.jsx:94-111`, `supabase/migrations/20260508000002_experiment_outcome_reason.sql:1-12`.
- **A6-05. Ghosting and warning enforcement runs only when Chat loads.** Expired active experiments are marked ghosted in browser code, counters increment, and warning levels change at 2 lifetime/3 consecutive and 4 lifetime/5 consecutive misses. No backend scheduler guarantees timely processing. Evidence: `src/pages/Chat.jsx:791-918`, `src/pages/Chat.jsx:1022-1116`.
- **A6-06. Account closure is documented but not implemented.** UI copy threatens permanent removal at warning level 2, while no route or current code removes users. The product direction explicitly puts this out of core, so the remaining threat copy and prompt logic should be removed. Evidence: `src/components/WarningCard.jsx:1-16`, `src/lib/openai.js:2009-2022`, `ARCHITECTURE.md:1246-1268`.
- **A6-07. Couldn't and Didn't have materially different side effects.** Couldn't cancels without strike/pattern; Didn't records a high-importance avoidance memory. Ghosted increments warning counters. Evidence: `src/lib/openai.js:1812-1827`, `src/pages/Chat.jsx:2184-2370`, `src/lib/personalMemory.js:167-195`.
- **A6-08. Outcomes feed memory/wiki but not a peer learning system.** Avoidance/resistance creates embedded personal pattern memories and syncs the personal wiki; there is no anonymization, consent, match or unlock write. Evidence: `src/lib/personalMemory.js:143-225`, `src/pages/Chat.jsx:2240-2368`, `server/index.js:1269-1326`.
- **A6-09. Onboarding data is used, but diffusely.** Answers and generated profile enter openings/readbacks and the large system prompt; pillar weights bias profile context. There is no normalized market/stage matching. Evidence: `src/lib/openai.js:289-446`, `src/lib/openai.js:1518-2038`.
- **A6-10. Give-to-get is missing.** No report-based unlock state, founder-case gate or next-stack mechanism exists. Evidence: `src/App.jsx:118-150`, experiment schema `supabase/migrations/20260505000006_experiment_status_actions.sql:1-23`, all API routes `server/index.js:269-280`, `server/index.js:857-1860`.

## Experiment lifecycle

```text
AI emits <experiment> JSON
 -> Chat parses and server validates
 -> experiments row: active, due_at = assigned + window
 -> user reports in chat OR browser notices expiry on next Chat load
 -> completed/cancelled/ghosted status + optional outcome/outcome_reason
 -> selected counters reset/increment
 -> optional personal pattern memory and wiki sync
```

Evidence: `src/pages/Chat.jsx:134-161`, `server/index.js:1448-1650`, `src/pages/Chat.jsx:791-918`, `src/pages/Chat.jsx:2138-2370`.

Validator rules: hypothesis required and includes “whether” plus a substantive claim (`159-168`); action contains approved verb and excludes reflection (`169-171`); real-world example rejects hypothetical language (`172-174`); success is <=260 chars, <=2 terminators, and contains binary evidence (`119-128`, `175-177`); action/example/success names entity/channel/metric (`105-117`, `178-180`); hypothesis and success share a significant token (`130-146`, `181-186`). All cited ranges are in `server/experimentQuality.js`.

## New-loop map

| Step | Status | Required change |
|---|---|---|
| Onboard | EXISTS BUT NEEDS CHANGE | Normalize missing founder context; add voice |
| Read Back | EXISTS BUT NEEDS CHANGE | Make pattern read durable, evidence-based and revisable |
| Seek | EXISTS BUT NEEDS CHANGE | Dedicated state; max two follow-ups; stop on situation + detail |
| Learn | MISSING | Structured attributed lessons and stage-ahead founder voices |
| Act | EXISTS BUT NEEDS CHANGE | Separate screen; mission, script, prep checklist, explicit commit |
| Report | EXISTS BUT NEEDS CHANGE | Evening trigger; three exact choices; voice/text note |
| Peer Map | MISSING | Consent, anonymization, outcome corpus, matching and rare intro flow |
| Global/free | PARTIAL | No active paywall code; market context absent; docs still describe payment |
| Chat behind tap | EXISTS BUT NEEDS CHANGE | Guarded behind Brain today; move behind new core screens |

## Needed behavior

Use server-owned state transitions: `seek.collecting -> seek.ready -> lessons.ready -> experiment.draft -> committed -> report_due -> reported`. Store `follow_up_count <= 2`. A scheduler should create evening report-due events and notification intents; clients should render them, not infer deadlines. Report submission should atomically write result/note, create consent-scoped anonymization work, and unlock matched founder cases. Matching should filter by stage, customer market and business model before ranking. Intros require separate per-intro opt-in from both sides.

## Cross area notes

- A2: separate Act/Report screens and voice controls are required.
- A3: peer consent, report, unlock and matching tables are absent.
- A4: seek stopping and pattern detection need code/state enforcement.
- A7: closure warnings, weekly read and graph sync are out-of-core weight.

## Open questions

- **UNVERIFIED:** desired local evening time, timezone behavior and notification channel.
- **UNVERIFIED:** whether “Couldn't” should create a replacement experiment automatically.
- **UNVERIFIED:** peer-case unlock quantity/duration and consent withdrawal behavior.

## Coverage

Read full experiment validators; experiment schemas/routes; all Chat experiment creation, report, cancellation, ghost and warning paths; ExperimentCard and WarningCard; memory/wiki outcome side effects; weekly/app session code; prompt experiment rules; product/architecture warning descriptions. Skipped runtime execution because it would write database rows; no scheduler configuration exists in the repository to inspect.
