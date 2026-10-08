alter table public.model_usage_logs
  alter column estimated_cost_usd drop not null,
  alter column estimated_cost_usd drop default;

alter table public.model_usage_logs
  drop constraint if exists model_usage_logs_call_type_check;

do $$
declare
  migration_cutoff timestamptz := clock_timestamp();
  has_legacy_artifact boolean;
  has_legacy_session_notes boolean;
  constraint_sql text;
begin
  select exists (
    select 1 from public.model_usage_logs where call_type = 'artifact'
  ) into has_legacy_artifact;

  select exists (
    select 1 from public.model_usage_logs where call_type = 'session_notes'
  ) into has_legacy_session_notes;

  constraint_sql := format(
    'alter table public.model_usage_logs add constraint model_usage_logs_call_type_check check (call_type in (%L, %L, %L, %L, %L, %L)',
    'chat',
    'query_expansion',
    'onboarding',
    'memory_update',
    'concept_state_update',
    'embedding'
  );

  if has_legacy_artifact then
    constraint_sql := constraint_sql || format(
      ' or (call_type = %L and created_at < %L::timestamptz)',
      'artifact',
      migration_cutoff
    );
  end if;

  if has_legacy_session_notes then
    constraint_sql := constraint_sql || format(
      ' or (call_type = %L and created_at < %L::timestamptz)',
      'session_notes',
      migration_cutoff
    );
  end if;

  execute constraint_sql || ')';
end
$$;
