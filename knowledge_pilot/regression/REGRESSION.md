# Regression: pilot chunks vs new library pipeline

Offline, no API calls. Source: the pilot PDFs. BEFORE = the pilot `chunks.jsonl` exactly as it was; AFTER = the new pipeline (generic extraction, rules-first chunking) with boundaries taken from the pilot's cached decisions. Both measured with `qa_check.py`.

Gate: flagged < 3% and median 200-450 words.

## Before and after

| Run | Chunks | Flagged | Median words | Gate | continuation_opener | no_terminal_punctuation | lead_in_at_end | under_150_words | over_700_unflagged | lost_hyphen | footnote_marker | figure_caption | epigraph_at_chapter_end | runin_heading_or_dateline | question_options_split |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| everything_store BEFORE | 309 | 87 (28.16%) | 357 | FAIL | 14 | 0 | 0 | 25 | 0 | 54 | 0 | 0 | 0 | 0 | 0 |
| everything_store AFTER | 291 | 0 (0.0%) | 377 | PASS | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| thinking_in_bets BEFORE | 250 | 143 (57.2%) | 189 | FAIL | 9 | 0 | 0 | 90 | 10 | 30 | 23 | 0 | 0 | 0 | 0 |
| thinking_in_bets AFTER | 193 | 0 (0.0%) | 307 | PASS | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |

## How boundaries were obtained (AFTER)

| Book | Oversized segments | Pilot seed hits | Exact cache hits | LLM calls | Rule fallbacks (cache miss) | Seeds unmatched | Rule splits | Merged continuation | Merged short |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| everything_store | 27 | 27 | 0 | 0 | 0 | 0 | 16 | 14 | 21 |
| thinking_in_bets | 51 | 51 | 0 | 0 | 0 | 3 | 18 | 8 | 77 |

Cache misses are handled by the rule split (paragraph boundary nearest the middle where a topic can start) and counted above. A zero means every oversized segment was covered by a pilot decision.

## Audit failures: old vs new

### everything_store_0001: lost line-break hyphen: 'sixthgrader'

- OLD: `...ng of River Oaks Elementary School, west of downtown Houston. The school’s principal chose a student to accompany her on the visit, an articulate, sandy-haired sixthgrader whose parents asked only that his real name not be used in print. So Ray called him Tim.  //  Tim, Julie Ray wrote in her book Turning On Bright Minds: A Parent Looks at Gifted Education in Texas, was “a student of general ...`
- NEW (everything_store_0001, 636 words): `...stled in a wing of River Oaks Elementary School, west of downtown Houston. The school’s principal chose a student to accompany her on the visit, an articulate, sandy-haired sixth-grader whose parents asked only that his real name not be used in print. So Ray called him Tim.  //  Tim, Julie Ray wrote in her book Turning On Bright Minds: A Parent Looks at Gifted Education in Texas, was “a student of general ...`
- NEW chunk opens: `In the early 1970s, an industrious advertising executive named Julie Ray became fascinated with an unconventional public-school program for `
- Fixed: yes

### everything_store_0084: opens on a continuation: 'But the deluge of spending...'

- OLD: `But the deluge of spending and the widening losses had fueled fear among Amazon’s management team—a fear that Bezos, still a young and volatile thirty-five-year-old CEO, needed additional help. And after hearing persistent grumbling from the rank...`
- NEW (everything_store_0078, 481 words): `...To mark the occasion, he took a photo of the group with his ever-present point-and-shoot digital camera and later taped the picture to the door of his office.  //  But the deluge of spending and the widening losses had fueled fear among Amazon’s management team—a fear that Bezos, still a young and volatile thirty-five-year-old CEO, needed additional help. And after hearing persistent grumbling from the rank...`
- NEW chunk opens: `In Amazon’s accounting group, the bean counters were working around the clock, and getting nervous. They tried to rationalize the numbers an`
- Fixed: yes

### everything_store_0186: opens on a continuation: 'And then Manber decided to leave.'

- OLD: `And then Manber decided to leave. Manber said he didn’t like running a remote office and felt isolated from the decision-making in Seattle. Privately, he was annoyed that Bezos had allowed Holden’s rival search effort to take root in Seattle. He told Be...`
- NEW (everything_store_0174, 404 words): `...But when Holden left, Bezos lost one of his oldest friends at the company and one of Amazon’s most versatile innovators. Fortunately, he still had Udi Manber.  //  And then Manber decided to leave. Manber said he didn’t like running a remote office and felt isolated from the decision-making in Seattle. Privately, he was annoyed that Bezos had allowed Holden’s rival search effort to take root in Seattle. He told Be...`
- NEW chunk opens: `Now everyone was in a difficult spot. Bezos came back and told Holden and Manber to form a joint team to evaluate the new approach. There ar`
- Fixed: yes

### thinking_in_bets_0223: footnote marker '*' spliced into the body: 'budgeting.* ASAS, founded...'

- OLD: `...ew years ago, I consulted with a national nonprofit organization, AfterSchool All-Stars (ASAS), to work with them on incorporating scenario planning into their budgeting.* ASAS, founded in 1992 by Arnold Schwarzenegger, provides three hours of structured after-school programming for over 70,000 underserved youth in eighteen cities across the United States. They depend heavily on grants fo...`
- NEW (thinking_in_bets_0178, 383 words): `A few years ago, I consulted with a national nonprofit organization, After-School All-Stars (ASAS), to work with them on incorporating scenario planning into their budgeting. ASAS, founded in 1992 by Arnold Schwarzenegger, provides three hours of structured after-school programming for over 70,000 underserved youth in eighteen cities across the United States. They depend heavily on grants for funding and ...`
- NEW chunk opens: `A few years ago, I consulted with a national nonprofit organization, After-School All-Stars (ASAS), to work with them on incorporating scena`
- Fixed: yes

### thinking_in_bets_0006: lost hyphens: 'shortyardage', 'third- or fourth-down'

- OLD: `...one-yard line. Everybody expected Seahawks coach Pete Carroll to call for a handoff to running back Marshawn Lynch. Why wouldn’t you expect that call? It was a shortyardage situation and Lynch was one of the best running backs in the NFL.  //  Instead, Carroll called for quarterback Russell Wilson to pass. New England intercepted the ball, winning the Super Bowl moments later. The headlines th...`
- NEW (thinking_in_bets_0004, 513 words): `...one-yard line. Everybody expected Seahawks coach Pete Carroll to call for a handoff to running back Marshawn Lynch. Why wouldn’t you expect that call? It was a short-yardage situation and Lynch was one of the best running backs in the NFL.  //  Instead, Carroll called for quarterback Russell Wilson to pass. New England intercepted the ball, winning the Super Bowl moments later. The headlines the next day...`
- NEW chunk opens: `One of the most controversial decisions in Super Bowl history took place in the closing seconds of Super Bowl XLIX in 2015. The Seattle Seah`
- Fixed: yes

## Context: BEFORE numbers for all ten pilot books

| Run | Chunks | Flagged | Median words | Gate | continuation_opener | no_terminal_punctuation | lead_in_at_end | under_150_words | over_700_unflagged | lost_hyphen | footnote_marker | figure_caption | epigraph_at_chapter_end | runin_heading_or_dateline | question_options_split |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| everything_store BEFORE | 309 | 87 (28.16%) | 357 | FAIL | 14 | 0 | 0 | 25 | 0 | 54 | 0 | 0 | 0 | 0 | 0 |
| how_the_world_really_works BEFORE | 403 | 257 (63.77%) | 146 | FAIL | 66 | 0 | 0 | 210 | 3 | 38 | 0 | 0 | 0 | 0 | 0 |
| laws_of_human_nature BEFORE | 928 | 416 (44.83%) | 209 | FAIL | 68 | 36 | 0 | 277 | 36 | 51 | 0 | 0 | 35 | 0 | 1 |
| lean_startup BEFORE | 289 | 142 (49.13%) | 203 | FAIL | 18 | 4 | 0 | 96 | 5 | 31 | 0 | 0 | 0 | 1 | 0 |
| never_split_the_difference BEFORE | 229 | 73 (31.88%) | 272 | FAIL | 4 | 2 | 2 | 46 | 12 | 17 | 0 | 0 | 0 | 1 | 0 |
| psychology_of_money BEFORE | 353 | 227 (64.31%) | 115 | FAIL | 28 | 0 | 0 | 217 | 0 | 7 | 0 | 0 | 0 | 1 | 0 |
| seven_powers BEFORE | 160 | 94 (58.75%) | 170 | FAIL | 5 | 20 | 2 | 71 | 1 | 8 | 0 | 15 | 0 | 0 | 0 |
| superforecasting BEFORE | 395 | 217 (54.94%) | 164 | FAIL | 42 | 0 | 0 | 174 | 6 | 22 | 0 | 0 | 0 | 0 | 0 |
| thinking_fast_and_slow BEFORE | 711 | 331 (46.55%) | 170 | FAIL | 15 | 2 | 0 | 298 | 4 | 20 | 1 | 2 | 0 | 0 | 1 |
| thinking_in_bets BEFORE | 250 | 143 (57.2%) | 189 | FAIL | 9 | 0 | 0 | 90 | 10 | 30 | 23 | 0 | 0 | 0 | 0 |

## Known limits (read before trusting the AFTER column)

- AFTER boundaries are the pilot model's own topic decisions, mapped onto the new paragraphs and then repaired by rules (continuation merges, short merges, 700-word splits). They were not re-judged by a model or a person.
- qa_check is a set of deterministic heuristics. It cannot see an unresolved NAME or a reference like "similar disputes" at a chunk opening, a story that is cut at a sensible-looking paragraph break, or a lost hyphen on a word that is also a valid solid word. A 0% flagged rate means no heuristic fired, not that every chunk is good.
- Thinking in Bets footnotes: the PDF inlines the footnote sentence right after the `*` marker (for example "ASAS, founded in 1992..."). The marker is stripped. The sentence is still in the body because nothing in the text layer separates it from prose. Only small-type footnote blocks at the page foot are moved out (extraction.json `footnotes`).
- Line-break hyphens follow the rule literally: a line ending in a hyphen keeps it. A purely typographic break such as "mom-" + "entum" would read "mom-entum". None was found in these two books.
- The footnote and caption rules were also exercised on a synthetic PDF in test_library.py, not only on these two books.

## Extraction report (AFTER)

| Book | Paragraphs | Words | Chapters | Detection | Footnote markers stripped | Datelines removed | Figure captions dropped | Epigraphs moved |
|---|---:|---:|---:|---|---:|---:|---:|---:|
| everything_store | 1231 | 113872 | 12 | toc | 0 | 0 | 0 | 0 |
| thinking_in_bets | 702 | 64132 | 7 | toc | 25 | 0 | 0 | 0 |
