# Main Axiom live schema audit

Audit date: 2026-09-29. Source: `supabase_axiom`, read-only PostgreSQL catalog queries. User tables were queried only with `count(*)`; no row values were read. The checked-in dump used as file evidence is `audit/schema_main.sql`.

## Findings

- **SM-01 — HIGH:** `public.wiki_sources` has RLS disabled and no policies. Every other public table has RLS enabled. This violates the architecture rule that every table use RLS. Evidence: `audit/schema_main.sql:517-544`, `audit/schema_main.sql:1281-1284`, `ARCHITECTURE.md:157-163`.
- **SM-02 — HIGH:** the migration set does not reproduce the live main schema. The live migration ledger is empty, while the repository has 15 migration files. Foundational tables and policies exist in the dump but have no creating migration. Evidence: `supabase/migrations/20260505000001_fix_pillar_constraint.sql:1-17`, `supabase/migrations/20260514000001_personal_memories_read_only_rls.sql:1-5`, `audit/schema_main.sql:252-544`.
- **SM-03 — HIGH:** repository migrations declare `source_learning_maps` and `user_concept_states`, but neither table exists live. Evidence: `supabase/migrations/20260511000002_axiom_knowledge_schema.sql:72-100`.
- **SM-04 — MEDIUM:** migrations declare `wiki_sources.is_core_library`; it is absent live. The migration version of `match_wiki_chunks` depends on that column, while the live function does not filter to core sources. Evidence: `supabase/migrations/20260511000003_core_library_curation.sql:1-55`, `audit/schema_main.sql:147-159`, `audit/schema_main.sql:517-544`.
- **SM-05 — MEDIUM:** migrations declare HNSW and pillar indexes for `wiki_chunks`; live has an IVFFlat embedding index and no pillar index. Evidence: `supabase/migrations/20260511000001_wiki_chunks_hnsw_search.sql:3-9`, `audit/schema_main.sql:850-865`.
- **SM-06 — MEDIUM:** the architecture's ten target founder-journey tables are all missing: `founder_profiles`, `founder_theory`, `situations`, `reads`, `lessons`, `move_reports`, `consent_snapshots`, `peer_outcomes`, `peer_unlocks`, `intro_requests`. Evidence: `ARCHITECTURE.md:132-145`, live table inventory below.
- **SM-07 — MEDIUM:** live `experiments` still uses old states and lacks target `swap_count` and `prediction`. Evidence: `audit/schema_main.sql:295-329`, `ARCHITECTURE.md:125-130`.
- **SM-08 — MEDIUM:** `personal_memories` permits browser reads only, but its three mutating RPCs are executable functions and are not `SECURITY DEFINER`. Whether API grants permit browser invocation is outside the requested schema comparison; the dump grants these functions to `anon` and `authenticated`. Evidence: `audit/schema_main.sql:37-143`, `audit/schema_main.sql:1187-1190`, `audit/schema_main.sql:1297-1329`.
- **SM-09 — LOW:** `experiments` has duplicate equivalent session/status indexes: `experiments_session_status_assigned_idx` and `experiments_session_status_idx`. Evidence: `audit/schema_main.sql:686-697`.
- **SM-10 — LOW:** `wiki_sources.source_key` has both a unique constraint index and a separate non-unique index on the same column. Evidence: `audit/schema_main.sql:650-655`, `audit/schema_main.sql:886-897`.
- **SM-11 — LOW:** `messages_thread_id_fkey` is `NOT VALID`; existing rows were not validated when the constraint was added. Evidence: `supabase/migrations/20260508000001_usage_sessions_threads.sql:181-195`, `audit/schema_main.sql:1012-1015`.

## Row counts

Exact `count(*)` values at audit time. Counts only.

| Table | Rows |
|---|---:|
| app_sessions | 68 |
| conversation_threads | 68 |
| experiments | 1 |
| messages | 766 |
| model_usage_logs | 753 |
| personal_memories | 458 |
| personal_wiki_edges | 610 |
| personal_wiki_nodes | 585 |
| sessions | 17 |
| users | 6 |
| weekly_reads | 9 |
| wiki_chunks | 34,161 |
| wiki_sources | 251 |

## Tables

Notation: `NN` = not null; `NULL` = nullable. Constraint and index definitions are exact catalog renderings with schema qualification shortened.

### app_sessions

Evidence: `audit/schema_main.sql:253-267`, `audit/schema_main.sql:662-673`, `audit/schema_main.sql:950-953`, `audit/schema_main.sql:1115-1119`, `audit/schema_main.sql:1194-1197`.

- Columns: `id uuid NN default gen_random_uuid()`; `user_id uuid NN`; `started_at timestamptz NN default now()`; `last_ping_at timestamptz NULL`; `ended_at timestamptz NULL`; `duration_seconds integer NULL`; `entry_point text NN default 'direct'`; `messages_sent integer NN default 0`; `device text NULL`.
- PK: `(id)`.
- FK: `user_id -> auth.users(id) ON DELETE CASCADE`.
- Check: `entry_point IN ('direct','resume','experiment','brain')`.
- Indexes: unique `app_sessions_pkey(id)`; `app_sessions_user_last_ping_idx(user_id,last_ping_at DESC)`; `app_sessions_user_started_idx(user_id,started_at DESC)`.
- RLS: enabled, not forced. Policy `Users own their app sessions`; permissive; command `ALL`; roles `{public}`; USING `auth.uid() = user_id`; WITH CHECK `auth.uid() = user_id`.

### conversation_threads

Evidence: `audit/schema_main.sql:271-288`, `audit/schema_main.sql:675-684`, `audit/schema_main.sql:958-969`, `audit/schema_main.sql:1123-1126`, `audit/schema_main.sql:1200-1203`.

- Columns: `id uuid NN default gen_random_uuid()`; `user_id uuid NN`; `session_id uuid NN`; `title text NULL`; `started_at timestamptz NULL`; `last_message_at timestamptz NULL`; `message_count integer NN default 0`; `status text NN default 'active'`; `primary_pillar text NULL`; `created_at timestamptz NN default now()`; `updated_at timestamptz NN default now()`.
- PK: `(id)`.
- FKs: `user_id -> auth.users(id) ON DELETE CASCADE`; `session_id -> sessions(id) ON DELETE CASCADE`.
- Checks: `status IN ('active','closed')`; `primary_pillar` is null or one of the six pillar keys.
- Indexes: unique PK; `(session_id,last_message_at DESC)`; `(user_id,last_message_at DESC)`; `(user_id,status,updated_at DESC)`.
- RLS: enabled, not forced. Policy `Users own their conversation threads`; permissive; `ALL`; roles `{public}`; USING and WITH CHECK `auth.uid() = user_id`.

### experiments

Evidence: `audit/schema_main.sql:292-329`, `audit/schema_main.sql:686-715`, `audit/schema_main.sql:974-993`, `audit/schema_main.sql:1130-1133`, `audit/schema_main.sql:1206-1209`.

- Columns: `id uuid NN default gen_random_uuid()`; `session_id uuid NN`; `user_id uuid NN`; `title text NULL`; `description text NN`; `status text NN default 'active'`; `pillar text NULL`; `topic text NULL`; `source_message_id uuid NULL`; `window_hours integer NN default 48`; `reference_count integer NN default 0`; `how_to_do_it text NULL`; `real_world_example text NULL`; `what_to_notice text NULL`; `success_condition text NULL`; `report text NULL`; `result_summary text NULL`; `assigned_at timestamptz NN default now()`; `due_at timestamptz NN default now()+48 hours`; `completed_at timestamptz NULL`; `legacy_key text NULL`; `metadata jsonb NN default {}`; `created_at timestamptz NN default now()`; `updated_at timestamptz NN default now()`; `cancelled_at timestamptz NULL`; `ghosted_at timestamptz NULL`; `outcome text NULL`; `outcome_reason text NULL`.
- PK: `(id)`. Unique: `(legacy_key)`.
- FKs: `session_id -> sessions(id) ON DELETE CASCADE`; `user_id -> auth.users(id) ON DELETE CASCADE`; `source_message_id -> messages(id) ON DELETE SET NULL`.
- Checks: status is `active|completed|cancelled|ghosted|reset|replaced`; pillar is null or one of six keys; `window_hours > 0`; `reference_count >= 0`; outcome reason is null or `couldnt|didnt|ghosted`.
- Indexes: PK; unique legacy key; `(session_id,status,assigned_at DESC)` twice under two names; `(user_id,status,due_at)`; `(user_id,status,assigned_at DESC)`; `(user_id,topic,assigned_at DESC)`.
- RLS: enabled, not forced. Policy `Users own their experiments`; permissive; `ALL`; roles `{public}`; USING and WITH CHECK `auth.uid() = user_id`.

### messages

Evidence: `audit/schema_main.sql:333-343`, `audit/schema_main.sql:717-720`, `audit/schema_main.sql:998-1015`, `audit/schema_main.sql:1137-1142`, `audit/schema_main.sql:1212-1215`.

- Columns: `id uuid NN default gen_random_uuid()`; `session_id uuid NULL`; `role text NULL`; `content text NULL`; `created_at timestamptz NULL default now()`; `thread_id uuid NULL`.
- PK: `(id)`.
- FKs: `session_id -> sessions(id)`; `thread_id -> conversation_threads(id) ON DELETE SET NULL NOT VALID`.
- Indexes: unique PK; `(session_id,thread_id,created_at)`.
- RLS: enabled, not forced. Policy `Users own their messages`; permissive; `ALL`; roles `{public}`; USING `auth.uid() = (SELECT sessions.user_id FROM sessions WHERE sessions.id = messages.session_id)`; WITH CHECK absent.

### model_usage_logs

Evidence: `audit/schema_main.sql:347-368`, `audit/schema_main.sql:722-735`, `audit/schema_main.sql:1020-1038`, `audit/schema_main.sql:1146-1149`, `audit/schema_main.sql:1218-1221`.

- Columns: `id uuid NN default gen_random_uuid()`; `user_id uuid NN`; `session_id uuid NULL`; `thread_id uuid NULL`; `message_id uuid NULL`; `model text NN`; `prompt_tokens integer NN default 0`; `completion_tokens integer NN default 0`; `total_tokens integer NN default 0`; `estimated_cost_usd numeric(10,6) NN default 0`; `call_type text NN`; `rag_chunks_used integer NN default 0`; `latency_ms integer NULL`; `error boolean NN default false`; `error_details text NULL`; `created_at timestamptz NN default now()`.
- PK: `(id)`.
- FKs: `user_id -> auth.users(id) ON DELETE CASCADE`; `session_id -> sessions(id) ON DELETE SET NULL`; `message_id -> messages(id) ON DELETE SET NULL`. `thread_id` has no FK.
- Check: call type is `chat|query_expansion|onboarding|session_notes|memory_update|concept_state_update|artifact|embedding`.
- Indexes: unique PK; `(call_type,created_at DESC)`; `(session_id,created_at DESC)`; `(user_id,created_at DESC)`.
- RLS: enabled, not forced. Policy `Users own their model usage logs`; permissive; `ALL`; roles `{public}`; USING and WITH CHECK `auth.uid() = user_id`.

### personal_memories

Evidence: `audit/schema_main.sql:372-396`, `audit/schema_main.sql:737-760`, `audit/schema_main.sql:1043-1054`, `audit/schema_main.sql:1187-1190`, `audit/schema_main.sql:1224-1227`.

- Columns: `id uuid NN default gen_random_uuid()`; `session_id uuid NN`; `type text NN`; `content text NN`; `importance integer NN default 3`; `embedding vector(1536) NN`; `created_at timestamptz NN default now()`; `confidence double precision NN default 0.7`; `use_count integer NN default 0`; `last_used_at timestamptz NULL`; `updated_at timestamptz NN default now()`; `user_id uuid NULL`; `primary_pillar text NULL`; `secondary_pillars text[] NN default {}`; `pillar_confidence double precision NN default 0.7`.
- PK: `(id)`.
- FKs: `session_id -> sessions(id) ON DELETE CASCADE`; `user_id -> auth.users(id)`.
- Checks: type is `goal|pattern|belief|experiment_result|preference|decision|fact`; importance 1..5; confidence and pillar confidence 0..1; primary pillar is null or one of six keys.
- Indexes: unique PK; IVFFlat cosine on embedding with `lists=100`; `(session_id,created_at DESC)`; `(user_id,created_at DESC)`; `(user_id)`; `(user_id,primary_pillar,updated_at DESC)`.
- RLS: enabled, not forced. Policy `Users read own memories`; permissive; `SELECT`; roles `{public}`; USING `auth.uid() = user_id`; WITH CHECK absent.

### personal_wiki_edges

Evidence: `audit/schema_main.sql:400-416`, `audit/schema_main.sql:762-765`, `audit/schema_main.sql:1059-1065`, `audit/schema_main.sql:1169-1174`, `audit/schema_main.sql:1230-1233`.

- Columns: `id uuid NN default gen_random_uuid()`; `session_id uuid NN`; `source_node_id uuid NN`; `target_node_id uuid NN`; `relationship text NN`; `weight double precision NN default 0.5`; `confidence double precision NN default 0.7`; `created_at timestamptz NN default now()`; `updated_at timestamptz NN default now()`.
- PK: `(id)`. Unique: `(session_id,source_node_id,target_node_id,relationship)`.
- FKs: session to `sessions`; source and target to `personal_wiki_nodes`; all `ON DELETE CASCADE`.
- Checks: weight and confidence 0..1; relationship is one of `belongs_to|causes|shows_up_as|tested_by|tests|contradicts|strengthens|resolved_by|related_to`.
- Indexes: unique PK and the unique four-column index above.
- RLS: enabled, not forced. Policy `Users own their wiki edges`; permissive; `ALL`; roles `{public}`; USING session owner subquery; WITH CHECK absent.

### personal_wiki_nodes

Evidence: `audit/schema_main.sql:420-444`, `audit/schema_main.sql:767-780`, `audit/schema_main.sql:1069-1073`, `audit/schema_main.sql:1178-1183`, `audit/schema_main.sql:1236-1239`.

- Columns: `id uuid NN default gen_random_uuid()`; `session_id uuid NN`; `label text NN`; `type text NN`; `pillar text NULL`; `summary text NULL`; `status text NN default 'dim'`; `importance integer NN default 3`; `confidence double precision NN default 0.7`; `x/y/z double precision NN default 0`; `created_at/updated_at timestamptz NN default now()`; `last_activated_at timestamptz NULL`.
- PK: `(id)`. FK: `session_id -> sessions(id) ON DELETE CASCADE`.
- Checks: importance 1..5; confidence 0..1; pillar allows the six keys plus legacy `psychology` and `economics`; status is `seed|dim|active|bright|ghosted|resolved`; type is `pillar|concept|pattern|goal|blind_spot|experiment|belief|decision|contradiction`.
- Indexes: unique PK; unique `(session_id,lower(label),type)`; `(session_id,status,updated_at DESC)`.
- RLS: enabled, not forced. Policy `Users own their wiki nodes`; permissive; `ALL`; roles `{public}`; USING session owner subquery; WITH CHECK absent.

### sessions

Evidence: `audit/schema_main.sql:448-467`, `audit/schema_main.sql:782-801`, `audit/schema_main.sql:1077-1081`, `audit/schema_main.sql:1153-1156`, `audit/schema_main.sql:1242-1245`.

- Columns: `id uuid NN default gen_random_uuid()`; `session_token text NULL`; `onboarding_answers jsonb NULL`; `pillar_weights jsonb NULL`; `axiom_profile text NULL`; `active_experiments jsonb NULL default []`; `ghost_count integer NULL default 0`; `warning_level integer NULL default 0`; `created_at/last_active timestamptz NULL default now()`; `session_notes text NULL default ''`; `user_id uuid NULL`; `concept_progress jsonb NN default []`; `consecutive_miss_count integer NN default 0`.
- PK: `(id)`. Unique constraint: `(session_token)`. Unique index: `(user_id)`. FK: `user_id -> auth.users(id) ON DELETE CASCADE`.
- Indexes: PK; unique session token; unique user ID; `(user_id,created_at DESC)`.
- RLS: enabled, not forced. Policy `Users own their sessions`; permissive; `ALL`; roles `{public}`; USING `auth.uid() = user_id`; WITH CHECK absent.

### users

Evidence: `audit/schema_main.sql:471-480`, `audit/schema_main.sql:803-806`, `audit/schema_main.sql:1084-1089`, `audit/schema_main.sql:1248-1271`.

- Columns: `id uuid NN`; `email text NN`; `first_name text NULL`; `created_at timestamptz NULL default now()`.
- PK: `(id)`. FK: `id -> auth.users(id) ON DELETE CASCADE`. Index: unique PK only.
- RLS: enabled, not forced. Three permissive `{public}` policies: `users_insert_own`, `INSERT`, WITH CHECK `auth.uid() = id`; `users_read_own`, `SELECT`, USING `auth.uid() = id`; `users_update_own`, `UPDATE`, USING `auth.uid() = id`, no WITH CHECK.

### weekly_reads

Evidence: `audit/schema_main.sql:505-513`, `audit/schema_main.sql:808-821`, `audit/schema_main.sql:1092-1097`, `audit/schema_main.sql:1160-1165`, `audit/schema_main.sql:1275-1278`.

- Columns: `id uuid NN default gen_random_uuid()`; `session_id uuid NN`; `week_start date NN`; `content text NN`; `source_message_count integer NN default 0`; `created_at/updated_at timestamptz NN default now()`.
- PK: `(id)`. Unique: `(session_id,week_start)`. FK: `session_id -> sessions(id) ON DELETE CASCADE`.
- Indexes: unique PK; `(session_id,created_at DESC)`; unique `(session_id,week_start)`.
- RLS: enabled, not forced. Policy `Users own their weekly reads`; permissive; `ALL`; roles `{public}`; USING session owner subquery; WITH CHECK absent.

### wiki_chunks

Evidence: `audit/schema_main.sql:517-530`, `audit/schema_main.sql:823-865`, `audit/schema_main.sql:1101-1105`, `audit/schema_main.sql:1109-1112`, `audit/schema_main.sql:1281-1284`.

- Columns: `id uuid NN default gen_random_uuid()`; `pillar text NULL`; `content_type text NULL`; `title text NULL`; `author text NULL`; `key_frameworks text NULL`; `embedding vector(1536) NULL`; `created_at timestamptz NULL default now()`; `chunk_index integer NULL`; `source_id uuid NULL`.
- PK: `(id)`. FK: `source_id -> wiki_sources(id) ON DELETE SET NULL`.
- Indexes: unique PK; IVFFlat cosine embedding; `(source_id)`.
- RLS: enabled, not forced. Policy `Authenticated users can read wiki chunks`; permissive; `SELECT`; roles `{public}`; USING `auth.role() = 'authenticated'`; WITH CHECK absent.

### wiki_sources

Evidence: `audit/schema_main.sql:534-558`, `audit/schema_main.sql:867-905`.

- Columns: `id uuid NN default gen_random_uuid()`; `pillar text NN`; `content_type text NN`; `title text NN`; `author text NULL`; `source_url text NULL`; `source_key text NULL`; `summary_for_retrieval text NULL`; `source_quality text NULL`; `created_at/updated_at timestamptz NN default now()`; `enrichment_status text NULL default 'raw'`; `enrichment_version text NULL`; `enriched_at timestamptz NULL`; `source_claims jsonb NN default {}`; `axiom_interpretation jsonb NN default {}`; both confidence columns `double precision NULL`; `published_at timestamptz NULL`.
- PK: `(id)`. Unique: `(source_key)`.
- Checks: enrichment status is `raw|claims_extracted|interpreted|failed`; source quality is null or `foundational|high_signal|speculative|mixed`; both confidence values are null or 0..1.
- Indexes: unique PK; unique source key; additional non-unique source key; `(content_type)`; `(pillar)`; `(published_at DESC)`; `(title)`.
- RLS: **disabled**, not forced. No policies.

## Functions and RPCs

There are 125 routines in `public`: 7 application routines and 118 owned by the `vector` extension (114 functions and four aggregates). The extension-owned routines are not application RPCs; their definitions are supplied by `vector` 0.8.0. Application definitions follow exactly. Evidence: `audit/schema_main.sql:36-245`.

```sql
CREATE OR REPLACE FUNCTION public.find_similar_personal_memory(query_embedding vector, match_user_id uuid, match_type text, similarity_threshold double precision DEFAULT 0.82)
RETURNS TABLE(id uuid, content text, importance integer, confidence double precision, primary_pillar text, secondary_pillars text[], pillar_confidence double precision, similarity double precision)
LANGUAGE sql STABLE AS $function$
  select pm.id, pm.content, pm.importance, pm.confidence, pm.primary_pillar,
    pm.secondary_pillars, pm.pillar_confidence,
    1 - (pm.embedding <=> query_embedding) as similarity
  from personal_memories pm
  where pm.user_id = match_user_id and pm.type = match_type
    and 1 - (pm.embedding <=> query_embedding) >= similarity_threshold
  order by pm.embedding <=> query_embedding limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.get_personal_wiki_graph(match_session_id uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $function$
  select jsonb_build_object(
    'nodes', coalesce((select jsonb_agg(to_jsonb(n) order by n.importance desc, n.updated_at desc)
      from (select distinct on (lower(n.label), n.type) n.* from personal_wiki_nodes n
        join sessions s on s.id=n.session_id
        where s.user_id=(select user_id from sessions where id=match_session_id)
        order by lower(n.label), n.type, n.updated_at desc) n), '[]'::jsonb),
    'edges', coalesce((select jsonb_agg(to_jsonb(e) order by e.weight desc, e.updated_at desc)
      from personal_wiki_edges e join sessions s on s.id=e.session_id
      where s.user_id=(select user_id from sessions where id=match_session_id)), '[]'::jsonb));
$function$;

CREATE OR REPLACE FUNCTION public.mark_personal_memories_used(memory_ids uuid[])
RETURNS void LANGUAGE sql AS $function$
  update personal_memories set use_count=use_count+1, last_used_at=now(), updated_at=now()
  where id=any(memory_ids);
$function$;

CREATE OR REPLACE FUNCTION public.match_personal_memories(query_embedding vector, match_user_id uuid, match_count integer DEFAULT 5, similarity_threshold double precision DEFAULT 0.35)
RETURNS TABLE(id uuid, session_id uuid, user_id uuid, type text, content text, primary_pillar text, secondary_pillars text[], pillar_confidence double precision, importance integer, confidence double precision, use_count integer, last_used_at timestamptz, similarity double precision)
LANGUAGE sql STABLE AS $function$
  select pm.id, pm.session_id, pm.user_id, pm.type, pm.content, pm.primary_pillar,
    pm.secondary_pillars, pm.pillar_confidence, pm.importance, pm.confidence,
    pm.use_count, pm.last_used_at, 1-(pm.embedding <=> query_embedding) as similarity
  from personal_memories pm where pm.user_id=match_user_id
    and 1-(pm.embedding <=> query_embedding)>=similarity_threshold
  order by pm.embedding <=> query_embedding, pm.importance desc, pm.confidence desc, pm.created_at desc
  limit match_count;
$function$;

CREATE OR REPLACE FUNCTION public.match_wiki_chunks(query_embedding vector, match_count integer, filter_pillar text DEFAULT NULL)
RETURNS TABLE(id uuid, pillar text, title text, author text, key_frameworks text, similarity double precision)
LANGUAGE sql STABLE AS $function$
  select id, pillar, title, author, key_frameworks,
    1-(embedding <=> query_embedding) as similarity
  from wiki_chunks where filter_pillar is null or pillar=filter_pillar
  order by embedding <=> query_embedding limit match_count;
$function$;

CREATE OR REPLACE FUNCTION public.set_experiments_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $function$
begin new.updated_at=now(); return new; end;
$function$;

CREATE OR REPLACE FUNCTION public.sync_conversation_thread_from_message()
RETURNS trigger LANGUAGE plpgsql AS $function$
begin
  if tg_op='INSERT' then
    if new.thread_id is not null then update conversation_threads
      set message_count=message_count+1,
          last_message_at=greatest(coalesce(last_message_at,new.created_at),new.created_at),
          updated_at=now() where id=new.thread_id; end if;
    return new;
  end if;
  if tg_op='UPDATE' then
    if old.thread_id is distinct from new.thread_id then
      if old.thread_id is not null then update conversation_threads
        set message_count=greatest(0,message_count-1),
            last_message_at=(select max(created_at) from messages where thread_id=old.thread_id),
            updated_at=now() where id=old.thread_id; end if;
      if new.thread_id is not null then update conversation_threads
        set message_count=message_count+1,
            last_message_at=greatest(coalesce(last_message_at,new.created_at),new.created_at),
            updated_at=now() where id=new.thread_id; end if;
    elsif new.thread_id is not null and old.created_at is distinct from new.created_at then
      update conversation_threads
      set last_message_at=(select max(created_at) from messages where thread_id=new.thread_id),
          updated_at=now() where id=new.thread_id;
    end if;
    return new;
  end if;
  if tg_op='DELETE' then
    if old.thread_id is not null then update conversation_threads
      set message_count=greatest(0,message_count-1),
          last_message_at=(select max(created_at) from messages where thread_id=old.thread_id),
          updated_at=now() where id=old.thread_id; end if;
    return old;
  end if;
  return null;
end;
$function$;
```

Vector extension routine identities are catalogued by the extension and include conversion, distance, comparison, normalization, HNSW/IVFFlat support, send/receive and aggregate support for `vector`, `halfvec`, `sparsevec`, and `bit`. Full SQL definitions do not exist for C-language routines; PostgreSQL stores their shared-library symbol declarations. Four extension aggregates are `avg(vector)`, `avg(halfvec)`, `sum(vector)`, and `sum(halfvec)`.

## Triggers

Evidence: `audit/schema_main.sql:907-921`.

```sql
CREATE TRIGGER experiments_set_updated_at
BEFORE UPDATE ON public.experiments
FOR EACH ROW EXECUTE FUNCTION public.set_experiments_updated_at();

CREATE TRIGGER messages_sync_conversation_thread
AFTER INSERT OR DELETE OR UPDATE OF thread_id, created_at ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.sync_conversation_thread_from_message();
```

## Extensions

Enabled extensions from the live extension catalog:

| Extension | Version | Schema |
|---|---|---|
| pgcrypto | 1.3 | extensions |
| uuid-ossp | 1.1 | extensions |
| supabase_vault | 0.3.1 | vault |
| pg_stat_statements | 1.11 | extensions |
| plpgsql | 1.0 | pg_catalog |
| vector | 0.8.0 | public |

## Repository comparison

Files compared: all 15 files under `supabase/migrations`, plus `audit/schema_main.sql`. `src/lib/supabase.js` is client configuration, not a schema definition.

### Live but not represented by migrations

The checked-in dump represents these, but no migration creates them: `users`, `sessions`, `messages`, `personal_memories`, `personal_wiki_nodes`, `personal_wiki_edges`, `weekly_reads`, `wiki_chunks`, and their initial constraints, indexes, FKs, functions, triggers and policies. `experiments` is only partly bootstrapped by a migration. Evidence: `audit/schema_main.sql:252-558`; migration coverage starts with alterations at `supabase/migrations/20260505000001_fix_pillar_constraint.sql:1-17`.

Live-only relative to the migration files also includes the `user_conversations` view, `users_*` policies, base indexes not declared by migrations, and functions `get_personal_wiki_graph`, `mark_personal_memories_used`, and `set_experiments_updated_at`. Evidence: `audit/schema_main.sql:62-110`, `audit/schema_main.sql:163-245`, `audit/schema_main.sql:483-501`, `audit/schema_main.sql:1248-1271`.

### In migrations but absent live

- Tables: `source_learning_maps`, `user_concept_states`.
- Type: `concept_learning_state`.
- Column: `wiki_sources.is_core_library`.
- Indexes: `wiki_chunks_embedding_hnsw_idx`, `wiki_chunks_pillar_idx`, `wiki_sources_core_pillar_idx`, `source_learning_maps_source_id_idx`, `user_concept_states_user_id_idx`, `user_concept_states_concept_id_idx`.
- Function behavior: repository `match_wiki_chunks` is PL/pgSQL and filters through `wiki_sources.is_core_library=true`; live is SQL and has no core-library filter.
- Nullability drift: migration declares `wiki_chunks.pillar`, `embedding`, and `created_at` not null; live permits nulls. Migration declares several `wiki_sources` JSON/status fields nullable without defaults; live has defaults and/or not-null constraints.

Evidence: `supabase/migrations/20260511000001_wiki_chunks_hnsw_search.sql:3-55`, `supabase/migrations/20260511000002_axiom_knowledge_schema.sql:4-150`, `supabase/migrations/20260511000003_core_library_curation.sql:1-55`, `audit/schema_main.sql:147-159`, `audit/schema_main.sql:517-558`.

### Dump comparison

The live application tables, columns, constraints, indexes, policies, seven application functions, two triggers, and `user_conversations` view match `audit/schema_main.sql`. The dump does not include extension object definitions because it is an application-schema dump. Row counts are not schema dump content. No live-only application schema object was found relative to that dump.

## ARCHITECTURE.md comparison

Evidence for the model: `ARCHITECTURE.md:108-163`.

| Architecture table/object | Result | Difference |
|---|---|---|
| Auth users | Exists and matches | `auth.users` is referenced by FKs; auth schema internals were outside public-schema scope. |
| sessions | Exists but differs | Legacy onboarding JSON, warning counters and concept progress remain. Target normalized founder profile is absent. |
| messages | Exists and matches current description | Supports optional chat; target server-only write rule is not encoded by its `ALL` RLS policy. |
| experiments | Exists but differs | Old state machine; no `swap_count` or `prediction`. |
| personal_memories | Exists and matches current description | Read-only founder RLS is present; mutation RPCs remain. |
| wiki_sources | Exists but differs | Present in main despite architecture assigning knowledge to the knowledge project; RLS disabled. |
| wiki_chunks | Exists but differs | Present in main despite project split; location/chapter metadata is absent. |
| model_usage_logs | Exists and matches current description | Current logging table exists. Cost correctness is application logic, not verifiable from schema. |
| founder_profiles | Missing | Target table not live. |
| founder_theory | Missing | Target table not live. |
| situations | Missing | Target table not live. |
| reads | Missing | Target table not live. |
| lessons | Missing | Target table not live. |
| move_reports | Missing | Target table not live. |
| consent_snapshots | Missing | Target table not live. |
| peer_outcomes | Missing | Target table not live. |
| peer_unlocks | Missing | Target table not live. |
| intro_requests | Missing | Target table not live. |
| weekly_reads | Exists but marked for later drop | Still live with 9 rows. |
| personal_wiki_nodes | Exists but marked for later drop | Still live with 585 rows. |
| personal_wiki_edges | Exists but marked for later drop | Still live with 610 rows. |

## Handoffs

- **SECURITY:** SM-01, SM-08 and the missing WITH CHECK clauses on several `ALL` policies need authorization review.
- **PRODUCT/DATA:** SM-06 and SM-07 block the documented founder journey and peer-map data model.
- **DEVOPS:** SM-02 through SM-05 show migration ledger and repository drift; establish which project should own knowledge tables before applying anything.

## Open questions

- **UNVERIFIED:** whether the 15 repository migrations were applied manually, through another project, or never applied. Need deployment/CLI history; the live migration ledger returned no entries.
- **UNVERIFIED:** whether public EXECUTE grants on memory RPCs are intentionally exposed through PostgREST. Need API settings and effective role privilege testing without invoking mutating functions.
- **UNVERIFIED:** whether `wiki_sources` and `wiki_chunks` should remain in main or move fully to the knowledge project. Need an ownership decision and a read-only audit of `axiom-knowledge`.
- **UNVERIFIED:** extension routine binary definitions beyond their catalog declarations. PostgreSQL cannot render C source; inspect the exact pgvector 0.8.0 extension SQL/source package if source-level definitions are required.

## Coverage

Read completely: `ARCHITECTURE.md`; `audit/schema_main.sql`; every file in `supabase/migrations/`: `20260505000001_fix_pillar_constraint.sql`, `20260505000002_add_rls_policies.sql`, `20260505000003_sessions_unique_user.sql`, `20260505000004_consecutive_miss_count.sql`, `20260505000005_messages_reads_rls.sql`, `20260505000006_experiment_status_actions.sql`, `20260505000007_wiki_source_dates.sql`, `20260505000008_personal_memory_pillars.sql`, `20260508000001_usage_sessions_threads.sql`, `20260508000002_experiment_outcome_reason.sql`, `20260511000001_wiki_chunks_hnsw_search.sql`, `20260511000002_axiom_knowledge_schema.sql`, `20260511000003_core_library_curation.sql`, `20260513000001_model_usage_concept_state_call_type.sql`, `20260514000001_personal_memories_read_only_rls.sql`.

Read live through `supabase_axiom`: all public tables, columns, nullability, defaults, constraints, indexes, RLS flags and policies; all public application functions; public trigger definitions; extension inventory; migration ledger; exact aggregate row counts.

Skipped: non-public schemas except FK targets in `auth`; user-table row contents by explicit instruction; database logs and external services because they are outside schema scope; `src/lib/supabase.js` after identifying it as client code, not a migration or schema file.
