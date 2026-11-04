# Lessons

- Destructive migrations that still have runtime dependencies belong outside `supabase/migrations/`. Keep them under `supabase/pending/` until code cleanup is merged and deployed and a data backup is verified.
- Do not remove denormalized session fields only because a replacement table exists. Confirm every runtime reader first; `sessions.pillar_weights` still drives RAG routing.

- Emphasis on text: use a thin underline in the highlight colour. Never colour or gradient the letters themselves; it reads cheap. (Rafay, screen 3.)
- Highlight at most 2 phrases per block of text, never everything the founder said. (Rafay, screen 3.)
- Axiom lines must contain something specific the founder said; never generic hand-offs like 'I have what I need'. Pre-filled inputs must never trap the founder: offer suggestions above an empty box. (Rafay, screen 4.)
- Never echo the founder's last message back as a hand-off. Ask the plain question, or move on silently. (Rafay, screen 4.)
- Axiom's Read must be plain: a headline that states the finding in everyday words, no clever contrast lines or metaphors. If the founder has to decode it, it failed. (Rafay, screen 5.)
- Axiom's copy must be plain, everyday language. No poetic, clever or abstract phrasing; no hypotheticals like 'if one of them said yes today, what would you want it to look like'. Ask the direct question. (Rafay, screens 5 and 6.)
- Every Axiom message must either ask one clear question or say what to do next. No remarks that leave the founder unsure what to do. (Rafay, screen 6.)
- Tapping a choice button must never post the choice as a chat message from the founder; show the pressed state and let Axiom continue. Buttons stay small and compact, never big blocks. (Rafay, Report.)
- Labels and buttons must say what the founder should DO in plain words. Internal terms (move, report, situation) are not self-explanatory. (Rafay, home screen.)
- Never assume anyone's gender in copy, samples or examples. Use they/them or rewrite. (Walkthrough, founder story sample.)
- Before writing a file, check whether it already exists (and read it). tasks/todo.md held 217 lines of earlier completed plans; I overwrote it and had to restore it from git. Append new plans instead. (Caught at commit time.)

## Lesson (B2)
- Builder tested its own care check with its own examples and passed; the independent care-tester found 9 real gaps (spaced letters, missing spaces, invalid model level treated as none). Rule: safety checks are always tested by a second agent that did not write them.

## Lessons (B2 to B5 review)
- Copy the founder sees has ONE home (the server) and is compared word for word to the approved mock by a test (server/journey/drift.test.js). The builder never writes or "improves" approved copy; unapproved copy is marked DRAFT and flagged. The app holds placeholders only, labelled. (Care screen: builder copy differed from the mock and lived in server and app.)
- Fallbacks may only repeat the founder's own words, in fixed sentences that read whole. Never fill a gap with a guessed fact ("no customer yet"). Test them with real-sounding input and with empty input. (First reading fallback, caught only by the voice-checker.)
- When a decision removes a feature, remove it in the same change from prompt, schema, types, storage and mocks, and add a test that it is gone. Grep for the old name first. (Read underlines.)
- Tests start their own server on port 0, never a fixed port. Ports 8765 and 8791 belong to the build office page; do not start or stop anything on them. (App agent's duplicate server broke the office page.)
- A builder that hits a product question (filler in Learn, care blocking Learn, "I don't know what to do") writes it to tasks/todo.md "Open questions" the moment it appears and asks the conductor at once, not at the end. Safety checks are tested by a second agent (see B2 lesson above).

## Lesson (resume watcher, Oct 26)
- The main session hit a usage limit without running `status.py rate waiting <reset>`, so the watcher saw "running" with a 3.5 hour old timestamp and started a second B6 builder and a second Learn app-builder in the same worktree. When the main session resumed at 23:00, two builders wrote the same files. Rule: before any long wait or at the first sign of a limit, set `rate waiting`; the watcher must also stop if `rate` is waiting or any helper shows "running" with a recent `since`, and must re-check `updated` before each commit.

## Lesson (B7)
- The independent privacy audit found a share/withdraw race, a possible share without a consent record, and a missing care check on re-share, in code its author had tested with 20 passing tests. Rule: consent and privacy code always gets a second auditor, and any multi-step change to shared data must be one transaction (a database function), not a sequence of calls.

## Lessons (B11 and B12 review)
- Module tests pass while the seams between modules break. Every step that crosses server and app gets one walkthrough test that runs the real routes in order, and the app's http client has a shape contract per call (server/e2e/journey.test.js, server/e2e/shapes.test.js). Add the contract in the same change as the route or the client call.
- A safety gate must check the founder's stored state (open care event), not only the text in front of it. Apply it as a hold on every route that moves the journey forward, and keep a test that lists them (server/care/hold.test.js). A route added later must be added to that list or to a written exempt list.
- Status has one source. Anything that decides what to show or send (pushes, History, Home) derives status from the report, never from a stored copy like situations.status. Test the scheduler with a situation that has a Done report.
- Fixtures must never ship: any fallback to sample data throws in a release build (app/src/api/index.ts). A fallback that can reach a real founder is a bug, not a convenience.
- A rule that is written must have a reader, and the test must prove the reader. Give-to-get: peer_unlocks rows are written (sharing.js) but nothing reads them to unlock founder cases. Test the effect (the next situation sees cases only after a report), not the row.
- A builder cut off by a limit leaves its state in tasks/build_status.json and todo.md before stopping; a test `todo` marker must name a task in tasks/todo.md, never a file that does not exist. Grep for orphan markers at each milestone.
- Scope a design question to what the founder of the request named. Rafay asked for fonts for the intro animation; I showed a whole app screen as if the app's fonts were changing. Before making a comparison, write in one line what it covers and what stays the same.
- Taglines: say the promise in plain words a stranger gets on first read, under five words. Clever structure and stacked clauses read as AI. Test each line by asking "would someone know what the app does from this alone?"
- Motion for Axiom is judged by a 22 to 35 year old founder: it must read as restrained and expensive, never playful. Particles, dust, scanning bars and per-letter tricks read as a kids' app. Default to one strong idea (the logo drawing itself), quiet supporting detail, and text that simply arrives where it lives.

## Lessons (migration handoff, Oct 31)
- After each successful live migration, record its project, file version, result and next file in the handoff/status before starting the next; on resume reconcile with live history, because a rate limit can leave the database partly migrated while the plan still says none applied. (Journey migration deployment.)
- Track approval separately from deployment prerequisites: reuse recorded approval, but verify authenticated access, deployed caller compatibility and required database-copy tests before applying; fake tests do not prove deletion isolation in Postgres. (MIGRATION_PLAN.md and DELETION_PLAN.md.)
