-- MESSAGES
alter table messages enable row level security;

create policy "Users own their messages"
  on messages for all
  using (
    auth.uid() = (
      select user_id from sessions where id = messages.session_id
    )
  );

-- WEEKLY READS
alter table weekly_reads enable row level security;

create policy "Users own their weekly reads"
  on weekly_reads for all
  using (
    auth.uid() = (
      select user_id from sessions where id = weekly_reads.session_id
    )
  );
