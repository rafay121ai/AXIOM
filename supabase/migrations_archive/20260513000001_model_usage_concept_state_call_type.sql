alter table model_usage_logs
  drop constraint if exists model_usage_logs_call_type_check;

alter table model_usage_logs
  add constraint model_usage_logs_call_type_check
  check (
    call_type in (
      'chat',
      'query_expansion',
      'onboarding',
      'session_notes',
      'memory_update',
      'concept_state_update',
      'artifact',
      'embedding'
    )
  );
