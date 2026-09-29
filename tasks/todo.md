# Migration baseline and security fix

- [x] Confirm the checked-in live dump is internally complete and identify statements that must be excluded from the baseline.
- [x] Search frontend, backend, and scripts for the five RPC call sites and record which calls originate in the browser.
- [x] Trace knowledge ingestion and retrieval to determine where chunk passage text is stored.
- [x] Archive the 15 drifted migrations under `supabase/migrations_archive/` and add an archive README.
- [x] Create one baseline migration reproducing the live public application schema without extension-owned vector routines or data.
- [x] Create a later security migration for `wiki_sources` RLS, RPC grants, and duplicate indexes.
- [x] Validate migration SQL statically and compare its object inventory with `audit/schema_main.sql`.
- [x] Mark this checklist complete and report every created/moved file, the unexecuted repair command, and passage-text evidence.

## Legacy data cleanup preparation

- [x] Search executable code for every read and write of the legacy graph tables, weekly reads, session fields, graph RPC, and `brain` app-session entry point.
- [x] Create a separate destructive migration after the baseline and security migration.
- [x] Normalize existing `brain` entry points before replacing the check constraint.
- [x] Verify retained tables and retained session columns are not dropped.
- [x] Document all remaining runtime blockers and an offline backup command without applying either migration or backup command.

## Pending migration correction

- [x] Move the unapplied legacy cleanup migration from active migrations to `supabase/pending/` using Git.
- [x] Add pending-migration lifecycle instructions.
- [x] Keep `sessions.pillar_weights`; leave every other cleanup statement unchanged.
- [x] Confirm active migrations contain exactly the baseline and security files.
- [x] Review every security migration statement for application impact.
- [x] Run `git diff --check` and commit the migration correction on the cleanup branch.
