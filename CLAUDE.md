# Axiom: Instructions for Coding Agents

This file is for Claude Code, Codex and any other coding agent working in
this repo. Read it at the start of every session.

## Project Context
Axiom is an operating system for founders. A founder brings a real
situation, Axiom reads what is really going on, teaches what they need to
know from authors and from founders one stage ahead, gives them one move
to make today, and finds out with them what happened.

- **PRODUCT.md** is the source of truth for what Axiom is and how it
  behaves.
- **ARCHITECTURE.md** is the source of truth for how it is built.
- If code and these documents disagree, stop and flag it. Do not guess.

Global product. Free for now. Native app first (Expo), with push
notifications. The old Vite web app stays only until replaced.

## Stack (current)
- App: Expo (React Native), iOS and Android, with push notifications.
  Old web app: Vite + React on Vercel, kept until replaced.
- Backend: Express (Node.js), on Railway
- Database and Auth: Supabase, two projects (main and axiom-knowledge)
- AI: OpenAI. Model IDs live in server config.

The old docs described Next.js, FastAPI and the Claude API. That stack
does not exist here.

## The Founder Journey
Onboarding once. Then every situation moves through separate screens:

**Situation -> Read -> Learn -> Move -> Report (evening)**

The screens are separate. The journey is connected by hooks: every screen
carries over a thread from the last one and leaves one open. See the Hooks
section of PRODUCT.md. Hooks must be specific to the founder. No teaser
questions, no withheld information.

## Hard Rules
- Axiom speaks first after onboarding. Returning founders land on the
  home screen: a greeting and a chat bar, never a blank prompt. What they
  left off shows as small items for a few seconds and in the menu.
- Situation: maximum 2 follow up questions, enforced in code.
- Every Learn conversation leads to a Move. Never information only.
- Author lessons always name the author and book. Never show a chapter,
  page or quote that is not verified against the source library. Never
  invent a quote. The loading hint may show the book name only.
- Founder voices shown to real users must come from real, consented,
  reviewed outcomes. Samples only in prototypes, labelled as samples.
- Moves: the founder is the only variable, startable within 10 minutes,
  binary success, reported the same evening or within 48 hours. Maximum 2
  active per founder. One swap allowed, with a real reason.
- Report outcomes: Done, Couldn't, Didn't. No strikes, no warnings, no
  removal, ever.
- Give to get: a report unlocks founder cases for the next situation.
- Consent to share is asked at every report, unless the founder has turned
  on "share automatically" in Settings. Default is not shared.
- Peer outcomes are never shown before human approval. Peer outcome rows
  never store a user_id. A private server-only link table may connect an
  outcome to its author, for taking down shares and for double opt-in
  introductions. It is never exposed.
- Distress or crisis signals stop the journey: no lessons, no move. Respond
  with care and point to real help.
- All writes go through the Express API. The app (and any browser) uses
  Supabase for auth only.
- No paywall, no gating, no payment code until explicitly instructed.

## Never Touch Without Explicit Instruction
- Supabase project URLs, keys, or live data
- Database schema. Write a migration plan first, and base it on a dump of
  the live schema, not the checked in files.
- The deterministic experiment validator. Full regression test required.
- Consent, anonymization and peer outcome privacy logic
- Stored founder memory, theory, situations and reports

## Flag First, Before Doing
- Changing Axiom's voice or adding filler copy
- Adding onboarding steps or questions
- Changing the AI model or provider
- Introducing new fonts, colors or UI patterns outside DESIGN.md
- Deleting any table, column or stored user data

## Deprecated: Do Not Build On
These are from the old product. Do not extend them. Remove them only when
the task says so and the replacement works.
- Founder Brain / Three.js sphere, nodes, edges, maturity stages
- Personal wiki graph
- The old AI-drawn artifact rendering system (the fixed picture library
  is allowed)
- Live web search
- Weekly reads
- Warning, removal, refund and reapplication system
- Payments and premium tiers

## Axiom's Voice
Direct and urgent. Never confrontational, never cold. Specific to the
founder: their words, their numbers, their dates. No filler.

Forbidden phrases: "great question", "certainly", "I understand",
"that's interesting", "absolutely", "of course", "I'd be happy to",
"great".

Plain words. Subtle dry humour only in greetings and when a move goes
well. No swearing. Never assume anyone's gender. Full guide: `tasks/voice.md`.

## Workflow

### 1. Plan first
- Use plan mode for any non trivial task (3+ steps or multiple files).
- Write the plan to `tasks/todo.md` with checkable items before touching
  code.
- If something goes sideways, stop and re plan.

### 2. Subagents
- Use subagents for research, exploration and parallel analysis.
- One task per subagent.

### 3. Self improvement
- After any correction, add the pattern to `tasks/lessons.md`.
- Review `tasks/lessons.md` at the start of each session.

### 4. Verify before done
Never mark a task complete without proving it works. After changes to the
relevant area, check:
- New founder: onboarding through first Read
- Returning founder: lands on the home screen (greeting, chat bar, items
  that fade, menu list)
- Situation: follow ups stop at 2
- Learn: lessons render, citations validated, follow up taps work
- Move: validator passes, commit schedules the report
- Report: outcome saved, unlock granted, consent recorded
- No client side writes introduced (app or browser)
- Cost logging still records the call

### 5. Elegance, not hacks
- For non trivial changes, ask whether there is a simpler way.
- Do not over engineer simple fixes.

### 6. Bug fixing
- Given a bug, find the root cause and fix it. No temporary patches.
- Always fix from the root. Never patch around a problem or work around a
  failing test.
- Delete dead code you find or create (unused files, functions, flags,
  comments about removed behaviour) in the same change.

### 7. Learning loop
- After every milestone, and after any correction or failed test, run the
  `learning-loop` agent. It finds the root cause, adds a lesson to
  `tasks/lessons.md`, and where possible a regression test or check.
- Keep `tasks/build_status.json` current with `python3 tasks/status.py`
  after every step. The "Axiom build" panel reads it.

### 8. Reports and usage limits
- When every screen of the app exists, write a plain-English report for
  Rafay (`tasks/build_report.md`): what was built, what each screen does,
  what was checked and how, what it cost, what is left, and anything that
  needs his decision.
- If a usage limit stops the work, wait for it to reset and resume from
  `tasks/build_status.json` and `tasks/todo.md` without being told.

## Core Principles
- **Simplicity first.** Smallest change that solves the problem.
- **Minimal impact.** Touch only what the task needs. Do not reformat
  unrelated code.
- **Memory is sacred.** Founder situations, reports, theory and memory are
  the product's value. Never alter or delete them without instruction.
- **Server owns logic.** Rules that matter are enforced in code, not only
  in prompts.
- **Specific or nothing.** Any output that would make sense to a different
  founder unchanged is a bug.

## File Structure
- `CLAUDE.md`: this file
- `PRODUCT.md`: product definition, rules and decisions
- `ARCHITECTURE.md`: system design, data model, AI layer
- `DESIGN.md`: visual language (updated October 2026)
- `BRAND.md`: brand guidance (updated October 2026; tagline still open)
- `tasks/todo.md`: current plan and progress
- `tasks/lessons.md`: mistakes and the rules that prevent them
- `tasks/decisions.md`: every product decision, with the reason
- `tasks/voice.md`: Axiom's voice guide
- `tasks/design/`: the approved screen mocks
- `audit/`: September 2026 codebase audit