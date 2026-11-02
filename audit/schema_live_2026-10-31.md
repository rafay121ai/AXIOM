# Live main schema before the journey push (read-only, Oct 31 2026)

Project: Axiom (zmzrrmqqxqzmmfovpqjt).

Applied migrations: 20260929000000 baseline, 20260929000001 secure_public_schema, 20260930000000 drop_legacy_brain_and_warnings.

Public tables: app_sessions, conversation_threads, experiments, messages, model_usage_logs, personal_memories, sessions, users, wiki_chunks, wiki_sources. No views (user_conversations is gone). None of the journey tables exist yet.

model_usage_logs.call_type in use: chat 227, memory_update 485, query_expansion 22, embedding 16, onboarding 8, artifact 7, concept_state_update 3, session_notes 2. The new checks are NOT VALID, so these rows stay.

To apply, in order: 20260930000001, 20260930000002, 20261013000001, 20261013000003, 20261101000001 to 20261101000011.
