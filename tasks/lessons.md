# Lessons

- Destructive migrations that still have runtime dependencies belong outside `supabase/migrations/`. Keep them under `supabase/pending/` until code cleanup is merged and deployed and a data backup is verified.
- Do not remove denormalized session fields only because a replacement table exists. Confirm every runtime reader first; `sessions.pillar_weights` still drives RAG routing.

- Emphasis on text: use a thin underline in the highlight colour. Never colour or gradient the letters themselves; it reads cheap. (Rafay, screen 3.)
- Highlight at most 2 phrases per block of text, never everything the founder said. (Rafay, screen 3.)
- Axiom lines must contain something specific the founder said; never generic hand-offs like 'I have what I need'. Pre-filled inputs must never trap the founder: offer suggestions above an empty box. (Rafay, screen 4.)
- Never echo the founder's last message back as a hand-off. Ask the plain question, or move on silently. (Rafay, screen 4.)
- Axiom's Read must be plain: a headline that states the finding in everyday words, no clever contrast lines or metaphors. If the founder has to decode it, it failed. (Rafay, screen 5.)
- Axiom's copy must be plain, everyday language. No poetic, clever or abstract phrasing; no hypotheticals like 'if one of them said yes today, what would you want it to look like'. Ask the direct question. (Rafay, screens 5 and 6.)
- Every Axiom message must either ask one clear question or say what to do next. No remarks that leave the founder unsure what to do. (Rafay, screen 6.)
- Tapping a choice button must never post the choice as a chat message from the founder; show the pressed state and let Axiom continue. Buttons stay small and compact, never big blocks. (Rafay, Report.)
- Labels and buttons must say what the founder should DO in plain words. Internal terms (move, report, situation) are not self-explanatory. (Rafay, home screen.)
- Never assume anyone's gender in copy, samples or examples. Use they/them or rewrite. (Walkthrough, founder story sample.)
- Before writing a file, check whether it already exists (and read it). tasks/todo.md held 217 lines of earlier completed plans; I overwrote it and had to restore it from git. Append new plans instead. (Caught at commit time.)
- A change to the app's API surface (src/api/types.ts, http.ts) must run the SERVER tests too: server/e2e/shapes.test.js holds a contract for every app call. I added isSignedIn, ran only the app tests, and committed a red server suite.
- Live test, Nov 2: (1) a fixed list of "what next" phrasings missed "when does this convo end", so no move was offered; when a founder signals they want out, that is a move request. (2) The model echoed our internal word "evidence"; every internal name the prompt uses for its inputs belongs in the server's banned list, not only in the prompt. (3) A follow-up mode with no grounding rule answered from general knowledge; every mode that receives passages must be told to build on one, and the server checks it.
- Before putting stored data on screen in a new way, look at real rows first. The pull-quote block showed verified but meaningless fragments ("...final thing was payments") and credited a podcast host (Guy Raz) for his guest's words, because "author" in the library is the host for interviews. A quote being verified word for word does not make it worth showing.
