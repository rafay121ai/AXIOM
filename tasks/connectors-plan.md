# Plan: the proactive Axiom (connected accounts through Composio)

Status: PLAN ONLY. No code until Rafay approves this file and the gates below.
Basis: Rafay's decisions of Nov 10 2026 (this file), `tasks/decisions.md` PARKED section, `tasks/memory-plan.md`, ARCHITECTURE.md (push, data model, security).
Branch: new branch off `main` after the memory layer is merged. Do not build on `feat/memory-layer`.

## What Rafay decided (Nov 10)
- Connectors: Gmail, Google Calendar, Notion. Read only.
- Connectors also teach Axiom about the founder (business, people, rhythm) with no extra questions. Facts are stored WITHOUT asking first.
- Significance is not limited to the open situation. It can touch any situation, or none.
- Three lanes: People (co-founder, investor, customer), Time (meetings, promises), World (newsletters, news that changes the founder's business).
- Newsletters: after Gmail connects, Axiom ranks the founder's newsletters and asks which ones matter. Those are watched. Others are ignored.
- Push cap: 4 a day. Extreme events may skip the cap, for that event only.
- The push explains the news and how it connects to the founder's business. It offers a Move only when there is a real one. Some signals are simply "you should know this", with no action attached (Rafay, Nov 10).
- All three connectors ship before demo day (Rafay, Nov 10). Build order inside that is still staged (see the end).

## Conflicts with current rules (must be settled and written to tasks/decisions.md BEFORE code)
1. Connected accounts are PARKED in PRODUCT.md and ARCHITECTURE.md ("Gated changes"). Unpark them, with the reasons.
2. Push cap: PRODUCT.md and the `notification_log` unique key say 2 a day (one per slot). Signals need a new rule: 4 a day (see Q1).
3. "Stored founder memory is never touched" and "no memory without asking": Rafay chose to store connector facts without asking. Kept safe by: every fact tagged `source = connector`, visible on the memory screen, correctable (`founder_corrections`), kept on disconnect (with a separate delete button) and deleted on account deletion.
4. "Live web search is deprecated": facts about unfamiliar people cannot come from the web (see Q4).
5. "Adding onboarding steps" is flag-first: the Connections step and the newsletter picker are new screens. Needs a mock in `tasks/design/` approved by Rafay, in DESIGN.md's language.
6. The memory-layer migrations (`20261109*`) this plan builds on are live (checked Nov 25).

## Facts checked on Nov 10 (Composio docs, web). Re-check in Phase 0.
- Gmail on Composio is a POLLING trigger, not push. Documented delay: up to about 15 minutes on Composio-managed auth (one page says 2 minutes minimum). "Exactly when the email lands" is not promised by Composio. Real-time would need our own Google app plus Gmail Pub/Sub, which brings Google's restricted-scope verification and a CASA security assessment (weeks, and a cost). Decision: v1 accepts a delay of a few minutes. The app never claims real-time.
- The first Gmail poll sets a baseline; older mail is NOT backfilled by the trigger. History for the profile comes from a one-time fetch call at connect.
- Under Composio-managed auth, Google verification sits with Composio's app, only for the scopes in its auth config. Our own OAuth app brings it back to us.
- Google's Limited Use rules apply to Gmail data: only for user-facing features, never to train models. The privacy page must say so.

## Phase 0 findings (Nov 10, Composio's own docs and pricing page)
- **Gmail and Calendar: polling. Notion: push** ("near-instant"). Minimum interval on Composio-managed auth is 2 minutes, so a Gmail push can arrive a few minutes after the email. Whether the interval can be changed, and the Calendar and Notion trigger slugs, are not stated on the pages read. Gmail slug: `GMAIL_NEW_GMAIL_MESSAGE`.
- **Webhook signing** (Standard Webhooks style): headers `webhook-id`, `webhook-timestamp`, `webhook-signature`; signed string `{id}.{timestamp}.{rawBody}`, base64 HMAC-SHA256, `v1,` prefix; 300 s tolerance; the id is stable across retries, so it is the idempotency key. The secret is shown once. The subscription must include event type `composio.trigger.message`. A forum user reported a mismatch following the generic scheme: use Composio's SDK verify call and test with a real event.
- **Disabling a connected account also disables its triggers**, and re-enabling does not turn them back on. The worker must re-enable triggers after a reconnect. No expiry event name is stated; plan to detect failed calls and mark `needs_reconnect`.
- **Pricing (official page, today): Free = $0, 10,000 tool calls a month, only 5 connections. Standard = $18 per seat, 10,000 calls per seat, overage $0.005 per call.** Third-party sites quote other numbers (20K or 100K); the official page wins. Trigger-event quota and rate limits are not stated.
  - Consequence 1: 5 connections is 1 founder with 3 toolkits plus 1. The 10 capstone users need 30 connections, so a paid plan is required.
  - Consequence 2: every fetch and backfill call costs about half a cent past the allowance. A founder backfilling 30 days of mail can use hundreds of calls, so Phase 3's hard per-connect call budget is a cost control, not a nice-to-have.
- **Google scopes and who carries Google verification on managed auth: NOT STATED.** The docs only describe a customer-owned Google app as the verification path. Cannot be settled from the docs. Rafay (or a Composio account) must open Composio's Gmail auth config and read which scopes it lists; I cannot create the account. Until then, Gmail read-only under managed auth is an assumption.

## Architecture in one picture
```
Composio (Gmail, Calendar, Notion)
   | trigger events (signed webhook)         | fetch calls (backfill, details)
   v                                         v
POST /connectors/webhook  -> verify signature -> insert job (idempotent)  [Express, Render]
   v
job worker (Postgres queue, SKIP LOCKED)
   1. FILTER   code only: drop bulk mail, promos, no-reply, sensitive; keep co-founder / watched senders / meetings
   2. EXTRACT  one model call, JSON only, no tools, email text = untrusted data
   3. VERIFY   code: every name, number, date in the output must appear in the source text
   4. SCORE    lane + relevance to this founder + urgency (0 to 3). An action is optional, never required to push.
   5. DECIDE   push now | home item | drop
   v
signals table  ->  push (cap, quiet hours, care pause, dedupe)  ->  app opens the signal  ->  Learn / Move (existing flow, existing validator)
```
Raw email bodies are never stored. Only extracted facts and a verbatim snippet of at most 200 characters (same as `memory_evidence`).

## Phases (each ends with a verify step and a gate; nothing ships dark-to-live without Rafay)

### Phase 0. Decisions and checks (no code)
- [x] Record the answers (Q1 to Q5) in `tasks/decisions.md`. Done Nov 10.
- [~] Composio check (done from docs; open items in "Phase 0 findings"): pricing and limits, Gmail and Calendar trigger interval, Notion trigger support, webhook signature scheme and replay window, data retention, security and DPA terms, how revoked tokens are reported, one Composio user id per founder.
- [ ] Google path: Composio-managed auth for v1 (no own verification). If Composio's Gmail auth config lacks the read-only scope we need, stop and report. For the capstone demo (10 external users) check whether Composio's app or Google "Testing" mode (test-user list, refresh tokens that may expire in about 7 days) is enough.
- [x] Update PRODUCT.md (unpark, push rules, lanes), ARCHITECTURE.md (new section), tasks/decisions.md. Flag first, Rafay approves wording.
- [x] Gate: Rafay approved the docs wording (Nov 10).

### Phase 1. Schema (read-only live dump first, then a migration plan, then approval)
- [x] Apply the memory-layer migrations (`20261109*`) first. Live as of Nov 25 (checked with list_migrations).
- [x] Fresh read-only dump of live main schema (extends `audit/schema_live_2026-11-09.md`).
- [x] Three migration files plus rollback, idempotent, RLS on, no client policies (same rule as every founder table):
  - `connector_accounts`: id, user_id, toolkit (gmail, calendar, notion), composio_account_id, status (active, needs_reconnect, revoked), scopes, connected_at, last_sync_at, last_error_code. One active row per founder and toolkit. We store NO OAuth tokens; Composio holds them.
  - `watch_sources`: id, user_id, kind (newsletter, sender), identifier (sender address or domain), display_name, status (suggested, watching, muted), rank_score, decided_at. Unique per founder and identifier.
  - `connector_jobs`: id, user_id, toolkit, external_id, kind, status (queued, running, done, failed, dropped), attempts, run_after, locked_at. Unique (user_id, toolkit, external_id) = idempotent; webhooks can repeat.
  - `signals`: id, user_id, lane (people, time, world), source_kind, external_ref_hash, facts jsonb (extracted, validated), impact text, urgency 0 to 3, status (new, pushed, shown, acted, dismissed, expired), situation_id null, expires_at, created_at. No raw body.
  - `notification_log`: allow `kind = 'signal'` with its own cap (see Q1). The current unique key (founder, day, slot) can't hold 4 signals, so signals need a different dedupe key. Change with care and test the morning and evening pushes still hold their one-a-day limit.
  - `founder_beliefs.source`: add `connector`. `model_usage_logs.call_type`: add `signal` and `connector` (same drop and re-add, NOT VALID, lock_timeout pattern as `20261101000009`).
  - `delete_account`: add the new tables, copied from the LIVE function definition, not from the repo files.
- [x] migration-checker agent passes. Rollback tested Nov 27 on live inside one transaction that applied all three files, ran the rollback, checked the result and was then undone (no branch cost; nothing stayed).
- [x] Gate: Rafay approved (Nov 27). Applied to live main Nov 27, versions 20261125000001-3. Deploy order: migrations first, then server code. Rollback: server code first, then SQL.

### Phase 2. Connection layer (server only)
- [x] `server/connectors/composio.js`: thin client. One place that calls Composio. API key only in Render env (`COMPOSIO_API_KEY`), never in the app.
- [x] Composio user id = the Supabase user id (opaque uuid, no email or name sent as an identifier).
- [x] Routes (JWT checked, behind `CONNECTORS=on`): start connect (returns the Composio link), status, disconnect. (Nov 27. No separate callback route: `GET /api/connectors` reconciles with Composio after the founder returns.)
- [ ] (server done Nov 27; screen and the separate "delete what Axiom learned" button not built) Disconnect = revoke at Composio, delete the connector row, signals and watch sources. Facts already learned (beliefs, world, evidence) are KEPT (Rafay, Nov 10). The disconnect screen says so plainly and offers "delete what Axiom learned from this" as a separate button. Account deletion still removes everything.
- [ ] Scopes (changed Nov 25, see "Acting on approval"): Gmail read and send, Calendar events, Notion the pages the founder picks. Enforced in code: an allowlist of Composio action names; read tools run freely, write tools only with a founder approval; anything else throws.
- [ ] Tests: fake Composio (same pattern as `createFakeSupabase`), connect, disconnect, revoked token becomes `needs_reconnect`, allowlist rejects a write action.

### Phase 3. Ingestion and queue
- [ ] `POST /connectors/webhook`: verify signature and timestamp (replay window), body size limit, constant-time compare, answer 200 fast, insert the job, return. No work in the request.
- [x] (built Nov 27 as a conditional-update claim, no SKIP LOCKED in supabase-js) Worker with Postgres `FOR UPDATE SKIP LOCKED`, retries with backoff, max attempts, dead-letter status. No new infrastructure (no Redis).
- [x] Safety net: a scheduled poll per active founder for missed events (reuse the push scheduler pattern in `server/push/scheduler.js`).
- [x] (hard caps on calls; no model spend yet) One-time bounded backfill at connect: last 30 days of Gmail headers and subjects from people, Calendar 14 days ahead and 30 behind, selected Notion pages. A hard limit on messages and on model spend per connect.
- [ ] Per-founder rate limit and a global circuit breaker: if Composio errors repeatedly, stop calling it and retry later. Failures never touch founder data.
- [ ] Tests: duplicate webhook does nothing twice, bad signature rejected, replayed old timestamp rejected, worker crash mid-job is retried once and not double-counted.

### Phase 4. Filter (code only, no model)
- [ ] Drop before any model sees it: Gmail categories promotions, social, spam, updates unless the sender is watched; `List-Unsubscribe` bulk mail unless watched; no-reply senders unless watched; calendar events marked private or with no attendees.
- [x] Sensitive deny list: medical, legal, bank and card, tax, ID, password-reset and one-time-code mail never reaches a model or storage. Unknown means drop.
- [ ] Always keep: confirmed co-founder, people on an upcoming meeting, a reply to something the founder sent.
- [x] Tests: a fixtures folder of real-shaped emails (promo, receipt, newsletter, co-founder, medical, injection attempt) with the expected keep or drop.

### Phase 5. Passive profile (learns without asking)
- [ ] Reuse the memory layer (`extractBeliefs.js`, `beliefRules.js`, `memoryStore.js`, `memory_evidence`): add `connector` as a source and a connector extraction prompt in `server/journey/memory/prompts/`.
- [ ] Rules kept from the memory plan: every number in a belief must appear in the source text; evidence snippet is verbatim and at most 200 characters; no belief from care-touched content.
- [ ] Learns: business and industry, customers, co-founder and key people (`founder_world`), recurring meetings, working rhythm, goals and bets (Notion).
- [ ] Never learns: health, politics, religion, family, money in personal accounts, anything the sensitive filter dropped.
- [ ] Shows on the existing memory screen (`memoryScreen.js`) with the source name, and the founder can mark a fact wrong or outdated (`founder_corrections`). A corrected fact is never re-learned.
- [ ] Tests: sensitive mail produces no belief; a wrong number is rejected; a correction sticks.

### Phase 6. Significance engine
- [x] One model step `SIGNAL` (env `MODEL_SIGNAL`, cost logged as call_type `signal`, counted by the daily cap in `server/dailyCap.js`). Input: filtered item, the founder's stored beliefs, world, open situations, upcoming events. Output is JSON and is schema-checked.
- [ ] Output fields: lane, what_happened (restating only what the source says), source_name, impact_on_founder (marked as Axiom's read, not news), urgency 0 to 3, an optional action (only if a real one doable in 10 minutes exists; otherwise null), related situation or none. A signal with no action is still pushed if relevance and urgency pass: the point is that the founder knows.
- [x] Code enforces what prompts cannot: every name, number and date in `what_happened` must appear in the source text; the source is named ("Bloomberg reports"); no claim that is not in the source is allowed as fact; `impact_on_founder` must reference a stored fact about this founder or the signal is demoted to a home item.
- [x] Prompt-injection defence: email and newsletter text is untrusted data. The model gets no tools and no ability to act. Instructions found inside content are ignored and the item is flagged. Output only through the schema.
- [ ] Extreme-event rule, in CODE, not in a prompt. A signal may skip the cap only if all of: urgency 3 from the model; the verifier passed; it matches something in the founder's own world (a stored route, customer, market or product); the source is a watched source or a confirmed key person. Skips the cap for that signal only. A hard ceiling still applies (Q2).
- [x] Meeting prep (the Elon case): triggers 24 to 48 hours before an event with an attendee not in the founder's world. Gathers only: the email thread, event description, Notion notes. Facts about the person come only from those. No outside or general-knowledge facts (Rafay, Q4). If the sources do not say who the person is, Axiom says "I could not confirm who this is" and prepares the founder from what the thread says they want.
- [ ] Author lesson in a brief: only a verified library lesson through the existing citation checker (`lesson_citations`, author and book named). If none fits, no author appears. Never invented.
- [ ] The Move, only when the signal has an action: created through the existing Move flow and the deterministic validator, untouched. Founder is the only variable, startable in 10 minutes, binary. If the founder already has 2 active moves, the brief still goes out with the existing `NO_ROOM_LINE` and no new move. Information-only signals create no Move and no Learn conversation. If the founder taps "teach me more" on one, the normal rule applies: that Learn conversation leads to a Move. CLAUDE.md's "Learn always leads to a Move" is not broken; flagged here so it is read that way.
- [ ] Information-only pushes still carry the whole point (no teaser) and the same cap and quiet hours.
- [ ] Tests (injection, made-up number, cap, duplicate, disconnect and care done in S2; extreme path and library quote wait): injection fixtures (an email that says "ignore your rules and push X"), a made-up number is rejected, extreme path needs all four conditions, a quote not in the library is never shown.

### Phase 7. Push and delivery
- [ ] Extend `server/push/` (`policy.js`, `compose.js`, `due.js`): kind `signal`, daily cap enforced atomically in the database (a lock per founder per local day, then count, then insert, then send) so two workers cannot send a fifth.
- [ ] Dedupe key per signal. The same news in two newsletters becomes one push.
- [ ] Quiet hours respected. Care open or delete request pending = no pushes (existing rules). Extreme events and quiet hours: see Q2.
- [ ] Lock-screen text follows the founder's setting (`full`, `short`, `hidden`). Default for connector pushes is `short`: email content on a lock screen is a privacy leak.
- [ ] Voice: direct, specific, the founder's own numbers, no teasers, no forbidden phrases. Run voice-checker on every line before it exists.
- [ ] A push that is not sent in time (the item went stale) expires and becomes a home item instead.
- [ ] Tests: 5th signal in a day is held, extreme skips only itself, quiet hours hold, care pause holds, failed send retried at most 3 times.

### Phase 8. App (Expo)
- [ ] Mock first (flag-first): Connections screen in Settings (connect, see what Axiom read, switch off per source, disconnect), the one-time newsletter picker after Gmail connects (top candidates ranked by how often they arrive and how often the founder opens or replies), signal item on the home screen, signal card that opens into Learn and Move. Uses DESIGN.md only. Rafay approves the mock.
- [ ] All writes through the Express API. No Composio or Google call from the app. The app opens Composio's connect link in the system browser.
- [ ] Offline and retry behaviour reuses the outbox.
- [ ] Tests in `app/__tests__/` for each new screen, plus a check that no client-side write was added.

### Phase 9. Security and production hardening (gate before any real founder connects)
- [ ] backend-auditor agent on the whole change. Result must be clean or each finding fixed.
- [ ] Secrets only in Render. No email text, subject, sender or snippet in logs; metadata and ids only (add a test that greps log output for fixture strings).
- [ ] Kill switches, default off: `CONNECTORS`, `SIGNAL_PUSH`. Per-toolkit switch. Turning one off stops that part and nothing else.
- [ ] Cost: per-founder and global daily caps include signal calls. A runaway inbox cannot spend past the cap; over cap, items wait and expire.
- [ ] Account export (`accountExport.js`) includes connector data. Account deletion removes it all (tested against the live `delete_account`).
- [ ] Privacy page and consent wording updated: what is read, what is stored, who sees it (Composio and OpenAI), Google Limited Use statement, how to disconnect and delete. New consent decision logged in `consent_log` with a wording version.
- [ ] Revoked or expired token: status `needs_reconnect`, one calm in-app line, no push spam.
- [ ] Load test: a burst of 500 webhooks, queue drains, nothing double-sent, no founder over cap.
- [ ] Rollback proven on a Supabase branch.

### Phase 10. Verify and roll out
- [ ] CLAUDE.md "Verify before done" list, plus: connect, backfill, newsletter picker, signal, push, cap, disconnect and delete, each shown working.
- [ ] test-runner agent, care-tester (distress in an email stops briefs), voice-checker, axiom-reviewer before merge, learning-loop after.
- [ ] `python3 tasks/status.py` after each step.
- [ ] Rollout: flags off, deploy, Rafay's own account only, then the 10 external capstone users, then everyone. Each step only with Rafay's go.

## Recommended build order for the first usable slice
1. Phases 0 to 3 (decisions, schema, connection, queue).
2. Calendar plus Gmail, People and Time lanes, meeting prep, push. (The most useful and the least noisy.)
3. Newsletter picker and the World lane.
4. Notion.
5. Passive profile on top of the memory screen.

## Answered by Rafay (Nov 10)
- Q1. Signals get their own 4 a day, on top of the morning and evening pushes (total up to 6).
- Q2. Extreme events: ceiling of 2 a day. Quiet hours kept, unless the event is dated within the next 3 hours.
- Q3. On disconnect, facts already learned are KEPT. (Risk: Google Limited Use and privacy; mitigated by the separate "delete what Axiom learned" button and plain wording. Re-check with Google's policy in Phase 0.)
- Q4. Facts about an unfamiliar person come only from the founder's own emails and notes. No general-knowledge line.

- Q5. All three connectors (Gmail, Calendar, Notion) before demo day. No signal needs an action to be pushed.

## Still open
Nothing from Rafay. Phase 0 checks (Composio limits, scopes, Notion triggers) may force a change.

## Not verified yet
Composio pricing and rate limits, Notion trigger support, whether Composio's Gmail auth covers the read-only scope, the real polling interval on our plan, Google Testing-mode token life.

## Gmail scopes: what happened (Nov 10, Rafay testing in Composio)
- Composio's default Gmail config lists 11 scopes, including `https://mail.google.com/` (full read, send, delete) and contacts, birthday, address and phone scopes.
- Narrowing it to `gmail.readonly` plus `userinfo.email` and `userinfo.profile` made Google show "This app is blocked" on sign-in. Composio's managed Google app is not approved for `gmail.readonly`.
- Rafay's decision: go back to Composio's DEFAULT scopes for development and testing.
- Rules that go with it (written here so they are not forgotten):
  - Default scopes are for Rafay's own account and development only. No other founder connects through them.
  - Read-only is then enforced only by our code (the action allowlist in Phase 2). A test must prove a write action such as send or delete throws before any connection is made.
  - Before any capstone tester or real founder connects: switch Gmail to our own Google app with `gmail.readonly` (Option A: Google Cloud project, Testing mode, test users listed, client id and secret entered in Composio). The consent wording must match what is really requested.
  - Before public launch: a custom domain for homepage, privacy and terms (a shared `*.vercel.app` address cannot be verified by Google, as far as we know), Google verification and the yearly security assessment (get a real quote).
- Calendar: test the managed connect with `calendar.readonly`; result not known yet.

## First connections (Nov 25)
- Composio Platform key in `.env` and Render. SDK `@composio/core` 0.31.0 (needs Node 22.22.3+: set Render's Node version before the server uses it).
- `server/connectors/composio.js`: one session per founder (Supabase user id), toolkits `googlecalendar`, `gmail`, `notion` (Composio's own, not `notion_mcp`, because only it has triggers). A read-only allowlist throws before any other tool is called; slugs checked against the live catalog.
- Rafay's own account connected to all three; one read-only call each passed (Calendar `log_ptfdJFP3DKHf`, Gmail `log_5g499Oh9p7NI`, Notion `log_SLwbf6cYJCgt`). `server/connectors/firstCall.js` repeats the check.
- Notion: the founder picks pages in Notion's picker (child pages included) and can add more later from the page's ••• → Connections. The connection shows Composio's name, not Axiom's: register our own Notion app in Composio before testers, and the Connections screen must say how to share more pages.

## Acting on approval (Rafay, Nov 25; decision in tasks/decisions.md)
Axiom prepares the work; the founder approves; only then Axiom does it. Not built.

Write tools (slugs checked against the live catalog, Nov 25). Nothing else that writes is ever allowed:
- Gmail: `GMAIL_SEND_EMAIL`, `GMAIL_REPLY_TO_THREAD`.
- Calendar: `GOOGLECALENDAR_CREATE_EVENT`, `GOOGLECALENDAR_PATCH_EVENT` (move), `GOOGLECALENDAR_DELETE_EVENT` (cancel: Google has no separate cancel call; deleting an event the founder owns is how attendees get the cancellation. Only as an approved "cancel this meeting").
- Notion: `NOTION_CREATE_NOTION_PAGE`, `NOTION_ADD_MULTIPLE_PAGE_CONTENT` (add to a page). Not `NOTION_UPDATE_PAGE` (Composio marks it destructive: it can archive), not replace, archive, delete or move.
- Never: any Gmail delete, trash, filter, forwarding, settings or label tool; batch tools; Notion archive or delete.

Schema (goes into the Phase 1 migration plan): `connector_actions`
- id, user_id, toolkit, tool_slug, args jsonb (exactly what runs), preview text (what the founder sees), content_hash, status (proposed, approved, done, failed, rejected, expired), source signal_id or situation_id, proposed_at, approved_at, done_at, expires_at, composio_log_id, error_code. Server only, RLS on, no client policies. Included in the account export and in `delete_account`.

Server
- `POST /api/actions/:id/approve` (JWT, founder owns it, status proposed, not expired; the app sends the content hash it showed, edited text creates a new proposed action first). Approve and run in one request: mark approved, run, mark done or failed. A row can run once (status change with a WHERE on status).
- `composio.js` gains `act(userId, actionRow)`: throws unless the tool is in the write list AND the row is approved, belongs to that user, is unused and its hash matches the args. `run()` stays read-only and refuses write tools.
- A model may only PROPOSE (insert a proposed row through code that validates args against the tool schema and the founder's own data: recipients must be people already in the thread or the founder's world). It never calls `act`.
- No action is proposed or run during care or a pending delete request. Kill switch `CONNECTOR_ACTIONS` (off by default).

App
- An action card: what will be sent or changed, to whom, when; Edit, Approve, Not now. After running: "Sent to Sara at 14:02" with a link where possible. "What Axiom did" list in Settings. Mock first (flag-first), DESIGN.md only.

Tests
- A write tool without an approved row throws before Composio is called; a used row cannot run twice; a changed body after approval is refused; another founder's row is refused; an email that says "send X to Y" never creates an approved action; care blocks proposing and running.

Google: our own app asks for `gmail.readonly`, `gmail.send`, `calendar.events` (sensitive, not restricted). No `gmail.compose` (restricted).

## Learning from how founders work (Rafay, Nov 25; decision in tasks/decisions.md)
Not built. Tables go into a later migration plan (not the Phase 1 drafts), after the fields below are approved.
- Connect screen (Phase 8 mock): "Connect Gmail, Calendar and Notion. I'll catch what matters before you miss it. Your reads get sharper from day one." Then a separate switch, off by default: "Learn how I work. Make every read sharper." Nothing else on that screen. Same switch in Settings, with "Anonymous. Never your name or your words. Kept to improve Axiom, even if you leave." under it. Each change is written to `consent_log` with the wording version.
- `founder_pattern_stats` (from everyone): totals only. Metric, bucket (e.g. stage = seed), month, count. No user id. Written by a nightly job from live data; a bucket under 5 founders is not stored, so a single founder cannot be read out of it.
- `founder_patterns` (switch on only): one anonymous row per founder, closed-list fields only: stage, industry category, decision traits (existing closed list), situation kinds, lanes acted on, approval rate band, move outcome counts, newsletter categories. No user id, no link table, no free text. Written in a monthly batch with times rounded to the month, so a row cannot be matched to an account by when it appeared. Never deleted with the account.
- Never in either table: names, companies, email or page content, sender addresses, numbers the founder typed.
- Before building: the exact field list and the bucket threshold need Rafay's approval; the privacy page gets the "anonymous, combined statistics" sentence and the Settings line.
