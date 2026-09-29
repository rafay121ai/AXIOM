drop policy if exists "Users own their memories" on personal_memories;

create policy "Users read own memories"
  on personal_memories for select
  using (auth.uid() = user_id);
