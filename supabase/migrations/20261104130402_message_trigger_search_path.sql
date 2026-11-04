-- The old app's message trigger names its tables without a schema
-- (conversation_threads, messages) and had no search_path of its own.
-- delete_account (20261101000011) runs with search_path '', so deleting a
-- message with a thread fired this trigger, which could not find
-- conversation_threads, and the whole deletion rolled back. Found by the copy
-- test on Nov 4 2026: 8 founders on live have such messages.
--
-- Pins the function's search_path to public. The function body and what it
-- does are unchanged. No data changes. Idempotent.
--
-- ROLLBACK: alter function public.sync_conversation_thread_from_message() reset search_path;

alter function public.sync_conversation_thread_from_message() set search_path = public;
