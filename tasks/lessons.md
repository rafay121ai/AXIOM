# Lessons

- Destructive migrations that still have runtime dependencies belong outside `supabase/migrations/`. Keep them under `supabase/pending/` until code cleanup is merged and deployed and a data backup is verified.
- Do not remove denormalized session fields only because a replacement table exists. Confirm every runtime reader first; `sessions.pillar_weights` still drives RAG routing.
- Verify tests a builder claims to have added with `git show --stat` and a per-file test count before accepting the build.
- Boot checks must stop the server by its own PID. Never pkill/killall by command line; it can kill other sessions' servers.
