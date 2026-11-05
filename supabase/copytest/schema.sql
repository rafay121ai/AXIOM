create schema auth;
create table auth.users (id uuid primary key, email text, banned_until timestamptz);
create role anon; create role authenticated; create role service_role;

create sequence public.situation_turns_seq_seq;
create sequence public.learn_turns_seq_seq;
create table public.account_requests (id uuid default gen_random_uuid() not null, user_id uuid not null, kind text not null, status text default 'queued'::text not null, created_at timestamp with time zone default now() not null, delete_after timestamp with time zone);
create table public.app_sessions (id uuid default gen_random_uuid() not null, user_id uuid not null, started_at timestamp with time zone default now() not null, last_ping_at timestamp with time zone, ended_at timestamp with time zone, duration_seconds integer, entry_point text default 'direct'::text not null, messages_sent integer default 0 not null, device text);
create table public.care_events (id uuid default gen_random_uuid() not null, user_id uuid not null, level text not null, scope_id uuid, created_at timestamp with time zone default now() not null, resolved_at timestamp with time zone);
create table public.consent_log (id uuid default gen_random_uuid() not null, user_id uuid not null, report_id uuid, action text not null, wording_version text not null, decided_at timestamp with time zone default now() not null);
create table public.conversation_threads (id uuid default gen_random_uuid() not null, user_id uuid not null, session_id uuid not null, title text, started_at timestamp with time zone, last_message_at timestamp with time zone, message_count integer default 0 not null, status text default 'active'::text not null, primary_pillar text, created_at timestamp with time zone default now() not null, updated_at timestamp with time zone default now() not null);
create table public.experiments (id uuid default gen_random_uuid() not null, session_id uuid not null, user_id uuid not null, title text, description text not null, status text default 'active'::text not null, pillar text, topic text, source_message_id uuid, window_hours integer default 48 not null, reference_count integer default 0 not null, how_to_do_it text, real_world_example text, what_to_notice text, success_condition text, report text, result_summary text, assigned_at timestamp with time zone default now() not null, due_at timestamp with time zone default (now() + '48:00:00'::interval) not null, completed_at timestamp with time zone, legacy_key text, metadata jsonb default '{}'::jsonb not null, created_at timestamp with time zone default now() not null, updated_at timestamp with time zone default now() not null, cancelled_at timestamp with time zone, ghosted_at timestamp with time zone, outcome text, outcome_reason text);
create table public.founder_lesson_log (id uuid default gen_random_uuid() not null, user_id uuid not null, source_key text not null, slot smallint, created_at timestamp with time zone default now() not null);
create table public.founder_profiles (user_id uuid not null, stage text, business_model text, customer_markets text[] default '{}'::text[] not null, country text, goal text, deadline date, report_time_local time without time zone, timezone text, open_answers jsonb default '[]'::jsonb not null, created_at timestamp with time zone default now() not null, updated_at timestamp with time zone default now() not null, signup_answers jsonb default '{}'::jsonb not null, first_reading jsonb);
create table public.learn_conversations (id uuid default gen_random_uuid() not null, situation_id uuid not null, user_id uuid not null, offers integer[] default '{}'::integer[] not null, move_subject text, move_fact text, after_cap_said boolean default false not null, lock_token uuid, locked_at timestamp with time zone, created_at timestamp with time zone default now() not null, updated_at timestamp with time zone default now() not null);
create table public.learn_turns (id uuid default gen_random_uuid() not null, seq bigint not null, conversation_id uuid not null, role text not null, kind text, text text not null, filler boolean default false not null, client_turn_id uuid, result jsonb, evidence jsonb, sources jsonb default '[]'::jsonb not null, picture jsonb, follow_ups jsonb default '[]'::jsonb not null, validation jsonb default '[]'::jsonb not null, move_offer text default 'none'::text not null, move_notice jsonb, parent_turn_id uuid, followup_index integer, created_at timestamp with time zone default now() not null);
create table public.lesson_citations (id uuid default gen_random_uuid() not null, learn_turn_id uuid not null, chunk_ids uuid[] not null, author text not null, book_title text not null, quote text, created_at timestamp with time zone default now() not null);
create table public.messages (id uuid default gen_random_uuid() not null, session_id uuid, role text, content text, created_at timestamp with time zone default now(), thread_id uuid);
create table public.model_usage_logs (id uuid default gen_random_uuid() not null, user_id uuid not null, session_id uuid, thread_id uuid, message_id uuid, model text not null, prompt_tokens integer, completion_tokens integer, total_tokens integer, estimated_cost_usd numeric(10,6), call_type text not null, rag_chunks_used integer default 0 not null, latency_ms integer, error boolean default false not null, error_details text, created_at timestamp with time zone default now() not null);
create table public.moves (id uuid default gen_random_uuid() not null, user_id uuid not null, situation_id uuid not null, learn_id uuid not null, status text not null, title text not null, mission text not null, success_condition text not null, words text default ''::text not null, checklist jsonb not null, prediction text not null, start_minutes integer not null, hypothesis text not null, validation jsonb not null, swap_reason text, swap_count integer default 0 not null, swapped_from uuid, active_slot smallint, committed_at timestamp with time zone, report_due_at timestamp with time zone, report_time_local text, time_zone text, closes_at timestamp with time zone, closed_at timestamp with time zone, swapped_at timestamp with time zone, created_at timestamp with time zone default now() not null, updated_at timestamp with time zone default now() not null);
create table public.notification_log (id uuid default gen_random_uuid() not null, user_id uuid not null, kind text not null, dedupe_key text not null, local_day date not null, slot text not null, status text not null, attempts smallint default 1 not null, error text, move_id uuid, situation_id uuid, created_at timestamp with time zone default now() not null, sent_at timestamp with time zone, updated_at timestamp with time zone default now() not null);
create table public.outcome_author_links (peer_outcome_id uuid not null, user_id uuid not null, report_id uuid not null, created_at timestamp with time zone default now() not null, withdrawn_at timestamp with time zone);
create table public.peer_outcomes (id uuid default gen_random_uuid() not null, status text not null, stage text, customer_market text, business_model text, outcome text not null, draft jsonb, story text, lesson text, reviewed_by text, reviewed_at timestamp with time zone, withdrawn_at timestamp with time zone, created_at timestamp with time zone default now() not null);
create table public.peer_unlocks (id uuid default gen_random_uuid() not null, user_id uuid not null, granted_by_report_id uuid not null, kind text not null, used_on_situation_id uuid, created_at timestamp with time zone default now() not null);
create table public.personal_memories (id uuid default gen_random_uuid() not null, session_id uuid not null, type text not null, content text not null, importance integer default 3 not null, embedding real[] not null, created_at timestamp with time zone default now() not null, confidence double precision default 0.7 not null, use_count integer default 0 not null, last_used_at timestamp with time zone, updated_at timestamp with time zone default now() not null, user_id uuid, primary_pillar text, secondary_pillars text[] default '{}'::text[] not null, pillar_confidence double precision default 0.7 not null);
create table public.product_events (id uuid default gen_random_uuid() not null, user_id uuid not null, event text not null, properties jsonb default '{}'::jsonb not null, created_at timestamp with time zone default now() not null);
create table public.push_tokens (id uuid default gen_random_uuid() not null, user_id uuid not null, token text not null, platform text not null, timezone text, created_at timestamp with time zone default now() not null, updated_at timestamp with time zone default now() not null);
create table public.reads (id uuid default gen_random_uuid() not null, situation_id uuid not null, headline text, body text, closing_question text, source text, closing_answer text, skipped boolean default false not null, answered_at timestamp with time zone, created_at timestamp with time zone default now() not null);
create table public.reports (id uuid default gen_random_uuid() not null, user_id uuid not null, move_id uuid not null, situation_id uuid not null, outcome text not null, note text, client_turn_id uuid not null, prediction text not null, prediction_check text not null, reply text not null, reply_pending boolean default false not null, share_state text, share_automatic boolean default false not null, share_decided_at timestamp with time zone, consent_wording_version text, consent_versions text[], created_at timestamp with time zone default now() not null, updated_at timestamp with time zone default now() not null);
create table public.sessions (id uuid default gen_random_uuid() not null, session_token text, onboarding_answers jsonb, pillar_weights jsonb, axiom_profile text, created_at timestamp with time zone default now(), last_active timestamp with time zone default now(), session_notes text default ''::text, user_id uuid, concept_progress jsonb default '[]'::jsonb not null);
create table public.situation_turns (id uuid default gen_random_uuid() not null, seq bigint not null, situation_id uuid not null, role text not null, text text not null, filler boolean default false not null, client_turn_id uuid, result jsonb, created_at timestamp with time zone default now() not null);
create table public.situations (id uuid default gen_random_uuid() not null, user_id uuid not null, title text, status text default 'open'::text not null, follow_up_count integer default 0 not null, create_turn_id uuid, care_flag boolean default false not null, created_at timestamp with time zone default now() not null, last_activity_at timestamp with time zone default now() not null);
create table public.user_settings (user_id uuid not null, updated_at timestamp with time zone default now() not null, share_auto boolean default false not null, morning_on boolean default true not null, evening_on boolean default true not null, lock_screen text default 'short'::text not null, quiet_start time without time zone default '22:00:00'::time without time zone not null, quiet_end time without time zone default '06:00:00'::time without time zone not null, last_greeting text, keep_items boolean default false not null, mentor_style text default 'direct'::text not null, created_at timestamp with time zone default now() not null);
create table public.users (id uuid not null, email text not null, first_name text, created_at timestamp with time zone default now());
create table public.wiki_chunks (id uuid default gen_random_uuid() not null, pillar text, content_type text, title text, author text, key_frameworks text, embedding real[], created_at timestamp with time zone default now(), chunk_index integer, source_id uuid);
create table public.wiki_sources (id uuid default gen_random_uuid() not null, pillar text not null, content_type text not null, title text not null, author text, source_url text, source_key text, summary_for_retrieval text, source_quality text, created_at timestamp with time zone default now() not null, updated_at timestamp with time zone default now() not null, enrichment_status text default 'raw'::text, enrichment_version text, enriched_at timestamp with time zone, source_claims jsonb default '{}'::jsonb not null, axiom_interpretation jsonb default '{}'::jsonb not null, source_claims_confidence double precision, axiom_interpretation_confidence double precision, published_at timestamp with time zone);
CREATE OR REPLACE FUNCTION public.mark_personal_memories_used(memory_ids uuid[])
 RETURNS void
 LANGUAGE sql
AS $function$
  update personal_memories
  set
    use_count = use_count + 1,
    last_used_at = now(),
    updated_at = now()
  where id = any(memory_ids);
$function$
;
CREATE OR REPLACE FUNCTION public.set_experiments_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.sync_conversation_thread_from_message()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION public.take_follow_up(p_situation_id uuid, p_user_id uuid, p_now timestamp with time zone DEFAULT now())
 RETURNS integer
 LANGUAGE sql
 SET search_path TO ''
AS $function$
  update public.situations
     set follow_up_count = follow_up_count + 1,
         last_activity_at = p_now
   where id = p_situation_id
     and user_id = p_user_id
     and follow_up_count < 2
  returning follow_up_count;
$function$
;
CREATE OR REPLACE FUNCTION public.peer_outcomes_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  new.created_at := date_trunc('day', coalesce(new.created_at, now()), 'UTC');
  if new.status in ('approved', 'rejected') then
    new.draft := null;
  end if;
  return new;
end
$function$
;
CREATE OR REPLACE FUNCTION public.share_outcome(p_user_id uuid, p_report_id uuid, p_from text, p_automatic boolean, p_action text, p_wording_version text, p_peer jsonb, p_now timestamp with time zone)
 RETURNS SETOF reports
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  r public.reports;
  s public.situations;
  peer_id uuid;
begin
  if p_action is null or p_action not in ('share', 'auto_share') then
    raise exception 'share_outcome: p_action must be share or auto_share' using errcode = '22023';
  end if;
  if p_automatic is distinct from (p_action = 'auto_share') then
    raise exception 'share_outcome: p_automatic must match p_action' using errcode = '22023';
  end if;

  select * into r from public.reports
   where id = p_report_id and user_id = p_user_id
   for update;
  if not found or r.share_state is distinct from p_from or p_from in ('shared', 'not_offered') then
    return;
  end if;

  select * into s from public.situations where id = r.situation_id;
  if not found or s.care_flag then
    return;
  end if;
  if exists (
    select 1 from public.care_events e
     where e.user_id = p_user_id
       and ((e.level = 'clear' and e.resolved_at is null)
            or e.scope_id = s.id
            or e.created_at >= s.created_at)
  ) then
    return;
  end if;

  insert into public.consent_log (user_id, report_id, action, wording_version, decided_at)
  values (p_user_id, p_report_id, p_action, p_wording_version, p_now);

  insert into public.peer_outcomes (status, stage, customer_market, business_model, outcome, draft,
      story, lesson, reviewed_by, reviewed_at, withdrawn_at, created_at)
  values ('pending_review', p_peer->>'stage', p_peer->>'customer_market', p_peer->>'business_model',
      p_peer->>'outcome', p_peer->'draft', null, null, null, null, null, p_now)
  returning id into peer_id;

  insert into public.outcome_author_links (peer_outcome_id, user_id, report_id, created_at, withdrawn_at)
  values (peer_id, p_user_id, p_report_id, p_now, null);

  return query
    update public.reports
       set share_state = 'shared', share_automatic = p_automatic,
           share_decided_at = p_now, updated_at = p_now
     where id = p_report_id
    returning *;
end
$function$
;
CREATE OR REPLACE FUNCTION public.unshare_outcome(p_user_id uuid, p_report_id uuid, p_from text, p_to text, p_action text, p_wording_version text, p_now timestamp with time zone)
 RETURNS SETOF reports
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  r public.reports;
begin
  if p_to is null or p_to not in ('private', 'withdrawn', 'not_offered') then
    raise exception 'unshare_outcome: p_to must be private, withdrawn or not_offered' using errcode = '22023';
  end if;
  if (p_action is null) is distinct from (p_to = 'not_offered') then
    raise exception 'unshare_outcome: only not_offered goes without a consent action' using errcode = '22023';
  end if;

  select * into r from public.reports
   where id = p_report_id and user_id = p_user_id
   for update;
  if not found or r.share_state is distinct from p_from then
    return;
  end if;

  update public.peer_outcomes
     set status = 'withdrawn', draft = null, story = null, lesson = null, withdrawn_at = p_now
   where id in (
     select peer_outcome_id from public.outcome_author_links
      where report_id = p_report_id and user_id = p_user_id and withdrawn_at is null
   );

  update public.outcome_author_links
     set withdrawn_at = p_now
   where report_id = p_report_id and user_id = p_user_id and withdrawn_at is null;

  if p_action is not null then
    insert into public.consent_log (user_id, report_id, action, wording_version, decided_at)
    values (p_user_id, p_report_id, p_action, p_wording_version, p_now);
  end if;

  return query
    update public.reports
       set share_state = p_to, share_automatic = false,
           share_decided_at = p_now, updated_at = p_now
     where id = p_report_id
    returning *;
end
$function$
;
CREATE OR REPLACE FUNCTION public.delete_account(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  delete from public.peer_outcomes
   where status <> 'approved'
     and id in (select peer_outcome_id from public.outcome_author_links where user_id = p_user_id);
  delete from public.outcome_author_links where user_id = p_user_id;

  delete from public.peer_unlocks where user_id = p_user_id;
  delete from public.consent_log where user_id = p_user_id;
  delete from public.notification_log where user_id = p_user_id;
  delete from public.reports where user_id = p_user_id;
  delete from public.moves where user_id = p_user_id;

  delete from public.lesson_citations
   where learn_turn_id in (
     select t.id from public.learn_turns t
       join public.learn_conversations c on c.id = t.conversation_id
      where c.user_id = p_user_id);
  delete from public.learn_turns
   where conversation_id in (select id from public.learn_conversations where user_id = p_user_id);
  delete from public.learn_conversations where user_id = p_user_id;
  delete from public.situation_turns
   where situation_id in (select id from public.situations where user_id = p_user_id);
  delete from public.reads
   where situation_id in (select id from public.situations where user_id = p_user_id);
  delete from public.situations where user_id = p_user_id;

  delete from public.messages where session_id in (select id from public.sessions where user_id = p_user_id);
  delete from public.app_sessions where user_id = p_user_id;
  delete from public.conversation_threads where user_id = p_user_id;
  delete from public.experiments where user_id = p_user_id;
  delete from public.personal_memories where user_id = p_user_id;
  delete from public.model_usage_logs where user_id = p_user_id;
  delete from public.product_events where user_id = p_user_id;
  delete from public.sessions where user_id = p_user_id;

  delete from public.founder_lesson_log where user_id = p_user_id;
  delete from public.care_events where user_id = p_user_id;
  delete from public.push_tokens where user_id = p_user_id;
  delete from public.user_settings where user_id = p_user_id;
  delete from public.users where id = p_user_id;
  delete from public.founder_profiles where user_id = p_user_id;
  delete from public.account_requests where user_id = p_user_id;
end
$function$
;
alter table public.account_requests add constraint account_requests_pkey PRIMARY KEY (id);
alter table public.app_sessions add constraint app_sessions_pkey PRIMARY KEY (id);
alter table public.care_events add constraint care_events_pkey PRIMARY KEY (id);
alter table public.consent_log add constraint consent_log_pkey PRIMARY KEY (id);
alter table public.conversation_threads add constraint conversation_threads_pkey PRIMARY KEY (id);
alter table public.experiments add constraint experiments_pkey PRIMARY KEY (id);
alter table public.founder_lesson_log add constraint founder_lesson_log_pkey PRIMARY KEY (id);
alter table public.founder_profiles add constraint founder_profiles_pkey PRIMARY KEY (user_id);
alter table public.learn_conversations add constraint learn_conversations_pkey PRIMARY KEY (id);
alter table public.learn_turns add constraint learn_turns_pkey PRIMARY KEY (id);
alter table public.lesson_citations add constraint lesson_citations_pkey PRIMARY KEY (id);
alter table public.messages add constraint messages_pkey PRIMARY KEY (id);
alter table public.model_usage_logs add constraint model_usage_logs_pkey PRIMARY KEY (id);
alter table public.moves add constraint moves_pkey PRIMARY KEY (id);
alter table public.notification_log add constraint notification_log_pkey PRIMARY KEY (id);
alter table public.outcome_author_links add constraint outcome_author_links_pkey PRIMARY KEY (peer_outcome_id);
alter table public.peer_outcomes add constraint peer_outcomes_pkey PRIMARY KEY (id);
alter table public.peer_unlocks add constraint peer_unlocks_pkey PRIMARY KEY (id);
alter table public.personal_memories add constraint personal_memories_pkey PRIMARY KEY (id);
alter table public.product_events add constraint product_events_pkey PRIMARY KEY (id);
alter table public.push_tokens add constraint push_tokens_pkey PRIMARY KEY (id);
alter table public.reads add constraint reads_pkey PRIMARY KEY (id);
alter table public.reports add constraint reports_pkey PRIMARY KEY (id);
alter table public.sessions add constraint sessions_pkey PRIMARY KEY (id);
alter table public.situation_turns add constraint situation_turns_pkey PRIMARY KEY (id);
alter table public.situations add constraint situations_pkey PRIMARY KEY (id);
alter table public.user_settings add constraint user_settings_pkey PRIMARY KEY (user_id);
alter table public.users add constraint users_pkey PRIMARY KEY (id);
alter table public.wiki_chunks add constraint wiki_chunks_pkey PRIMARY KEY (id);
alter table public.wiki_sources add constraint wiki_sources_pkey PRIMARY KEY (id);
alter table public.experiments add constraint experiments_legacy_key_key UNIQUE (legacy_key);
alter table public.sessions add constraint sessions_session_token_key UNIQUE (session_token);
alter table public.wiki_sources add constraint wiki_sources_source_key_key UNIQUE (source_key);
alter table public.account_requests add constraint account_requests_kind_check CHECK ((kind = ANY (ARRAY['export'::text, 'delete'::text])));
alter table public.app_sessions add constraint app_sessions_entry_point_check CHECK ((entry_point = ANY (ARRAY['direct'::text, 'resume'::text, 'experiment'::text])));
alter table public.care_events add constraint care_events_level_check CHECK ((level = ANY (ARRAY['unclear'::text, 'clear'::text])));
alter table public.consent_log add constraint consent_log_action_check CHECK ((action = ANY (ARRAY['asked'::text, 'share'::text, 'auto_share'::text, 'keep_private'::text, 'withdraw'::text, 'auto_share_on'::text, 'auto_share_off'::text])));
alter table public.conversation_threads add constraint conversation_threads_status_check CHECK ((status = ANY (ARRAY['active'::text, 'closed'::text])));
alter table public.conversation_threads add constraint conversation_threads_primary_pillar_check CHECK ((primary_pillar = ANY (ARRAY['human_mind'::text, 'money_game'::text, 'how_companies_win'::text, 'whats_coming'::text, 'think_sharper'::text, 'move_people'::text])));
alter table public.experiments add constraint experiments_pillar_check CHECK ((pillar = ANY (ARRAY['human_mind'::text, 'money_game'::text, 'how_companies_win'::text, 'whats_coming'::text, 'think_sharper'::text, 'move_people'::text])));
alter table public.experiments add constraint experiments_outcome_reason_check CHECK (((outcome_reason IS NULL) OR (outcome_reason = ANY (ARRAY['couldnt'::text, 'didnt'::text, 'ghosted'::text]))));
alter table public.experiments add constraint experiments_reference_count_check CHECK ((reference_count >= 0));
alter table public.experiments add constraint experiments_status_check CHECK ((status = ANY (ARRAY['active'::text, 'completed'::text, 'cancelled'::text, 'ghosted'::text, 'reset'::text, 'replaced'::text])));
alter table public.experiments add constraint experiments_window_hours_check CHECK ((window_hours > 0));
alter table public.founder_lesson_log add constraint founder_lesson_log_slot_check CHECK ((slot = ANY (ARRAY[1, 2])));
alter table public.founder_profiles add constraint founder_profiles_timezone_len CHECK (((timezone IS NULL) OR (char_length(timezone) <= 64)));
alter table public.founder_profiles add constraint founder_profiles_business_model_check CHECK ((business_model = ANY (ARRAY['b2b'::text, 'b2c'::text, 'marketplace'::text, 'services'::text, 'other'::text])));
alter table public.founder_profiles add constraint founder_profiles_country_len CHECK (((country IS NULL) OR (char_length(country) <= 80)));
alter table public.founder_profiles add constraint founder_profiles_customer_markets_max CHECK ((cardinality(customer_markets) <= 10));
alter table public.founder_profiles add constraint founder_profiles_first_reading_object CHECK (((first_reading IS NULL) OR (jsonb_typeof(first_reading) = 'object'::text)));
alter table public.founder_profiles add constraint founder_profiles_goal_len CHECK (((goal IS NULL) OR (char_length(goal) <= 1000)));
alter table public.founder_profiles add constraint founder_profiles_open_answers_array CHECK ((jsonb_typeof(open_answers) = 'array'::text));
alter table public.founder_profiles add constraint founder_profiles_open_answers_max CHECK ((jsonb_array_length(open_answers) <= 3));
alter table public.founder_profiles add constraint founder_profiles_signup_answers_object CHECK ((jsonb_typeof(signup_answers) = 'object'::text));
alter table public.founder_profiles add constraint founder_profiles_stage_check CHECK ((stage = ANY (ARRAY['idea'::text, 'validating'::text, 'first_paying_customer'::text, 'first_10_customers'::text, 'repeatable_sales'::text, 'scaling'::text])));
alter table public.learn_conversations add constraint learn_conversations_offers_max CHECK ((cardinality(offers) <= 2));
alter table public.learn_turns add constraint learn_turns_move_offer_check CHECK ((move_offer = ANY (ARRAY['none'::text, 'first'::text, 'second'::text])));
alter table public.learn_turns add constraint learn_turns_kind_check CHECK (((kind IS NULL) OR (kind = ANY (ARRAY['lesson'::text, 'reply'::text, 'followup'::text]))));
alter table public.learn_turns add constraint learn_turns_role_check CHECK ((role = ANY (ARRAY['founder'::text, 'axiom'::text])));
alter table public.model_usage_logs add constraint model_usage_logs_call_type_check CHECK ((call_type = ANY (ARRAY['chat'::text, 'query_expansion'::text, 'onboarding'::text, 'memory_update'::text, 'concept_state_update'::text, 'embedding'::text, 'read'::text, 'learn'::text, 'followup'::text, 'move'::text, 'care'::text, 'report'::text, 'memory'::text]))) NOT VALID;
alter table public.moves add constraint moves_active_slot_check CHECK (((active_slot IS NULL) OR (active_slot = ANY (ARRAY[1, 2]))));
alter table public.moves add constraint moves_checklist_check CHECK (((jsonb_typeof(checklist) = 'array'::text) AND ((jsonb_array_length(checklist) >= 2) AND (jsonb_array_length(checklist) <= 4))));
alter table public.moves add constraint moves_time_zone_len CHECK (((time_zone IS NULL) OR (char_length(time_zone) <= 64)));
alter table public.moves add constraint moves_swap_count_check CHECK (((swap_count >= 0) AND (swap_count <= 1)));
alter table public.moves add constraint moves_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'committed'::text, 'report_due'::text, 'reported'::text, 'closed_no_report'::text, 'swapped'::text])));
alter table public.moves add constraint moves_start_minutes_check CHECK (((start_minutes >= 1) AND (start_minutes <= 10)));
alter table public.moves add constraint moves_report_time_local_check CHECK (((report_time_local IS NULL) OR (report_time_local ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'::text)));
alter table public.notification_log add constraint notification_log_attempts_check CHECK (((attempts >= 1) AND (attempts <= 3)));
alter table public.notification_log add constraint notification_log_status_check CHECK ((status = ANY (ARRAY['sending'::text, 'sent'::text, 'failed'::text])));
alter table public.notification_log add constraint notification_log_slot_check CHECK ((slot = ANY (ARRAY['morning'::text, 'evening'::text])));
alter table public.notification_log add constraint notification_log_kind_check CHECK ((kind = ANY (ARRAY['morning'::text, 'quiet_check'::text, 'evening'::text, 'reminder'::text])));
alter table public.peer_outcomes add constraint peer_outcomes_status_check CHECK ((status = ANY (ARRAY['pending_review'::text, 'approved'::text, 'rejected'::text, 'withdrawn'::text])));
alter table public.peer_outcomes add constraint peer_outcomes_outcome_check CHECK ((outcome = ANY (ARRAY['done'::text, 'couldnt'::text, 'didnt'::text])));
alter table public.peer_unlocks add constraint peer_unlocks_kind_check CHECK ((kind = ANY (ARRAY['report'::text, 'share'::text])));
alter table public.personal_memories add constraint personal_memories_primary_pillar_check CHECK ((primary_pillar = ANY (ARRAY['human_mind'::text, 'money_game'::text, 'how_companies_win'::text, 'whats_coming'::text, 'think_sharper'::text, 'move_people'::text])));
alter table public.personal_memories add constraint personal_memories_pillar_confidence_check CHECK (((pillar_confidence >= (0)::double precision) AND (pillar_confidence <= (1)::double precision)));
alter table public.personal_memories add constraint personal_memories_type_check CHECK ((type = ANY (ARRAY['goal'::text, 'pattern'::text, 'belief'::text, 'experiment_result'::text, 'preference'::text, 'decision'::text, 'fact'::text])));
alter table public.personal_memories add constraint personal_memories_confidence_check CHECK (((confidence >= (0)::double precision) AND (confidence <= (1)::double precision)));
alter table public.personal_memories add constraint personal_memories_importance_check CHECK (((importance >= 1) AND (importance <= 5)));
alter table public.product_events add constraint product_events_event_check CHECK ((event = ANY (ARRAY['onboarding_completed'::text, 'chat_started'::text, 'message_sent'::text, 'experiment_created'::text, 'experiment_committed'::text, 'experiment_reported'::text, 'thread_resumed'::text])));
alter table public.push_tokens add constraint push_tokens_platform_check CHECK ((platform = ANY (ARRAY['ios'::text, 'android'::text])));
alter table public.push_tokens add constraint push_tokens_timezone_len CHECK (((timezone IS NULL) OR (char_length(timezone) <= 64)));
alter table public.reads add constraint reads_source_check CHECK (((source IS NULL) OR (source = ANY (ARRAY['model'::text, 'fallback'::text]))));
alter table public.reports add constraint reports_outcome_check CHECK ((outcome = ANY (ARRAY['done'::text, 'couldnt'::text, 'didnt'::text])));
alter table public.reports add constraint reports_prediction_check_check CHECK ((prediction_check = ANY (ARRAY['right'::text, 'wrong'::text, 'unclear'::text, 'not_tested'::text])));
alter table public.reports add constraint reports_share_state_check CHECK (((share_state IS NULL) OR (share_state = ANY (ARRAY['asked'::text, 'shared'::text, 'private'::text, 'withdrawn'::text, 'not_offered'::text]))));
alter table public.situation_turns add constraint situation_turns_role_check CHECK ((role = ANY (ARRAY['founder'::text, 'axiom'::text])));
alter table public.situations add constraint situations_status_check CHECK ((status = ANY (ARRAY['open'::text, 'paused'::text, 'closed'::text])));
alter table public.situations add constraint situations_follow_up_count_check CHECK (((follow_up_count >= 0) AND (follow_up_count <= 2)));
alter table public.user_settings add constraint user_settings_last_greeting_len CHECK (((last_greeting IS NULL) OR (char_length(last_greeting) <= 64))) NOT VALID;
alter table public.user_settings add constraint user_settings_lock_screen_check CHECK ((lock_screen = ANY (ARRAY['full'::text, 'short'::text, 'hidden'::text]))) NOT VALID;
alter table public.user_settings add constraint user_settings_mentor_style_check CHECK ((mentor_style = ANY (ARRAY['calm'::text, 'direct'::text, 'hard'::text]))) NOT VALID;
alter table public.wiki_sources add constraint wiki_sources_enrichment_status_check CHECK ((enrichment_status = ANY (ARRAY['raw'::text, 'claims_extracted'::text, 'interpreted'::text, 'failed'::text])));
alter table public.wiki_sources add constraint wiki_sources_source_quality_check CHECK (((source_quality IS NULL) OR (source_quality = ANY (ARRAY['foundational'::text, 'high_signal'::text, 'speculative'::text, 'mixed'::text]))));
alter table public.wiki_sources add constraint wiki_sources_source_claims_confidence_check CHECK (((source_claims_confidence IS NULL) OR ((source_claims_confidence >= (0)::double precision) AND (source_claims_confidence <= (1)::double precision))));
alter table public.wiki_sources add constraint wiki_sources_axiom_interpretation_confidence_check CHECK (((axiom_interpretation_confidence IS NULL) OR ((axiom_interpretation_confidence >= (0)::double precision) AND (axiom_interpretation_confidence <= (1)::double precision))));
alter table public.account_requests add constraint account_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);
alter table public.app_sessions add constraint app_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.care_events add constraint care_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.consent_log add constraint consent_log_report_id_fkey FOREIGN KEY (report_id) REFERENCES reports(id);
alter table public.consent_log add constraint consent_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);
alter table public.conversation_threads add constraint conversation_threads_session_id_fkey FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
alter table public.conversation_threads add constraint conversation_threads_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.experiments add constraint experiments_session_id_fkey FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
alter table public.experiments add constraint experiments_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.experiments add constraint experiments_source_message_id_fkey FOREIGN KEY (source_message_id) REFERENCES messages(id) ON DELETE SET NULL;
alter table public.founder_lesson_log add constraint founder_lesson_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);
alter table public.founder_profiles add constraint founder_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.learn_conversations add constraint learn_conversations_situation_id_fkey FOREIGN KEY (situation_id) REFERENCES situations(id) ON DELETE CASCADE;
alter table public.learn_conversations add constraint learn_conversations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);
alter table public.learn_turns add constraint learn_turns_parent_turn_id_fkey FOREIGN KEY (parent_turn_id) REFERENCES learn_turns(id);
alter table public.learn_turns add constraint learn_turns_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES learn_conversations(id) ON DELETE CASCADE;
alter table public.lesson_citations add constraint lesson_citations_learn_turn_id_fkey FOREIGN KEY (learn_turn_id) REFERENCES learn_turns(id) ON DELETE CASCADE;
alter table public.messages add constraint messages_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES conversation_threads(id) ON DELETE SET NULL NOT VALID;
alter table public.messages add constraint messages_session_id_fkey FOREIGN KEY (session_id) REFERENCES sessions(id);
alter table public.model_usage_logs add constraint model_usage_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.model_usage_logs add constraint model_usage_logs_session_id_fkey FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL;
alter table public.model_usage_logs add constraint model_usage_logs_message_id_fkey FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE SET NULL;
alter table public.moves add constraint moves_swapped_from_fkey FOREIGN KEY (swapped_from) REFERENCES moves(id);
alter table public.moves add constraint moves_learn_id_fkey FOREIGN KEY (learn_id) REFERENCES learn_conversations(id) ON DELETE CASCADE;
alter table public.moves add constraint moves_situation_id_fkey FOREIGN KEY (situation_id) REFERENCES situations(id) ON DELETE CASCADE;
alter table public.moves add constraint moves_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);
alter table public.notification_log add constraint notification_log_situation_id_fkey FOREIGN KEY (situation_id) REFERENCES situations(id) ON DELETE SET NULL;
alter table public.notification_log add constraint notification_log_move_id_fkey FOREIGN KEY (move_id) REFERENCES moves(id) ON DELETE SET NULL;
alter table public.notification_log add constraint notification_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.outcome_author_links add constraint outcome_author_links_peer_outcome_id_fkey FOREIGN KEY (peer_outcome_id) REFERENCES peer_outcomes(id) ON DELETE CASCADE;
alter table public.outcome_author_links add constraint outcome_author_links_report_id_fkey FOREIGN KEY (report_id) REFERENCES reports(id);
alter table public.outcome_author_links add constraint outcome_author_links_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);
alter table public.peer_unlocks add constraint peer_unlocks_used_on_situation_id_fkey FOREIGN KEY (used_on_situation_id) REFERENCES situations(id);
alter table public.peer_unlocks add constraint peer_unlocks_granted_by_report_id_fkey FOREIGN KEY (granted_by_report_id) REFERENCES reports(id);
alter table public.peer_unlocks add constraint peer_unlocks_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);
alter table public.personal_memories add constraint personal_memories_session_id_fkey FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE;
alter table public.personal_memories add constraint personal_memories_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);
alter table public.product_events add constraint product_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.push_tokens add constraint push_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.reads add constraint reads_situation_id_fkey FOREIGN KEY (situation_id) REFERENCES situations(id) ON DELETE CASCADE;
alter table public.reports add constraint reports_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);
alter table public.reports add constraint reports_situation_id_fkey FOREIGN KEY (situation_id) REFERENCES situations(id) ON DELETE CASCADE;
alter table public.reports add constraint reports_move_id_fkey FOREIGN KEY (move_id) REFERENCES moves(id);
alter table public.sessions add constraint sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.situation_turns add constraint situation_turns_situation_id_fkey FOREIGN KEY (situation_id) REFERENCES situations(id) ON DELETE CASCADE;
alter table public.situations add constraint situations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);
alter table public.user_settings add constraint user_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);
alter table public.users add constraint users_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
alter table public.wiki_chunks add constraint wiki_chunks_source_id_fkey FOREIGN KEY (source_id) REFERENCES wiki_sources(id) ON DELETE SET NULL;
CREATE INDEX conversation_threads_user_last_message_idx ON public.conversation_threads USING btree (user_id, last_message_at DESC);
CREATE INDEX model_usage_logs_user_created_idx ON public.model_usage_logs USING btree (user_id, created_at DESC);
CREATE INDEX messages_session_thread_created_idx ON public.messages USING btree (session_id, thread_id, created_at);
CREATE UNIQUE INDEX learn_turns_conversation_client_turn_key ON public.learn_turns USING btree (conversation_id, client_turn_id) WHERE (client_turn_id IS NOT NULL);
CREATE INDEX experiments_user_status_idx ON public.experiments USING btree (user_id, status, assigned_at DESC);
CREATE INDEX lesson_citations_turn_idx ON public.lesson_citations USING btree (learn_turn_id);
CREATE INDEX outcome_author_links_report_idx ON public.outcome_author_links USING btree (report_id);
CREATE INDEX personal_memories_user_created_idx ON public.personal_memories USING btree (user_id, created_at DESC);
CREATE INDEX model_usage_logs_call_type_created_idx ON public.model_usage_logs USING btree (call_type, created_at DESC);
CREATE INDEX outcome_author_links_user_idx ON public.outcome_author_links USING btree (user_id);
CREATE UNIQUE INDEX moves_learn_first_key ON public.moves USING btree (learn_id) WHERE (swapped_from IS NULL);
CREATE INDEX peer_outcomes_status_stage_idx ON public.peer_outcomes USING btree (status, stage);
CREATE UNIQUE INDEX moves_swapped_from_key ON public.moves USING btree (swapped_from) WHERE (swapped_from IS NOT NULL);
CREATE UNIQUE INDEX notification_log_user_dedupe_key ON public.notification_log USING btree (user_id, dedupe_key);
CREATE INDEX app_sessions_user_last_ping_idx ON public.app_sessions USING btree (user_id, last_ping_at DESC);
CREATE UNIQUE INDEX account_requests_user_kind_queued_key ON public.account_requests USING btree (user_id, kind) WHERE (status = 'queued'::text);
CREATE UNIQUE INDEX sessions_user_id_unique_idx ON public.sessions USING btree (user_id);
CREATE INDEX sessions_user_id_created_at_idx ON public.sessions USING btree (user_id, created_at DESC);
CREATE INDEX reports_situation_idx ON public.reports USING btree (situation_id);
CREATE UNIQUE INDEX situation_turns_situation_client_turn_key ON public.situation_turns USING btree (situation_id, client_turn_id) WHERE (client_turn_id IS NOT NULL);
CREATE INDEX personal_memories_session_created_idx ON public.personal_memories USING btree (session_id, created_at DESC);
CREATE INDEX model_usage_logs_session_created_idx ON public.model_usage_logs USING btree (session_id, created_at DESC);
CREATE UNIQUE INDEX learn_turns_seq_key ON public.learn_turns USING btree (seq);
CREATE INDEX consent_log_user_decided_idx ON public.consent_log USING btree (user_id, decided_at);
CREATE UNIQUE INDEX learn_conversations_situation_key ON public.learn_conversations USING btree (situation_id);
CREATE INDEX learn_turns_conversation_seq_idx ON public.learn_turns USING btree (conversation_id, seq);
CREATE INDEX learn_conversations_user_idx ON public.learn_conversations USING btree (user_id, situation_id);
CREATE INDEX situations_status_activity_idx ON public.situations USING btree (status, last_activity_at);
CREATE INDEX wiki_sources_pillar_idx ON public.wiki_sources USING btree (pillar);
CREATE UNIQUE INDEX reads_situation_key ON public.reads USING btree (situation_id);
CREATE INDEX moves_situation_idx ON public.moves USING btree (situation_id);
CREATE INDEX care_events_user_created_idx ON public.care_events USING btree (user_id, created_at DESC);
CREATE UNIQUE INDEX push_tokens_token_key ON public.push_tokens USING btree (token);
CREATE INDEX wiki_chunks_source_id_idx ON public.wiki_chunks USING btree (source_id);
CREATE UNIQUE INDEX situation_turns_seq_key ON public.situation_turns USING btree (seq);
CREATE INDEX experiments_user_topic_assigned_idx ON public.experiments USING btree (user_id, topic, assigned_at DESC);
CREATE INDEX wiki_sources_content_type_idx ON public.wiki_sources USING btree (content_type);
CREATE UNIQUE INDEX reports_move_key ON public.reports USING btree (move_id);
CREATE INDEX personal_memories_user_primary_pillar_idx ON public.personal_memories USING btree (user_id, primary_pillar, updated_at DESC);
CREATE INDEX moves_user_status_created_idx ON public.moves USING btree (user_id, status, created_at);
CREATE UNIQUE INDEX account_requests_user_pending_key ON public.account_requests USING btree (user_id) WHERE ((kind = 'delete'::text) AND (status = 'pending'::text));
CREATE INDEX moves_learn_created_idx ON public.moves USING btree (learn_id, created_at DESC);
CREATE INDEX product_events_user_created_idx ON public.product_events USING btree (user_id, created_at DESC);
CREATE INDEX personal_memories_user_id_idx ON public.personal_memories USING btree (user_id);
CREATE UNIQUE INDEX learn_turns_parent_followup_key ON public.learn_turns USING btree (parent_turn_id, followup_index) WHERE ((parent_turn_id IS NOT NULL) AND (followup_index IS NOT NULL));
CREATE INDEX wiki_sources_title_idx ON public.wiki_sources USING btree (title);
CREATE INDEX experiments_session_status_assigned_idx ON public.experiments USING btree (session_id, status, assigned_at DESC);
CREATE UNIQUE INDEX founder_lesson_log_slot_key ON public.founder_lesson_log USING btree (user_id, slot);
CREATE INDEX product_events_event_created_idx ON public.product_events USING btree (event, created_at DESC);
CREATE INDEX notification_log_user_created_idx ON public.notification_log USING btree (user_id, created_at DESC);
CREATE INDEX consent_log_report_idx ON public.consent_log USING btree (report_id);
CREATE INDEX situation_turns_situation_seq_idx ON public.situation_turns USING btree (situation_id, seq);
CREATE UNIQUE INDEX notification_log_user_day_slot_key ON public.notification_log USING btree (user_id, local_day, slot) WHERE (status = ANY (ARRAY['sending'::text, 'sent'::text]));
CREATE INDEX peer_unlocks_user_idx ON public.peer_unlocks USING btree (user_id);
CREATE INDEX conversation_threads_session_last_message_idx ON public.conversation_threads USING btree (session_id, last_message_at DESC);
CREATE UNIQUE INDEX founder_lesson_log_source_key ON public.founder_lesson_log USING btree (user_id, source_key);
CREATE UNIQUE INDEX moves_user_active_slot_key ON public.moves USING btree (user_id, active_slot) WHERE (active_slot IS NOT NULL);
CREATE INDEX reports_user_created_idx ON public.reports USING btree (user_id, created_at DESC);
CREATE INDEX push_tokens_user_updated_idx ON public.push_tokens USING btree (user_id, updated_at DESC);
CREATE INDEX care_events_user_open_idx ON public.care_events USING btree (user_id) WHERE (resolved_at IS NULL);
CREATE INDEX situations_user_created_idx ON public.situations USING btree (user_id, created_at);
CREATE INDEX moves_status_report_due_idx ON public.moves USING btree (status, report_due_at);
CREATE INDEX wiki_sources_published_at_idx ON public.wiki_sources USING btree (published_at DESC);
CREATE UNIQUE INDEX situations_user_create_turn_key ON public.situations USING btree (user_id, create_turn_id) WHERE (create_turn_id IS NOT NULL);
CREATE UNIQUE INDEX peer_unlocks_report_kind_key ON public.peer_unlocks USING btree (granted_by_report_id, kind);
CREATE INDEX experiments_user_status_due_idx ON public.experiments USING btree (user_id, status, due_at);
CREATE INDEX app_sessions_user_started_idx ON public.app_sessions USING btree (user_id, started_at DESC);
CREATE INDEX situations_user_status_activity_idx ON public.situations USING btree (user_id, status, last_activity_at DESC);
CREATE INDEX conversation_threads_user_status_idx ON public.conversation_threads USING btree (user_id, status, updated_at DESC);
CREATE TRIGGER experiments_set_updated_at BEFORE UPDATE ON public.experiments FOR EACH ROW EXECUTE FUNCTION set_experiments_updated_at();
CREATE TRIGGER messages_sync_conversation_thread AFTER INSERT OR DELETE OR UPDATE OF thread_id, created_at ON public.messages FOR EACH ROW EXECUTE FUNCTION sync_conversation_thread_from_message();
CREATE TRIGGER peer_outcomes_guard BEFORE INSERT OR UPDATE ON public.peer_outcomes FOR EACH ROW EXECUTE FUNCTION peer_outcomes_guard();
