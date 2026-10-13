-- Unknown cost and unknown tokens (aborted or failed calls) are stored as null, not 0.
alter table public.model_usage_logs
  alter column prompt_tokens drop not null,
  alter column prompt_tokens drop default,
  alter column completion_tokens drop not null,
  alter column completion_tokens drop default,
  alter column total_tokens drop not null,
  alter column total_tokens drop default,
  alter column estimated_cost_usd drop not null,
  alter column estimated_cost_usd drop default;

-- NOT VALID: new rows must use a current call_type, existing rows (including
-- legacy values we cannot verify on the live table) are never checked or rejected.
alter table public.model_usage_logs
  drop constraint if exists model_usage_logs_call_type_check;

alter table public.model_usage_logs
  add constraint model_usage_logs_call_type_check
  check (call_type in (
    'chat',
    'query_expansion',
    'onboarding',
    'memory_update',
    'concept_state_update',
    'embedding'
  )) not valid;
