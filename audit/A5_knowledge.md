# A5: Knowledge and learning

## Findings

- **A5-01. The claimed 127-source/1,760-concept corpus cannot be verified from the repository.** Local `sources` contains 100 PDFs and 8 transcript text files; concepts live only in Supabase. Generated backup JSON exists but is not authoritative deployed state. **UNVERIFIED:** need read-only counts from `wiki_sources`, `wiki_chunks` and `source_learning_maps`. Evidence: `sources:1` repository inventory; `scripts/generate_learning_maps.js:90-123`, `supabase/migrations/20260511000002_axiom_knowledge_schema.sql:72-100`.
- **A5-02. Exact chapter/location attribution is impossible with the current chunk schema.** Chunks store pillar, content type, title, author, text, embedding, index and source ID. There is no page, chapter, section, edition or character offset. Evidence: `supabase/migrations/20260511000002_axiom_knowledge_schema.sql:48-59`.
- **A5-03. Retrieval can return exact stored passage text, title and author, but not exact book location.** `match_wiki_chunks` returns `key_frameworks` plus title/author/similarity; source enrichment adds claims and interpretation, not page provenance. Evidence: `supabase/migrations/20260511000002_axiom_knowledge_schema.sql:102-147`, `src/lib/rag.js:707-857`, `src/lib/rag.js:1151-1233`.
- **A5-04. Chunking is fixed at 450 words with 50-word overlap.** Embeddings use `text-embedding-3-small` at 1536 dimensions and HNSW cosine indexing (`m=16`, `ef_construction=64`). Evidence: `seed.js:1339-1367`, `seed.js:2005-2035`, `supabase/migrations/20260511000002_axiom_knowledge_schema.sql:48-64`.
- **A5-05. The six pillars are real source-level and chunk-level metadata.** Seed records assign a pillar; chunks copy it; sources and retrieval index/filter it. Evidence: `seed.js:1602-1605`, `seed.js:2025-2033`, `supabase/migrations/20260511000002_axiom_knowledge_schema.sql:12-18`, `supabase/migrations/20260511000002_axiom_knowledge_schema.sql:48-54`.
- **A5-06. Learning states affect prompts but are model-inferred, not demonstrated mastery.** Concepts are generated from source excerpts; post-response AI labels transitions among encountered/partial/absorbed and writes them. The user does not explicitly complete an assessment. Evidence: `scripts/generate_learning_maps.js:112-211`, `src/lib/rag.js:934-1015`, `src/lib/rag.js:1017-1149`.
- **A5-07. Personal wiki is not only decorative, but its main consumer is the out-of-core Brain.** Memory and experiment updates sync nodes/edges; Brain renders them and Chat can inject a selected node. Evidence: `server/index.js:1269-1326`, `src/lib/personalWiki.js:1-495`, `src/pages/Brain.jsx:928-1445`, `src/pages/Chat.jsx:1689-1695`.
- **A5-08. Retrieval is overbuilt for the new early product.** A turn can classify mode, embed, search multiple pillars, expand the query, fetch sources/concepts/states, optionally live-search, format interpretations and cache results before the answer. Evidence: `src/lib/rag.js:430-930`, `src/pages/Chat.jsx:1532-1631`.
- **A5-09. There is no market/country metadata.** `wiki_sources` has pillar/content/source metadata and date/quality, but no geography, market, language or applicability tags. Global/market-aware lessons cannot be filtered reliably. Evidence: `supabase/migrations/20260511000002_axiom_knowledge_schema.sql:12-33`.
- **A5-10. Founder voices are not a first-class knowledge type.** Some podcast/transcript sources contain founder stories, but there is no stage, customer market, business model, consent, anonymization or outcome metadata needed to place a founder one stage ahead. Evidence: `seed.js:1326-1333`, `supabase/migrations/20260511000002_axiom_knowledge_schema.sql:12-33`.
- **A5-11. Market-bias share is UNVERIFIED.** Titles and seed definitions include many US-centric business sources, but neither rows nor local files carry market tags, so a defensible percentage cannot be calculated. Need a source-level manual coding/export. Evidence: `seed.js:1-1337`, `supabase/migrations/20260511000002_axiom_knowledge_schema.sql:12-33`.

## Library and ingestion

Local corpus inventory: 100 PDF files across six pillar folders, 8 transcript `.txt` files, 42 `.gitkeep` placeholders and 8 `.DS_Store` files. The seed pipeline fetches/extracts sources, cleans text, chunks at 450/50 words, generates embeddings, upserts source metadata and inserts chunks. Auxiliary scripts enrich source claims, generate concept maps, migrate to the separate project, curate core sources, integrity-check and prune archives. Evidence: `seed.js:1339-1367`, `seed.js:1541-1699`, `seed.js:2005-2162`, `scripts/enrich_wiki_sources.js:216-338`, `scripts/generate_learning_maps.js:90-259`, `scripts/migrate_axiom_knowledge.js:179-412`.

Retrieval path:

```text
user text -> routeQuestionMode (AI JSON/fallback) -> query embedding
 -> match_wiki_chunks RPC, potentially per pillar -> optional query expansion
 -> fetch wiki_sources -> fetch source_learning_maps + user_concept_states
 -> format chunk/source/learning context -> main response prompt
 -> post-response AI concept transition -> server upsert
```

Evidence: `src/lib/rag.js:430-620`, `src/lib/rag.js:675-930`, `src/lib/rag.js:934-1149`.

## Readiness for new Learn

Attributed lessons are **partially possible**: exact stored passage, source title, author and pillar are available. Exact book chapter/page/location is not. Required work: preserve extraction provenance per chunk; add edition/ISBN where applicable; store chapter/section/page/start/end; make lesson output cite source/chunk IDs; validate every attribution server-side; tag country/market/language/personal-life applicability; and model founder outcomes separately with consent and anonymization.

## Cross area notes

- A3: add provenance, geography and peer-outcome schema plus knowledge-project RLS.
- A4: structured lesson output must reference source and chunk IDs, not free-text citations.
- A6: report outcomes should feed a consented peer corpus, not the canonical author library directly.
- A7: personal wiki, live search, RSS and graph-specific enrichment are out-of-core removal candidates.

## Open questions

- **UNVERIFIED:** deployed counts (127 sources, 1,760 concepts), missing/failed enrichments and chunk integrity. Need read-only database queries.
- **UNVERIFIED:** copyright/licensing rights for the 100 local PDFs and derived chunks. Need source/license records.
- **UNVERIFIED:** source quality and US-market percentage. Need a row export and manual coding rubric.

## Coverage

Read the complete knowledge schema migration; all retrieval stages in `src/lib/rag.js`; chunking/embedding/source metadata sections in `seed.js`; all knowledge maintenance scripts; filenames and counts under every `sources` subfolder; all local transcript files were inventoried by name. Skipped reading full copyrighted PDF/transcript contents because the pass concerns system metadata and provenance, not summarizing source works; binary PDFs cannot establish deployed row state. Skipped generated backup JSON bodies because they are non-authoritative snapshots; files were inventoried.
