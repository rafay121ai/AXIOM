# Axiom build report: journey v1

For Rafay. Written 31 October 2026 at the end of the long build run (B0 to B12).

The code is on branch `feature/journey-v1`, in the worktree `/Users/rafayessani/AXIOM-wt/journey`.
It is **not merged and not pushed**. **No migration has been applied.** No real model
call was made, no real push was sent, and nothing was spent ($0 of the $6 cap).

## What was built

**Server (Express, `server/`).** The whole founder journey, behind the API:

| Part | What it does |
|---|---|
| Care check (`server/care`) | Screens every text a founder sends. Clear distress shows the care screen; slang or unclear words get one soft question. While a clear care event is open, nothing reads, teaches or gives a move until the founder answers the check-in on Home. Pushes pause too. |
| Sign-up and first reading | The 13 answers save one by one and resume where the founder stopped. The first reading is checked to use the founder's own words. |
| Situation and Read | At most 2 follow-up questions, enforced in code (proven with 8 turns at the same time). The Read is stored once and comes back the same every time. |
| Learn | Lessons from the library with citations checked against the source, pictures from the fixed set, follow-up taps, and the move card. The loading hint shows the book name only. |
| Move | The validator runs first. At most 2 active moves (3 commits at the same time give 200, 200, 409). One swap, only with a real reason. A move closes quietly if never reported. |
| Report | Done, Couldn't or Didn't. No strikes or warnings. Consent asked every time unless "share automatically" is on; default is private. Shared outcomes store no user id. A private link table makes take-down possible. Share and take-down cannot race (database functions). |
| Pushes | At most 2 a day, quiet hours, paused during care, never sent twice. Never asks about a situation that is already finished. |
| Home, History, Settings | Greeting from the approved set, items that fade, the drawer, history search and past pages, settings, export and delete requests. Delete is a safe stub that deletes nothing. |
| Cost logging | Every model call writes a usage row named after its step (read, learn, move...). |

**Migrations (`supabase/migrations/20261101000001` to `...0009`).** Nine files and a
plain-English plan (`supabase/MIGRATION_PLAN.md`). Written and statically checked, never
run. An independent check found no destructive statements.

**App (Expo, `app/`).** Every screen, built from the approved mocks: sign-in, the 13
questions, wait, first reading, care, Situation, Read, Learn with the move card, Move,
Report, Home with the drawer, History with past pages, Settings. The app uses Supabase
for sign-in only (a test fails the build otherwise). It saves unsent answers and messages
on the phone and sends them again with the same ids. It shows one plain line for every
server error code. It runs on fake data by default.

## How it was checked

- **Server: 514 tests pass, 0 failing, 0 open todos.** **App: 166 tests pass,** and the
  type check is clean.
- **End-to-end walkthrough** (`server/e2e/journey.test.js`): one founder goes from
  sign-up to report on the real server with fake models. It covers care in the middle,
  pushes, history and the cost rows.
- **Contract test** (`server/e2e/shapes.test.js`): every call the app makes is checked
  against what the server actually returns.
- The walkthrough found 5 real mismatches. All are fixed at the root:
  1. The care screen's help numbers had a different shape in the app than on the server.
  2. A plain Learn message after distress could still get a lesson or a move.
  3. A "where are you with..." push could go out for a situation already reported Done.
  4. The app had no way to take a share back.
  5. Cost rows all said "chat" instead of naming the step.
- Independent second checks were run on the safety and privacy code: care set, privacy
  audit and re-audit, push audit, migration check, voice check. The B12 review results are
  at the end of this report.

## What it cost

$0 in model spend; every model call was a fake. The $6 testing budget is untouched.

## Needs your decision

1. **Apply the migrations.** Take a fresh read-only dump of the live main schema, compare
   it with `supabase/MIGRATION_PLAN.md`, then apply the 9 files in order. Migration 9 must
   go in before the new server is live, or the new server's cost rows will fail to save.
   `20261013000003` (founder_profiles) must already be applied.
2. **Real-model runs.** Up to 3 runs, at most $6 in total, the first at most $2. Each one
   needs your yes.
3. **Care wording and help numbers.** The care wording in `server/care/copy.js` is a draft
   (ideally reviewed by someone with a mental-health background). Every country's help line
   in `server/care/help.js` is a placeholder and unverified, so today the care screen shows
   only "More help near you: findahelpline.com". Real, verified numbers are needed before
   launch.
4. **New wording.** All of it is in one table, `tasks/wording_to_approve.md`. New this run:
   the "Take it down" link on a past page (the mock styles the link but shows no words).
5. **Home, History and Settings.** Please look through them; they were built to the mocks
   without a checkpoint.
6. **See the app.** I could not look at it in the simulator or a browser in this run
   (starting the preview server was declined). Run it on fake data with:
   `cd app && npx expo start --ios` (or `--web`). Add `EXPO_PUBLIC_FAKE_CARE=clear` to see
   the care screen, or `EXPO_PUBLIC_FAKE_HOME=morning|report|evening|care` to see the home
   states.

## What is left

- Account delete and export are stubs. They record the request and delete nothing until a
  plan is approved.
- Real Google sign-in has not been run against real keys.
- `tasks/` exists in two places (this checkout and the journey worktree). When the branch
  merges, make one copy.

## B12 review results

Three independent checks ran at the end: a branch review against CLAUDE.md, PRODUCT.md
and ARCHITECTURE.md; a second agent testing the care hold; and a dead-code sweep. Then
the learning loop ran.

**Fixed in this run:**
- **Samples could reach a real build.** The app used the sample data (sample founders,
  stories and quotes, with no "Sample" label) whenever the server setting was missing. A
  release build now refuses to start without the real server.
- **Care holds every forward step.** The care tester's 7 cases pass. It found the first
  reading and the report were not held; both are now.
- **Dead code removed.** Three unused functions and one stale comment.
- **New guard tests from the learning loop.** If someone adds a write route later and
  forgets the care hold, a test fails until the route is held or put on a written list
  with its reason. Another test proves a release build refuses the sample data. Six
  lessons were added to `tasks/lessons.md`.

**Not built, and the rules say it should be (your call on when):**
1. **Give to get is not enforced.** A report writes an unlock row, but nothing reads it,
   so stories are not gated by sharing. The shared line ("That opens more founder stories
   for you.") promises something the code does not do yet.
2. **Founder voices are not in Learn.** Learn cites authors only. This is safe (no
   unreviewed voice can show), but it is not built.
3. **The Calm / Direct / Hard setting is saved, but no prompt reads it.** Every founder
   gets Direct.

**Worth knowing:**
- **The old web app's chat and experiments routes have the care check but not the care
  hold,** and sit outside the 2-move limit. That is fine only if the web app is retired
  before the native app has real users.
- **With 2 moves already open, Learn ends with the "no room" line instead of a move
  card.** That follows the 2-move limit, but it is an exception to "every Learn leads to a
  Move".
- **The loading hint stays empty until the verified lesson library is loaded.**
- **This branch carries more than the journey.** It also has the earlier cost-cap and
  security work (commits ff4f580 to c1e2b82), edits to the old web app, and migrations
  20260930 and 20261013. The destructive revoke stays in `supabase/pending/`.
- **Three lines found in the final review need your wording decision.** They are in the
  last section of `tasks/wording_to_approve.md`.
