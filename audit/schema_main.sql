--
-- PostgreSQL database dump
--

\restrict f4oV57brWiraKegcRNQLuw7jaOtueZ8hG3Pv6e0izhNCnZLdtQDPLZ0VB3xL3NI

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.11 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: find_similar_personal_memory(public.vector, uuid, text, double precision); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.find_similar_personal_memory(query_embedding public.vector, match_user_id uuid, match_type text, similarity_threshold double precision DEFAULT 0.82) RETURNS TABLE(id uuid, content text, importance integer, confidence double precision, primary_pillar text, secondary_pillars text[], pillar_confidence double precision, similarity double precision)
    LANGUAGE sql STABLE
    AS $$
  select
    pm.id,
    pm.content,
    pm.importance,
    pm.confidence,
    pm.primary_pillar,
    pm.secondary_pillars,
    pm.pillar_confidence,
    1 - (pm.embedding <=> query_embedding) as similarity
  from personal_memories pm
  where pm.user_id = match_user_id
    and pm.type = match_type
    and 1 - (pm.embedding <=> query_embedding) >= similarity_threshold
  order by pm.embedding <=> query_embedding
  limit 1;
$$;


--
-- Name: get_personal_wiki_graph(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_personal_wiki_graph(match_session_id uuid) RETURNS jsonb
    LANGUAGE sql STABLE
    AS $$
  select jsonb_build_object(
    'nodes',
    coalesce(
      (
        select jsonb_agg(to_jsonb(n) order by n.importance desc, n.updated_at desc)
        from (
          select distinct on (lower(n.label), n.type) n.*
          from personal_wiki_nodes n
          join sessions s on s.id = n.session_id
          where s.user_id = (select user_id from sessions where id = match_session_id)
          order by lower(n.label), n.type, n.updated_at desc
        ) n
      ),
      '[]'::jsonb
    ),
    'edges',
    coalesce(
      (
        select jsonb_agg(to_jsonb(e) order by e.weight desc, e.updated_at desc)
        from personal_wiki_edges e
        join sessions s on s.id = e.session_id
        where s.user_id = (select user_id from sessions where id = match_session_id)
      ),
      '[]'::jsonb
    )
  );
$$;


--
-- Name: mark_personal_memories_used(uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.mark_personal_memories_used(memory_ids uuid[]) RETURNS void
    LANGUAGE sql
    AS $$
  update personal_memories
  set
    use_count = use_count + 1,
    last_used_at = now(),
    updated_at = now()
  where id = any(memory_ids);
$$;


--
-- Name: match_personal_memories(public.vector, uuid, integer, double precision); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.match_personal_memories(query_embedding public.vector, match_user_id uuid, match_count integer DEFAULT 5, similarity_threshold double precision DEFAULT 0.35) RETURNS TABLE(id uuid, session_id uuid, user_id uuid, type text, content text, primary_pillar text, secondary_pillars text[], pillar_confidence double precision, importance integer, confidence double precision, use_count integer, last_used_at timestamp with time zone, similarity double precision)
    LANGUAGE sql STABLE
    AS $$
  select
    pm.id,
    pm.session_id,
    pm.user_id,
    pm.type,
    pm.content,
    pm.primary_pillar,
    pm.secondary_pillars,
    pm.pillar_confidence,
    pm.importance,
    pm.confidence,
    pm.use_count,
    pm.last_used_at,
    1 - (pm.embedding <=> query_embedding) as similarity
  from personal_memories pm
  where pm.user_id = match_user_id
    and 1 - (pm.embedding <=> query_embedding) >= similarity_threshold
  order by
    pm.embedding <=> query_embedding,
    pm.importance desc,
    pm.confidence desc,
    pm.created_at desc
  limit match_count;
$$;


--
-- Name: match_wiki_chunks(public.vector, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.match_wiki_chunks(query_embedding public.vector, match_count integer, filter_pillar text DEFAULT NULL::text) RETURNS TABLE(id uuid, pillar text, title text, author text, key_frameworks text, similarity double precision)
    LANGUAGE sql STABLE
    AS $$
  select id, pillar, title, author, key_frameworks,
    1 - (embedding <=> query_embedding) as similarity
  from wiki_chunks
  where filter_pillar is null or pillar = filter_pillar
  order by embedding <=> query_embedding
  limit match_count;
$$;


--
-- Name: set_experiments_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_experiments_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


--
-- Name: sync_conversation_thread_from_message(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_conversation_thread_from_message() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: app_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    last_ping_at timestamp with time zone,
    ended_at timestamp with time zone,
    duration_seconds integer,
    entry_point text DEFAULT 'direct'::text NOT NULL,
    messages_sent integer DEFAULT 0 NOT NULL,
    device text,
    CONSTRAINT app_sessions_entry_point_check CHECK ((entry_point = ANY (ARRAY['direct'::text, 'resume'::text, 'experiment'::text, 'brain'::text])))
);


--
-- Name: conversation_threads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversation_threads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    session_id uuid NOT NULL,
    title text,
    started_at timestamp with time zone,
    last_message_at timestamp with time zone,
    message_count integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    primary_pillar text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT conversation_threads_primary_pillar_check CHECK ((primary_pillar = ANY (ARRAY['human_mind'::text, 'money_game'::text, 'how_companies_win'::text, 'whats_coming'::text, 'think_sharper'::text, 'move_people'::text]))),
    CONSTRAINT conversation_threads_status_check CHECK ((status = ANY (ARRAY['active'::text, 'closed'::text])))
);


--
-- Name: experiments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.experiments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    user_id uuid NOT NULL,
    title text,
    description text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    pillar text,
    topic text,
    source_message_id uuid,
    window_hours integer DEFAULT 48 NOT NULL,
    reference_count integer DEFAULT 0 NOT NULL,
    how_to_do_it text,
    real_world_example text,
    what_to_notice text,
    success_condition text,
    report text,
    result_summary text,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    due_at timestamp with time zone DEFAULT (now() + '48:00:00'::interval) NOT NULL,
    completed_at timestamp with time zone,
    legacy_key text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    cancelled_at timestamp with time zone,
    ghosted_at timestamp with time zone,
    outcome text,
    outcome_reason text,
    CONSTRAINT experiments_outcome_reason_check CHECK (((outcome_reason IS NULL) OR (outcome_reason = ANY (ARRAY['couldnt'::text, 'didnt'::text, 'ghosted'::text])))),
    CONSTRAINT experiments_pillar_check CHECK ((pillar = ANY (ARRAY['human_mind'::text, 'money_game'::text, 'how_companies_win'::text, 'whats_coming'::text, 'think_sharper'::text, 'move_people'::text]))),
    CONSTRAINT experiments_reference_count_check CHECK ((reference_count >= 0)),
    CONSTRAINT experiments_status_check CHECK ((status = ANY (ARRAY['active'::text, 'completed'::text, 'cancelled'::text, 'ghosted'::text, 'reset'::text, 'replaced'::text]))),
    CONSTRAINT experiments_window_hours_check CHECK ((window_hours > 0))
);


--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid,
    role text,
    content text,
    created_at timestamp with time zone DEFAULT now(),
    thread_id uuid
);


--
-- Name: model_usage_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.model_usage_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    session_id uuid,
    thread_id uuid,
    message_id uuid,
    model text NOT NULL,
    prompt_tokens integer DEFAULT 0 NOT NULL,
    completion_tokens integer DEFAULT 0 NOT NULL,
    total_tokens integer DEFAULT 0 NOT NULL,
    estimated_cost_usd numeric(10,6) DEFAULT 0 NOT NULL,
    call_type text NOT NULL,
    rag_chunks_used integer DEFAULT 0 NOT NULL,
    latency_ms integer,
    error boolean DEFAULT false NOT NULL,
    error_details text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT model_usage_logs_call_type_check CHECK ((call_type = ANY (ARRAY['chat'::text, 'query_expansion'::text, 'onboarding'::text, 'session_notes'::text, 'memory_update'::text, 'concept_state_update'::text, 'artifact'::text, 'embedding'::text])))
);


--
-- Name: personal_memories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.personal_memories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    type text NOT NULL,
    content text NOT NULL,
    importance integer DEFAULT 3 NOT NULL,
    embedding public.vector(1536) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    confidence double precision DEFAULT 0.7 NOT NULL,
    use_count integer DEFAULT 0 NOT NULL,
    last_used_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid,
    primary_pillar text,
    secondary_pillars text[] DEFAULT '{}'::text[] NOT NULL,
    pillar_confidence double precision DEFAULT 0.7 NOT NULL,
    CONSTRAINT personal_memories_confidence_check CHECK (((confidence >= (0)::double precision) AND (confidence <= (1)::double precision))),
    CONSTRAINT personal_memories_importance_check CHECK (((importance >= 1) AND (importance <= 5))),
    CONSTRAINT personal_memories_pillar_confidence_check CHECK (((pillar_confidence >= (0)::double precision) AND (pillar_confidence <= (1)::double precision))),
    CONSTRAINT personal_memories_primary_pillar_check CHECK ((primary_pillar = ANY (ARRAY['human_mind'::text, 'money_game'::text, 'how_companies_win'::text, 'whats_coming'::text, 'think_sharper'::text, 'move_people'::text]))),
    CONSTRAINT personal_memories_type_check CHECK ((type = ANY (ARRAY['goal'::text, 'pattern'::text, 'belief'::text, 'experiment_result'::text, 'preference'::text, 'decision'::text, 'fact'::text])))
);


--
-- Name: personal_wiki_edges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.personal_wiki_edges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    source_node_id uuid NOT NULL,
    target_node_id uuid NOT NULL,
    relationship text NOT NULL,
    weight double precision DEFAULT 0.5 NOT NULL,
    confidence double precision DEFAULT 0.7 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT personal_wiki_edges_confidence_check CHECK (((confidence >= (0)::double precision) AND (confidence <= (1)::double precision))),
    CONSTRAINT personal_wiki_edges_relationship_check CHECK ((relationship = ANY (ARRAY['belongs_to'::text, 'causes'::text, 'shows_up_as'::text, 'tested_by'::text, 'tests'::text, 'contradicts'::text, 'strengthens'::text, 'resolved_by'::text, 'related_to'::text]))),
    CONSTRAINT personal_wiki_edges_weight_check CHECK (((weight >= (0)::double precision) AND (weight <= (1)::double precision)))
);


--
-- Name: personal_wiki_nodes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.personal_wiki_nodes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    label text NOT NULL,
    type text NOT NULL,
    pillar text,
    summary text,
    status text DEFAULT 'dim'::text NOT NULL,
    importance integer DEFAULT 3 NOT NULL,
    confidence double precision DEFAULT 0.7 NOT NULL,
    x double precision DEFAULT 0 NOT NULL,
    y double precision DEFAULT 0 NOT NULL,
    z double precision DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_activated_at timestamp with time zone,
    CONSTRAINT personal_wiki_nodes_confidence_check CHECK (((confidence >= (0)::double precision) AND (confidence <= (1)::double precision))),
    CONSTRAINT personal_wiki_nodes_importance_check CHECK (((importance >= 1) AND (importance <= 5))),
    CONSTRAINT personal_wiki_nodes_pillar_check CHECK ((pillar = ANY (ARRAY['psychology'::text, 'economics'::text, 'human_mind'::text, 'money_game'::text, 'how_companies_win'::text, 'whats_coming'::text, 'think_sharper'::text, 'move_people'::text]))),
    CONSTRAINT personal_wiki_nodes_status_check CHECK ((status = ANY (ARRAY['seed'::text, 'dim'::text, 'active'::text, 'bright'::text, 'ghosted'::text, 'resolved'::text]))),
    CONSTRAINT personal_wiki_nodes_type_check CHECK ((type = ANY (ARRAY['pillar'::text, 'concept'::text, 'pattern'::text, 'goal'::text, 'blind_spot'::text, 'experiment'::text, 'belief'::text, 'decision'::text, 'contradiction'::text])))
);


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_token text,
    onboarding_answers jsonb,
    pillar_weights jsonb,
    axiom_profile text,
    active_experiments jsonb DEFAULT '[]'::jsonb,
    ghost_count integer DEFAULT 0,
    warning_level integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    last_active timestamp with time zone DEFAULT now(),
    session_notes text DEFAULT ''::text,
    user_id uuid,
    concept_progress jsonb DEFAULT '[]'::jsonb NOT NULL,
    consecutive_miss_count integer DEFAULT 0 NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid NOT NULL,
    email text NOT NULL,
    first_name text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: user_conversations; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.user_conversations AS
 SELECT u.id AS user_id,
    u.email,
    u.first_name,
    s.id AS session_id,
    s.created_at AS session_started_at,
    s.last_active AS session_last_active,
    m.id AS message_id,
    m.role,
    m.content,
    m.created_at AS message_at,
    m.thread_id
   FROM ((public.users u
     JOIN public.sessions s ON ((s.user_id = u.id)))
     JOIN public.messages m ON ((m.session_id = s.id)))
  ORDER BY u.email, s.created_at, m.created_at;


--
-- Name: weekly_reads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.weekly_reads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    week_start date NOT NULL,
    content text NOT NULL,
    source_message_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: wiki_chunks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wiki_chunks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    pillar text,
    content_type text,
    title text,
    author text,
    key_frameworks text,
    embedding public.vector(1536),
    created_at timestamp with time zone DEFAULT now(),
    chunk_index integer,
    source_id uuid
);


--
-- Name: wiki_sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wiki_sources (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    pillar text NOT NULL,
    content_type text NOT NULL,
    title text NOT NULL,
    author text,
    source_url text,
    source_key text,
    summary_for_retrieval text,
    source_quality text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    enrichment_status text DEFAULT 'raw'::text,
    enrichment_version text,
    enriched_at timestamp with time zone,
    source_claims jsonb DEFAULT '{}'::jsonb NOT NULL,
    axiom_interpretation jsonb DEFAULT '{}'::jsonb NOT NULL,
    source_claims_confidence double precision,
    axiom_interpretation_confidence double precision,
    published_at timestamp with time zone,
    CONSTRAINT wiki_sources_axiom_interpretation_confidence_check CHECK (((axiom_interpretation_confidence IS NULL) OR ((axiom_interpretation_confidence >= (0)::double precision) AND (axiom_interpretation_confidence <= (1)::double precision)))),
    CONSTRAINT wiki_sources_enrichment_status_check CHECK ((enrichment_status = ANY (ARRAY['raw'::text, 'claims_extracted'::text, 'interpreted'::text, 'failed'::text]))),
    CONSTRAINT wiki_sources_source_claims_confidence_check CHECK (((source_claims_confidence IS NULL) OR ((source_claims_confidence >= (0)::double precision) AND (source_claims_confidence <= (1)::double precision)))),
    CONSTRAINT wiki_sources_source_quality_check CHECK (((source_quality IS NULL) OR (source_quality = ANY (ARRAY['foundational'::text, 'high_signal'::text, 'speculative'::text, 'mixed'::text]))))
);


--
-- Name: app_sessions app_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_sessions
    ADD CONSTRAINT app_sessions_pkey PRIMARY KEY (id);


--
-- Name: conversation_threads conversation_threads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_threads
    ADD CONSTRAINT conversation_threads_pkey PRIMARY KEY (id);


--
-- Name: experiments experiments_legacy_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.experiments
    ADD CONSTRAINT experiments_legacy_key_key UNIQUE (legacy_key);


--
-- Name: experiments experiments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.experiments
    ADD CONSTRAINT experiments_pkey PRIMARY KEY (id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: model_usage_logs model_usage_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_usage_logs
    ADD CONSTRAINT model_usage_logs_pkey PRIMARY KEY (id);


--
-- Name: personal_memories personal_memories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personal_memories
    ADD CONSTRAINT personal_memories_pkey PRIMARY KEY (id);


--
-- Name: personal_wiki_edges personal_wiki_edges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personal_wiki_edges
    ADD CONSTRAINT personal_wiki_edges_pkey PRIMARY KEY (id);


--
-- Name: personal_wiki_nodes personal_wiki_nodes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personal_wiki_nodes
    ADD CONSTRAINT personal_wiki_nodes_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_session_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_session_token_key UNIQUE (session_token);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: weekly_reads weekly_reads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.weekly_reads
    ADD CONSTRAINT weekly_reads_pkey PRIMARY KEY (id);


--
-- Name: wiki_chunks wiki_chunks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_chunks
    ADD CONSTRAINT wiki_chunks_pkey PRIMARY KEY (id);


--
-- Name: wiki_sources wiki_sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_sources
    ADD CONSTRAINT wiki_sources_pkey PRIMARY KEY (id);


--
-- Name: wiki_sources wiki_sources_source_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_sources
    ADD CONSTRAINT wiki_sources_source_key_key UNIQUE (source_key);


--
-- Name: app_sessions_user_last_ping_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX app_sessions_user_last_ping_idx ON public.app_sessions USING btree (user_id, last_ping_at DESC);


--
-- Name: app_sessions_user_started_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX app_sessions_user_started_idx ON public.app_sessions USING btree (user_id, started_at DESC);


--
-- Name: conversation_threads_session_last_message_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX conversation_threads_session_last_message_idx ON public.conversation_threads USING btree (session_id, last_message_at DESC);


--
-- Name: conversation_threads_user_last_message_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX conversation_threads_user_last_message_idx ON public.conversation_threads USING btree (user_id, last_message_at DESC);


--
-- Name: conversation_threads_user_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX conversation_threads_user_status_idx ON public.conversation_threads USING btree (user_id, status, updated_at DESC);


--
-- Name: experiments_session_status_assigned_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX experiments_session_status_assigned_idx ON public.experiments USING btree (session_id, status, assigned_at DESC);


--
-- Name: experiments_session_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX experiments_session_status_idx ON public.experiments USING btree (session_id, status, assigned_at DESC);


--
-- Name: experiments_user_status_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX experiments_user_status_due_idx ON public.experiments USING btree (user_id, status, due_at);


--
-- Name: experiments_user_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX experiments_user_status_idx ON public.experiments USING btree (user_id, status, assigned_at DESC);


--
-- Name: experiments_user_topic_assigned_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX experiments_user_topic_assigned_idx ON public.experiments USING btree (user_id, topic, assigned_at DESC);


--
-- Name: messages_session_thread_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX messages_session_thread_created_idx ON public.messages USING btree (session_id, thread_id, created_at);


--
-- Name: model_usage_logs_call_type_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX model_usage_logs_call_type_created_idx ON public.model_usage_logs USING btree (call_type, created_at DESC);


--
-- Name: model_usage_logs_session_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX model_usage_logs_session_created_idx ON public.model_usage_logs USING btree (session_id, created_at DESC);


--
-- Name: model_usage_logs_user_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX model_usage_logs_user_created_idx ON public.model_usage_logs USING btree (user_id, created_at DESC);


--
-- Name: personal_memories_embedding_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX personal_memories_embedding_idx ON public.personal_memories USING ivfflat (embedding public.vector_cosine_ops) WITH (lists='100');


--
-- Name: personal_memories_session_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX personal_memories_session_created_idx ON public.personal_memories USING btree (session_id, created_at DESC);


--
-- Name: personal_memories_user_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX personal_memories_user_created_idx ON public.personal_memories USING btree (user_id, created_at DESC);


--
-- Name: personal_memories_user_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX personal_memories_user_id_idx ON public.personal_memories USING btree (user_id);


--
-- Name: personal_memories_user_primary_pillar_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX personal_memories_user_primary_pillar_idx ON public.personal_memories USING btree (user_id, primary_pillar, updated_at DESC);


--
-- Name: personal_wiki_edges_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX personal_wiki_edges_unique_idx ON public.personal_wiki_edges USING btree (session_id, source_node_id, target_node_id, relationship);


--
-- Name: personal_wiki_nodes_session_label_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX personal_wiki_nodes_session_label_type_idx ON public.personal_wiki_nodes USING btree (session_id, lower(label), type);


--
-- Name: personal_wiki_nodes_session_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX personal_wiki_nodes_session_status_idx ON public.personal_wiki_nodes USING btree (session_id, status, updated_at DESC);


--
-- Name: sessions_user_id_created_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sessions_user_id_created_at_idx ON public.sessions USING btree (user_id, created_at DESC);


--
-- Name: sessions_user_id_unique_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX sessions_user_id_unique_idx ON public.sessions USING btree (user_id);


--
-- Name: weekly_reads_session_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX weekly_reads_session_created_idx ON public.weekly_reads USING btree (session_id, created_at DESC);


--
-- Name: weekly_reads_session_week_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX weekly_reads_session_week_idx ON public.weekly_reads USING btree (session_id, week_start);


--
-- Name: wiki_chunks_embedding_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wiki_chunks_embedding_idx ON public.wiki_chunks USING ivfflat (embedding public.vector_cosine_ops);


--
-- Name: wiki_chunks_source_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wiki_chunks_source_id_idx ON public.wiki_chunks USING btree (source_id);


--
-- Name: wiki_sources_content_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wiki_sources_content_type_idx ON public.wiki_sources USING btree (content_type);


--
-- Name: wiki_sources_pillar_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wiki_sources_pillar_idx ON public.wiki_sources USING btree (pillar);


--
-- Name: wiki_sources_published_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wiki_sources_published_at_idx ON public.wiki_sources USING btree (published_at DESC);


--
-- Name: wiki_sources_source_key_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wiki_sources_source_key_idx ON public.wiki_sources USING btree (source_key);


--
-- Name: wiki_sources_title_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wiki_sources_title_idx ON public.wiki_sources USING btree (title);


--
-- Name: experiments experiments_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER experiments_set_updated_at BEFORE UPDATE ON public.experiments FOR EACH ROW EXECUTE FUNCTION public.set_experiments_updated_at();


--
-- Name: messages messages_sync_conversation_thread; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER messages_sync_conversation_thread AFTER INSERT OR DELETE OR UPDATE OF thread_id, created_at ON public.messages FOR EACH ROW EXECUTE FUNCTION public.sync_conversation_thread_from_message();


--
-- Name: app_sessions app_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_sessions
    ADD CONSTRAINT app_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: conversation_threads conversation_threads_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_threads
    ADD CONSTRAINT conversation_threads_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE;


--
-- Name: conversation_threads conversation_threads_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_threads
    ADD CONSTRAINT conversation_threads_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: experiments experiments_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.experiments
    ADD CONSTRAINT experiments_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE;


--
-- Name: experiments experiments_source_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.experiments
    ADD CONSTRAINT experiments_source_message_id_fkey FOREIGN KEY (source_message_id) REFERENCES public.messages(id) ON DELETE SET NULL;


--
-- Name: experiments experiments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.experiments
    ADD CONSTRAINT experiments_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: messages messages_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id);


--
-- Name: messages messages_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.conversation_threads(id) ON DELETE SET NULL NOT VALID;


--
-- Name: model_usage_logs model_usage_logs_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_usage_logs
    ADD CONSTRAINT model_usage_logs_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE SET NULL;


--
-- Name: model_usage_logs model_usage_logs_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_usage_logs
    ADD CONSTRAINT model_usage_logs_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE SET NULL;


--
-- Name: model_usage_logs model_usage_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.model_usage_logs
    ADD CONSTRAINT model_usage_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: personal_memories personal_memories_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personal_memories
    ADD CONSTRAINT personal_memories_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE;


--
-- Name: personal_memories personal_memories_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personal_memories
    ADD CONSTRAINT personal_memories_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: personal_wiki_edges personal_wiki_edges_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personal_wiki_edges
    ADD CONSTRAINT personal_wiki_edges_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE;


--
-- Name: personal_wiki_edges personal_wiki_edges_source_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personal_wiki_edges
    ADD CONSTRAINT personal_wiki_edges_source_node_id_fkey FOREIGN KEY (source_node_id) REFERENCES public.personal_wiki_nodes(id) ON DELETE CASCADE;


--
-- Name: personal_wiki_edges personal_wiki_edges_target_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personal_wiki_edges
    ADD CONSTRAINT personal_wiki_edges_target_node_id_fkey FOREIGN KEY (target_node_id) REFERENCES public.personal_wiki_nodes(id) ON DELETE CASCADE;


--
-- Name: personal_wiki_nodes personal_wiki_nodes_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.personal_wiki_nodes
    ADD CONSTRAINT personal_wiki_nodes_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: users users_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: weekly_reads weekly_reads_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.weekly_reads
    ADD CONSTRAINT weekly_reads_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE;


--
-- Name: wiki_chunks wiki_chunks_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wiki_chunks
    ADD CONSTRAINT wiki_chunks_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.wiki_sources(id) ON DELETE SET NULL;


--
-- Name: wiki_chunks Authenticated users can read wiki chunks; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated users can read wiki chunks" ON public.wiki_chunks FOR SELECT USING ((auth.role() = 'authenticated'::text));


--
-- Name: app_sessions Users own their app sessions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users own their app sessions" ON public.app_sessions USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: conversation_threads Users own their conversation threads; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users own their conversation threads" ON public.conversation_threads USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: experiments Users own their experiments; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users own their experiments" ON public.experiments USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: messages Users own their messages; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users own their messages" ON public.messages USING ((auth.uid() = ( SELECT sessions.user_id
   FROM public.sessions
  WHERE (sessions.id = messages.session_id))));


--
-- Name: model_usage_logs Users own their model usage logs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users own their model usage logs" ON public.model_usage_logs USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: sessions Users own their sessions; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users own their sessions" ON public.sessions USING ((auth.uid() = user_id));


--
-- Name: weekly_reads Users own their weekly reads; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users own their weekly reads" ON public.weekly_reads USING ((auth.uid() = ( SELECT sessions.user_id
   FROM public.sessions
  WHERE (sessions.id = weekly_reads.session_id))));


--
-- Name: personal_wiki_edges Users own their wiki edges; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users own their wiki edges" ON public.personal_wiki_edges USING ((auth.uid() = ( SELECT sessions.user_id
   FROM public.sessions
  WHERE (sessions.id = personal_wiki_edges.session_id))));


--
-- Name: personal_wiki_nodes Users own their wiki nodes; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users own their wiki nodes" ON public.personal_wiki_nodes USING ((auth.uid() = ( SELECT sessions.user_id
   FROM public.sessions
  WHERE (sessions.id = personal_wiki_nodes.session_id))));


--
-- Name: personal_memories Users read own memories; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users read own memories" ON public.personal_memories FOR SELECT USING ((auth.uid() = user_id));


--
-- Name: app_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: conversation_threads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.conversation_threads ENABLE ROW LEVEL SECURITY;

--
-- Name: experiments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.experiments ENABLE ROW LEVEL SECURITY;

--
-- Name: messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

--
-- Name: model_usage_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.model_usage_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: personal_memories; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.personal_memories ENABLE ROW LEVEL SECURITY;

--
-- Name: personal_wiki_edges; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.personal_wiki_edges ENABLE ROW LEVEL SECURITY;

--
-- Name: personal_wiki_nodes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.personal_wiki_nodes ENABLE ROW LEVEL SECURITY;

--
-- Name: sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- Name: users users_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_insert_own ON public.users FOR INSERT WITH CHECK ((auth.uid() = id));


--
-- Name: users users_read_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_read_own ON public.users FOR SELECT USING ((auth.uid() = id));


--
-- Name: users users_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_update_own ON public.users FOR UPDATE USING ((auth.uid() = id));


--
-- Name: weekly_reads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.weekly_reads ENABLE ROW LEVEL SECURITY;

--
-- Name: wiki_chunks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.wiki_chunks ENABLE ROW LEVEL SECURITY;

--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION find_similar_personal_memory(query_embedding public.vector, match_user_id uuid, match_type text, similarity_threshold double precision); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.find_similar_personal_memory(query_embedding public.vector, match_user_id uuid, match_type text, similarity_threshold double precision) TO anon;
GRANT ALL ON FUNCTION public.find_similar_personal_memory(query_embedding public.vector, match_user_id uuid, match_type text, similarity_threshold double precision) TO authenticated;
GRANT ALL ON FUNCTION public.find_similar_personal_memory(query_embedding public.vector, match_user_id uuid, match_type text, similarity_threshold double precision) TO service_role;


--
-- Name: FUNCTION get_personal_wiki_graph(match_session_id uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.get_personal_wiki_graph(match_session_id uuid) TO anon;
GRANT ALL ON FUNCTION public.get_personal_wiki_graph(match_session_id uuid) TO authenticated;
GRANT ALL ON FUNCTION public.get_personal_wiki_graph(match_session_id uuid) TO service_role;


--
-- Name: FUNCTION mark_personal_memories_used(memory_ids uuid[]); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.mark_personal_memories_used(memory_ids uuid[]) TO anon;
GRANT ALL ON FUNCTION public.mark_personal_memories_used(memory_ids uuid[]) TO authenticated;
GRANT ALL ON FUNCTION public.mark_personal_memories_used(memory_ids uuid[]) TO service_role;


--
-- Name: FUNCTION match_personal_memories(query_embedding public.vector, match_user_id uuid, match_count integer, similarity_threshold double precision); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.match_personal_memories(query_embedding public.vector, match_user_id uuid, match_count integer, similarity_threshold double precision) TO anon;
GRANT ALL ON FUNCTION public.match_personal_memories(query_embedding public.vector, match_user_id uuid, match_count integer, similarity_threshold double precision) TO authenticated;
GRANT ALL ON FUNCTION public.match_personal_memories(query_embedding public.vector, match_user_id uuid, match_count integer, similarity_threshold double precision) TO service_role;


--
-- Name: FUNCTION match_wiki_chunks(query_embedding public.vector, match_count integer, filter_pillar text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.match_wiki_chunks(query_embedding public.vector, match_count integer, filter_pillar text) TO anon;
GRANT ALL ON FUNCTION public.match_wiki_chunks(query_embedding public.vector, match_count integer, filter_pillar text) TO authenticated;
GRANT ALL ON FUNCTION public.match_wiki_chunks(query_embedding public.vector, match_count integer, filter_pillar text) TO service_role;


--
-- Name: FUNCTION set_experiments_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.set_experiments_updated_at() TO anon;
GRANT ALL ON FUNCTION public.set_experiments_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.set_experiments_updated_at() TO service_role;


--
-- Name: FUNCTION sync_conversation_thread_from_message(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.sync_conversation_thread_from_message() TO anon;
GRANT ALL ON FUNCTION public.sync_conversation_thread_from_message() TO authenticated;
GRANT ALL ON FUNCTION public.sync_conversation_thread_from_message() TO service_role;


--
-- Name: TABLE app_sessions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.app_sessions TO anon;
GRANT ALL ON TABLE public.app_sessions TO authenticated;
GRANT ALL ON TABLE public.app_sessions TO service_role;


--
-- Name: TABLE conversation_threads; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.conversation_threads TO anon;
GRANT ALL ON TABLE public.conversation_threads TO authenticated;
GRANT ALL ON TABLE public.conversation_threads TO service_role;


--
-- Name: TABLE experiments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.experiments TO anon;
GRANT ALL ON TABLE public.experiments TO authenticated;
GRANT ALL ON TABLE public.experiments TO service_role;


--
-- Name: TABLE messages; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.messages TO anon;
GRANT ALL ON TABLE public.messages TO authenticated;
GRANT ALL ON TABLE public.messages TO service_role;


--
-- Name: TABLE model_usage_logs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.model_usage_logs TO anon;
GRANT ALL ON TABLE public.model_usage_logs TO authenticated;
GRANT ALL ON TABLE public.model_usage_logs TO service_role;


--
-- Name: TABLE personal_memories; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.personal_memories TO anon;
GRANT ALL ON TABLE public.personal_memories TO authenticated;
GRANT ALL ON TABLE public.personal_memories TO service_role;


--
-- Name: TABLE personal_wiki_edges; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.personal_wiki_edges TO anon;
GRANT ALL ON TABLE public.personal_wiki_edges TO authenticated;
GRANT ALL ON TABLE public.personal_wiki_edges TO service_role;


--
-- Name: TABLE personal_wiki_nodes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.personal_wiki_nodes TO anon;
GRANT ALL ON TABLE public.personal_wiki_nodes TO authenticated;
GRANT ALL ON TABLE public.personal_wiki_nodes TO service_role;


--
-- Name: TABLE sessions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.sessions TO anon;
GRANT ALL ON TABLE public.sessions TO authenticated;
GRANT ALL ON TABLE public.sessions TO service_role;


--
-- Name: TABLE users; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.users TO anon;
GRANT ALL ON TABLE public.users TO authenticated;
GRANT ALL ON TABLE public.users TO service_role;


--
-- Name: TABLE user_conversations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_conversations TO anon;
GRANT ALL ON TABLE public.user_conversations TO authenticated;
GRANT ALL ON TABLE public.user_conversations TO service_role;


--
-- Name: TABLE weekly_reads; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.weekly_reads TO anon;
GRANT ALL ON TABLE public.weekly_reads TO authenticated;
GRANT ALL ON TABLE public.weekly_reads TO service_role;


--
-- Name: TABLE wiki_chunks; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.wiki_chunks TO anon;
GRANT ALL ON TABLE public.wiki_chunks TO authenticated;
GRANT ALL ON TABLE public.wiki_chunks TO service_role;


--
-- Name: TABLE wiki_sources; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.wiki_sources TO anon;
GRANT ALL ON TABLE public.wiki_sources TO authenticated;
GRANT ALL ON TABLE public.wiki_sources TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- PostgreSQL database dump complete
--

\unrestrict f4oV57brWiraKegcRNQLuw7jaOtueZ8hG3Pv6e0izhNCnZLdtQDPLZ0VB3xL3NI

