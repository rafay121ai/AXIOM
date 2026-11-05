# Account deletion plan

Status: the SQL function `public.delete_account` IS applied on live (checked
read-only on Nov 3 2026: same body as migration `20261101000011`; only
`service_role` can execute it, `anon` and `authenticated` cannot; 0 delete
requests exist). Deletion is still OFF (`ACCOUNT_DELETE` not `on`). The server
code is tested against in-memory fakes, and the function against a copy.

Copy test, Nov 4 2026: the live main structure (read-only queries) loaded into
a local in-memory Postgres (PGlite; no Docker on this Mac), two made-up
founders with a row in every founder table. It FAILED first: deleting an old
app message fired `sync_conversation_thread_from_message`, which names its
tables without `public.` and could not find them under the function's empty
search path. Nothing was removed (the whole call rolls back), but deletion
would fail for the 8 founders on live with threaded messages. Fix:
migration `20261104130402`, applied on live Nov 4 2026. With it, the copy test
passes: all 36 rows of founder A go across 28 tables, founder B's 37 rows are
unchanged, A's approved story stays with no link, the pending, rejected and
withdrawn stories go, a second run changes nothing, removing the sign-in is
not blocked, and a run that fails part way leaves everything as it was.

Server run on the copy, Nov 5 2026 (step 6): the real `accountService.js` and
`accountDelete.js` against the same local copy, through a small stand-in for
the Supabase client. All 7 cases pass: the 7-day wait, cancel, ban then delete
then sign-in removal in that order, a second run, a cancel landing during the
run, sign-in removal failing 3 times, and the function failing.

Still not proven, because only a real Supabase project can show it: real
Supabase auth (the ban and the sign-in removal are stand-ins here), its exact
error shapes, and true parallel connections. Test deletion on one throwaway
account on live right after `ACCOUNT_DELETE=on`.

Re-run both with `npm ci` then `WITH_FIX=1 node copytest.mjs` and
`WITH_FIX=1 node servertest.mjs` in `supabase/copytest/`. `schema.sql` is the
live structure read on Nov 4; `fix.sql` adds the two later migrations. Both
hold structure only, no founder data. Refresh them after any schema change.

## What a founder sees

1. Settings, "Delete my account". They type `DELETE`. Anything else is
   refused ("To delete everything, type DELETE to confirm.").
2. With the switch OFF: the request is recorded and Axiom says nothing has
   been deleted. Same as before.
3. With the switch ON: the account is marked pending with a date 7 days away.
   Axiom says the date. Asking again returns the same date.
4. During the 7 days they can cancel (`{cancel: true}`). Nothing changes.
   While pending, they get no push notifications.
5. After the date, an hourly check on the server deletes the account.
6. A founder with a care check open is never blocked. The answer is the
   shorter, warmer version and adds nothing else.

## What is removed, in this order

All in one database transaction (SQL function `delete_account`,
migration `20261101000011`). If the function is missing the server logs an
error and deletion fails closed: nothing is removed another way.

1. Shared outcomes (see the decision below).
2. Share unlocks (`peer_unlocks`), consent log, notification log.
3. Reports, then moves.
4. Learn: lesson citations, turns, conversations.
5. Situations: their turns, Reads, then the situations.
6. Old-app data: messages, app sessions,
   threads, experiments, personal memories, model usage (cost) logs, product
   events, sessions.
7. Founder lesson log, care events, devices (push tokens), settings.
8. The name and email row, the founder profile (sign-up answers, theory).
9. The delete request itself.
10. Last, the sign-in account (Supabase auth), by the server. Before step 1
    the server bans the sign-in, so nobody can sign in and write rows while
    the function runs. If removing the sign-in fails it is tried 3 times; if it
    still fails, no founder data is left, the empty sign-in stays banned, and
    it can be removed from the Supabase dashboard (the request row is gone by
    then, so nothing retries it later). If the ban or the function fails, the
    request row stays and the next hourly run repeats it.

Only rows of this founder are touched. Every delete is filtered to the
founder's id.

## Decision (Rafay, Nov 3 2026): approved stories stay

An outcome already approved and published holds no name. The plan:
- Published story: stays, anonymised. Its private link to the founder is
  removed, so it can never be traced back, and the founder can no longer take
  it down.
- Waiting for review, rejected, or already withdrawn: removed with its link.

Decided: published stories stay after the account is deleted. The founder is
told this before typing DELETE (the existing sentence in
`DELETION_PLAN.shared_outcomes`, sent by the server). The alternative was to also remove published stories. That is safer for the
person, and costs other founders a lesson. Consent was given at share time, so
the default keeps them; change it by deleting the story in the first step of
the function and in `accountDelete.js`.

## What cannot be undone

Everything above, after the grace period. There is no backup restore built
in. Supabase's own database backups are outside this plan: tell founders they
may exist for a short time (Rafay to decide wording and retention).
Consent log rows go too: the proof that a founder consented to a published
story is lost with them. The story stays because no name is attached.

## Not covered

- Knowledge project: holds no founder data.
- OpenAI: prompts sent to the provider are under its own retention.
- Logs: the server logs hold no founder text or ids. Deletion failures log a step name and an error code only.

## How to test it on a copy first

1. Take a fresh read-only dump of the live main schema and compare with the
   migration files (see MIGRATION_PLAN.md).
2. Restore the dump into a COPY (a Supabase branch or a local database), not
   the live project.
3. Apply migrations 1 to 11 to the copy only.
4. Create two test founders with situations, moves, a report and a shared
   outcome. Run `select public.delete_account('<founder A id>')`.
5. Check: founder B's rows are unchanged. No row in any table has founder A's
   id (`select` over every column in `information_schema`). The published
   story is still there with no link. Run it a second time: no error, no
   change.
6. Then try the server against the copy, with `delete_after` moved by hand
   (done Nov 5, see the top of this file).

## What Rafay must approve

1. The 7-day grace period.
2. The typed word `DELETE`.
3. Published stories stay (anonymised), links removed.
4. Cost logs and consent log rows are deleted with the founder.
5. The sentences in `tasks/wording_to_approve.md`, section F.
6. The copy test (steps above). The function is already applied on live; this is the proof it is safe to switch on.
7. Setting `ACCOUNT_DELETE=on` on Render (where the server runs), only after the copy test passes.
