# Plan: the learning layer (founder memory)

Status: PLAN ONLY. No code is written until Rafay approves this file.
**Revision 2 (Nov 9) is at the bottom and overrides the Phase 2 to 4 table design above where they differ.** Rafay confirmed: the pivot-rule reversal is intended, the expanded memory set is wanted, and the narrower personality rule is right.
Basis: the memory audit of Nov 9 (what Axiom stores, retrieves and learns today).
Branch: new branch off `main` per phase group (the current branch is `fix/model-length-limits`; do not build on it).

## Decisions that need Rafay before code

These conflict with a rule or leave a gap. I will not guess.

1. **Cross-situation memory reverses the Nov 9 decision.** Today the Read, Learn and Move prompts say "nothing from before this situation is known" and the sign-up answers feed only the first reading (Rafay, Nov 9, so founders can pivot). Phases 1 and 4 add old data to those prompts. The safeguard is the framing you specified (the conversation always wins). Confirm this is the intended reversal. If yes, I record it in `tasks/decisions.md` with the reason.
2. **Live-schema dump first.** CLAUDE.md says a migration plan is based on a dump of the live schema, not the checked-in files. Before writing the migration I take a fresh read-only dump (as for `founder_lesson_log`, Oct 31) and check `delete_account` and the `model_usage_logs` constraint against it. I need your OK to run read-only queries on the main Supabase project.
3. **Stored founder memory is on the "never touch" list.** Phase 2 adds a table. It does not alter existing stored memory, situations or reports. It does add two small columns on `moves` / `reports` (see Migration). Approve that explicitly.
4. **Two sensitive-data limits beyond your list**, both enforced in code, not only in the prompt: no belief is written for a situation touched by care (reusing `sharing.careTouched`), and every number in a belief must appear in the text the model was given.

## Migration plan (Phase 2 and 3 need it; Phase 1, 4, 5 need none)

One file, `supabase/migrations/<ts>_founder_beliefs.sql`, idempotent, with a matching step in a new rollback file. Applied only after the dump check and your approval.

1. **`founder_beliefs`** (columns as you specified):
   - `id uuid pk default gen_random_uuid()`, `user_id uuid not null references auth.users(id)`
   - `belief text not null` (length 1 to 240)
   - `kind text not null check (kind in ('fact','pattern'))`
   - `confidence numeric(3,2) not null check (confidence between 0 and 1)`
   - `evidence uuid[] not null default '{}'` (situation, move or report ids)
   - `status text not null default 'active' check (status in ('active','superseded'))`
   - `superseded_by uuid null references founder_beliefs(id)`
   - `created_at`, `updated_at timestamptz not null default now()`
   - Index `(user_id, status, kind)`. Check: `superseded_by` only when `status = 'superseded'`.
2. **RLS.** Enabled. Policies let a founder `select` and `update` only rows where `user_id = auth.uid()` (read for Phase 6; update limited to `status`). No insert or delete policy: all writes go through the Express API, which uses the service role (rule: "All writes go through the Express API"). This is stricter than "touch their own rows" and I flag it: a founder cannot insert beliefs from a browser.
   - Open point: `founder_lesson_log` is server-only with no policies at all. I propose select-only for founders. If you prefer the same server-only pattern until Phase 6 exists, I drop the policy until then.
3. **Idempotency marker.** `reports.beliefs_extracted_at timestamptz null` and `moves.beliefs_extracted_at timestamptz null`. Without it a retried report or a repeated `settle` would count the same evidence twice. This touches two existing tables (additive, nullable, no backfill: old reports are never extracted, so nothing old is read or altered).
4. **`model_usage_logs.call_type` check.** Add `'beliefs'` (same pattern as `20261101000009`: drop and re-add, `NOT VALID`, `lock_timeout 5s`). Alternative if you want no change to that table: reuse the already allowed `'memory'` step name. I prefer `'beliefs'` to match `MODEL_BELIEFS`.
5. **`delete_account`.** `create or replace` with one added line, `delete from public.founder_beliefs where user_id = p_user_id;`, placed before the `auth.users` removal. The rest of the function is copied from the live definition in the dump, not from `20261101000011`. Superseded rows go too (they are the founder's data).
6. **Rollback** (`supabase/rollback/`): drop the table, drop the two columns, restore the previous check and the previous `delete_account`.

Migration check: run the `migration-checker` agent on the file before it is pushed.

## Phase 1: track record in the Read and Move prompts (no new tables)

**New:** `server/journey/memory/trackRecord.js`
- `loadTrackRecord(supabase, userId)`: the founder's last 5 moves with `status in ('reported','closed_no_report')`, newest first, across all situations, joined to their `reports` row. Excludes drafts, swapped and still-open moves (they have no outcome yet). Two queries, both filtered by `user_id`.
- `trackRecordText(rows)`: pure function that builds the block. Returns `''` with no rows. Hard cap 600 characters.
  ```
  Last 5 moves: 2 done, 1 couldn't, 2 didn't.
  Predictions: right 1, wrong 2, unclear 2.
  Pattern: both skipped moves needed more than 5 minutes to start.
  ```
  - Counts come from `reports.outcome`. A move that closed with no report counts as "didn't" (the founder never reported it). If you want a fourth bucket ("no report"), say so.
  - Predictions count `prediction_check` right, wrong, unclear. `not_tested` (Couldn't, Didn't) is left out, so the three numbers need not add up to 5.
  - The pattern line is computed by code from structured fields only (`start_minutes` of skipped versus done moves, 3 or more skipped moves, a clear split). If nothing is clear, no line. I will not ask the model to find patterns in free text here: that is Phase 3's job.

**Touch:**
- `server/journey/move/moveService.js` (`compose`): load the record, pass `trackRecord` into `moveMessages`.
- `server/journey/situations.js` (`read`) and `server/journey/theRead.js`: pass it into `createRead`, then `readMessages`.
- `server/journey/move/prompts/move.js` and `server/journey/prompts/read.js`: new optional `trackRecord` argument, added as one `system` message after the style message, only when non-empty.

**Prompt changes:**
- Move: "Track record (what this founder did on recent moves). Use it to choose a move they will actually do: if they keep skipping long or heavy moves, make this one smaller. Never mention the record, never lecture, never say they missed anything."
- Read: the line "The Read is built only on this conversation... nothing from before this situation is known" becomes "The Read is about this conversation. A short track record may follow. It is background only: never quote it, never cite counts, never bring up past moves unless the founder did."

**Validator interaction (important, found in code):**
- `checkMove`, `checkReportReply` and `checkRead` reject any number the founder never wrote. Counts like "2" or "5 minutes" in a track record could make the model echo a number and fail the check, causing retries and fallbacks.
- Decision: track-record numbers are NOT added to the allowed corpus. The prompt tells the model not to cite them. A reply that echoes one still fails the existing check, which is the safe side.
- The Report reply prompt is unchanged (Phase 1 is Read and Move only, as specified).

**Tests:** no moves (empty string, prompt identical to today), 1 to 5 moves, 7 moves (only the newest 5), a closed-no-report move, `not_tested` ignored, length cap holds, another founder's moves never loaded, track record present in both prompts and absent when empty, a number from the record in the model output is rejected by the existing checks.

## Phase 2: `founder_beliefs`

- The migration above, plus `server/journey/memory/beliefsStore.js` (reads and writes through the injected supabase: `activeBeliefs`, `insertBelief`, `updateConfidence` with compare-and-swap on `updated_at`, `supersede`).
- `server/journey/home/accountExport.js`: add `founder_beliefs` to `COLUMNS` and the export (all statuses, columns `belief, kind, confidence, evidence, status, created_at, updated_at`; not `user_id`).
- Account deletion: the SQL change in `delete_account` (see migration). `accountDelete.js` itself needs no change (it calls the function).
- Docs: ARCHITECTURE.md data model table and `server/journey/schema_needs.md`.
- **Tests:** export includes beliefs and only this founder's; the deletion SQL is covered by the existing migration/e2e tests extended to assert the table is emptied; RLS statement checks in `server/migrations/migrations.test.js`.

## Phase 3: extraction after a report

**Config:** `server/config.js`: new step `beliefs`, default `gpt-4.1-mini` (the existing cheap model), override `MODEL_BELIEFS`. Added to `STEPS`, so `modelUsage.js` logs it as `call_type: 'beliefs'`.

**New:** `server/journey/memory/extractBeliefs.js`, `server/journey/memory/beliefRules.js`, `server/journey/memory/prompts/beliefs.js`

- **Trigger.** At the end of `finish()` in `reportService.js`, after the report and reply are stored and sharing is decided. Best-effort and non-blocking for the founder's response (`void`-style with caught errors and `log`). It never throws into the report path. Skipped when the report row already has `beliefs_extracted_at`, when `sharing.careTouched(userId, situation)` is true, or when there is no note and the outcome is not Done (nothing the founder said).
- **Input to the model:** situation (title and the founder's messages), the Read, the move, outcome, note, current active beliefs with ids. Founder text is data, not instructions.
- **Output schema (strict JSON):**
  `{ new_beliefs: [{belief, kind, evidence_ids}], reinforce: [{id}], weaken: [{id}], supersede: [{id, replacement: {belief}}] }`
  Only facts can be superseded. The model proposes ids and wording only. It never sets confidence.
- **Prompt rules:** only what the founder said or did; no guesses about personality, health, mood, money trouble or anything sensitive; never from care or distress messages; a new fact that contradicts an old one goes in `supersede`; patterns are about behaviour, facts about the business; short plain sentences; no quotation marks; nothing the founder did not say.
- **Update rules in code (`beliefRules.js`, pure, unit tested):**
  - New fact: confidence 0.6. New pattern: 0.35 (below the 0.4 prompt threshold until it is reinforced). Both rounded to 2 decimals.
  - Reinforce: +0.15, capped at 0.95. The evidence array gains the new source id (deduplicated).
  - Weaken: -0.2, floor 0. Anything under 0.2 becomes `superseded` (no `superseded_by`).
  - A pattern with fewer than 2 evidence ids is capped at 0.5, enforced in code even if the model asks for reinforce.
  - Supersede: the old row becomes `status='superseded'`, `superseded_by` = new row id, and the new fact row is inserted first. Nothing is deleted. Ids the model returns that are not this founder's, not active or not facts are ignored.
  - Decay: facts with `updated_at` older than 90 days lose 0.1 each run. Decay does not touch `updated_at`, so the next run decays again. Ambiguity: "per run" means an active founder decays faster than an idle one. I follow your wording. Say if you want once per 90 days instead.
  - Guards in code: belief length 3 to 240 characters, no banned phrase, no teaser, no quotation marks, any digit string must appear in the input texts, at most 3 new beliefs per run, at most 50 active beliefs per founder (lowest confidence is superseded when the cap is hit).
- **Lighter version (situation ends without a report):** same function with `mode: 'facts_only'` (schema has no pattern output, prompt says facts only, input has no outcome or note). Trigger: in `moves.settle()` for each move that closes as `closed_no_report`, and when a situation's status goes to `closed`. `settle` runs on the founder's next request, so extraction is lazy. Marked with `moves.beliefs_extracted_at`. Open question: does anything else count as "a situation ends" (a paused or abandoned situation has no event today)? I only hook the two events that exist.
- **Failure:** any model or validation failure writes nothing and leaves `beliefs_extracted_at` null (retried on the next trigger). One retry inside `callStructured` as usual. Every attempt is logged.
- **Tests:** no past beliefs; new fact; contradiction supersedes and keeps the old row; reinforce cap at 0.95; weaken -0.2; below 0.2 becomes superseded; pattern with one evidence stays at or under 0.5; pattern reaching 0.5+ with 2 evidence; 90-day decay; foreign id ignored; care-touched situation writes nothing; invalid output (digit not in the input) rejected; extraction runs once per report (marker); report response unchanged when extraction throws; facts-only mode never writes a pattern; usage row has `call_type 'beliefs'`.

## Phase 4: beliefs in the Read, Learn and Move prompts

**New:** `loadBeliefs(supabase, userId)` and `beliefsMessage(beliefs)` in `server/journey/memory/beliefs.js`.
- Selection: `status='active'` and `confidence >= 0.4`, at most 10: patterns first (highest confidence), then facts by newest `updated_at`. No embeddings, no model.
- Framing, one `system` message, only when there is at least one belief:
  "Past observations about this founder. They may be outdated. If anything in this conversation conflicts with them, the conversation wins. Do not mention these observations unless they directly help." followed by the beliefs as plain lines. No ids, no confidence numbers.
- Touch: `readMessages`, `learnMessages`, `moveMessages` and their callers (`theRead.js` / `situations.js`, `learn.js makeTurn`, `moveService.js compose`). Learn's followup mode gets it too (same prompt builder).
- Prompt text fixes that would otherwise contradict the new block: the Read's "nothing from before is known" line; the Learn and Move "Facts: use only numbers, dates and names the founder wrote in this situation" rule stays and is extended with "Observations are never a source of numbers, dates or names."
- Validators unchanged (beliefs are not added to `founderTexts`), so an old number leaking into a reply still fails. Cost: slightly more retries when the model echoes one. Phase 4 prompt tokens are small (10 short lines, about 250 tokens).
- Care: no beliefs are sent while a care event is open (the same rule `styleOf` uses: plain voice).
- **Tests:** none (prompt unchanged), cap of 10 with ordering, below-0.4 excluded, superseded excluded, other founder's excluded, framing text present exactly once, open care event sends none, conflict case (belief says one thing, the conversation another: the validator still pins numbers to the conversation).

## Phase 5: care context

- `server/care/middleware.js`: `careGate(extract, context)` takes an optional `context(req) => Promise<string[]>`. It returns the last 4 founder messages of the current situation (founder rows in `situation_turns`, not filler, plus Read-talk and Learn replies, newest last), each clipped to 500 characters (already done by `askModel`). It is passed as `context` to `classifyCare` only when a context function exists. The rules-first path in `classifyCare` is unchanged: context is used only when `needsModel` is true, as today.
- Routes wired: `/api/situations/:id/turn`, `/api/situations/:id/read/answer`, `/api/learn/:id/turn` (resolve its situation), `/api/moves/:id/swap` and the report note (resolve their situation). `POST /api/situations` (new), sign-up, and `/api/home/checkin` have no situation, so they pass none.
- The context lookup is one query by id, scoped with `user_id`. A failure returns `[]` (never blocks or changes a screening result).
- Privacy note for you: this sends up to 4 previous founder messages to the care classifier model, only in the slang or weak-signal cases that already reach the model. Same provider, same model as today.
- **Tests:** context passed (4 messages, newest last, clipped), fewer than 4 messages, no situation, lookup failure still screens, rules-first clear phrases never call the model, another founder's situation never read, escalation: three unclear-sounding messages across turns classify as unclear or clear with context but not without (care test set).

## Phase 6 (optional, not built until you confirm)

A screen listing active patterns and facts, with "this is wrong" setting a row to `superseded`. Needs: `GET /api/memory`, `POST /api/memory/:id/wrong`, an app screen from a new mock in `tasks/design` (a new UI pattern is flagged by CLAUDE.md), and an RLS update policy limited to `status`. Not started.

## Files I will touch (all phases)

- New: `supabase/migrations/<ts>_founder_beliefs.sql`, a rollback step, `server/journey/memory/{trackRecord,beliefs,beliefsStore,beliefRules,extractBeliefs}.js`, `server/journey/memory/prompts/beliefs.js`, and tests beside each.
- Edited: `server/config.js`, `server/journey/{situations,theRead}.js`, `server/journey/prompts/read.js`, `server/journey/learn/{learn.js,prompts/learn.js}`, `server/journey/move/{moveService.js,prompts/move.js}`, `server/journey/report/reportService.js`, `server/journey/home/accountExport.js`, `server/care/middleware.js` and the route files that call `careGate`, `server/e2e/harness.js` (new `beliefs` call type), ARCHITECTURE.md (tables, AI layer, calls per step), PRODUCT.md (memory behaviour), `tasks/decisions.md`, `tasks/lessons.md` if anything fails.
- Not touched: the experiment validator, consent, anonymization and peer outcome logic, existing stored data, sign-up answers handling, Express write rules.

## Risks

- **Pivot rule.** The main product risk. Mitigation: the framing text, patterns surviving pivots but facts decaying, no beliefs as number sources, and (Phase 6) founder control.
- **Wrong or sensitive beliefs.** A model can still infer something it should not. Mitigations: narrow prompt, code guards (care-touched skip, digits, banned phrases, caps), and `kind` limits. It cannot be made zero risk; Phase 6 is the real remedy. Voice rules apply to belief text since it appears in prompts, not in the UI.
- **Prompt injection through founder text.** Beliefs are written from founder text and later placed in system messages. A founder could plant instructions that persist. Mitigation: beliefs are stored as short plain claims that pass the guards (length, no quotation marks, banned phrases), framed as data in the prompt, and the extraction prompt treats input as data. I will add a test with an injected instruction.
- **Number validators causing more retries or fallbacks** (Phase 1 and 4). Watch the fallback rate in the usage log after release; the Read has a fallback, the Move has none and throws after two failed attempts.
- **Report latency and cost.** Extraction runs after the report response is built and is best-effort. Added cost is one mini-model call per report. Logged as `beliefs`; the $6 cap check must include the new call.
- **Concurrency.** Two reports finishing together could both update one belief: compare-and-swap on `updated_at`, retry up to 3 times, else skip.
- **Lazy "no report" extraction** depends on the founder opening the app (`settle` runs on request). A founder who never returns gets none, which is fine.
- **Existing tests.** Several tests assert exact prompt arrays. They must change only where a new optional message appears. Empty memory must give byte-identical prompts, and I will test that.
- **Live data.** Nothing in this plan alters existing situations, reports or memory. The two nullable columns are the only change to existing tables.

## Order and gates

1. Approval of this plan (and the 4 decisions at the top).
2. Phase 1 (no migration). Summary to you.
3. Live-schema dump, migration file, `migration-checker`, your approval to apply. Then Phase 2, Phase 3, Phase 4, Phase 5, each with its own summary.
4. After each phase: `test-runner`, `axiom-reviewer` before any merge, `graphify update .`, `python3 tasks/status.py`, and the CLAUDE.md "verify before done" list for the affected screens.
5. Phase 6 only after you confirm.

---

# Revision 2: the expanded memory set (replaces the Phase 2 to 4 table design)

Goal (Rafay, from a founder conversation): Axiom should know how a founder thinks and decides, so they do not have to re-explain context. The test is: after a few weeks, a short message ("same issue with the clinics, they went quiet again") is understood without setup.

## The personality rule (final)

Allowed: how the founder works and decides at work, inferred only from what they said or did in Axiom.
Not allowed, in code and prompt: mood, health, money trouble, relationships, family, age, religion, politics, identity, diagnoses or labels ("you are an avoider"). Never created from care events. Axiom never announces that it remembers ("I know you well"); it just stops asking for things it already holds.

## How it is kept from making things up

1. **Closed vocabulary for traits.** The model cannot invent a personality label. `founder_traits` uses a fixed list of dimensions, each with a fixed list of values (below). The model picks from the list or says nothing.
2. **Every memory has a receipt.** Each item must come with a short verbatim snippet from the source (the founder's own words, or the move/report record). Code checks the snippet is really in the source text; if not, the item is dropped. Stored in `memory_evidence`, so "why does Axiom think this?" always has an answer.
3. **Names and terms must be typed by the founder.** A person, company or term enters `founder_world` / `founder_vocabulary` only if that exact string appears in the founder's text.
4. **Evidence thresholds in code.** A trait is not used in any prompt until it has 3 observations across at least 2 situations. A pattern stays at or under 0.5 with fewer than 2 pieces of evidence. Anything the founder typed at sign-up as a self-description starts as a self-report prior, capped at 0.5, which behaviour can confirm or overturn.
5. **The summary is built by code, not by the model.** `founder_brief` is assembled from active rows with a fixed template. No model writes the text that goes into prompts, so it cannot add anything the rows do not say.
6. **The conversation always wins**, and nothing old is a source of numbers, dates or names (the existing validators stay as they are).
7. **Founder corrections stick.** When a founder marks something wrong (Phase 6), the extractor is told not to recreate it.
8. **Tests that expect nothing.** A set of sample conversations where the correct extraction is empty (small talk, a bad day, a health mention, a care message, an injected instruction). A model change cannot ship if any of them produce an item.
9. **Scope.** Memory only feeds the existing journey (first reading, Situation, Read, Learn, Move, Report). No chat companion, no new screens except Phase 6, no change to the founder's data other than the new tables.

## Tables (9 new, all server-written, RLS select-only for the owner, in export and in `delete_account`)

| Table | Purpose | Main columns |
|---|---|---|
| `founder_beliefs` | Business facts and behaviour patterns, plus communication preferences | id, user_id, belief, kind (`fact`, `pattern`, `preference`), confidence 0 to 1, status (`active`, `superseded`), superseded_by, source (`signup`, `conversation`, `report`), created_at, updated_at |
| `founder_traits` | How the founder thinks and decides, from a closed list | id, user_id, dimension, value, confidence, origin (`self_report`, `observed`), status, superseded_by, timestamps. One active row per user and dimension |
| `founder_world` | People, companies, products, channels the founder keeps mentioning | id, user_id, name, kind (`person`, `company`, `product`, `channel`), role (short text), mention_count, last_mentioned_at, status, timestamps |
| `founder_vocabulary` | The founder's shorthand and what it refers to | id, user_id, term, meaning, confidence, mention_count, status, timestamps |
| `founder_threads` | Storylines that run across situations (a goal, a bet, an open question) | id, user_id, title, kind (`goal`, `bet`, `open_question`), status (`open`, `done`, `dropped`), timestamps |
| `memory_evidence` | The receipt for every item above | id, user_id, item_table, item_id, source_kind (`signup`, `situation`, `read`, `learn`, `move`, `swap`, `report`), source_id, snippet (verbatim, max 200 chars), created_at |
| `memory_runs` | One row per extraction pass, so nothing is counted twice | id, user_id, source_kind, source_id, mode (`signup_seed`, `full`, `facts_only`), status (`done`, `failed`, `skipped_care`), model, created_at. Unique on (source_kind, source_id, mode) |
| `founder_corrections` | What the founder marked wrong, so it is not rebuilt | id, user_id, item_table, item_text, reason (`wrong`, `outdated`), created_at |
| `founder_brief` | The compiled short text that goes into prompts | user_id (pk), text, item_count, built_at |

`memory_runs` replaces the two `beliefs_extracted_at` columns from the first plan, so **no existing table is changed**. `memory_evidence` replaces the evidence id array.

### Fixed trait list (first version; every value is observable from what Axiom already stores)

| Dimension | Values | Observed from |
|---|---|---|
| `decision_speed` | `fast`, `deliberate`, `waits_until_forced` | how soon they commit a move after it is offered, swaps, reply length |
| `evidence_basis` | `numbers_first`, `gut_first`, `asks_others` | what they cite in situations and notes |
| `after_setback` | `changes_approach`, `digs_into_why`, `pauses`, `pushes_harder` | Couldn't and Didn't notes, swap reasons |
| `move_size` | `small_steps`, `big_swings` | which moves get done versus skipped |
| `detail_level` | `big_picture`, `detail` | length and specificity of their messages, follow-ups tapped |
| `pace_of_follow_through` | `same_day`, `within_48h`, `drifts` | commit and report timing |

New dimensions are added by a code change and a migration-free enum list, not by the model.

## What feeds the tables

1. **Sign-up seed (no model, day one).** Code maps the 13 sign-up answers to rows: facts (stage, team, customers abroad, goal and date), self-report patterns (what they avoid most, what they say they are strong at), and the new onboarding answers below. Origin is `self_report`, confidence at most 0.5. Receipts point at the answer.
2. **Extraction after each report** (Phase 3, one call, cheap model, `MODEL_BELIEFS`): outputs new items, reinforce, weaken, supersede for all five item types, each with a snippet. Update arithmetic stays in code as you specified (+0.15 cap 0.95, -0.2, below 0.2 superseded, 90-day fact decay, patterns need 2 pieces of evidence above 0.5).
3. **Facts-only pass** when a situation ends without a report.
4. **Signals Axiom already stores, no new tracking:** swap reasons, which follow-ups were tapped, a skipped Read question, reply length, report notes, move timing.

## How it is used (Phase 4, widened)

- **Read, Learn, Move** get the `founder_brief` (and Phase 1's track record). Framing unchanged: past observations, may be outdated, conversation wins, do not mention unless they directly help.
- **Situation follow-up and the Read talk** also get it, with one added rule: "Never ask for something the observations already answer." This is the main fix for re-explaining. It can only reduce questions, so the 2-question cap and its server check are untouched.
- **The first reading** keeps using the sign-up answers as today.
- **What goes into the brief** (cap about 900 characters): up to 5 patterns/traits at confidence 0.4 or more, up to 5 newest facts, the people and terms from `founder_world` / `founder_vocabulary` that appear in the current conversation (so "the clinics" resolves), and the 2 most recent open threads. Rebuilt by code after each extraction. No care event open.

## Onboarding changes (needs Rafay: CLAUDE.md says adding onboarding steps or questions is flag-first)

Proposed, nothing built:
1. **A name screen** ("What should I call you?", pre-filled from sign-in, editable). It writes the existing `users.first_name`. No schema change.
2. **Birthday: decision needed.** Recommended: month and day only, used only for a dry birthday greeting. It never goes into any prompt or trait. Month and day avoids the age question entirely (collecting a full date means deciding what to do for under-18 users). Needs two small columns on `founder_profiles`, plus export and delete. If you want the year too, say so and I will plan an age rule first.
3. **Three new tap questions** (max 5 options, behaviour in a moment, not personality labels; this stays inside the earlier decision "no personality tests"):
   - "When you have to make a call and you are not sure, you usually…" (Decide fast and adjust / Look for more information first / Ask someone I trust / Wait until I have to)
   - "When something you tried does not work, you…" (Change the approach right away / Work out why first / Step back for a bit / Push harder at the same thing)
   - "How should Axiom talk to you?" (Calm / Direct / Hard). Same three values as the existing Settings style; asking it at sign-up sets `mentor_style` from day one.
4. **One optional written question:** "Who else is part of this? Names and what they do (cofounder, first customers, an advisor). Skip if nobody yet." Seeds `founder_world`. Goes through the care gate like the other typed answers. Names of third parties are stored only in the founder's own rows, exported and deleted with the account, and never copied into any shared story.
5. **Total:** 13 questions become 16 plus a name screen, with one optional. If that is too long, the minimum I would keep is the talk-style question and the optional people question (they save the most re-explaining). The two reasoning questions can wait, because behaviour teaches those traits within a few weeks anyway.

## Phase order (revised)

Phase 1 (track record), then the migration (9 tables, delete function, usage check), Phase 2 (stores, export, deletion), Phase 3 (sign-up seed and report extraction, with the no-extraction test set), Phase 4 (brief and prompts), Phase 5 (care context), onboarding changes (only after your answers), Phase 6 (the "What Axiom thinks" screen). Phase 6 is now strongly recommended before any public launch of Phase 3, because it is the founder's control over a personal profile.

## Added risks

- **More tables, more privacy surface.** Everything is in export and deletion with tests that fail if a table is missed. Third-party names are a new category of data (people the founder mentions).
- **Brief quality depends on thresholds.** Too strict and nothing changes for weeks; too loose and wrong traits appear. The thresholds are constants in one file so they can be tuned.
- **Cost.** One extraction call per report plus a code-only brief rebuild. The Situation follow-up call gets a slightly longer prompt (about 250 tokens).
- **Self-report versus behaviour.** What a founder says about themselves at sign-up and what they do can disagree. The design keeps both (self-report prior, observed row) and trusts behaviour once it has evidence.

---

# Revision 3 (Nov 9): approved by Rafay

- Onboarding is 14 questions, 7 business and 7 personal, as listed in `tasks/decisions.md` (Memory layer). Birthday is month and day only. A name screen is added. Time on it, team size, what you tried and background are dropped; stored answers stay, and founders with 13 answers must not be sent back into onboarding (completion rule to change).
- Build state: Phase 1 is built on branch `feat/memory-layer` (not committed). Nothing touches Supabase until the migration is approved separately: live-schema dump first, then the 9-table migration file, `migration-checker`, then apply.

## Migration review (migration-checker, Nov 9): no blockers; rules for the server code

- Fixed in the file: a failed `memory_runs` row no longer blocks a retry (the unique index skips `status = 'failed'`).
- `founder_world` and `founder_vocabulary` have partial unique indexes on `lower(name)` / `lower(term)`: supabase-js `upsert` cannot target them. The store must select, then insert or update, and trim the name or term first.
- `superseded_by` is a self-reference with no cascade. The store must only link rows of the same founder, and needs a test, or one bad link could stop that founder's account deletion.
- Migration 002 is safe only if each file runs as one transaction (the CLI does this; 20261101000009 used the same pattern). Run `supabase db push --dry-run` before the real push.
- Rollback: revert the server first, or `beliefs` usage logs fail against the restored check.

---

# Revision 4 (Nov 9): after review

- `founder_brief` is dropped: eight tables, not nine. The brief is built live by code on each call (nothing read a stored copy).
- Built on branch `feat/memory-layer`, uncommitted: Phase 1 to 5, the 14-question sign-up (server and app), name and birthday screens, the sign-up seed, extraction after a report, the facts-only pass for moves closed with no report. Four migrations are written and NOT applied (`supabase/migrations/20261109000001` to `4`, rollback in `supabase/rollback/20261109_rollback.sql`).
- Not built: Phase 6 (needs a design), the situation-closed trigger (nothing ever closes a situation), a sign-up seed for founders whose first reading was stored before this ships.
- Release gate: apply the four migrations, with `supabase db push --dry-run` first, BEFORE merging (Render deploys from main).
