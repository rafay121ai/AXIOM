alter table experiments
  add column if not exists outcome_reason text;

alter table experiments
  drop constraint if exists experiments_outcome_reason_check;

alter table experiments
  add constraint experiments_outcome_reason_check
  check (
    outcome_reason is null
    or outcome_reason in ('couldnt', 'didnt', 'ghosted')
  );
