# A4: AI layer and cost

## Findings

- **A4-01. One ordinary chat turn can trigger four model calls plus an embedding; artifact turns can trigger more.** Route classification, query embedding, optional query expansion, main streamed answer, concept-state classification, conditional memory update and artifact generation are separate operations. Evidence: `src/lib/rag.js:430-493`, `src/lib/rag.js:525-544`, `src/lib/rag.js:675-705`, `src/pages/Chat.jsx:1532-1561`, `src/pages/Chat.jsx:1752-1804`, `src/pages/Chat.jsx:2006-2041`.
- **A4-02. Prompt budgets are extremely large.** Code permits 25,000 characters for normal turns, 35,000 for learning, 45,000 for artifacts/accountability and 55,000 for live turns, before conversation history. At roughly four characters/token, those targets alone are about 6.25k, 8.75k, 11.25k and 13.75k input tokens. Evidence: `src/lib/openai.js:1087-1110`, `src/pages/Chat.jsx:1697-1729`.
- **A4-03. Pattern detection is mostly model prose, not a scored or testable subsystem.** Onboarding asks one model to state a dominant pattern/blind spot, Welcome asks another model to compress it, and later memory updates may create pattern records. No deterministic evidence set, confidence calibration, contradiction tracking or readback feedback is persisted. Evidence: `src/lib/openai.js:289-377`, `src/lib/openai.js:879-989`, `src/lib/personalMemory.js:143-257`.
- **A4-04. Seek stopping is prompt/heuristic behavior, not enforced workflow state.** Code classifies context and concrete incidents, but there is no follow-up counter capped at two. Evidence: `src/pages/Chat.jsx:711-766`, `src/lib/openai.js:1283-1304`, `src/pages/Chat.jsx:1212-1484`.
- **A4-05. The AI layer cannot produce the required lesson contract.** Existing structured JSON covers welcome reads, artifacts, route decisions, memory and concept states. No schema requires author, exact book, chapter/location, argument, founder connection, action and inline follow-ups as one lesson object. Evidence: `src/lib/openai.js:199-241`, `src/lib/openai.js:323-377`, `src/lib/openai.js:482-672`, `src/lib/rag.js:1017-1149`.
- **A4-06. Book attribution is presentation guidance, not provenance enforcement.** Prompt rules request book references, while retrieved chunks contain title/author but no chapter/location field. The model can therefore produce precise-looking chapter claims without a verifiable chunk location. Evidence: `src/lib/openai.js:1408-1434`, `supabase/migrations/20260511000002_axiom_knowledge_schema.sql:48-59`, `supabase/migrations/20260511000002_axiom_knowledge_schema.sql:102-147`.
- **A4-07. The generic/non-obvious/learning gates are split between code flags and prose.** Code resolves response mode and module inclusion; qualitative compliance remains prompt-only. Learning-state transitions are themselves decided by a model, then server-persisted. Evidence: `src/pages/Chat.jsx:383-565`, `src/lib/openai.js:996-1084`, `src/lib/openai.js:1218-1516`, `src/lib/rag.js:972-1149`.
- **A4-08. JSON reliability can multiply costs.** Structured requests retry once and then call a separate repair prompt; progressive artifacts can make repeated 220-token calls. Evidence: `src/lib/openai.js:169-241`, `src/lib/artifacts.js:200-276`.
- **A4-09. Usage accounting underprices every GPT-5 model.** Pricing only lists `gpt-4.1-mini` and embeddings; all GPT-5.2/5.4 calls use the cheaper fallback rate. Stored `estimated_cost_usd` is therefore not trustworthy unless those models happen to share that price. Evidence: `server/index.js:47-54`, `server/index.js:83-88`, `server/index.js:144-188`.
- **A4-10. Out-of-core behavior still consumes prompt space and calls.** Prompts include artifacts, live current search, brain node context, warning/closure behavior, weekly reads, jailbreak behavior and learning-map mechanics. Evidence: `src/lib/openai.js:446-878`, `src/lib/openai.js:996-1094`, `src/lib/openai.js:1338-1516`, `src/lib/openai.js:1562-1584`.

## Model call inventory

| Call | Model | Trigger / mode | Evidence |
|---|---|---|---|
| Profile | `gpt-5.2-2025-12-11` | Once after onboarding; JSON not enforced | `src/lib/openai.js:289-321` |
| Welcome read | `gpt-4.1-mini` | First welcome; JSON | `src/lib/openai.js:323-377` |
| Opening/brain/node messages | `gpt-5.4-mini-2026-03-17` | Screen/session entry; mixed streaming/nonstream | `src/lib/openai.js:381-480`, `src/lib/openai.js:743-878` |
| Weekly read | `gpt-4.1-mini` | Brain weekly read | `src/lib/openai.js:674-720` |
| Route classification | default GPT-5.4 mini | Most chat turns; JSON, 220 output cap | `src/lib/rag.js:430-493` |
| Query expansion | GPT-5.4 mini | Allowed retrieval turns; 150 cap | `src/lib/rag.js:675-705` |
| Embedding | `text-embedding-3-small` | Retrieval and memory | `src/lib/openai.js:276-286` |
| Main response | GPT-5.4 mini | Every normal chat message; streaming | `src/pages/Chat.jsx:1791-1839` |
| Artifact | GPT-5.4 mini | Routed artifact; JSON/streaming, sometimes progressive | `src/lib/openai.js:482-672`, `src/lib/artifacts.js:200-377` |
| Memory update | GPT-5.4 mini | Conditional post-turn; JSON, 500 cap | `src/lib/openai.js:879-989`, `src/pages/Chat.jsx:2023-2041` |
| Concept states | GPT-5.4 mini | Post-turn when concepts exist; JSON, 1600 cap | `src/lib/rag.js:1017-1149` |
| JSON repair | GPT-5.4 mini | After failed structured retries; 1200 cap | `src/lib/openai.js:169-241` |

## Cost estimate

Static estimate only; no API or production usage data was queried. Onboarding sends ten answers to the profile call, then the same answers plus profile to Welcome: roughly 900-1,600 input tokens and up to about 360 output tokens total. An ordinary chat turn has a 6.25k-character-budget floor for its system prompt (potentially about 6.25k tokens at the 25k-character target), up to ten history messages, a route call, one embedding, optional expansion, and post-turn classifiers. A plausible normal range is 7k-15k input tokens and 0.5k-3k output tokens across calls; learning/artifact/live turns can be materially higher. This is an estimate, not measured usage. Evidence: `src/lib/openai.js:289-377`, `src/lib/openai.js:1087-1095`, `src/pages/Chat.jsx:1697-1804`, output caps listed above.

Dollar cost is **UNVERIFIED** because current pricing for the dated GPT-5.2 and GPT-5.4-mini model IDs is not defined in the repository and external lookup was forbidden. The app currently calculates those calls at the `gpt-4.1-mini` fallback of $0.40/M input and $1.60/M output, which is not evidence of actual billing. Evidence: `server/index.js:83-88`, `server/index.js:144-149`.

## Five cuts

1. Merge route classification into a small deterministic router plus one structured main response; cut one call on routine turns.
2. Remove query expansion by default; vector-search the founder's original situation first.
3. Replace post-response concept classification with lesson completion events.
4. Run memory extraction once at Seek/Report boundaries, not opportunistically after chat turns.
5. Remove artifact/live/brain/warning modules from core prompts; target a compact per-step contract instead of 25k-55k characters.

## Cross area notes

- A3: lesson provenance needs chapter/location stored with chunks.
- A5: retrieval metadata sets a hard ceiling on attribution quality.
- A6: enforce follow-up count and report state in data/code, not prompt prose.
- A7: out-of-core prompt builders and artifact calls are removal candidates.

## Open questions

- **UNVERIFIED:** actual token/cost distribution by call type. Need read-only aggregate access to `model_usage_logs` after correcting GPT-5 pricing.
- **UNVERIFIED:** current provider pricing and availability for dated model IDs. Need official model/pricing lookup, forbidden during this audit.
- **UNVERIFIED:** quality of generated readbacks and lessons. Need an eval set and sampled outputs.

## Coverage

Read every OpenAI/embedding invocation in `src/lib/openai.js`, `src/lib/rag.js`, `src/lib/artifacts.js`, `src/pages/Chat.jsx`, `scripts`, and `server/index.js`; prompt assembly and `promptControl`; server allowlist, usage logging, retries/timeouts and structured parsing. Skipped live model calls and production usage rows because external API/database access is forbidden.
