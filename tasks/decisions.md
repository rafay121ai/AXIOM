# Decision log (plain English)

Every decision for the new Axiom app: what was decided, who decided it, why, and what changes because of it. Newest at the bottom.

## Decision 1: sign-up questions (DECIDED)

**What this decides.** The questions every new founder answers once, right after signing in. Goal: learn facts a founder would never think to say in a chat.

### Decided so far
- **Q7 (money: revenue band and months of runway) is removed.** Decided by Rafay.
  - Why: personal and sensitive to ask at sign-up.
  - What changes: the first reading of a founder will not have a money number to anchor on. Money can still come up in "what have you tried" or in the situation itself, and we can ask for it later, after trust is built.
- **Add 2 to 3 questions that help Axiom know the founder personally.** Decided by Rafay.
  - Note: PRODUCT.md currently says onboarding "captures situation, not personality" because personality questions give little signal. Rafay chose to add personal questions anyway. Proposal: ask concrete, factual-personal questions (background, why, what they do when it gets hard) instead of "which sentence sounds like you" questions. PRODUCT.md to be updated once Rafay confirms the final list.

- **Personal questions chosen: A (what did you do before this), B (why are you doing this), E (what are you better at than most, and what do you avoid).** Decided by Rafay. C (what do you do when it gets hard) and D (life around this) were not chosen.
  - Why: they cover background, motivation, strengths and avoidance, which a founder rarely says in a chat.
- **Only 2 of the 13 questions are written; the rest are taps.** Decided by Rafay.
  - Why: taps are fast and finish rates are higher; two written answers are enough to capture the founder's own words.
  - What changes: B (why) and E (strengths and avoidance) become taps, and "what have you tried" becomes a tap checklist. The two written questions are "what are you building and for whom" and "what are you stuck on or putting off, and what have you tried on it".

### Final list (13 questions, in this order). Rafay said "continue" after seeing this list.
Taps (11): 1 stage (worded as facts), 2 how long on it, 3 time per week, 4 who pays, 5 where you and your customers are, 6 who builds with you, 7 goal and deadline, 8 what you did before this, 9 why you are doing this ("even if it's not flattering"), 10 better at than most plus what you avoid most (one screen, two taps), 11 what you have tried (tick all that apply).
Written (2): 12 what are you building and for whom, 13 what are you most stuck on or putting off, and what have you tried on it.

### Assumptions I made from "continue" (Rafay can reverse any of these)
- Order as listed: easy facts first, personal taps in the middle, the two written questions last.
- "How many customers have you talked to" is left out (Rafay did not pick it).
- Short "other" write-ins on questions 8 and 9 are allowed and not counted as written questions.
- Why: matches the choices Rafay made (remove money, add A/B/E, only 2 written), and keeps sign-up to roughly 5 minutes.

### Follow-ups owed
- Update PRODUCT.md (it says "7 tap + 3 open" and "situation, not personality") once the whole onboarding decision is final.
- Exact wording and choices get reviewed again by Rafay before the screens are built.

## Decision 2: Axiom's first reading of the founder (DECIDED)

**What this decides.** Right after the last sign-up question, before anything else, Axiom tells the founder what it thinks is really going on.

### Decided by Rafay
- **Short.** About 4 to 5 sentences. Why: quick to read, and a wrong guess costs little.
- **Just the reading.** No evidence line under it. Why: cleaner. The reading itself names where it came from ("you told me…").
- **Every first reading contains three things:** one pattern the founder did not say outright (across their answers), their own words or a number or date from their answers, and a thread into the next step.
- **No "That's right / Not quite" buttons, ever. No option to rate the reading.** Why (Rafay): if a founder taps "Not quite", that ends the app right there.
- **Confident and direct, and it names its basis.** It says "you told me…" so the founder can judge it. It never says "I understand" or any other phrase banned in the voice rules.

### What this changes in the documents (conflict flagged; Rafay's decision overrides)
- PRODUCT.md currently says the founder answers "That's right" or "Not quite" and both are saved, and lists "Read accuracy" as a measure. Both go.
- ARCHITECTURE.md lists `POST /api/reads/:id/feedback` and feedback/correction fields on reads. Both go.
- To update after the whole journey is decided.

### How we know a reading is good, without buttons (my default; Rafay can reverse)
- Do they carry on to the next step, and how do they write there.
- Rafay reads a sample of readings himself each week.
- Automatic check that every quote in a reading is really the founder's words.

## Decision 3: the "tell me what's going on" step (DECIDED)

**What this decides.** After the first reading, the founder explains their situation. Axiom can ask follow-up questions, at most 2.

### Decided by Rafay
- **First visit: the screen is pre-filled from the founder's own answer to "what are you most stuck on or putting off".** Example: *"You told me you're stuck on: '...'. Start there, or tell me something else."* They can edit or replace it. Why: it uses their words, does not make them repeat themselves, and keeps the rule that Axiom speaks first and never shows a blank box.
- **One follow-up question at a time. It must be related to what they just wrote.** No question that changes the mood or the point of the conversation. Why: an out-of-the-box question breaks the feeling that Axiom is following them.
  - How we enforce it: the question must be about the same thing the founder wrote (it has to use their own words or topic), and it may only ask for the missing piece (a number, a person or role, a date, or something already tried).
- **"Enough" rule stays as written:** Axiom stops asking once it has a named situation plus one concrete detail. If they give both in the first message, it asks nothing. If they write very little, it asks the single best question. The 2-question limit is counted by the server, not left to the AI.
- **Returning founder: sees their last situation and where they left off, plus a clear way to start a new one. Never a blank box.**

### Still open from this decision
- Crisis screening runs before anything else in this step. Its wording and rules are their own decision, later.

## Decision 4: the Learn screen (IN PROGRESS)

**What this decides.** What the founder sees after they explain their situation, and how we guarantee every author, quote and number is real.

### Decided by Rafay
- **Shape: a reply written like a person talking, not a stack of boxes.** It repeats the founder's situation back in their own words and numbers first, then brings in the author and book ("I found Warren Buffett saying…"), ties it back to them, and ends with one thing to do. Why: proves Axiom understood them before it says anything else and keeps it from being generic.
- **Pictures (artifacts): yes, from a fixed library of picture types, not drawn freely by the AI.** Why: the AI picks the type and fills it with data, and our server checks every number, so no made-up numbers can appear in a chart.
  - Rule: every number in a picture is one the founder gave, one our code calculated from theirs, or one from a verified book passage. Otherwise no picture.
  - Rafay wants the pictures **interactive and premium-looking**, not childish. This is a requirement for the design stage, decided later.
  - This reverses CLAUDE.md's "deprecated: artifact rendering system" on purpose. The old system (AI-drawn, removed in the cleanup) is not coming back; this is a new, smaller one.

### Still open
- Starting picture types, how often (at most one per reply), and build order (reply first, pictures right after).
- Tappable follow-ups under the reply: keep or drop.
- Number of sources in one reply (recommendation: one or two).
- Three defaults: no fallback to the AI's memory, no made-up founder stories, ends with one action.
- How a verified quote shows its source.

### Decision 4, more decided by Rafay
- **Books are woven into the paragraph.** One or two per reply, never a list.
- **It should feel like a conversation, not a 600-word story.** Short. Target length to be confirmed (proposal: about 100 to 150 words, hard cap 200, enforced by the server).
- **The source is shown as the author's name and the book's name only.** No chapter or page line in the app. Why: simpler, and it matches the product doc ("book level attribution is acceptable until chapter metadata exists"). Quotes are still only shown when we have verified them.

### Decision 4, more decided by Rafay (answers to the open list)
- **Five starting picture types:** split bar, before-and-after bars, side-by-side table, timeline, 2×2 box. (Forecast lines left out on purpose: they always involve guesses.)
- **At most one picture per reply, and only when it makes things clearer.**
- **Build order: the reply first, with its quote and number checks working, then the pictures right after.**
- **Tappable follow-ups under the reply are kept** ("What if they say no?", "Show me the opposite view", "Give me the exact words to use").
- **No fallback to the AI's memory.** If there is no verified source, Axiom does not announce that. It "just says nothing" about sources (exact behaviour to be confirmed with Rafay: see below).
- **Founder stories: only the ones Rafay tells us to add.** No made-up or sample stories.
- **The reply still ends with one action** (a hard rule in CLAUDE.md: "every Learn screen ends in a Move"). Not discussed; stays unless Rafay says otherwise.

### Still open in decision 4
- What exactly the reply looks like when there is no verified source.
- The length (proposal: about 100 to 150 words, hard cap 200).

### Decision 4 is CLOSED. Final answers from Rafay
- **No verified source: a short reply with no book in it.** It restates the situation in the founder's words, gives a plain practical thought and one action. It never names an author or book and never announces that it couldn't find one. The book part is simply absent.
- **Length: about 100 to 150 words, hard cap 200,** enforced by the server so the AI cannot ramble.

## Decision 5: how the app looks (IN PROGRESS)

### Decided by Rafay (answers to four questions)
- **Mood: dark and quiet.** Near-black background, off-white text, one restrained accent. Why: matches the existing black and glass logos and the "built different" tone.
- **Feel: calm and editorial.** Generous space, a serif for Axiom's words, clean charts.
- **Phone first, works on computer.** Why: founders use it at midnight and for the evening check-in.
- **Reference feel: Apple / Superhuman.** Minimal, spacious, very polished.

### Found, not yet decided
- BRAND.md says "Axiom will remove you if you don't follow through". The new product rule is no removal, ever. The line has to be dropped.
- BRAND.md voice (challenging, never encouraging) vs PRODUCT.md voice (never confrontational, never cold): to settle in its own decision.
- Existing brand kit (logos, favicons, social images, guide PDF) is kept: name and logo do not change.

### Next
- Rafay reviews 3 mock directions of the same Learn screen and picks one (or mixes).

### Decision 5, more decided by Rafay
- **Look: Ink and brass** (direction 1 of the three mocks). Hairline bars, thin lines, brass used once for the number that matters, ivory text on near-black.
- **The Learn screen must not give the action ("experiment") while the conversation has only just started.** Axiom should not say everything it has at once. Instead it leads into it, something like "I have something that may help when you're ready, say the word and I'll show it", and the founder opens it when they choose.
- **The founder can change the action when they open it** (room to change it).

### Conflicts this creates (flagged, to settle with Rafay)
- CLAUDE.md says "Every Learn screen ends in a Move. Never information only." and PRODUCT.md has Move as its own separate screen. Resolution proposed: Learn ends with a way INTO the Move, not the action itself. This supersedes the earlier decision "the reply ends with one action".
- PRODUCT.md bans "rhetorical teaser questions" and "withholding information to create curiosity". A vague "I have something for you, ready?" would be exactly that. Proposal: the pointer must be specific and honest, naming what it is and the founder's own thread ("Your move for Friday's renewal call is ready. Open it when you want it."), not curiosity bait.
- PRODUCT.md allows one swap of a move, with a real reason ("I'm busy" is not a reason). This matches Rafay's "room to change".

### Decision 5, Learn screen clarified by Rafay
- **The Learn screen is a chat.** The founder is chatting with Axiom.
- **The Move screen pops up only after Axiom has actually given the lesson AND the founder has shown some "submission" towards it.** Not before. This replaces the earlier idea of a "Show me the move" button at the bottom of Learn.
- **All other screens are good to go** (per the screen list: sign in, sign-up questions, first reading, situation, read, home for returning founders). Report, settings, history come later. The care screen is still undecided.
- Rafay asked me to act as creative developer and recommend changes. My recommendations are in the next message; none are decided yet.

### Decision 5, the Learn loop and the Move notice (decided by Rafay)
- **The loop:** Axiom gives the lesson, and right then asks the founder one question, so they can answer in terms of whether they understood it. Their reply to that question is the "submission". No separate exercise.
- **After their reply, the Move is offered as a notification-style pop-up, not a full page.** Something like "I have something for you. Want to look at it now?" The founder can ignore it or tap it to open the Move.
- **No buttons on the pop-up.** No "Not yet", no "Move in". Just the notification: ignore it, or tap it.
- **If they ignore it and the chat continues, it shows again. It shows twice in total, never more.**
- **Chat cap: Rafay is not sure he wants one.** My default (to confirm): no visible limit for the founder, a generous invisible safety limit in the background (and the daily limit per founder from the architecture doc).
- **Nothing else to add to Learn.**

### Decision 5, colours and look (decided by Rafay; replaces "ink and brass")
- **Colours: ivory and black only.** Rafay does not like the brass or other accent colours. Why: strong contrast.
- **Premium, with the Apple glass effect** (translucent, blurred glass surfaces).
- Emphasis in pictures and buttons comes from brightness (solid ivory against dimmed ivory), not from a colour.

### Conflicts and open points flagged
- A move that is offered twice and never opened must stay reachable somewhere, otherwise it dead-ends. Proposal: it waits on the returning-founder home screen ("your move is ready").
- PRODUCT.md bans vague teasers. The pop-up must name the real thing ("Your move for Friday's renewal call is ready"), not just "I have something for you".
- CLAUDE.md "flag first" covers new colours and UI patterns outside DESIGN.md: this decision is that approval. DESIGN.md and BRAND.md get rewritten later.
- The Move screen itself keeps "commit" and "change this move once, with a real reason" (PRODUCT.md). Not changed by this decision.

### Decision 5, round 3 (decided by Rafay after seeing the glass mock)
- **Colour: the ivory was too bright. Use a dull ivory, a beige.** Black stays. Highlights, buttons, bars and the logo in-app all use the dull beige, nothing near pure white. (BRAND.md's ivory #EEECE6 is the logo file colour; the in-app text colour becomes a duller beige.)
- **Look otherwise approved:** glass, layout, notification, Move screen.
- **Notification wording: keep it tied to the founder's own position, and make it very specific.** It must come from what they actually said; never an invented detail (the mock wrongly said "Friday", which the founder never said).
- **One-word and filler replies do NOT count as a submission.** If the reply is filler ("ok", "makes sense"), Axiom asks a follow-up instead of showing the Move notice.
- **The closing question changes.** No "in your own words" and no quiz. Axiom just continues the conversation that was going on and asks the founder what they are trying to do. Their reply tells Axiom whether they want to continue:
  - Filler reply: Axiom asks a follow-up.
  - A full, thoughtful reply that states their position: Axiom works around it, then the Move notice appears (it still shows at most twice).
- **Voice principle from Rafay: advice must never read as the founder submitting or pleading.** His reaction to the example ("asking them for help" = the founder is the one submitting) is that this reads as weak. Axiom's advice should read as the founder staying in control. To be written into the voice decision (BRAND.md currently says "challenging", PRODUCT.md says "never confrontational").

### Decision 5, round 4 (decided by Rafay)
- **An ignored move lives on the home screen.** Confirmed.
- **Home screen requirement (for when we design it):** when a founder comes back, it must not feel like starting something new, must not look blank, and must not ask them to make a decision. It should be very easy to take the next step.
- **The hidden safety limit on the chat is generous.** Confirmed.
- **Colour: "the page is not right".** Rafay wants 4 to 5 colour options on a black base to choose from, and the ability to change them live in the mock. Built as a palette switcher plus a custom colour picker.
- **Process: screen by screen, starting from the beginning.** Fix the Learn screen colour first, then sign-up and onboarding, then the rest in journey order. All screens get designed (12 in the list, including the returning-founder home).
- **Before starting the screens, Rafay asked whether there is any other decision to settle.** List given in the next message.

### Decision 5, round 5 (decided by Rafay)
- **Base: black. Writing colour: Stone** (a cool silver-grey, #C4C8CE).
- **A second, highlight colour for the pictures (artifacts) and for important things.** It should amplify the meaning of whatever it marks and look good: a gradient, possibly drawn from the logo's colours (the logo's glass gradient is light brass, brass #B98143 and burgundy #642B35).
- **The "other screen" Rafay mentioned is the returning-founder home screen** (screen 9 in the list). So there are 12 screens in total, not 13.
- **Do not move on to any other screen until the Learn screen is finished and approved.** Rafay's instruction, in capitals in spirit: stay on this one.

### Decision 5, round 6 (decided by Rafay): it has to be minimal, low-key and premium
- **Rafay's verdict on the last mock: it looked cheap.**
- **My diagnosis (my mistake):** gradients and glows in too many places, glass on every element, a coloured gradient icon, thick glossy bars, bold gradient text, a moving glow. Too many effects fighting for attention.
- **Design principles for the rebuild:**
  - Almost flat black. No moving glow, no heavy shadows.
  - Hairlines and space instead of cards and boxes.
  - Glass only on the two surfaces that float over content: the notification and the input bar.
  - One highlight per screen, used on the single most important thing (Learn: the cost number and its bar; Move: the Commit button). Flat colour by default; a very soft gradient only as an option.
  - Founder messages are plain text, not bubbles. Axiom's words in a serif. Lighter weights, smaller type, wide-tracked small caps for labels.
  - Rafay can dial three things himself in the mock: highlight colour and finish, writing brightness, and how much glass.

### Decision 5, round 7 (Rafay: "I don't like the colours, fix them up on your own")
- **Base stays black. Writing stays Stone.** Rafay.
- **Highlight: 3 to 4 colours that interchange, used for artifacts (pictures) and other important things.** Rafay delegated the choice of the colours to me.
- **My choice: four quiet colours, matched in lightness and softness so none shouts:** Gold (#CDB27E), Seafoam (#7FBFAA), Periwinkle (#8EA0DD), Rose (#D49A9F). Why: the earlier options differed wildly in brightness, which is what made them look cheap; these four sit at the same level, so any of them feels equally calm on black next to Stone.
- **Interchange rule (my proposal): each new situation takes the next colour, and keeps it for that whole situation.** The picture, the key number, the ticks and the Commit button in that situation all use the same colour, so the Move visibly belongs to the lesson that led to it. The next situation gets the next colour.
- Rafay can still change any of the four colours with a picker in the mock.

## Decision 5: how the app looks (CLOSED)
**Final, as decided by Rafay:**
- **Base black. All writing in Stone.** Dull, not bright (default writing brightness 82% of Stone).
- **Four quiet highlight colours that rotate, one per situation: Gold #CDB27E, Seafoam #7FBFAA, Periwinkle #8EA0DD, Rose #D49A9F.** Used only for the key number and picture, ticks and the Commit button of that situation. (Colours chosen by me on Rafay's instruction "fix them on your own".)
- **Finish: soft gradient** (Rafay: "keep the soft gradient"). Mock: tasks/design/mock-minimal-v5.html (set to soft in later mocks).
- **Minimal, low-key, premium.** Hairlines and space instead of cards; glass only on floating things (notification, input bar); one highlight per screen; founder's messages as plain text; Axiom's words in a serif.
- **Learn is a chat.** Axiom gives the lesson, asks what the founder is trying to do, and only after a real (non-filler) reply does a button-less notification offer the Move. It shows at most twice. An unopened Move waits on the home screen. Hidden generous safety limit on the chat.
- **Phone first, works on a computer.**

## The eight open decisions: defaults taken because Rafay said "move on" (all reversible)
1. Care screen: to be designed as a calm, plain screen with a human message and real help; wording to be approved by Rafay when we reach it.
2. Terms and privacy at sign-up: one quiet line on the sign-in screen, plus a plain note that answers are private.
3. Voice input: later, not in the first version. Text first.
4. Desktop: a centered phone-width column first, identical on every device.
5. Fonts on non-Apple devices: load one good free serif so it looks the same everywhere.
6. Report (evening check) is not in the first version.
7. Evening reminder time: set in settings with a sensible default (8 pm), not asked at sign-up.
8. Axiom's voice: to settle in one sitting before real copy is written. Rule already set: advice never reads as the founder submitting or pleading.

## Now working on: screens 1 and 2, sign-in and the 13 sign-up questions (IN PROGRESS)

### Screens 1 and 2 mock built: tasks/design/mock-onboarding-v1.html (awaiting your reaction)
- Sign-in: wordmark, brand tagline (placeholder, to confirm), "Continue with Google", one privacy line.
- 13 questions, one per screen, progress hairline, back button, Gold soft gradient. Single choices auto-advance; two are written (Q12, Q13).
- Waiting screen quotes the founder's own words from Q12. Next screen to design: the first reading.
- Flag: 13 questions differs from PRODUCT.md (7 taps + 3 open). Docs to be updated once you approve.

### Screens 1 and 2, round 2 (mock-onboarding-v2.html), your changes applied
- Writing brighter: Stone mixed with white (was plain Stone).
- Q1 cut from 7 options to 5 (idea / talking to people / building, nobody pays / someone is paying / growing).
- No question count shown, only the thin progress line.
- Smooth slide-and-fade between questions and between screens.
- Any tap moves on by itself. Continue only appears on written questions, multi-select (Q10, Q11), "Other" boxes, and pick-a-date.
- Q10 is now multi-select in both groups. Q3 hours folded into the options. Q5 is now taps (country chips + where customers are).
- Waiting screen: no "few seconds", no dots; four founder lines, the first quotes their own words. Copy is a draft.

### Glass fix (same file, mock-onboarding-v2.html)
- Cause: glass only shows when there is light behind it to blur; the screens were pure black, so the one glass button looked flat.
- Fix: slow-drifting soft gold light behind the screens; option rows, chips and the sign-in button are now frosted glass with a bright top edge. Selected rows glow gold.
- Flag: this widens the earlier rule "glass only on floating surfaces" to option cards too. Say if you want it pulled back.

### Glass round 2
- Frosting stronger: blur 24px to 42px, brighter edges, a little more tint.
- Hover (rows, chips, sign-in button): lifts 3 to 4px, grows slightly, edge brightens, deeper shadow. Press settles it back down. On phones there is no hover, so only the press effect applies.

### Glass round 3: depth
- Rows, chips, sign-in and Continue now look raised: bright top edge, darker underside, layered cast shadow. Hover lifts further; pressing sinks them in. Continue has a gold bevel.

### Max 5 options per list, no scrolling
Rule: no question has more than 5 options, and every question fits one screen (checked in code: nothing overlaps the Continue area, scrolling is off).
Cut options (what we lose): Q2 merged "under a month" and "1 to 3 months". Q4 dropped "Something else". Q7 goals: dropped "Quit my job" and "Something else"; dates: dropped "This year". Q9 dropped "Something else", merged "freedom and money" with "build something that matters". Q10: dropped design, spotting opportunities, tracking numbers, marketing in public (5 per list). Q11: merged cold outreach, ads, investors into "Tried to sell or raise"; dropped "changed my price". Q5 country is now typed (with suggestions) plus 3 customer chips.
Flag: some cut options (quit my job, pricing change) were signals PRODUCT.md values; Q12 and Q13 written answers still catch them.

### Sign-in logo
- Emblem only (Brand Kit/01-Vector/axiom-icon-glass.svg), no wordmark. Tagline stays under it (still to confirm).
- Flag: BRAND.md says "Wordmark only. No icon. No symbol." That doc is flagged as out of date and needs updating to match this.

### Sign-in line: parked
- The tagline ("You already know you're built different. Prove it.") is a placeholder. Rafay will decide the line later. His brief: it should sell the value of a year with Axiom (growth, becoming, learning from other founders and from existing knowledge), short and punchy, in the style of "strangers at 4, friends at 5". Made brighter to match the other text.

### Screen 3 mock: the first reading (inside mock-onboarding-v2.html, jump button "First reading")
- Follows Decision 2: short (5 sentences), names its basis ("you wrote", "you said"), no rating buttons, ends by pointing at the next step.
- Appears one sentence at a time. Founder's own words in the gold gradient. Small emblem on top. Continue appears after the last sentence.
- Wait screen now hands over to the reading by itself after its four lines (about 15 seconds in the mock; real timing depends on the model).
- Mock text is hand-composed from the sample answers. Real one is model-written, with a code check that every quote is the founder's words.

### Screen 3 fix: highlight style
- No coloured letters. The founder's own words keep normal text colour and get a thin gold underline (1px, gradient). Lesson: highlights on text are underlines, never coloured type. Applies to every later screen.

### Screen 3 fix: fewer underlines
- Maximum two underlined phrases per reading, only the ones that carry the point (here: what they are stuck on, and what they avoid). Everything else is plain text. To be enforced by the server: the model may mark at most 2 phrases, and each must be an exact piece of the founder's own words.

### Screen 4 mock: the situation (inside mock-onboarding-v2.html, jump button "Situation")
- Follows Decision 3. Axiom speaks first: "You told me you're stuck on: “…”. Start there, or tell me something else." (one underline, their words).
- The glass box underneath is already filled with their own stuck answer. Send as is, edit, or replace. Never blank.
- Their words show on the right in small quiet text, Axiom's in serif on the left. No bubbles.
- One related follow-up at a time, at most 2, then "I have what I need. Reading it now." Stops early if the first message already has a named situation plus one concrete detail (a number, a person, a date).
- A one-word reply ("ok") gets "Say a bit more…" and does not use up a follow-up.
- Mock follow-ups are hand-written; the real ones are model-written and must use the founder's own topic, checked in code.
- Not yet designed: the care screen that interrupts this step if distress shows. Next screen: the Read (screen 5).

### Screen 4 fixes (Rafay's two issues)
1. The box was pre-filled and locked them into deleting it. Now the box is empty and always free to type in. Their earlier answer sits above it as a small glass suggestion ("Use what you wrote earlier"), one tap sends it, and it disappears once anything is sent. Still satisfies "never a blank box": the suggestion is there on arrival.
   - Changes Decision 3 slightly: "pre-filled" became "offered above an empty box". Same intent.
2. The closing line "I have what I need. Reading it now." was vague. Now it quotes the founder: "You said “…”. I am reading what sits behind that." Wording is a draft for Rafay to rewrite.
Lesson: no generic hand-off lines anywhere; every line Axiom says must contain something only this founder said.

### Screen 4, round 3: no repeating
- Axiom's opening is one plain question: "Do you want to start with what you said you are stuck on, or is something else on your mind?" It does not quote their answer (the suggestion above the box already shows it).
- When Axiom has enough, there is no closing line. The screen goes straight to the Read. (The mock shows a dashed note where screen 5 will open.)
- Rule: Axiom never restates what the founder just said back to them as filler. Quotes appear only when they do work, such as in the Read.

### Mock fix: chat box not visible
- Cause: in a narrower window the phone wrapped below the long side panel, so the chat box sat far down the page. Phone now comes first, scales to the window height, and stays in view while scrolling. Also hid a stray scrollbar in the box. (Mock layout only; nothing about the app design changed.)

### Mock layout fix (round 2)
- The file's HTML was valid (checked tag by tag), but my window-height sizing could misbehave in some preview panes. Replaced with a fixed phone plus a small script that shrinks it to fit short windows and never enlarges it. Phone sits first, panel after. No design change.

## Decision 6: the Read screen (screen 5) (DECIDED, approved by Rafay)
- **A. Shape:** one plain headline sentence that states the finding, then 3 to 4 short sentences. Sentences appear one at a time like the first reading.
- **B. Contents:** (1) the thing they have not said, (2) proof from their own words or numbers, at most 2 underlines, (3) the cost of waiting in their own real date or number, never an invented one. The headline may only be built from things the founder actually said.
- **C. Ending:** a last line naming what Learn will teach, specific to them, never a teaser. No "That's right / Not quite" buttons. Button: Continue.
- **D. Pictures:** none. Pictures belong to Learn.
- **E. New topics: free, everything saved.** Changing topic mid-situation opens a new situation; the old one stays saved as "left open". After the Read, a quiet line "Something else on my mind" opens a fresh situation, with open ones offered as one-tap suggestions. In Learn, a different problem gets a plain question ("That's a different problem from the pricing one. Start it as its own?", Yes / Later); the same problem is answered inside Learn. Each situation has its own cap of 2 follow-ups. Moves stay capped at 2 active; a new situation can start but a Move is offered only if there is room. Non-founder chat gets a short friendly line pointing back. Distress triggers the care screen anywhere.
- **Added after Rafay asked "other ways to look at it":**
  1. A plain reply box on the Read (a normal chat line, no rating). Whatever they write is taken into the lesson. Not the rejected "Not quite" button.
  2. Quiet situations pause after 14 days. No warning, no strike, nothing deleted; they return if mentioned.
  3. A daily limit on new situations, enforced by the server (cost). Number to be set later; suggested 5 a day. At the limit, Axiom says so plainly and offers the open ones.
- **Next up:** settle the voice (BRAND "challenging" vs PRODUCT "never confrontational") right after screen 5. Returning founders' Reads using history comes after the first version works.

### Screen 5 mock built: the Read (inside mock-onboarding-v2.html, jump button "Read")
- Situation hands off to it by itself. Headline in larger serif, 2 short paragraphs, 2 gold underlines, a muted "Next:" line behind a hairline.
- Bottom: Continue, a glass reply box (plain chat, no rating), and a quiet "Something else on my mind" which opens a fresh situation ("What is on your mind?", open situations offered as "Still open").
- Mock text is hand-composed from the sample answers. Real text is model-written and checked in code.

### Screen 5 fix: plain words, no underlines (Rafay: "I don't get the meaning")
- Read rewritten in everyday words: say plainly what is happening and what it means for them. No clever contrast lines ("not stuck on X, stuck on Y"), no metaphors. Headline now: "Nobody has actually said yes or no to this yet."
- Underlines removed from the Read. (Still on the first reading, screen 3, until Rafay says otherwise.)

### Screen 5 change (Rafay): the Read ends with a question
- Replaces the "Next: …" line (Decision 6C). The last line is one real question about a missing piece, answered in the reply box: "Have you gone back to either of those clinics since?" They can also skip it with Continue.
- Not a teaser: it must be answerable, about something they said, and the answer feeds Learn. This stays inside PRODUCT.md's hook rules (their own words, a real thing). Unlike the 2-question follow-up cap on screen 4, this is part of the Read, so it is not counted as a follow-up; to confirm.
- Screen 3 stays exactly as it is, underlines included.

### Screen 5 change (Rafay): no Continue button on the Read
- The Read ends with a question, so answering it is what moves the founder on to Learn. Continue was redundant and breaks the rule "no Continue unless the question is open-ended" (here the answer box is the open-ended part).
- Anyone who doesn't want to answer has a quiet "Skip this question". "Something else on my mind" stays. A one-word reply like "ok" gets "Say a bit more." and does not move them on.

### Screen 5 approved as it stands (Rafay)
- The Read stays: plain headline, short body, ends with a real question, no Continue, quiet Skip, reply box, "Something else on my mind".
- **The answer to that question is used in the lesson.** Whatever the founder replies is passed into Learn and the lesson must visibly build on it (e.g. if they say "No, I haven't contacted them since the demo three weeks ago", the lesson speaks to that, using their words). If they skip, Learn falls back to what they already told us. Server rule: the reply is saved with the situation, and the Learn call is given it.
- Learn (screen 6) is already designed (mock-minimal-v5.html). Next step: join it to this flow so it uses the reply.

### Screen 6 joined: Learn + Move (inside mock-onboarding-v2.html, jump button "Learn")
- Flow now runs end to end: sign-in, 13 questions, wait, first reading, situation, Read, Learn, Move sheet.
- The answer to the Read's question changes the lesson's first paragraph, without repeating their words back (mock handles a time like "three weeks"; the real one is model-written). Skip falls back to what they already said.
- Learn keeps what was approved in v5: author and book named, a picture (here a tappable "What have the clinics actually given you?" checklist with a meter, built from facts we do not invent), ONE question at the end, filler replies get a re-ask, a Move notice with no buttons that shows at most twice, tap it for the Move sheet, Commit, "Change this move" once with a real reason.
- Lesson text is a SAMPLE. Real lessons come from the verified library; author, book and any quote are checked in code.
- Decision 5 says each new situation takes the next colour (first = Seafoam). The mock stays Gold through all screens. Open question for Rafay: switch to Seafoam from screen 4?

### Learn fix: plain language everywhere (Rafay: "you don't have to make the app poetic")
- The closing question was convoluted. Now: "What would a real yes from one of those clinics be?"
- Re-asks, bridge lines and the lesson opening reworded in plain everyday words (no "the whole problem in one fact", no "hold the thread" style lines).
- Rule for all Axiom copy: if a founder has to stop and decode a sentence, rewrite it. Short, concrete, everyday words. Applies to the Read, Learn, the Move and every question.

### Learn fix: always say what to do next
- After the founder's answer, Axiom's line now says plainly what happens and what to do: "That is clear enough to ask them for. Your move is ready. Tap the note at the top to open it." Second answer: "Your move is still ready. Tap the note at the top when you want it." After the notice has shown twice: "Your move is waiting for you on the home screen."
- Rule: every Axiom line either asks one clear question or says plainly what to do next. Never a remark that leaves the founder asking "so what do I do?".

### Learn: when the Move appears (Rafay)
- Not right after the first answer. Learn is a real conversation first: the founder replies, Axiom reacts and refines (asks one related question), the founder replies again, and only then Axiom says it has worked out the move and the note appears (at the top, no buttons).
- Exception: if the founder asks what to do next, in any wording ("what should I do next", "what now", "give me the move"), they get the move at once. The real app has the model judge the intent; the mock uses simple patterns.
- Filler replies ("ok") never count toward the two replies.
- The note shows at most twice in total. After that, "Your move is waiting for you on the home screen."

### Learn: the move is a card in the chat, not a notification at the top (Rafay)
- No top-of-screen notification. When the move is ready it pops up as a card inside the conversation, under Axiom's line. No buttons: the whole card is tappable and opens the Move sheet.
- Same timing as before: after two real replies, or at once if they ask what to do next. At most 2 cards in total, then "Your move is waiting for you on the home screen."
- Updates Decision 5's earlier "notification" wording. Everything else about the Move is unchanged.

### Learn: second card is more urgent (Rafay)
- First card: label "Your move", text "Your move for the two clinics is ready."
- Second card: label "Still waiting", text "It takes 10 minutes. The two clinics have heard nothing from you for three weeks." Axiom's line before it: "Your move takes about 10 minutes. The longer you wait, the less they remember your demo."
- Urgency must be true: only facts the founder gave (here the three weeks), the 10-minute start rule, never an invented deadline or fear. This follows PRODUCT.md's hook rules (a real number or time from their life).

## Screens 1 to 7 APPROVED by Rafay (mock: tasks/design/mock-onboarding-v2.html)
Sign-in, 13 questions, wait screen, first reading, situation, the Read, Learn (with the move card and Move sheet). Colour stays Gold throughout for now (Decision 5's "first situation takes Seafoam" is parked). Sign-in tagline is a placeholder, to be decided later.
Still to design: Report (evening), returning-founder home, care screen, settings, history. Still to decide: Axiom's voice.

### Voice (Rafay): decided to do it at the END, once all screens are ready, then test the whole journey from 0 to 1 with the chosen voice. Until then all copy is draft and plain.

### Direction from Rafay (Report discussion)
- We are building this directly as an app (native; Expo preferred in CLAUDE.md), so the Report reminder is a PUSH notification at the founder's chosen time. This replaces my "open the app and land on it" default (A) for reminders. Landing on the Report when they open the app stays as the fallback.
- Open question raised by Rafay: make Axiom PROACTIVE, with access to the founder's own data (company numbers, email, calendar, team), so it brings problems to the founder before they ask ("you have 6 months of cash left", "you emailed 5 investors: 3 no, 1 maybe, 1 yes"). Being discussed before Report is designed.

## PARKED, to come back to: Proactive Axiom and connected accounts (Rafay's idea, discussed, not yet decided)
**The idea.** Axiom brings problems to the founder before they ask, using data it already has: cash left vs the plan ("6 months of cash, planning to scale"), and later connected accounts ("you emailed 5 investors: 3 no, 1 maybe, 1 yes"). A morning push turns it into a move, not just a summary. Rafay wants this as the foundation ("a killer").
**How it fits the journey.** Axiom starts a situation itself (skips the "what's going on" step), then Read, Learn, Move, Report as normal. Extends the hard rule "Axiom speaks first".
**Three levels (my recommendation: build 1 and 2 with the core loop, design them into the screens now):**
1. From what Axiom already knows: dates they gave, silence ("clinics heard nothing for three weeks"), moves due, patterns. No connections needed.
2. From numbers the founder types in: a one-tap weekly check (cash in the bank, monthly spend). The server does the maths, not the AI. Needs us to ask money later, after trust (Q7 was removed from sign-up).
3. From connected accounts, read-only: Stripe, Shopify, Gmail, Notion, CRM (HubSpot first), Calendar.
**Connectors for a startup (researched Oct 2026; verify prices and details before relying on them):**
- Use an integration platform (Nango or Composio, roughly free to $250 a month; Paragon from about $1,000 a month; Merge quote-only) so a small team ships fast. Keep our own Google developer app for Gmail.
- Order: Stripe, Notion, Calendar, then HubSpot, then Shopify (Shopify reviews public apps, incl. limited-visibility), then Gmail.
- Gmail is the hard one: restricted permission, Google verification plus a yearly paid security audit (estimates $540 to $6,000 a year, 2 to 8 weeks, get a real quote), until then users see a warning screen and the app is capped at 100 test users. Trick: use the 100-user cap as the closed beta while verification runs; start the paperwork early (privacy policy, demo video, reason for each permission). Pre-verified third-party access (Nylas, Unipile, Truto) is a fallback with a shared-account risk.
- Store less: keep what Axiom worked out ("1 yes, 3 no"), not whole emails.
**Rules to respect:** connected data is never shared with other founders (peer privacy rules). Each source gets an on/off switch and a "show me what you saw" view. Read-only, never send. Treat email text as untrusted (it could try to instruct the AI). Lock-screen pushes: founder chooses how much a push shows. Cap pushes; only send ones containing something real (their own number, date or words). Detection in plain code, AI only to word the message (cost). New stored data needs a migration plan and Rafay's approval first (hard rule).
**Still to decide:** a Connections screen (connect a source, see what Axiom read, switch off); which proactive triggers ship first; push limits.

### Report: changes from Rafay (screen not built yet)
- **A (push permission):** keep the ask simple. Proposed wording: "Want a reminder tonight?" with two taps (Yes / No thanks), shown right after they commit to a move. Time defaults to 8 pm, changeable in settings. (Replaces my longer wording.)
- **D (sharing):** give value FIRST. After Axiom's response to the report, if a matching consented founder case exists, Axiom offers it ("A founder who was in your spot shared what he got wrong and what worked. Want to see it?"). They say yes, they get it, THEN Axiom asks for the return: "He shared his so it could help you. Would you share yours the same way, with no name?" (Share / Keep private, nothing pre-selected, skipping = private).
- **Open conflict to settle:** Rafay's wording ties access to sharing ("ask for a return if they want to access the lesson"). My recommendation is NOT to make sharing a condition: consent has to be freely given, and CLAUDE.md says consent default is "not shared" and a REPORT (not sharing) unlocks founder cases. Ask after the value, as an invitation. Alternative: sharing unlocks extra cases only.
- **No case available:** Axiom says nothing about founder cases (Rafay's earlier rule: no source, Axiom says nothing). The sharing question is then asked on its own, framed as helping founders behind them.
- Founder cases shown to real users must be real, consented and human-approved. The mock uses a clearly labelled SAMPLE.

## Decision 7: the Report screen (APPROVED by Rafay, A to F, with the alternative on stories)
- **A. Reminder = push notification** at the founder's chosen time (default 8 pm, changed in settings). Asked simply after they commit to a move: "Want a reminder tonight?" (Yes / No thanks). Opening the app that evening also lands on the Report.
- **B. Shape:** Axiom names the move and its own prediction and asks what happened. Three big taps (Done / Couldn't / Didn't), no Continue button. One plain question based on the tap, answered in the box.
- **C. Axiom's reply:** Done = responds to what happened, says if its prediction was right, names the next move or situation. Couldn't = a smaller version of the same move, no penalty. Didn't = asks plainly what got in the way, notes the pattern quietly, never warns, no strikes.
- **D. Value first, then the ask (Rafay's order).** After Axiom's reply it offers a founder story that fits ("A founder who was in your spot shared what he got wrong and what worked. Want to see it?"). They say yes and get it. THEN: "He shared his so it could help you. Would you share yours the same way, with no name?" (Share / Keep private, nothing pre-selected, skip = private).
- **The story is free for reporting. Sharing is NOT a condition for it.** Rafay chose the alternative: sharing unlocks MORE founder stories later. (Consent stays free: reporting alone gets the first story.) To keep in mind: tying extra stories to sharing is still an incentive; wording must be an invitation, never "you must".
- **No story available:** Axiom says nothing about stories; the sharing question is asked alone, framed as helping the founders behind them.
- **E. Give to get:** a report unlocks founder stories for the next situation.
- **F. No report:** one reminder push, then the situation closes quietly and stays in history. No strikes.
- Founder stories shown to real users must be real, consented and human-approved. The mock uses a clearly labelled SAMPLE.

### Screen 8 mock built: the Report (inside mock-onboarding-v2.html, jump buttons "Report" and "Evening push")
- After Commit in the Move sheet: "Want a reminder tonight?" (Yes / No thanks). Yes: "I will remind you at 8 pm."
- "Evening push" shows the banner "Tonight: how did the two clinics go?"; tapping it opens the Report.
- Report: Axiom names the move and its prediction, three big taps (Done / Couldn't / Didn't), a plain question, a reply (one-word replies get "Say a bit more."), Axiom's reply (sample text), then the founder story offer (Yes / Not now), the sample story, then "Would you share yours the same way, with no name?" (Share / Keep private, nothing pre-selected), then a closing line. "Not now" skips the story and asks about sharing alone.
- All Axiom replies and the story are SAMPLE text. Real replies are written from the founder's own answer.
- Not designed yet: the screen that comes after the Report (home).

### Report fixes (Rafay)
- Buttons were too big and ugly: now small, compact, side by side.
- The opening looked empty: Axiom's question and the three buttons now sit centred in the middle of the screen.
- Pressing a button does NOT send a message ("Done" is not echoed as a chat message). The button just shows as pressed, the question rises to the top, and Axiom's next question appears. Same for the other button choices on this screen (see the story, share).
- Rule for all screens: tapping a choice button never creates a message from the founder.
- Report buttons: flat thin outlined pills (no glass, bevel or shadow) to match the quiet chat screens. Depth stays on the onboarding buttons only.

### Report choices: six looks offered (tasks/design/mock-report-buttons.html), awaiting Rafay's pick
1 words with a gliding gold line; 2 one pill with a sliding gold thumb; 3 large serif lines; 4 round marks with labels; 5 a rail with three stops; 6 the answer inside Axiom's sentence ("I did it / I couldn't / I didn't"). Rafay did not like the outlined pills or the glass/depth buttons for this screen.

### Report choices: Rafay picked look 4 (round marks), smaller and minimal
- Small round marks (38px) with a thin outline and a short label. The pressed one fills gold; the others dim.
- Marks that mean something: Done = tick. Couldn't = pause (something got in the way, can be picked up again; the arrow meant nothing). Didn't = a plain dash.
- The same marks are used for the other choices on this screen: Yes / Not now = tick / pause; Share / Keep private = tick / lock.

## Decision 8: the returning-founder home screen (direction from Rafay, details awaiting approval)
- Rafay's correction: the home screen must NOT push the founder back into what they left off. Sometimes they want to talk about something else. It should work like landing on Claude or ChatGPT: Axiom welcomes them personally and a chat box is ready. What they left off sits only as a small highlighted item next to the chat bar, nothing else. (Replaces my A to G proposal, which made the open thing the main card.)
- Proposed shape: a short specific greeting from Axiom (name, time of day, one open line, no filler, never the same twice) + a chat bar + up to 2 small highlighted chips beside/above it (the open move, tonight's report). Menu icon for history and settings. Typing something new starts a new situation. The ignored-move rule stays: it waits as a chip.

### Home greeting and check-in voice: direction from Rafay (draft, voice is settled at the end)
- Greeting is a proper sentence, name NOT at the start ("It's 6 am, Rafay. Most people aren't up yet. What's the plan?"). Playful, founder-oriented, not a friendly chatbot. "Monday Rafay" reads weird: avoid.
- Persona: a discipline mentor in the spirit of David Goggins: gets you up, checks on you, asks "what are you doing now, where are you now". Same voice for push notifications (reminder, motivator, checker), not just the greeting.
- Guardrails I am proposing: use the ENERGY, not his words or life story (nothing invented or attributed to him; a real Goggins book could be cited later only if it is in the verified library); intensity aimed at the situation, never at the person; no shaming, no profanity, no strikes; every line names a real thing the founder said or a real fact; push cap and quiet hours; distress signals override everything (care screen, no motivation).
- Idea: a "mentor style" setting (Calm / Direct / Hard) in settings, default Direct, since this intensity is not for everyone. Not a sign-up question (flag-first rule).
- Conflict to settle with the voice decision: PRODUCT.md says "never confrontational"; BRAND.md says "challenging". This persona sits between them.

### Home voice, round 2 (Rafay)
- **Pushes: at most 2 a day.** Proposed: one morning (the move) and one evening (the report). If nothing is due, no push at all. The "quiet for 3 days" check replaces the morning one. Midday and afternoon check-ins live only in the greeting inside the app, never as pushes. Quiet hours apply.
- **Greetings by time of day approved, but SHORT.** Draft set (name inside the sentence, never first):
  6 am: "6 am, Rafay. Most people aren't up. What's the plan?" | Morning with their goal: "78 days to your first customer, Rafay. What's the move?" | Midday: "Midday, Rafay. What have you moved?" | Evening: "Day's nearly done, Rafay. What got done?" | Late: "Still up, Rafay? Make it count." | Weekend: "Saturday, Rafay. Nobody's watching. What are you building?"
- Home screen layout per Decision 8: greeting, chat bar, up to 2 small highlighted chips for what they left off, menu icon.

### Screen 9 mock built: returning-founder home (inside mock-onboarding-v2.html, jump buttons "Home: ...")
- Short greeting in serif (name inside the sentence), picked by time of day (auto from the clock, or the demo buttons). A chat bar ("What's going on?"). Up to 2 tiny gold-dot items above the bar: "Your move: two clinics" opens the Move; "Report tonight" opens the Report. "No open items" shows only greeting and bar. Menu icon top left: History, Paused situations, Settings (mock popover, screens not designed).
- Typing something new would start a new situation (mock shows a note).
- All greeting wording is a draft until the voice session at the end.
- Name: mock uses "Rafay"; the app will use the first name from the Google account.

### Home chips: plain labels (Rafay: "I didn't catch 'your move' or 'report tonight'")
- Labels now say what to DO, not our internal names: "Today: ask the clinics for a call" (opens the Move) and "Tonight: tell me how it went" (opens the Report).
- Variants: a move left untouched for days: "Still to do: ask the clinics for a call" (no guilt wording, no day count). After the evening reminder time: "Tell me how it went".
- Rule: wherever the founder sees a label, use plain words for the action. "Move" and "Report" are our names; use them sparingly where a founder has to understand them.

## Decision 8 (updated): what shows above the chat bar on the home screen (Rafay)
- Items show only what is still left to do, in plain words, and only for about 8 seconds when the founder arrives, then they fade away. Hovering or touching them keeps them a little longer. (Rafay said 5 to 10 seconds; I picked 8.)
- Nothing is lost: the menu has a "What's open" list with everything pending (to do) and paused situations.
- States: morning with an open move = only "Today: ask the clinics for a call". Move done = "Tell me how it went" (the move item goes). Evening = "Still to do: ask the clinics for a call" (if still open) plus "Tonight: tell me how it went". After the check-in = nothing, or one next step if Axiom named one ("Next: confirm the time with the clinic that replied"). Nothing open = no items at all, never a "nothing to do" item.
- Typing a new message clears the items at once. They come back on the home screen only if still pending.
- You cannot swipe an item away. The honest ways out: do the move, report Couldn't or Didn't, or change the move once with a real reason.
- Flags: (1) CLAUDE.md says returning founders "land on their last open loop, never a blank prompt". This is kept in spirit: the greeting plus the fading items plus the menu list. Rafay's direction overrides the stricter reading. (2) Fading items can be missed (accessibility, slow readers): keep them on screen while touched/hovered and offer a setting later to keep them visible. (3) An ignored move now only shows 8 seconds per visit, so the pushes (max 2 a day) and the menu list are what keep it alive.

### Home menu = a side drawer (Rafay), like Claude or ChatGPT on a phone
- Tapping the menu icon slides a drawer in from the left and pushes the home screen aside. Tap the pushed-aside screen to close.
- Inside, separated by thin lines: "Start something new" (top), What's open (to do items), History (past situations grouped Today / Yesterday / Earlier this week), Paused (with how to bring one back), and at the bottom the founder's name with Settings.
- This replaces the small popover menu and the separate "What's open" sheet.
- Not designed yet: the Settings screen, a full History view (search, open a past situation), what happens when a past situation is opened. Mock rows are samples.

### Home background (Rafay): very subtle light gold behind the black
- The home screen is no longer plain black: a very faint, smooth gold gradient (stronger at the bottom, a whisper at the top). The drifting soft blobs are switched off on this screen so it stays calm. The drawer gets the same faint gold at its bottom corner.
- Rafay's message ended at "And nothing", so I took it as "and nothing else / nothing loud". Tell me if there was more.

## Screens 1 to 9 APPROVED by Rafay: sign-in, 13 questions, wait screen, first reading, situation, the Read, Learn + Move, Report, returning-founder home with drawer menu and gold wash.
Mock: tasks/design/mock-onboarding-v2.html (plus mock-report-buttons.html, the six looks; Rafay chose look 4).
Still to design: Care screen, Settings, History view. Parked: proactive Axiom and connected accounts, sign-in tagline. To do at the end: voice session + full test from 0 to 1, then update PRODUCT/ARCHITECTURE/DESIGN/BRAND, then tasks/todo.md and the build run limits.

## Decision 9: the care screen (Rafay's rule, wording draft awaiting approval)
- **The full care screen shows only for clear signs of distress, or explicit words like "suicide".** Not for slang or exaggeration such as "I wanna dieee".
- **Ambiguous statements:** Axiom replies using the context of the conversation. With no context it asks, softly and in plain words, what is going on. It does NOT jump to the care screen.
- My addition (safeguard, to confirm): three outcomes, not two. Clear = care screen. Unclear = context reply or soft question, with the mentor tone and any move paused for that turn. If the soft question gets a worrying answer, or unclear signals repeat, it escalates to the care screen. Tuned to catch rather than miss: a missed real crisis is worse than an extra check-in.
- Care screen: calm, no glow or animation, one human message, real help for their country (emergency number, helpline, directory fallback), "I'm an assistant, not a counsellor, but I'm here if you want to keep talking". All pushes paused, nothing about moves or reports, gentle check-in on return, no strikes. Sensitive text is never used in founder stories or sharing.
- Help numbers are NOT written until a person verifies them (country from sign-up question 5, fallback findahelpline.com, reviewed yearly). Before launch: a test set of messages including false alarms ("kill the feature", "burn rate"), and a wording review ideally by someone with a mental-health background.

## Decision 9 approved: care screen + escalation safeguard (Rafay).

## Decision 10: Settings (built from decisions already made; Rafay reacts to the mock)
Groups, each divided by thin lines, plain labels:
1. **You:** name and email (from Google, read-only), country, "What Axiom knows about you" (edit the sign-up answers).
2. **Reminders:** check-in time (default 8 pm), morning push on/off, evening push on/off, what a push shows on the lock screen (Full / Short / Hidden, default Short), quiet hours. Fixed note: at most 2 a day.
3. **How Axiom talks:** mentor style Calm / Direct / Hard, default Direct. Settings only, never a sign-up question.
4. **On screen:** "Keep my open items on screen" (stops the 8-second fade).
5. **Sharing:** what you have shared (each with Withdraw), and a fixed line that sharing is always asked and never on by default.
6. **Help and privacy:** Get help (the care resources, always one tap away), Privacy, Terms.
7. **Account:** Sign out, "Delete everything Axiom knows about me" (confirm step). Flag: deleting stored user data is flag-first under CLAUDE.md and needs its own deletion plan before it is built.
- Left out on purpose: Connected accounts (parked idea), payments (none), anything about streaks or scores.

### Screen 11 mock built: Settings (inside mock-onboarding-v2.html; menu drawer, tap your name; or jump button "Settings")
- Groups divided by thin lines: You, Reminders, How Axiom talks, On screen, Sharing, Help and privacy, Account. Switches are small and quiet (gold when on). Mentor style uses the gliding-line words look.
- "Keep my open items on screen" really stops the 8-second fade on the home screen. "Get help" opens the care screen. Withdraw removes a shared item. Delete shows a confirm box; nothing is deleted in the mock.
- Left out on purpose: connected accounts (parked), payments, streaks and scores.

### Settings changes (Rafay)
- Removed: the line "At most 2 reminders a day. Quiet from 10 pm to 6 am." (the rule still applies in the product, it is just not written on screen).
- Removed: the whole Sharing group (what you've shared + Withdraw + the "I always ask" line).
- Removed: the "Get help" row. "Help and privacy" is now "Privacy" (Privacy, Terms).
- FLAGS, Rafay's call: (1) PRODUCT.md says "A settings page lets founders see and withdraw anything they have shared", and CLAUDE.md treats consent and sharing as sacred. With the Sharing group gone there is NO way to withdraw a share. If kept out of Settings it should live somewhere else (for example the History screen: each past situation shows if it was shared, with Withdraw), otherwise this breaks a stated privacy rule. (2) Help is now reachable only when Axiom shows the care screen, not on demand.

### Settings: one Withdraw row (Rafay) — settles the flag about withdrawing
- In Settings > Privacy: "Withdraw my consent to share" with one sentence ("You can take back your consent any time. From then on, nothing of yours is shared with other founders.") and a Withdraw button. After pressing it the row says consent is withdrawn.
- Plain limit to settle before build: CLAUDE.md says peer outcome rows NEVER store a user_id, so already-shared anonymous outcomes cannot be traced back to take down. So withdrawal can only STOP FUTURE sharing, unless we change that rule (a privacy and legal decision, Rafay's call). The sentence is worded to match what is true: "from then on". PRODUCT.md's "withdraw anything they have shared" should be reworded to match.

### Settings: sharing is a switch (Rafay)
- Replaces the Withdraw button. Settings > Privacy: switch "Share with other founders". On: "Lets me ask, after a check-in, if you will share what happened, with no name. Nothing is shared unless you say yes each time." Off: "Off. I will not ask, and nothing of yours is shared with other founders."
- Off also means the Report skips the sharing question.
- Default is ON meaning "Axiom may ask". Nothing is ever shared without a yes each time, so "default is not shared" still holds. Flag for Rafay: if it defaults to OFF the Report's sharing question never appears for new founders. Same limit as before: turning it off stops FUTURE sharing only (shared outcomes never store a user_id, so they cannot be traced back).

### Sharing: Axiom ALWAYS asks after a check-in (Rafay) — the switch changes meaning
- Rafay: even if the setting is off, still ask the founder after the report whether they'd like to share. This matches CLAUDE.md ("Consent to share is asked at every report. Default is not shared.").
- So the Settings switch "Share with other founders" can no longer mean "stop asking". New meaning: OFF (default) = after each check-in Axiom asks, and nothing is shared unless they say yes. ON = share automatically, with no name, without asking each time (an opt-in the founder can turn off any time).
- FLAG for Rafay: the ON state is something I added so the switch still does something. It is standing consent given in advance, which is stricter territory than "asked at every report". If you do not want it, remove the switch and keep Settings simple: sharing is only ever decided in the Report. Say which.
- Still true: shared outcomes never store a user_id, so turning anything off stops FUTURE sharing only.

## Settings APPROVED by Rafay, with the "Share with other founders" switch kept as "share automatically" (off by default: Axiom still asks after every check-in).

## Decision 11: History (built from decisions already made; Rafay reacts to the mock)
- Reached from the menu drawer ("See all history"). A plain list of past situations with a search box, grouped Today / Yesterday / Earlier / Paused. Each row: a plain title and one quiet status in words: Open, Done, Couldn't, Didn't, Paused. No scores, no streaks, no counts of missed days.
- Opening a past situation shows a read-only page, divided by thin lines: What I read (the headline), What you learned (author and book), Your move, How it went (what they reported), Shared or kept private. One quiet button: "Talk about this again" which reopens it as a chat. An open one shows "Pick it up".
- No delete here. Stored situations are the product's memory (CLAUDE.md "memory is sacred"); deleting everything is only in Settings and needs its own plan.
- Mock data is sample.

### Screens 12 and 13 mocks built: History and a past situation (menu drawer > See all history, or jump button "History")
- List with search, grouped Today / Yesterday / Earlier this week / Paused, one quiet status word per row. Tap a row for a read-only page: What I read, What you learned, Your move, How it went (and shared or private), then one action: Talk about this again / Pick it up (opens the move) / Bring it back (paused).
- Drawer history rows open the same page. Sample data, placeholder authors.

## ALL SCREENS APPROVED by Rafay (History included, after one change): 1 sign-in, 2 thirteen questions, 3 wait, 4 first reading, 5 situation, 6 Read, 7 Learn + Move, 8 Report, 9 home with drawer, 10 care, 11 settings, 12 history, 13 past situation. Mock: tasks/design/mock-onboarding-v2.html.

### History change (Rafay)
- No "Today / Yesterday / Earlier" headings, in History and in the menu drawer. Newest first. Each chat sits in its own thin-outlined box with space around it (not one long list with lines). The status word (Open, Done, Couldn't, Didn't, Paused) stays on each box.

### What comes next, in order
1. Voice session: I draft a one-page voice guide from everything Rafay has said, he edits it, then every line in the mock is rewritten in that voice.
2. Full walkthrough from 0 to 1 with that voice.
3. Update PRODUCT.md, ARCHITECTURE.md, DESIGN.md, BRAND.md to match every decision.
4. Write tasks/todo.md and agree the long-run limits (spending cap, what I may do alone, where I must stop).
### Things to settle before building (collected flags)
- Stack: Rafay now says "directly an app" (native, push). CLAUDE.md says Vite + React on Vercel, web first, native later. ARCHITECTURE.md must change.
- 13 sign-up questions vs PRODUCT.md's 7 + 3. No "That's right / Not quite", no feedback endpoint. BRAND.md "Axiom will remove you" goes.
- Sharing: "share automatically" is standing consent (kept); withdrawing only stops FUTURE sharing (shared outcomes never store a user_id).
- Care: help numbers verified by a person, test messages, wording review. Delete-everything needs a deletion plan. Fading home items vs "never a blank prompt".
- Parked: sign-in tagline, proactive Axiom and connected accounts, Seafoam colour rotation, a Connections screen.
- Database and cost: main-project migration and Knowledge lesson tables need explicit approval; push scheduling and daily caps.

### History, round 2 (Rafay): no boxes
- The boxes did not look nice. History is a plain list separated by thin lines, no day headings, newest first, status word at the right.

## Voice session started: draft guide written to tasks/voice.md (awaiting Rafay's edits)
- Five rules: plain, specific, direct and urgent but never harsh, always the next step, quiet. Banned list, mentor energy, the Calm/Direct/Hard dial with one fact in three strengths, by-screen guidance, before/after table, and how BRAND.md vs PRODUCT.md conflicts are settled in the draft.
- Open for Rafay: humour, praise, swearing in Hard, the name rule, the sign-in line.

## Voice decisions (Rafay), written into tasks/voice.md
- Humour: very subtle and dry, only in greetings and when a move goes well. Never when something went wrong, never in care.
- Praise: only when they do something good; one short plain line with a dry touch of humour.
- Swearing: never, in any mode.
- Name: in most pushes and greetings (it makes them feel personal), not every message.
- Sign-in line: Rafay will provide it.
- Applied to the mock: the six greetings (e.g. "6 am, Rafay. Most people aren't up. Their loss. What's the plan?"), the push ("Rafay, how did the two clinics go?"), the urgent second move card (name inside), and the Done reply in the Report ("I was right, which helps nobody. You sent it anyway, and that is the part that counts.").

## Full walkthrough 0 to 1 done (Rafay approved the voice lines first). Findings in tasks/walkthrough.md
- Fixed five small things (quote cut mid-phrase, stray comma, assumed gender in the sample story, dead end after Commit, dead end after the Report). Rule: never assume anyone's gender.
- Gaps found, not designed yet: loading state, errors and offline, lesson fallback when quotes fail the check, push permission denied, sign-in problems, resuming an interrupted sign-up, a few small screens (edit sign-up answers, Privacy, Terms, delete confirm), move swap and the second active move.

## Decision 12: the four in-between states (designed together, awaiting Rafay's changes): tasks/design/mock-states-v1.html
1. **Thinking.** Never a spinner. A thin gold line moves under the founder's message with one plain line naming what Axiom is working on ("Looking at the clinics."). After about 4 seconds: "Still on it. Your message is saved." After about 10 seconds it becomes the error. Long waits (first reading, Read) keep the approved wait screen.
2. **Something went wrong.** The founder never loses what they wrote, and no "sorry" or error codes. (a) AI failed: "I couldn't answer that just now. Your message is saved." plus a quiet "Try again". (b) No connection: a thin strip "No connection. What you write is saved and sent when you're back.", messages queue ("Waiting to send"). (c) Report with no signal: "Your check-in is saved. I'll send it as soon as you're back online."
3. **No verified source.** Axiom says NOTHING about it (Rafay's rule). No author line, no apology, the lesson is built only from the founder's own facts and still has the picture and the closing question. The server decides, the founder just sees a shorter lesson.
4. **Reminders refused.** Said once after they commit: "Reminders are off on your phone. I'll keep tonight's check-in waiting on your home screen." plus "Turn on in phone settings". Settings shows one quiet row with the fix (reminder switches paused). That evening the home item does NOT fade until they report.

### Decision 12, changes from Rafay
- **Loading:** no line, no "Looking at the clinics" copy. Instead a logo animation (the emblem draws itself in gold and glows, looping) with "Something to think about" and one question from the founder's own situation underneath, changing every few seconds ("Who decides about buying at those clinics?"). After about 4 seconds a small line says "Your message is saved." The thought lines are written by the server from the situation; they must be real questions, never invented facts and never a quote we have not verified.
- **No connection:** the grey strip is replaced by a small floating glass pill with a gold dot, like the push banner (matches the palette): "No connection. What you write is saved."
- **Writing brighter, everywhere:** the base writing colour is a bit whiter and brighter in both mocks (from 214,216,219 to 234,236,238).

### Decision 12, round 2 (Rafay approved, made)
- **Loading:** the logo is small (about half). Under it ONE real quote that fits the founder's situation, with the BOOK NAME ONLY (no author), then after ~4 s a small "Your message is saved." Long waits swap quotes every 5 s. If no verified quote fits, only the logo shows and Axiom says nothing.
- Quotes come only from the verified library (the stored short_quote of a lesson, checked word for word), and only the author's own words. Shown exactly as printed, with "…" in front when the original starts mid-sentence, nothing tidied. The quote on the loading screen is never the same one used in the lesson that follows.
- FLAG: CLAUDE.md says author lessons always name author AND book. On this one screen only, Rafay chose book name only. Lessons themselves still name both.
- **No connection:** option A. No separate notice. The chat box says "No connection. Your messages are saved." with a small gold dot; unsent messages carry "Waiting to send".
- **Examples shown (sample founder messages, real quotes):** makeup brand: repeat purchases > 7 Powers; looking like every brand > Play Bigger; slow support > To Sell Is Human. AI agency: stuck doing delivery > The E-Myth Revisited; nothing repeats > Crossing the Chasm; demo then silence > Play Bigger. Clinics: Never Split the Difference. Long waits: general quotes (Never Split the Difference, The Great Mental Models Volume 2).

### Loading state, round 3 (Rafay): tiny, a hint, not a screen. New focused file: tasks/design/mock-loading-v1.html
- The quote text was taking over the screen. Now it is very small (about 12px, muted but readable) and sits where Axiom's answer will appear, next to a small drawing logo (24px). It reads as "your real answer is being prepared", not a new screen. The real answer then takes its place. Book name only, real verified quote, tiny "Your message is saved." after 4 s.
- From here until the loading state is approved, only this file is shown. The other screens stay approved. (The loading phones inside mock-states-v1.html are out of date and will be synced after approval.)

### Loading state, round 4 (Rafay approved my plan A + B)
- Removed "Your message is saved." completely.
- Makes it feel like loading: (A) a soft light sweeps across the tiny quote in a loop, so it reads as something in progress; (B) three faint empty answer lines sit under it and shimmer in time with the light. When the real answer arrives the lines and quote fade and the answer's words fill in one by one in the same place.
- Logo keeps drawing itself. Still a real verified quote, book name only; if nothing fits, only the logo and the faint lines show.
- Faint answer lines made much lighter: thinner (5px), quieter (about half the contrast), two lines instead of three. (Rafay: too much weight.)
- Faint answer lines made much lighter: thinner (5px), quieter (about half the contrast), two lines instead of three. (Rafay: too much weight.)

## Documents updated (Rafay asked): PRODUCT.md, ARCHITECTURE.md, DESIGN.md, BRAND.md
- PRODUCT.md and ARCHITECTURE.md rewritten to match every decision. DESIGN.md fully replaced with the new visual language. BRAND.md updated (voice, logo, imagery, positioning, launch, pricing) and the campaigns built on removed features are marked Retired.
- Not changed on purpose: CLAUDE.md. Its disagreements with the new documents are listed at the bottom of tasks/todo.md for Rafay to settle.
- Still open: marketing typography, the sign-in line, the one-line, withdrawal link table (A or B), help numbers to verify, the deletion plan, native app vs web first.

## Decisions on the CLAUDE.md disagreements (Rafay)
- **1 Native app, 2 returning screen:** already decided. CLAUDE.md to be updated.
- **3 Learn:** option A. "Every Learn conversation leads to a Move."
- **4 Author and book:** option A. Lessons always name both; the loading hint may show the book only.
- **5 Consent:** option A. Asked at every report unless the founder has turned on "share automatically" in Settings. Default is not shared.
- **6 Link table:** option B (Rafay's reason: the future plan connects complementary founders, which needs to know who is behind an outcome). A private server-only link table exists; peer outcome rows still never hold a user_id; introductions stay double opt in; Privacy page says so plainly. ARCHITECTURE.md and PRODUCT.md updated.
- **7 Onboarding:** nothing to change (CLAUDE.md never said 7 + 3).
- **8 Artifacts:** reword: the old AI-drawn system is deprecated, the fixed picture library is allowed.
- **9 Verify checklist:** returning founder line reworded to the home screen.
- **10 Distress:** NO change. CLAUDE.md keeps "Distress or crisis signals stop the journey." (The documents' middle tier for unclear talk is not added to CLAUDE.md; the documents still describe it. To keep in mind: this is the one place CLAUDE.md and PRODUCT.md will differ on purpose.)
- CLAUDE.md edits are shown to Rafay before saving.

## CLAUDE.md updated (Rafay said "ok" to the edits shown): native app first, home screen for returning founders, Learn leads to a Move, loading hint book-only exception, share automatically, private link table, new picture library allowed, voice line, verify checklist, file structure. Two small consequential edits not on the shown list: "browser" became "app (and any browser)" in the writes rule, and "No browser side writes" became "No client side writes". Distress rule unchanged.

## Build plan drafted (tasks/todo.md, "Build plan v1"), waiting for Rafay
- Real-model testing cap: $6 in total (Rafay agreed), at most 3 approved runs. Brand Kit stays uncommitted for now (Rafay: "lets plan it").
- Found: feature/backend-hardening (39 commits, unmerged, includes cost-tracking) already has server hardening, writes behind the API, a daily cost cap, usage logging, founder_profiles migration and endpoints, and tests. Plan builds on it.
- Open questions for Rafay: base branch, where the Expo app lives, whether backend-hardening migrations are live.

## Setup for the long run approved (Rafay)
- Build on feature/backend-hardening; Expo app in app/. Read-only live check done: the backend-hardening migrations are NOT live (founder_profiles and product_events do not exist). Real-model testing cap $6, at most 3 approved runs.
- Standing rules: fix from the root, delete dead code, a learning-loop agent after every milestone, a plain-English report when all screens exist, resume by itself after a usage limit (mechanism awaiting a yes).
- New agents (in ~/.claude/agents): learning-loop, voice-checker, care-tester, app-builder. Conductor = me. Max 3 helpers at once. Proposed: a conductor session plus a Server session and an App session.
- New: tasks/status.py and tasks/build_status.json, and the "axiom-build-monitor" panel (command /axiom-build). The panel loads only after Rafay answers "Turn them on" to the engine's question.

## Build monitor look (October 2026)
- Rafay wants the monitor to be a pixel-art office: each agent a small robot in its own booth at a desk, Claude's brain in the centre, glowing dots travelling along lines when work is handed out and reported back, robot moods (typing, asleep, thumbs up, red light), and B0 to B12 shown as a path of nodes.
- Both a side panel (small text robots) and a live page (`tasks/tools/axiom-office/index.html`, served by the `axiom-office` preview on port 8765, `?demo=1` shows fake data). A slim strip on the page shows needs-you, budget, tests, rate-limit status.
- Rafay shared a reference (an isometric "agents office": coloured platforms per team, a central Brain, roads with moving data, team cards, task list on the right). The office page was redone to match: four team platforms (Server, App & Voice, Quality, Learning), Claude's brain in the centre, a task-status list on the right.

- Rafay said go: agent list approved, three sessions approved, 20-minute resume task approved (October 26, 2026).

## 2026-10-31: give to get, decided by Rafay
- The first 2 founder lessons are given free. Each is followed by the share ask.
- If the founder still has not shared after the 2nd, no more founder lessons. Axiom says so once, plainly, and says that turning on sharing in Settings brings them back.
- Turning sharing on in Settings unlocks founder lessons immediately. Reason: sharing is the return for what they receive, and the way back in must be one switch they can find.
- Replaces the open question on how "unlock" works. PRODUCT.md "Give to get" and CLAUDE.md "Hard Rules" to be updated to match.

## 2026-10-31: founder credits and referrals (PARKED, open question)
Idea from Rafay: founder credits, and growth by referral. Not building until give-to-get has landed and Rafay says go.
- Direction proposed: credits are the currency for founder lessons beyond the free 2 and for warm introductions (double opt-in). Earned by sharing a reviewed outcome, and by a referred founder completing a first report (not for a sign-up alone).
- Never buyable: extra active moves (the 2-move rule), care, the Read, anything in the core loop.
- Needs Rafay's explicit yes first: CLAUDE.md says no gating or payment code until instructed, and credits are a currency.
- Constraints: referral links must not reveal who referred whom (server-only link, like peer outcomes); credits never expire or get taken away (no strikes, no removal).
- Founder-lessons access is built as a pure function of stored facts, so a credit balance can become one more term later.

- Built (Oct 31): `founder_lesson_log` (migration 20261101000010, not applied) holds the count; access is derived each request from it, `share_auto` and any 'share' unlock. Wording in tasks/wording_to_approve.md section D. Deliveries made while sharing is on are logged but not counted.

- Calm/Direct/Hard now reaches the model (Oct 31): the Read, Learn replies, Move and Report reply read the saved style live each request (default direct, direct and any care hold add nothing) via one shared module, server/journey/prompts/style.js. Tone only; care, forbidden phrases, citations, Move rules, follow-up cap and fixed copy are never styled. Wording in wording_to_approve.md section E. The sign-up first reading is not styled.

## 2026-10-31: wording approvals and sign-in direction
- Founder-lessons notice: Rafay chose the "invitation" version, shortened (v2).
- Section A of wording_to_approve.md applied in full (wait lines, report fallback replies, care line, "Tonight's check-in" title, push, lock note, rate-limit, Learn and Move errors). Home greeting joke stays.
- Sign-up page: Rafay dislikes the gold light blobs ("old fashioned, like a kids app"). Wants a black sign-up page with an opening motion piece: zoom in, zoom out, animated tagline about Axiom itself, like a motion graphics video. Tagline direction: the spirit of "I think, therefore I am", in the context of founders. Tagline chosen later: "See. Learn. Become."

- Sign-up film (Oct 31, Rafay): sign-in is pure black (drifting light off for it only). A ~9 second title sequence plays once per app open, awe then momentum, ending on the emblem and the placeholder tagline "I move, therefore I am." (superseded the same day by intro v3 and "See. Learn. Become."). Animated-only: the blur clear is a fade with a small rise. Lines in copy.intro, timings in app/src/intro/timeline.ts.

## Rafay's calls (Oct 31)
- All pending wording is approved (wording_to_approve.md A to F, push wording, account lines); the NEEDS APPROVAL markers are removed.
- Care help shows no phone numbers: one tappable link to https://findahelpline.com (all countries). The help table and country lookup are deleted.
- The founder's name is read-only in Settings (it comes from Google); the server no longer accepts a name change.
- The morning push stays a fixed 8 am local time, not a setting (no change).
- The stray packageManager line in the root package.json is reverted.
- Migrations (Rafay, Oct 31): apply every pending migration to main, including 20260930000000 (drops weekly_reads, personal_wiki_edges, personal_wiki_nodes and four old sessions columns). Before applying: fresh read-only dump of live, check the applied-migrations list.
- Migrations applied to main on Oct 31 2026: 20260930000001 through 20261101000011 (15 files; 20260930000000 was already live). Verified: RLS on every table, no anon/authenticated grants on new tables, peer_outcomes holds no author link.
- Hosting (Rafay, Nov 2): the API moves from Railway (account banned) to Render, Singapore. Free plan while testing; Starter (always on) before pushes go on, because the push scheduler runs in the process. Setup in render.yaml. CLAUDE.md and ARCHITECTURE.md still say Railway: update them once Render is live.
