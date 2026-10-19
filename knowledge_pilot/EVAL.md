# EVAL: old library (wiki_chunks) vs new lesson library

20 founder situations in a founder's own words (all six pillars, idea to scaling), 5 results from each library, 200 results scored blind by two sonnet subagents. Results were shuffled, unlabeled, and the scorers were never told two libraries existed. Raw data: `eval/situations.json`, `eval/retrieval.json`, `eval/scores_1.json`, `eval/scores_2.json`, key in `eval/blind_key_SECRET.json`.

## Result

| | Relevant | Partly | Irrelevant | Would genuinely help |
|---|---|---|---|---|
| Old (match_wiki_chunks, 1536 dims) | 26% | 45% | 29% | 40% |
| New (lessons, 512 dims, local cosine) | 19% | 50% | 31% | 25% |

Situations won on 'would help' count: old 9, new 4, tie 7. Rank-1 result helped: old 6/20, new 5/20.

Helpful results by pillar (situations per pillar: how_companies_win 5, move_people 4, human_mind 3, money_game 3, think_sharper 3, whats_coming 2; maximum is 5 per situation):

| Pillar | Old | New |
|---|---|---|
| how_companies_win | 15 | 6 |
| human_mind | 6 | 5 |
| money_game | 3 | 4 |
| move_people | 12 | 10 |
| think_sharper | 4 | 0 |
| whats_coming | 0 | 0 |

## Per situation (helpful results out of 5)

| # | Pillar | Stage | Old | New | Situation |
|---|---|---|---|---|---|
| 1 | how_companies_win | first customers | 1 | 1 | We built scheduling software for dental clinics. Three clinics love it... |
| 2 | how_companies_win | scaling | 2 | 1 | We went from 8 to 35 people in six months. Decisions I used to make in... |
| 3 | how_companies_win | early revenue | 3 | 0 | A big incumbent just shipped a free version of our main feature. We're... |
| 4 | human_mind | idea | 2 | 2 | I've worked on my startup idea nights and weekends for eight months. I... |
| 5 | human_mind | early growth | 3 | 0 | A client we'd chased for two years just rejected us and it wrecked me ... |
| 6 | money_game | pre-seed | 3 | 1 | A seed investor offered $1.2M at an $8M post-money but wants a 2x liqu... |
| 7 | money_game | personal | 0 | 2 | I make $140k at a startup and I'm thinking of leaving to build my own ... |
| 8 | move_people | fundraising | 4 | 4 | I'm pitching twelve investors next week. My deck is 28 slides, and las... |
| 9 | move_people | early growth | 5 | 0 | My biggest customer is 40% of revenue and wants a 30% discount at rene... |
| 10 | move_people | first customers | 2 | 5 | Our landing page says 'AI-powered workflow automation platform' and no... |
| 11 | think_sharper | early growth | 2 | 0 | We have to decide in two weeks whether to build the enterprise feature... |
| 12 | think_sharper | planning | 2 | 0 | My financial model says we hit $1M ARR in 14 months. Last year's model... |
| 13 | think_sharper | survival | 0 | 0 | We have 11 months of runway and one customer is 60% of revenue. If the... |
| 14 | whats_coming | existing business | 0 | 0 | I run a six-person agency doing content and support for ecommerce bran... |
| 15 | whats_coming | idea | 0 | 0 | I want to build software for AI agents in healthcare billing. Everyone... |
| 16 | how_companies_win | early growth | 4 | 1 | We're a project management tool in a crowded space. Our investors keep... |
| 17 | how_companies_win | scaling | 5 | 3 | I need to hire my first head of sales. I've never managed sales and I'... |
| 18 | human_mind | team | 1 | 3 | My cofounder and I have stopped talking about anything except tasks. I... |
| 19 | move_people | early growth | 1 | 1 | I need our best advisor to open five investor intros for us but he's b... |
| 20 | money_game | first customers | 0 | 1 | I charge $29 a month and have 400 customers who rarely complain. A fri... |

## What the numbers do and do not say

**New library did not beat the old one on this test.** 25% of its results would genuinely help against 40% for the old, and it won 4 situations against 9.

Reasons that are not a defect in the lesson quality itself, in order of weight:
1. **Coverage.** The old library holds 196 core sources, including essays, papers, podcasts and articles (Paul Graham, Acquired, Lenny's, Lex Fridman, shareholder letters and so on). The new library has 66 core books only; biographies, transcripts and every non-book source are deferred to save cost. Several situations (pricing, early customers, fundraising, category design) are served by sources the new library does not have.
2. **Granularity.** The unit is one narrow lesson, so the top 5 are five narrow tactics. In situation 9 (customer demands a 30% discount) three of the five new results are Voss lessons, the right book, but they are about anchoring and incremental offers, not about a big-customer renewal. The old library returns a whole-source framework summary, which the scorer read as more useful.
3. **Query shape.** A long first-person situation embedded against a short lesson card gives low similarity scores (0.45-0.50 top). No query rewriting was tried.
4. **Format asymmetry.** Old results were shown as the stored `key_frameworks` summary (about 2,600 characters per source); new results as one lesson card plus 900 characters of cited text. This favours the old side somewhat.
5. **Noise.** 20 situations, two scorers of the same model, strict 'helps' definition. A difference of a few situations is within noise; a 15-point gap on 100 results each is not obviously so.

**whats_coming scored 0 for both.** Neither library has material that helped on AI-timing or AI-agent questions.

## Recommendation

**Do not cut over to the new library as a replacement.** The data does not support it yet.

What the data does support:
- Keep `wiki_chunks` as the source for choosing which book or source to teach from.
- Use the lessons as a second layer: after a source is chosen, retrieve lessons *within that source* (or the top 3 sources) to supply cited paragraphs and the author attribution. This plays to the lessons' strength (verbatim cited text, named author, page range) and avoids their weakness (narrow tactics returned out of context). It is a small test to run: restrict the local search to the sources in the old top 5 and rescore the same 20 situations.
- Before any wider cutover, add a query-rewrite step and re-run this same eval, then process the deferred biographies and the non-book sources that the old library contains.

`sql/create_lessons.sql` and `upload_lessons.py` remain unrun. If the hybrid test passes, uploading is cheap: about 57-78 MB.
