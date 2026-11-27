-- NOT APPLIED. Draft only (S1 audit, item 10). Do not run; move to supabase/migrations/ with a new timestamp after Rafay's yes.
-- The daily clearing job deletes connector_jobs with status done or dropped and updated_at older than 7 days.
-- Without this index that is a scan of the table once a day: fine while small, worth adding once the table is large.
create index if not exists connector_jobs_cleanup_idx on public.connector_jobs (updated_at) where status in ('done', 'dropped');
