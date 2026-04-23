# Axiom — Claude Code Instructions

## Project Context
Mentor app for ambitious founders and builders (18-28).
Built web-first. Native (React Native + Expo) comes after web is live.

Stack (web):
- Frontend: Next.js
- Backend: FastAPI
- Database + Auth: Supabase
- Deployment: Railway

Core loop has two entry points:
- Situation-based: user brings something that happened, Axiom identifies
  the pattern they can't see, responds through the relevant pillar, ends
  with a 24-48hr experiment.
- Curiosity-based: user wants to understand a specific topic, Axiom
  teaches it through their specific context and world, still ends with
  an experiment.

Both entry points end the same way — an action, never just information.

AI: Claude API (claude-sonnet-4-20250514) powers the tutor.
Tone: Adaptive. Reads the user's state and mirrors it. Always direct,
never generic, never chatbot-friendly.

The product compounds over time. Axiom tracks experiments, reports, and
patterns across sessions. After enough sessions it knows the gap between
what a user says they want and how they actually behave. That
understanding is the moat.

Axiom is not for everyone. Users who don't follow through get removed.
This is a core product decision, not a feature — do not touch removal
logic without explicit instruction.

## The 6 Pillars
| Pillar            | Domain                                              |
|-------------------|-----------------------------------------------------|
| The Money Game    | Economics, capital, investing, financial literacy   |
| The Human Mind    | Psychology, behavior, cognitive science             |
| How Companies Win | Business strategy, competitive advantage            |
| What's Coming     | Futures thinking, emerging tech, geopolitics        |
| Think Sharper     | Mental models, decision-making, reasoning           |
| Move People       | Influence, persuasion, communication, leadership    |

Pillars are not tabs. They are lenses the AI applies to whatever the
user brings. A single session can touch multiple pillars. The user
never categorizes themselves.

## The Founder Brain
The home screen is a 3D sphere of nodes — the user is inside it.
Every concept engaged with and every completed experiment is a node.
Nodes are color-coded and symbol-coded by pillar.
Edges connect nodes across pillars when Axiom identifies a relationship.

Node states:
- Dim: concept engaged, experiment not completed
- Bright: experiment completed, knowledge implemented

On open: sphere auto-rotates for 3 seconds. Axiom's 1-2 sentence read
appears as floating text in the center. Axiom highlights 1-3 nodes with
a guiding light beam and "Start here today" label.

Navigation: slide to rotate, pinch to zoom in/out, tap node to open.
Tapping a node shows its label and pillar. Second tap starts the session.

Bottom of screen: persistent small text bar — "Something on your mind?"
User types freely. Axiom maps it to the right node and opens the session.
Axiom always speaks first when a session opens.

Node tap behavior: user sees the exact Axiom-generated insight that
created that node. For cross-pillar edges, they see the specific
connection Axiom made about them personally.

Maturity stages: Novice → Developing → Sharp → Founder-grade
Measured per pillar and overall.

3D brain built with Three.js on web.
When converting to native: rebuild with expo-gl + Three.js.

## Testing Mode (Pre-Launch)
All features are unlocked for internal testing. No paywalls, no feature
flags, no premium gates active.

When going live, the following move to premium:
- Full interconnected graph with cross-pillar edges
- Maturity stage label
- Shareable brain snapshot

Do NOT build any paywall logic until explicitly instructed.
Do NOT gate any feature during testing phase.

## Workflow Orchestration

### 1. Plan Node Default
- Enter plan mode for ANY non-trivial task (3+ steps or changes
  touching multiple files)
- If something goes sideways, STOP and re-plan — don't keep pushing
- Write detailed specs upfront before touching any code
- Use plan mode for verification steps, not just building

### 2. Subagent Strategy
- Use subagents to keep the main context window clean
- Offload research, exploration, and parallel analysis to subagents
- One task per subagent for focused execution

### 3. Self-Improvement Loop
- After ANY correction: update `tasks/lessons.md` with the pattern
- Write rules that prevent the same mistake from recurring
- Review `tasks/lessons.md` at the start of each session

### 4. Verification Before Done
- Never mark a task complete without proving it works
- Ask yourself: "Would a staff engineer approve this?"
- Check all session flows after every change — new user, returning
  user, experiment delivery, removal warning, brain graph update
- Verify Three.js sphere renders correctly after any graph change
- Verify memory persistence after any Supabase schema change
- Test bottom text bar routing after any session logic change

### 5. Demand Elegance
- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky, implement the elegant solution instead
- Skip this for simple, obvious fixes — don't over-engineer
- Challenge your own work before presenting it

### 6. Autonomous Bug Fixing
- When given a bug report: just fix it, no hand-holding needed
- Point at logs, errors, or broken behavior — then resolve them
- Zero context switching required from the user

## Task Management
1. **Plan First** — Write plan to `tasks/todo.md` with checkable items
2. **Verify Plan** — Check in before starting implementation
3. **Track Progress** — Mark items complete as you go
4. **Explain Changes** — High-level summary at each step
5. **Document Results** — Add review section to `tasks/todo.md`
6. **Capture Lessons** — Update `tasks/lessons.md` after any correction

## Core Principles
- **Simplicity First** — Make every change as simple as possible.
  Impact minimal code.
- **No Laziness** — Find root causes. No temporary fixes.
  Senior developer standards.
- **Minimal Impact** — Changes should only touch what's necessary.
  Avoid introducing bugs.
- **Memory is Sacred** — Never touch session history, experiment logs,
  or user pattern data without explicit instruction. This is the core
  value of the product.
- **Voice is Non-Negotiable** — Axiom's tone is direct, confrontational,
  and urgent. Never soften copy without flagging it first.
- **The Sphere is the Product** — The 3D brain is not a feature. It is
  the home screen, the navigation, and the entry point. Never replace
  it with a flat UI without explicit instruction.

## Project-Specific Rules

### Never touch without explicit instruction:
- Supabase project URL or anon key
- Session memory schema — write a migration plan first
- Experiment delivery logic — full regression test required
- Removal logic, warning thresholds, or refund triggers — these are
  legal and product commitments
- Three.js sphere core logic — document the change before touching it
- The bottom text bar routing — this is the primary entry point fallback

### Never do without flagging first:
- Soften Axiom's voice or add filler copy anywhere in the product
- Add onboarding steps — every extra step kills conversion
- Change pillar colors, symbols, or node visual language
- Introduce new fonts, colors, or UI patterns outside DESIGN.md
- Change the AI model — claude-sonnet-4-20250514 is the default

### Hard rules:
- Axiom speaks first on every returning user session — never break this
- The home screen is the 3D brain sphere — never default to a chat UI
- All experiments must be completable within 24-48 hours unless
  explicitly instructed otherwise
- Nodes have two states only — dim (engaged) and bright (implemented)
  — do not add intermediate states without instruction
- Cross-pillar edges only appear when Axiom has generated a specific
  personal insight linking them — never auto-generate edges
- The bottom text bar placeholder is "Something on your mind?" —
  do not change this copy without flagging
- Do NOT build paywall logic until explicitly instructed
- Do NOT gate any feature during the testing phase

### Removal System — do not modify:
- Warning 1: user misses 2 consecutive experiments with no report back
- Warning 2: user misses 2 more consecutive experiments
- Warning 1 and 2 are delivered in Axiom's voice — not as system
  notifications or customer service copy
- After Warning 2: next miss triggers permanent removal
- Refund: full refund only if removed within first 15 days
- Reapplication: available after 3 months
- Reapplication question: "When you left, it was because [specific
  logged reason]. Tell us 3 things you did in the last 3 months
  to overcome that."
- Axiom reviews the response and decides — no appeals process

### Wiki Pipeline Rules
- Never process documents synchronously —
  always async, never block the upload response
- Never skip the similarity threshold (0.75) —
  irrelevant chunks injected into context are
  worse than no wiki context at all
- Never store raw files in Supabase Storage —
  raw files go to R2 only, Supabase holds chunks
  and embeddings only
- Never expose the admin panel route in the
  main app navigation — /admin only, no link
- Never auto-approve user-contributed sources —
  team review always required before processing
- OpenAI API key is for embeddings only —
  all AI responses still use Claude API
- If processing fails: log the error, mark
  document as failed, never silently drop it
- Reprocess option must always be available
  in admin panel for failed documents

## File Structure
- `tasks/todo.md` — current task plan and progress
- `tasks/lessons.md` — running log of mistakes and fixes
- `CLAUDE.md` — this file, codebase bible
- `PRODUCT.md` — full product philosophy, rules, and decisions
- `ARCHITECTURE.md` — system design, memory layer, API structure
- `DESIGN.md` — visual language, interaction principles,
  component rules
