create table if not exists model_usage_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid references sessions(id) on delete set null,
  thread_id uuid,
  message_id uuid references messages(id) on delete set null,
  model text not null,
  prompt_tokens int not null default 0,
  completion_tokens int not null default 0,
  total_tokens int not null default 0,
  estimated_cost_usd numeric(10,6) not null default 0,
  call_type text not null check (
    call_type in ('chat', 'query_expansion', 'onboarding', 'session_notes', 'memory_update', 'artifact', 'embedding')
  ),
  rag_chunks_used int not null default 0,
  latency_ms int,
  error boolean not null default false,
  error_details text,
  created_at timestamptz not null default now()
);

create index if not exists model_usage_logs_user_created_idx
  on model_usage_logs (user_id, created_at desc);

create index if not exists model_usage_logs_session_created_idx
  on model_usage_logs (session_id, created_at desc);

create index if not exists model_usage_logs_call_type_created_idx
  on model_usage_logs (call_type, created_at desc);

alter table model_usage_logs enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'model_usage_logs'
      and policyname = 'Users own their model usage logs'
  ) then
    create policy "Users own their model usage logs"
      on model_usage_logs for all
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;

create table if not exists app_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  last_ping_at timestamptz,
  ended_at timestamptz,
  duration_seconds int,
  entry_point text not null default 'direct' check (
    entry_point in ('direct', 'resume', 'experiment', 'brain')
  ),
  messages_sent int not null default 0,
  device text
);

create index if not exists app_sessions_user_started_idx
  on app_sessions (user_id, started_at desc);

create index if not exists app_sessions_user_last_ping_idx
  on app_sessions (user_id, last_ping_at desc);

alter table app_sessions enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'app_sessions'
      and policyname = 'Users own their app sessions'
  ) then
    create policy "Users own their app sessions"
      on app_sessions for all
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;

create table if not exists conversation_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references sessions(id) on delete cascade,
  title text,
  started_at timestamptz,
  last_message_at timestamptz,
  message_count int not null default 0,
  status text not null default 'active' check (status in ('active', 'closed')),
  primary_pillar text check (
    primary_pillar in (
      'human_mind',
      'money_game',
      'how_companies_win',
      'whats_coming',
      'think_sharper',
      'move_people'
    )
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists conversation_threads_user_last_message_idx
  on conversation_threads (user_id, last_message_at desc);

create index if not exists conversation_threads_session_last_message_idx
  on conversation_threads (session_id, last_message_at desc);

create index if not exists conversation_threads_user_status_idx
  on conversation_threads (user_id, status, updated_at desc);

alter table conversation_threads enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'conversation_threads'
      and policyname = 'Users own their conversation threads'
  ) then
    create policy "Users own their conversation threads"
      on conversation_threads for all
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;

insert into conversation_threads (
  id,
  user_id,
  session_id,
  title,
  started_at,
  last_message_at,
  message_count,
  status,
  created_at,
  updated_at
)
select
  m.thread_id,
  s.user_id,
  m.session_id,
  left(
    coalesce(
      nullif(
        trim((array_agg(m.content order by m.created_at) filter (where m.role = 'user'))[1]),
        ''
      ),
      'Branch thread'
    ),
    80
  ),
  min(m.created_at),
  max(m.created_at),
  count(*)::int,
  'active',
  coalesce(min(m.created_at), now()),
  now()
from messages m
join sessions s on s.id = m.session_id
where m.thread_id is not null
  and s.user_id is not null
group by m.thread_id, s.user_id, m.session_id
on conflict (id) do update
set
  user_id = excluded.user_id,
  session_id = excluded.session_id,
  title = coalesce(conversation_threads.title, excluded.title),
  started_at = coalesce(conversation_threads.started_at, excluded.started_at),
  last_message_at = excluded.last_message_at,
  message_count = excluded.message_count,
  updated_at = now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'messages_thread_id_fkey'
      and conrelid = 'public.messages'::regclass
  ) then
    alter table messages
      add constraint messages_thread_id_fkey
      foreign key (thread_id)
      references conversation_threads(id)
      on delete set null
      not valid;
  end if;
end $$;

create or replace function sync_conversation_thread_from_message()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    if new.thread_id is not null then
      update conversation_threads
      set
        message_count = message_count + 1,
        last_message_at = greatest(coalesce(last_message_at, new.created_at), new.created_at),
        updated_at = now()
      where id = new.thread_id;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.thread_id is distinct from new.thread_id then
      if old.thread_id is not null then
        update conversation_threads
        set
          message_count = greatest(0, message_count - 1),
          last_message_at = (
            select max(created_at) from messages where thread_id = old.thread_id
          ),
          updated_at = now()
        where id = old.thread_id;
      end if;

      if new.thread_id is not null then
        update conversation_threads
        set
          message_count = message_count + 1,
          last_message_at = greatest(coalesce(last_message_at, new.created_at), new.created_at),
          updated_at = now()
        where id = new.thread_id;
      end if;
    elsif new.thread_id is not null and old.created_at is distinct from new.created_at then
      update conversation_threads
      set
        last_message_at = (
          select max(created_at) from messages where thread_id = new.thread_id
        ),
        updated_at = now()
      where id = new.thread_id;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.thread_id is not null then
      update conversation_threads
      set
        message_count = greatest(0, message_count - 1),
        last_message_at = (
          select max(created_at) from messages where thread_id = old.thread_id
        ),
        updated_at = now()
      where id = old.thread_id;
    end if;
    return old;
  end if;

  return null;
end;
$$;

drop trigger if exists messages_sync_conversation_thread on messages;
create trigger messages_sync_conversation_thread
after insert or update of thread_id, created_at or delete on messages
for each row execute function sync_conversation_thread_from_message();
