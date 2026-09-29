# Archived migrations

These 15 migrations were archived on 2026-09-29 because the main project's live migration ledger was empty and the files did not reproduce the live schema. They contained partial, reordered, and knowledge-project changes that drifted from the audited main database.

The replacement baseline is `supabase/migrations/20260929000000_baseline_live_public_schema.sql`, generated from `audit/schema_main.sql`. On the existing main project, mark that baseline as applied with `supabase migration repair`; do not execute the baseline SQL against the live database.

The archived files are historical evidence only. Do not apply them after the baseline.
