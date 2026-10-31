# Account deletion plan

Status: written, built, tested against in-memory fakes only. NOT applied to
any database. Deletion is OFF (`ACCOUNT_DELETE` not `on`). Needs Rafay's
approval before anything below is switched on.

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
migration `20261101000011`). If the function is missing the server runs the
same steps one by one; each step is safe to repeat.

1. Shared outcomes (see the decision below).
2. Share unlocks (`peer_unlocks`), consent log, notification log.
3. Reports, then moves.
4. Learn: lesson citations, turns, conversations.
5. Situations: their turns, Reads, then the situations.
6. Old-app data: messages, weekly reads, wiki nodes and edges, app sessions,
   threads, experiments, personal memories, model usage (cost) logs, product
   events, sessions.
7. Founder lesson log, care events, devices (push tokens), settings.
8. The name and email row, the founder profile (sign-up answers, theory).
9. The delete request itself.
10. Last, the sign-in account (Supabase auth), by the server. If this last
    step fails, no founder data is left; the empty sign-in account is retried
    only if you re-ask, or can be removed from the Supabase dashboard.

Only rows of this founder are touched. Every delete is filtered to the
founder's id.

## Decision for Rafay: shared outcomes

An outcome already approved and published holds no name. The plan:
- Published story: stays, anonymised. Its private link to the founder is
  removed, so it can never be traced back, and the founder can no longer take
  it down.
- Waiting for review, rejected, or already withdrawn: removed with its link.

The alternative is to also remove published stories. That is safer for the
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
- Logs: the server logs hold no founder text or ids.

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
6. Then try the server against the copy with `ACCOUNT_DELETE=on`, a 7-day
   grace shortened by editing `delete_after` by hand.

## What Rafay must approve

1. The 7-day grace period.
2. The typed word `DELETE`.
3. Published stories stay (anonymised), links removed.
4. Cost logs and consent log rows are deleted with the founder.
5. The sentences in `tasks/wording_to_approve.md`, section F.
6. Applying migration `20261101000011` (after the copy test).
7. Setting `ACCOUNT_DELETE=on` on Railway, only after 6.
