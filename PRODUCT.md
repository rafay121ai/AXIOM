# Axiom: Product Document

Updated October 2026 to match every decision in `tasks/decisions.md`. The voice
is in `tasks/voice.md`. The approved screens are in
`tasks/design/mock-onboarding-v2.html` (plus `mock-loading-v1.html` and
`mock-states-v1.html`). If this document and the code disagree, stop and flag
it.

## What Axiom Is
Axiom is an operating system for founders.

A founder brings a real situation. Axiom reads what is actually going on,
teaches the few things they need to know to move forward (from authors and
from founders one stage ahead of them), gives them one move to make today,
and finds out with them what happened.

Every report makes Axiom sharper for that founder, and, with consent, for
the founders behind them.

Axiom is a phone app first (native, with push notifications). It also works
on a computer.

## The Problem
Founders do not lack information. The internet is full of it, and AI makes
it endless. What founders lack is the right thing to know at the moment of
a decision, and the truth about what actually worked for someone like them.

- Advice online is generic and mostly written for American markets.
- LinkedIn shows wins and hides the real numbers and failures.
- General AI assistants give the average answer of the internet and agree
  too easily.
- Most early founders have no experienced cofounder, advisor or board.
  They make judgment calls alone.

## Who Axiom Is For
Founders anywhere in the world, at any stage from idea to scaling.
Axiom is a global product. It is not built for one country.

Founders are matched to lessons and to other founders by:
- Stage
- Where their customers are (which is often not where the founder lives)
- Business model

Language: English for v1.

## Core Philosophy
- **Axiom speaks first.** The founder never faces a blank screen. After
  sign-up Axiom opens with what it sees. When they return, Axiom greets them
  and a chat bar is ready (see Home).
- **Axiom sees the pattern before the founder names it.** Axiom keeps a
  private theory of each founder: contradictions, blind spots, the gap
  between what they say and what they do.
- **Never generic.** Every response, lesson and transition must be specific
  to this founder. If it could be shown to another founder unchanged, it
  fails.
- **Plain.** Everyday words. If a founder has to decode a line, it failed.
- **Every conversation leads to a move.** Never just information, never just
  reflection. (Learn leads into the Move; it does not hand it over at once.)
- **The cost of inaction is made concrete.** Real numbers, real dates, real
  consequences from the founder's own situation. Never invented.
- **Pillars are lenses, not tabs.** The founder never categorizes themselves.
- **Memory is sacred.** Every piece of data exists to make the next
  interaction more accurate than the last. Situations, reports and the
  private theory are never altered or deleted without instruction.
- **Server owns logic.** Rules that matter are enforced in code, not only in
  prompts.

## The Six Pillars
| Pillar            | Domain                                            |
|-------------------|---------------------------------------------------|
| The Money Game    | Economics, capital, pricing, financial literacy   |
| The Human Mind    | Psychology, behavior, cognitive science           |
| How Companies Win | Strategy, competitive advantage                   |
| What's Coming     | Emerging tech, geopolitics, futures thinking      |
| Think Sharper     | Mental models, decision making, reasoning         |
| Move People       | Influence, persuasion, negotiation, leadership    |

Early on, when few peer lessons exist, the pillars carry the product.
Pillar input always sits alongside peer lessons, never replaced by them.

---

## The Founder's Journey

Sign-in and sign-up happen once. After that, every visit is a situation.

A situation moves through these screens: **Situation, Read, Learn, Move,
Report (evening).** They are separate screens, not one long scroll. What
makes them feel like one journey is the connection between them (see Hooks).

Founders can start a new situation at any time. A situation they leave stays
saved. Past situations are kept as history, which over time becomes their own
playbook.

### Colour
The first screens use the gold highlight. A later decision may rotate a new
colour per situation (Gold, Seafoam, Periwinkle, Rose). For now everything is
Gold.

---

## Sign-in
- Google sign-in only. The emblem (no wordmark) and one short line about the
  value of the year. The line is **not yet written** (Rafay will provide it).
- One quiet line about terms and privacy, and that answers stay private.

## Onboarding (once): name, birthday, 14 questions

### Format
- Before the questions: a name screen (what to call the founder) and a
  birthday screen (month and day only, no year). Nothing reads the birthday
  yet and no birthday greeting is written.
- One question per screen. No question counter, only a thin progress line.
  A back arrow. Smooth slide between questions.
- **No question has more than 5 options** and every question fits one screen
  (no scrolling).
- Any tap on a single-choice question moves on by itself. A Continue button
  appears only for written answers, multi-select and typed answers.
- 10 taps and typed answers, 4 written. Two of the written ones (12 and 13
  below: the belief people argue with, who else is part of this) are optional,
  with a Skip. A skipped question is stored as skipped.
- Answers are saved as they go, so an interrupted sign-up resumes where it
  stopped.
- The answer to question 11 (how they want hard things said) sets the
  Settings style once, at sign-up: Gently = Calm, Straight = Direct, Blunt =
  Hard. The founder can change it in Settings.
- Captures structured fields and the founder's own words. The personal
  questions ask about behaviour (how they decide, why they drop plans), not
  personality types, and there is **no money question** (revenue and runway
  are not asked at sign-up; they may be asked later, after trust).
- Removed from the old 13: time on it, team size, what you tried, background.
  Answers already stored are kept. A founder who finished the old 13 is not
  asked again.

### The questions (7 business, 7 personal; final wording is reviewed before build)
Business
1. Where are you with it right now? (Just an idea / I'm talking to people
   about it / I'm building it and nobody pays yet / Someone is paying me / It's
   growing)
2. How much of your week goes into it? (Full time / Part time, 15 hours or
   more / Evenings and weekends, under 15 hours / On and off)
3. Who pays you, or would? (Businesses / Consumers / Both sides of a
   marketplace / Clients, for services / No one yet)
4. Where are you, and where are your customers? (Country typed with
   suggestions; Mostly in my own country / Mostly abroad / Both)
5. What are you aiming for, and by when? (My first customer / My first 10
   customers / A revenue number / Raise money / Ship it; This month / In 3
   months / In 6 months / Pick a date)
6. Written: What are you building, and for whom?

Personal
7. Why are you doing this? "Pick the one that is most true, even if it is not
   flattering." (To get out of a job I don't want / I've lived this problem
   myself / I see a big opportunity / To prove something / Freedom, money, or
   something that matters)
8. Be honest about yourself. Better than most people at (Building the product
   / Selling / Numbers and planning / Leading people / Not quitting) and what
   I avoid most (Talking to customers / Asking for money / Pricing / Hard
   talks with the team / Launching); pick as many as are true.
9. You have a big decision and not enough information. What do you usually do?
   (Decide now and adjust later / Wait and collect more / Ask someone I trust /
   Put it off until I have to)
10. When you drop a plan halfway, it is usually because... (A better idea
    showed up / It got repetitive / Nobody was checking on me / It got
    uncomfortable / I rarely drop plans)
11. When someone tells you something hard about your work, you want it...
    (Gently / Straight / Blunt, no padding)
12. Written, optional: What do you believe about this business that most
    people around you would argue with?
13. Written, optional: Who else is part of this? Names and what they do.
14. Written (business): What are you most stuck on, or putting off? And what
    have you tried on it?

The 7th business question (what they are stuck on) is asked last, so the
screen order is 1 to 14 as numbered; question 14 is business.

### After the last question
A wait screen shows a drawing logo and lines made for founders, the first one
quoting their own words. No dots, no "this takes a few seconds". Then the
first reading.

---

## First Reading (right after sign-up)
Axiom tells the founder what it thinks is really going on, based on how they
answered, not only what they said.

**Axiom learns the founder over time.** The sign-up answers start it. After
that:
- The Read and the Move see a short track record of the founder's recent
  moves (done, couldn't, didn't).
- Situation questions, the Read, the talk after it, Learn and the Move also
  see what Axiom has learned: beliefs, how the founder decides, people they
  mention, their shorthand and their ongoing threads.
- The conversation always wins. Nothing old is ever a source of numbers,
  dates or names; those come from what the founder writes in this situation.
- Axiom never announces that it remembers.
- Only how the founder works and decides is remembered. Never mood, health,
  money trouble, relationships, family, age, religion, politics, identity or
  labels. Nothing is learned from care moments.

Settings such as report time and time zone are not affected.

- **Short:** about 5 sentences, appearing one at a time.
- **Always three things:** one pattern they did not say outright, their own
  words or a number or date, and a pointer into the next step.
- **Names its basis** ("You wrote…", "you said…"). No evidence line under it.
- **No rating, ever.** No "That's right / Not quite", no feedback endpoint.
  If a founder had to mark it wrong, that could end the app on the spot.
- At most two short phrases are underlined (thin line in the highlight
  colour). Never coloured letters.
- Confident and direct; never "I understand" or other banned phrases.

---

## Screen 1: Situation
Axiom speaks first with one plain question: do you want to start with what
you said you are stuck on, or is something else on your mind? The founder's
earlier answer sits above an **empty** chat box as one tap to send. The box is
never pre-filled or locked.

### Follow up rule (enforced by the server)
- At most **2** follow-up questions per situation, one at a time, each about
  what the founder just wrote, asking only for the missing piece (a number, a
  person or role, a date, or something already tried).
- Axiom stops once it has a named situation plus one concrete detail. If the
  first message has both, it asks nothing.
- One-word or filler replies ("ok") do not count as an answer and do not use
  up a follow-up.
- Axiom never asks for anything already said in this situation.
- When it has enough, it moves straight to the Read. No closing line, no
  restating what they just said.

---

## Screen 2: Read
Axiom says plainly what is really happening in this situation.

- **A plain headline** that states the finding in everyday words, then 3 to 4
  short sentences. Appears one sentence at a time.
- Contains the thing they have not said, proof from their own words or
  numbers, and (only if real) the cost of waiting in their own date or number.
  The headline may only be built from things the founder said.
- No underlines on the Read. No pictures.
- **Ends with one real question** the founder can answer in a reply box. The
  answer feeds the lesson. A quiet "Skip this question" exists. There is no
  Continue button.
- **After the answer, Axiom may talk a little more** on the Read screen: at
  most 2 more questions, each asking only for a piece the lesson still needs:
  what they want to happen, what is in the way, and one concrete detail (a
  number, person or date). The server moves on to Learn only when all three
  are known, or after the 2nd question. The
  cap is enforced in code. Skipping during the talk moves on and keeps the
  answer. At the daily cost limit the answer is saved and Learn is next.
- A one-word reply gets "Say a bit more." and does not move them on.
- "Something else on my mind" opens a fresh situation.
- No rating buttons. A plain reply box is a normal chat line, not a rating.

### New topics and many situations
- Changing topic opens a new situation. The old one stays saved as left open.
- Each situation has its own cap of 2 follow-ups. Maximum 2 active moves per
  founder; a new situation can start but a move is offered only if there is
  room.
- A situation quiet for 14 days is paused silently. Nothing is deleted. No
  warning, no strike.
- A daily limit on new situations (suggested 5) is enforced by the server for
  cost; Axiom says so plainly and offers the open ones.
- A daily cost limit ($1 per founder). At the limit Axiom says "You've hit
  today's limit. Come back tomorrow to keep going." It never blocks the care
  response, the evening Report, or anything already written.
- Chat that is not a founder situation gets a short friendly line pointing
  back to what Axiom is for.

---

## Screen 3: Learn
A conversation first. Axiom gives a lesson, the founder replies, Axiom
refines.

### The lesson
- Written like a person talking: short (about 100 to 150 words, hard cap 200,
  enforced by the server). Starts from the founder's situation, uses what they
  answered on the Read (without repeating it back), weaves in one or two
  books, ties it back, never a stack of boxes.
- **Author and book are always named in lessons.** Quotes appear only when
  verified word for word against the source library. No chapter or page line
  in the app.
- **No verified source: Axiom says nothing about it.** A shorter lesson built
  only from the founder's own facts, with no author line, no apology, no hint
  anything is missing. It never falls back to the model's memory and never
  invents a source.
- **Pictures** (at most one per reply, only when clearer) come from a fixed
  library of five types: split bar, before and after bars, side by side
  table, timeline, 2x2 box. The AI picks the type; the server fills and
  checks the numbers. Every number is one the founder gave, one our code
  calculated, or one from a verified passage. Otherwise no picture. Pictures
  can be interactive (for example a tappable checklist with a meter).
- **Tappable follow-ups** stay ("What if they say no?", "Show me the opposite
  view", "Give me the exact words to use").
- It closes with **one plain question**, not a quiz and not "in your own
  words".

### Founder voices
Real outcomes from founders one stage ahead, in their own voice. Only real,
consented, human-reviewed outcomes. Written samples appear only in prototypes,
clearly labelled **Sample**.

### Market awareness and personal life
Same as before: Axiom says what carries over across markets, and personal
situations (sleep, burnout, family, focus) are in scope using the relevant
pillars. A personal struggle is never framed as a performance problem.

### When the move appears
- Not right away. It appears after **two real replies** from the founder, once
  Axiom has refined it with them, **or at once if they ask** what to do next
  in any wording.
- One-word and filler replies never count. A tap on a suggestion chip counts as
  a reply (Rafay, Nov 2), so the founder never has to ask for the move.
- It arrives as a **card inside the chat**, no buttons (the whole card is
  tappable). At most two cards in total. The first says the move is ready.
  The second is more urgent and uses only real facts (for example "It takes
  10 minutes, Rafay. The two clinics have heard nothing from you for three
  weeks."). No invented deadlines.
- After that, the move waits on the home screen.

---

## Screen 4: Move
Opens as a sheet over the chat. The founder is committing, so it looks calmer
and more focused.

### Contents
- The mission, in the founder's own situation, in plain words.
- What success looks like (yes or no).
- The exact words to use.
- A short checklist the founder ticks.
- Axiom's prediction of what will happen, which the report will check.
- A commit button.

### Rules
- The founder is the only variable. Startable within 10 minutes.
- Reported the same evening, or within 48 hours at most.
- The result teaches the founder something about themselves.
- Maximum 2 active moves per founder.
- A founder can change a move **once**, by giving a real reason. "I'm busy"
  is not a reason. No pressure loop and no hard refusal.

### After Commit
Axiom asks one simple question: "Want a reminder tonight?" (Yes / No thanks).
Yes asks the phone for notification permission. Then the founder goes to the
home screen, where the move waits. If notifications are refused, see
"In-between states".

---

## Screen 5: Report (evening)
A push notification at the founder's chosen time (default 8 pm) opens it. It
also opens if they open the app that evening.

### Format
- Axiom names the move and its own prediction, centred in the middle of the
  screen: "Your move was to … I said …. What happened?"
- Three small round marks with labels: **Done** (tick), **Couldn't** (pause),
  **Didn't** (dash). Pressing one shows it pressed; **nothing is sent as a
  message.** The question rises to the top and Axiom asks one plain question
  based on the tap, answered in a box.

### What each means
- **Done:** Axiom responds to what happened, checks its prediction, gives one
  short line of credit with a dry touch of humour (only when true), and names
  the next move or situation.
- **Couldn't:** circumstances changed. Axiom offers a smaller version of the
  same move. No penalty, no humour.
- **Didn't:** the founder chose not to. Axiom asks plainly what got in the
  way, notes the pattern quietly, never judges. No penalty, no humour.
- **No report:** one reminder push. After that the situation closes quietly
  and stays in history. No strikes, no warnings, no removal.

### Give to get, with value first
After Axiom's reply it can offer a founder lesson: an approved story from a
founder who was in the same spot ("A founder who was in your spot shared what
went wrong and what worked. Want to see it?"). It shows in the report and in
Learn, at most one per situation in Learn.
- The first 2 founder lessons are free. After each, Axiom asks for the return:
  "They shared theirs so it could help you. Would you share yours the same way,
  with no name?" (Share / Keep private, nothing pre-selected, skipping means
  private).
- After the 2nd, a founder who has not shared gets no more founder lessons.
  Axiom says so once, plainly, and says that turning on "Share with other
  founders" in Settings brings them back.
- Turning that switch on opens founder lessons at once. A founder who has
  shared an outcome keeps them. Access is worked out from what is stored at the
  moment of use (lessons shown, the setting, any share); there is no separate
  flag.
- A lesson counts only when a real approved story is shown. When no story
  matches, Axiom says nothing about stories or about this rule and asks about
  sharing on its own.

### Consent
- Consent to share is asked after **every** report. Default is not shared.
- Settings has a switch "Share with other founders" meaning **share
  automatically** (standing consent), off by default. Off means Axiom still
  asks every time.
- Shared outcome rows never store a user id. A private, server-only link
  connects an outcome to its author (see ARCHITECTURE.md, Privacy boundary).
  Turning sharing off stops future sharing, and withdrawing lets the founder
  have past outcomes taken down. The same link is what makes introductions
  possible later. The Privacy page says this plainly.

---

## Home (returning founder)
The home screen is a welcome and a chat bar, like Claude or ChatGPT. It does
not push the founder back into what they left off.

- **Greeting** from Axiom, short, by time of day, name inside the sentence,
  very subtle dry humour. Examples (draft): "6 am, Rafay. Most people aren't
  up. Their loss. What's the plan?" / "Midday, Rafay. Coffee doesn't count as
  progress. What have you moved?" / "Still up, Rafay? Make it count, or go to
  sleep."
- **What is left to do** shows as at most two small items above the chat bar,
  in plain words ("Today: ask the clinics for a call", "Tonight: tell me how it
  went"). They fade after about 8 seconds, stay while touched, and clear when
  the founder starts typing. If notifications are refused, the evening item
  does not fade until they report.
- States: morning with an open move shows only the move; when the move is done
  it becomes "Tell me how it went"; evening shows both; after the check-in
  only a next step if Axiom named one; nothing open shows nothing. Never a
  "nothing to do" item. No streaks, no scores, no numbers about the founder's
  behaviour.
- Typing something new starts a new situation.
- A gentle gold wash sits behind the black. See DESIGN.md.

### Menu (side drawer)
Slides in from the left, pushing the home aside. Divided by thin lines:
Start something new, What's open, History, Paused, What Axiom thinks (title
PENDING, see below), and the founder's name with Settings.

### What Axiom thinks
Opened only from the menu. Never pushed and shown nowhere else. It is the
founder's own view of what Axiom has learned about them: a count, then lines
grouped as How you decide, How you work, Your business, People and words,
Still open. Tapping a line opens its receipt: where it came from (the
founder's own words or move, with a date), or a note that there is no source.
Each receipt has Wrong and Outdated. Either removes the line, and Axiom stops
using it; the extractor and the sign-up seed never recreate a removed line.
Nothing shows a score, a confidence or an id. No undo. If nothing is learned
yet, one line says so. Server: GET /api/memory and POST
/api/memory/:table/:id/wrong (see ARCHITECTURE.md).

PENDING (Rafay has not decided): (1) whether a founder-opened "mark wrong"
control is allowed given the no-rating rule; (2) the copy of this screen has
not been approved; (3) the title: Settings already has "What Axiom knows about
you".

### History
A plain list of past situations, newest first, no day headings, separated by
thin lines, with a search box. Each row has a title and one status word: Open,
Done, Couldn't, Didn't, Paused. Opening one shows a read-only page: What I
read, What you learned (author and book), Your move, How it went, shared or
kept private, then one action (Talk about this again / Pick it up / Bring it
back). No delete here.

### Settings
Groups divided by thin lines: You (name, email, country, what Axiom knows
about you), Reminders (check-in time, morning reminder, evening check-in, what
shows on the lock screen: Full / Short / Nothing), How Axiom talks (Calm /
Direct / Hard, default Direct), On screen (keep my open items on screen),
Privacy (share with other founders, Privacy, Terms), Account (sign out,
delete everything Axiom knows about me). At most 2 reminders a day and quiet
hours are product rules, not shown as text. Deleting everything needs its own
plan before it is built.

---

## Pushes
- **At most 2 scheduled pushes a day.** Normally the morning move and the evening check-in. (Proactive signals have their own cap of 4 a day, planned: see "Proactive Axiom".) If
  nothing is due, no push. The "quiet for 3 days" check replaces the morning
  one. Quiet hours.
- The name appears inside most pushes. Each one names something real.
- Lock screen shows Short by default (founder choice).
- Pushes stop completely while the care screen is up.
- Permission is asked once, after the founder commits to a move, with one
  plain question.

---

## Hooks: How the Screens Connect
Screens are separate. The journey is not. Every screen opens by carrying over
a thread from the previous one and closes by leaving one open.

### A hook must contain at least one of these, from this founder:
1. **Their own words**, quoted back.
2. **A real number** from their situation, usually the cost of inaction.
3. **A time or date** from their life.
4. **A contradiction** between what they said and what they did.
5. **A prediction** Axiom will be held to in the report.

### Banned
- Rhetorical teaser questions ("Want to see why?").
- Withholding information to create curiosity.
- Any hook that would make sense to a different founder unchanged.
- Restating what the founder just said as filler.

If there is nothing real to hook on, the screen ends cleanly. The Read ends
on one real question. Every Axiom message either asks one clear question or
says what to do next.

---

## Peer Map
Outcomes shared with consent become lessons for founders behind.

### How an outcome becomes a founder voice
1. Founder reports and consents to share.
2. Axiom drafts an anonymized version: names, companies, identifying details
   removed. **Peer outcome rows never store a user id.**
3. Human review. Rafay reviews every shared outcome personally until the
   product has more than 50 active founders. Nothing is shown to anyone
   before approval.
4. Published to the peer map, tagged with stage, customer market and business
   model.

### Matching
- "One stage ahead" means exactly one stage above the founder, or the same
  stage with an outcome already reported.
- Match order: stage, then customer market, then business model.
- When no close match exists, Axiom shows the nearest founder and says so
  plainly, including what may not carry over.
- Small numbers are shown as counts and stories, never as percentages.

### Intros
Rare and double opt in. The plan is to connect complementary founders: someone
stuck on something a founder ahead has just solved, or founders who fit each
other. The server uses the private link to ask **both** people; nothing is
revealed unless both accept.

---

## Safety and Care
Personal situations are in scope, so some founders will share serious things.
Every message the founder types is screened before any lesson or move.

- **Three outcomes.** Clear distress or explicit words like suicide: the
  **care screen**. Unclear or slang ("I wanna dieee"): Axiom replies from the
  context of the conversation, or asks softly and plainly what is going on,
  with no lesson or move that turn. If the answer is worrying, or signals
  repeat, it escalates to the care screen. Nothing worrying: carry on. Tuned
  to catch rather than miss.
- **The care screen** is calm: no glow, no animation, no buttons that push
  anywhere. One human message, real help for their country (emergency number,
  a helpline, a worldwide directory fallback), an honest line that Axiom is an
  assistant, not a counsellor, and a quiet way to keep talking. No lessons, no
  moves. Axiom never frames a struggle as a performance problem.
- While it is up, all pushes are paused and nothing mentions moves or
  reports. On return Axiom first asks gently how they are.
- What they wrote is never used in founder stories or sharing.
- **Before launch:** a person verifies every help number (country from sign-up
  question 5, reviewed yearly), a test set of messages including false alarms
  ("kill the feature", "burn rate"), and the wording is reviewed, ideally by
  someone with a mental-health background.

---

## In-between states
- **Thinking:** never a spinner. A small logo draws itself where the answer
  will appear, with one real verified quote (book name only) under a soft
  moving light and two faint answer lines. The real answer fills the lines in.
  If no verified quote fits, only the logo and lines show.
- **Something went wrong:** their message is kept. One plain line ("I couldn't
  answer that just now. Your message is saved.") and a quiet "Try again". No
  "sorry", no error codes.
- **No connection:** no separate notice. The chat box says it ("No connection.
  Your messages are saved."); unsent messages say "Waiting to send" and send by
  themselves. The evening check-in is saved and sent when back online.
- **No verified source:** see Learn. Axiom says nothing.
- **Reminders refused:** said once after they commit. Settings shows one quiet
  row with the fix, and the evening item stays on the home screen until they
  report.

---

## Axiom's Voice
Short version here; the full guide is `tasks/voice.md`.
- Plain, specific, direct and urgent but never harsh, always the next step,
  quiet.
- Hard on the situation, never on the person. No shaming, no strikes.
- **Subtle dry humour only in greetings and when a move goes well.** Never
  when something went wrong, never in care.
- **No swearing, ever.**
- The name is used in most pushes and greetings, not every message.
- Forbidden phrases: "great question", "certainly", "I understand", "that's
  interesting", "absolutely", "of course", "I'd be happy to", "great".
- Never assume anyone's gender. Use they, or rewrite.
- Mentor energy in the spirit of a discipline coach, using the energy and not
  anyone's words or story. A **Calm / Direct / Hard** setting changes the
  strength.
- Response length matches the situation.

---

## Pricing
- Free. No paywall, no trial, no gated features, no payment code until
  explicitly instructed.
- Paid plans start only when this is true: **50 founders each report at least
  one move a week, four weeks in a row.**
- Founding member offer (later): free now, a locked discount when paid plans
  start. Capped at the first 100 founders. A discount, never free for life.
- When pricing starts, it will be regional.
- Collect a willingness to pay signal without charging: after a founder's third
  report, ask what would feel fair.

---

## What We Measure
- Report rate: share of moves that get a report.
- Return rate: founders who bring a second situation within a week without
  being prompted.
- Completion per screen: where founders drop off.
- Contribution rate: shared outcomes per active founder.
- Cost per active founder per week.
- How we know a first reading is good without rating buttons: do they carry
  on, how they write next, a weekly sample read by Rafay, and an automatic
  check that every quote is really the founder's words.

---

## Removed From the Product
These belonged to the original Axiom and are no longer part of it. Do not
build or extend them.
- The 3D Founder Brain sphere as home screen, nodes, edges, maturity stages.
- The warning system, account removal, refunds and reapplication.
- Payments, premium tiers, session and message caps.
- Axiom Circle as a paid add-on. It is replaced by the peer map.
- The 21 question personality onboarding pool and the earlier 7 + 3
  onboarding.
- Live web search.
- The daily knowledge briefing as the front door.
- "That's right / Not quite" on the first reading or the Read, and the
  read-feedback endpoint.
- The Welcome screen and the old chat product.

## Proactive Axiom (decided Nov 10 2026, NOT BUILT; plan: `tasks/connectors-plan.md`)
Axiom reads the founder's Gmail, Google Calendar and Notion (read only, through
Composio) and tells them what they should know, without being asked.
- **Three lanes.** People (co-founder, investor, customer), Time (a meeting with
  no prep, a promise with a date), World (news in newsletters the founder chose
  to watch, when it changes their business). A signal does not have to connect
  to the open situation.
- **Pushed because the founder should know.** An action is optional. If a real
  move exists (founder is the only variable, startable in 10 minutes, binary),
  it is offered through the normal Move flow. Otherwise there is no move.
- **Says what the source says**, names the source, and marks the effect on the
  founder's business as Axiom's own read. Every name, number and date is checked
  against the source text by code. No teaser: the push carries the whole point.
- **Facts about people come only from the founder's own emails and notes.** If
  Axiom cannot tell who someone is, it says so. Author lessons come only from the
  verified library.
- **Learns the founder from the connectors** (business, people, rhythm) and stores
  it without asking first. Each fact shows its source on the memory screen and can
  be marked wrong or outdated. Never health, politics, religion, family or money
  in personal accounts. Disconnecting keeps what Axiom learned, with a separate
  "delete what Axiom learned" button; deleting the account removes everything.
- **Newsletters:** after Gmail connects, Axiom ranks the founder's newsletters
  and asks which matter. Only those are watched.
- **Pushes:** signals get their own 4 a day on top of the morning and evening
  ones. An extreme event may skip the cap, at most 2 a day, still respecting
  quiet hours unless the event is dated within 3 hours. Lock screen defaults to
  Short. Pushes stop during care and delete requests, as before.
- Raw email text is never stored. Read only: Axiom never sends or edits anything.
- Delivery is not real-time: Gmail and Calendar are checked every few minutes.

## Later and parked (not now)
- Connected accounts beyond Gmail, Calendar and Notion (Stripe, Shopify, CRM,
  company numbers). The first three are now planned: see "Proactive Axiom".
- Rotating the highlight colour per situation.
- The sign-in line.
- Voice input for answers.
- A weekly "your playbook" view of past situations and patterns.
- Chapter level attribution once chunk metadata supports it.
- Historical personas built from books and interviews.
- Small screens still to design: edit sign-up answers, Privacy, Terms, full
  delete confirmation, the move swap and a second active move.

## Flags for Rafay (this document departs from earlier text or a hard rule)
1. **Home fades the "left off" items** and does not land on the last open
   loop. CLAUDE.md says returning founders land on their last open loop,
   never a blank prompt. Kept in spirit by the greeting, the fading items and
   the menu list. Needs CLAUDE.md updated if confirmed.
2. **Loading quote shows the book name only.** CLAUDE.md says author lessons
   always name author and book. Lessons still do; only the loading hint does
   not.
3. **Share automatically** is standing consent. CLAUDE.md says consent is
   asked at every report and default is not shared. The default is off.
4. **A private server-only link** connects each shared outcome to its
   author (decided), so past shares can be taken down and introductions can
   work. The outcome rows themselves still hold no user id.
5. **The app is native (push, reminders)**; CLAUDE.md says web first, native
   later. ARCHITECTURE.md follows the app direction and must be confirmed.
