# Head review

## Round 1: contradictions, gaps, weak claims

- **H-01 CORRECTED (A7-11).** `dist`, both `node_modules` trees, `.venv`, `scripts/output` and Brand Kit are present locally but have zero tracked files. They are workspace weight, not repository history. `sources` has 82 tracked files. A7-11 was imprecise. Evidence: `.gitignore:1-80`, `scripts/prune_knowledge_archives.js:174-195` (backup creation), `git ls-files` review; tracked source definitions are in `seed.js:55-1337`.
- **H-02 CORRECTED (A5-01).** Local file inventory is 100 PDFs and 8 transcript text files, but only 82 source-path files are tracked. This does not prove deployed source count. A5-01's conclusion is right; its `sources:1` citation was not a valid line citation. Use the ingestion catalog `seed.js:55-1337`, transcript loader/fetch paths `seed.js:1714-1932`, and DB-only learning-map reads `scripts/generate_learning_maps.js:90-123` as code evidence; treat the file counts as a HEAD JUDGMENT from repository inventory.
- **H-03 CORRECTED (A2-08).** No audio implementation is visible in onboarding or Chat, and no audio/transcription route exists. The conclusion is right; the synthetic `src:1` citation was invalid. Evidence: input rendering `src/pages/Onboarding.jsx:340-385`, `src/pages/Chat.jsx:2571-2679`, route inventory `server/index.js:269-280`, `server/index.js:857-1860`.
- **H-04 CORRECTED (A1-01/A7-10).** Staleness extends beyond `ARCHITECTURE.md` and `PRODUCT.md`: `CLAUDE.md` mandates Brain-first behavior and warning enforcement, `DESIGN.md` defines Founder Brain as Screen 1, and `BRAND.md` treats Brain snapshots as a growth loop. The code and all old guiding documents point in the old direction. Evidence: `CLAUDE.md:50-79`, `CLAUDE.md:169-190`, `DESIGN.md:556-799`, `DESIGN.md:852-944`, `BRAND.md:230-246`, `BRAND.md:792-809`.
- **H-05 HEAD JUDGMENT (A6-05/A6-06).** Code warning thresholds conflict with product documentation. Code raises warning 1 at 2 lifetime ghosts or 3 consecutive misses and warning 2 at 4 lifetime or 5 consecutive; old product prose says two consecutive, then two more. No closure code exists. For actual behavior, A6-05 is right and docs are wrong. Evidence: `src/pages/Chat.jsx:791-918`, `PRODUCT.md:411-461`, `server/index.js:269-280`, `server/index.js:857-1860`.
- **H-06 HEAD JUDGMENT (A2-04/A4-03).** “Read Back exists” and “pattern detection is mostly prose” are compatible. There is a one-time readback UI, but not the evidence-backed durable pattern engine required by the new direction. Both findings stand. Evidence: `src/pages/Welcome.jsx:81-164`, `src/lib/openai.js:289-377`, `src/lib/personalMemory.js:143-257`.
- **H-07 HEAD JUDGMENT (A3-04).** Client knowledge reads and absent checked-in knowledge RLS are not proof of a deployed exposure. The risk remains UNVERIFIED because the separate project's live policies may differ. A3-04 is correctly qualified. Evidence: `src/lib/knowledgeSupabase.js:1-18`, `supabase/migrations/20260511000002_axiom_knowledge_schema.sql:12-153`.
- **H-08 CORRECTED (A4-09).** The logger definitely applies fallback pricing to unlisted GPT-5 IDs; calling that “underpricing” assumes current external prices. Correct statement: stored estimates price GPT-5 calls *as if* they were GPT-4.1-mini and therefore cannot be treated as actual billing. Evidence: `server/index.js:47-54`, `server/index.js:83-88`, `server/index.js:144-188`.

Coverage gaps found and resolved: root guidance/docs (`CLAUDE.md`, `DESIGN.md`, `BRAND.md`, existing `audit.md`); `.gitignore`; Brand Kit guide/start file and asset inventory; `dist`/local environment tracked status; `.claude` inventory; source tracking status. Brand/design docs reinforce the old Brain-first direction (H-04). Existing `audit.md` is a prior report, not executable source. Binary brand exports and compiled/vendor environments contain no auditable runtime logic.

## Round 2: remaining contradictions and weak evidence

- **H-09 CORRECTED (A1 environment list).** `SHOULD_LOG_PROMPT_MODULES` is a source constant, not an environment variable. The A1 list did not include it and is correct. A script references `VITE_KNOWLEDGE_SUPABASE_SERVICE_ROLE_KEY`, while documented production uses `KNOWLEDGE_SUPABASE_SERVICE_ROLE_KEY`; flag remains valid. Evidence: `src/lib/openai.js:982-993`, `scripts/smoke.test.js:27-30`, `.env.example:10-16`.
- **H-10 HEAD JUDGMENT (A4 cost).** Token ranges are order-of-magnitude planning estimates, not measured facts. Prompt character budgets are verified, but actual filled prompt length and outputs vary. Final report will not present a precise per-founder dollar amount. Evidence: `src/lib/openai.js:1087-1110`, `src/pages/Chat.jsx:1722-1740`, `server/index.js:169-190`.
- **H-11 HEAD JUDGMENT (A7 dependency candidates).** `react-is`, root `express-rate-limit` and `@types/three` lack direct source imports, but lockfile peer/transitive behavior was not executed. Keep them in “verify then remove,” not “safe now.” Evidence: `package.json:24-43`, `server/package.json:10-17`.
- **H-12 CORRECTED (A3-06).** PostgreSQL `FOR ALL` owner policies are broad, but absent explicit `WITH CHECK` is not itself evidence of an insert bypass because PostgreSQL can apply `USING` as the check. The finding is about excess client capability, not cross-user access. Evidence: `supabase/migrations/20260505000002_add_rls_policies.sql:1-31`, `supabase/migrations/20260505000005_messages_reads_rls.sql:1-21`.
- **H-13 HEAD JUDGMENT.** No pass found an implemented paywall. Payment exists only in stale architecture/product documents; “free for now” requires removing those promises/docs, not dismantling billing code. Evidence: `ARCHITECTURE.md:1582-1611`, `PRODUCT.md:464-492`, executable routes `src/App.jsx:118-150`, `server/index.js:269-280`.
- **H-14 CORRECTED (A5-03).** The RPC returns passage text/title/author but not `source_id`, `chunk_index`, or source URL in its declared return table. Later client joins can recover source metadata only if chunk rows contain source IDs through the client query path. Lesson provenance should be passed explicitly, not inferred from title/author. Evidence: `supabase/migrations/20260511000002_axiom_knowledge_schema.sql:102-147`, `src/lib/rag.js:707-857`.

After two rounds, no unresolved contradiction changes the core conclusion: this is a working old-product prototype with useful experiment and RAG assets, not an implementation of the new loop.

## Cross area notes

- Final: use corrected wording from H-01, H-02, H-03, H-08, H-12 and H-14.
- Final: do not claim a deployed security exposure, exact source count, exact model bill or installed-dependency safety without external evidence.

## Open questions

- Live database schemas/policies/counts, hosting settings, production model costs, source licensing, notification channel/timezone and peer-consent product rules remain unresolved because required systems were out of bounds.

## Coverage

Re-read `audit/A1_architecture.md` through `audit/A7_dead_weight.md`; compared their coverage to every path from `rg --files` and `git ls-files`; re-read `CLAUDE.md`, `DESIGN.md`, `BRAND.md`, existing `audit.md`, `.gitignore`, package/config files and key corrected source ranges. Inventoried all folders and assets. Skipped full bodies of vendor dependencies, compiled `dist`, virtual environment, generated backup JSON, binary Brand Kit exports and copyrighted source PDFs; reasons are vendor/generated/binary/content corpus rather than executable or policy source. No file or folder was silently skipped.
