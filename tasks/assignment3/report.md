# Axiom: Working MVP Report (Assignment 3)

Draft, Nov 8 2026. Everything below is taken from the code, the test suites and the live usage logs.
`[ ]` = to fill in from real user testing. Nothing in sections B or C may be filled in with invented data.

---

## 0. The product in one paragraph

**Problem:** early-stage founders make hard decisions alone. Guidance from founders who have been there works, but few founders get it: Y Combinator took 260 companies from over 27,000 applications for Winter 2024. A third of new startups now have a single founder (Carta, 2024).
**Target user:** first-time founders at idea to pre-seed stage, especially solo founders. First market: the US.
**What Axiom does:** a founder brings a real situation. Axiom reads what is really going on, teaches what they need from named books, gives one small move to make today, and asks that evening how it went.

**Main user journey (the MVP):**
1. Sign in with Google and answer 13 short onboarding questions (taps, at most 5 options each).
2. **First reading:** Axiom describes the founder back to them, in their own words.
3. **Situation:** the founder types what is going on. Axiom asks at most 2 follow-up questions.
4. **Read:** a short headline and body naming what is really going on, quoting the founder's own words.
5. **Learn:** a conversation with lessons from the book library. Every lesson names the author and book. Quotes are checked word for word against the source.
6. **Move:** one action for today. The founder is the only one who has to act, it can start within 10 minutes, and success is yes or no.
7. **Report (that evening, or within 48 hours):** Done, Couldn't or Didn't, an optional note, and a choice to share the outcome anonymously.

---

## 1. Functional working MVP

| Requirement | How Axiom meets it |
|---|---|
| Addresses the validated problem and target user | The journey above is built for a founder facing a decision alone |
| User completes the task without the team doing it for them | Every step runs on its own: AI, checks, storage and scheduling are automatic. The one manual step is listed in A4 |
| Meaningful AI capability | Five AI steps form the core of the product (section 3) |
| Deployed and accessible | Server: live on Render since Nov 2 (`axiom-api-gu9h.onrender.com`). App: [web link on Vercel, once deployed] and Android build. See A5 |
| Clear value proposition | The founder leaves with a named read of their situation, a cited lesson, and one move they can do today, then reports back |

**Stack:** Expo (React Native) app for iOS, Android and web; Express (Node.js) API on Render; Supabase for sign-in and the database; OpenAI models per step.
**Quality checks (run Nov 8 2026):** server 515 tests pass, 0 fail; app 196 tests in 21 suites pass. One end-to-end test runs a founder from sign-up to report through the real routes, and a contract test checks every call the app makes against what the server returns.

---

## A. Product status and limitations

### A1. Mocked integrations
| Item | Status |
|---|---|
| Push notifications | Built and tested with a fake push service. Switched off in production (`EXPO_PUSH` off) until the app is in the stores. Web has no push |
| AI models in automated tests | All automated tests use fake models. Live behaviour was checked by hand on Nov 2–3 (section 3) |
| Connected accounts (Stripe, Gmail, calendar...) | Not built. Planned for phase 2 |

### A2. Synthetic or sample data
| Item | Status |
|---|---|
| Sample founders, stories and quotes | Used only in development. A release build refuses to start without the real server, so samples cannot reach a tester (tested) |
| Founder stories ("founders one stage ahead") | No real stories exist yet, so Learn shows book lessons only. Nothing unreviewed or invented is ever shown |
| Demo situation in the video | [Real situation from our own use, or labelled as a sample] |

### A3. Unfinished features
- **Founder stories in Learn:** the sharing, consent and human review pipeline exists. Showing stories in Learn is not built.
- **Give to get:** a shared outcome writes an unlock record, but nothing reads it yet. So the "first 2 founder lessons free, then share to unlock" rule is not enforced.
- **Calm / Direct / Hard setting:** saved, but not used by the prompts. Every founder gets Direct.
- **Verified lesson library:** not loaded. Learn uses the existing book passages with book-level citations (author and book, no chapter or page). The loading hint stays empty until the library is loaded.
- **Care help numbers:** the care screen shows only findahelpline.com until real, verified numbers per country exist.
- **Privacy Policy and Terms:** drafted, not reviewed by a lawyer.

### A4. Manual steps still required
- **Evening Report reminder:** with push off, testers are reminded by message to open the app and report. This is the only step a person does in the journey.
- **Review of shared stories:** a person approves every shared outcome before anyone else can see it. This is by design, not a gap.

### A5. Known technical limitations
- **Not in the App Store:** we have no Apple developer account yet, so there is no TestFlight. Testers use [the web version / an Android build].
- **Cold start:** the server runs on Render's free plan. It sleeps after 15 minutes without requests and took 33 seconds to wake when measured on Nov 6.
- **Limits per founder:** 5 new situations a day; $1 a day of AI spend (never blocks the care check, the Report or saving what a founder wrote).
- **Sign-in:** Google only.
- **Language:** English only.
- **Data location:** the database is in Singapore; the AI provider is OpenAI.

### A6. Assumptions made to enable the MVP
- Founders will describe a real situation honestly in a few sentences.
- A move small enough to start in 10 minutes is still useful for real decisions.
- Founders will come back the same evening, or within 48 hours, to report.
- Book lessons are useful before any founder stories exist.
- The web version is a fair stand-in for the phone app during testing (no push, browser instead of app).

---

## 3. Meaningful AI capability

### What AI does in Axiom
| Step | What the AI does | Model | What code enforces around it |
|---|---|---|---|
| Situation | Decides whether it understands enough, or asks one more question | gpt-4.1-mini | Hard stop at 2 follow-up questions, enforced in the database (tested with 8 turns at the same time) |
| Read | Writes what is really going on, quoting the founder's own words | gpt-5.2 | Every quote is checked to be the founder's own typed words; failing Reads fall back to fixed sentences |
| Learn | Finds the right book passages (embeddings) and teaches from them in conversation | text-embedding-3-small, gpt-5.4-mini | Author and book come from the library record; quotes must match the passage word for word; each reply must build on a passage |
| Move | Drafts one action for today | gpt-5.4-mini | A rule-based validator checks the founder is the only one acting, it starts within 10 minutes, success is yes or no. At most 2 open moves |
| Report | Responds to Done, Couldn't or Didn't | gpt-5.4-mini | No strikes or warnings, ever |
| Care | Screens every message for signs of distress | rules + gpt-5.4-mini | Clear distress stops the journey (no lesson, no move) and shows real help |

### Why AI makes the product better
Without AI, Axiom would be a library of generic advice. The AI reads one founder's situation in their own words, finds the few book passages that fit it, and turns them into one action sized for today. A human mentor does this too, but costs far more and few founders have one. At under 2 cents of AI per situation (live logs, Nov 2026), Axiom can do it for every founder.

### How we know whether the AI is working
1. **Checks in code on every answer:** quotes, citations, move rules and the 2-question limit are checked by the server, not left to the prompt. A failing answer is retried or replaced with a safe fallback.
2. **Test sets:** the care check has an independent test set, written by a second agent, with over 150 phrases. It covers business language that sounds alarming ("kill the feature", "burn rate"), slang, and real distress.
3. **Live runs:** we used the real models end to end on Nov 2–3 and logged every failure (table below).
4. **The Report itself:** Done, Couldn't and Didn't tell us whether moves are doable. If moves keep coming back "Couldn't", the advice is wrong.
5. **From user testing:** [testers' rating of whether the Read was accurate, and whether the move was clear and doable].

### Cases where the AI was wrong, unreliable or unhelpful, and what we changed
| # | What went wrong | Type | Fix |
|---|---|---|---|
| 1 | A lesson cited Eric Ries without naming him. "Name the author" lived only in the prompt, and the model skipped it | Incorrect | The server now checks every lesson names its author and book and rejects it otherwise |
| 2 | The Read quoted our own form labels ("Avoids most:", "Based in") as if the founder had said them | Incorrect | The quote checker now accepts only words the founder typed, never text we wrote |
| 3 | A faithful quote failed the check twice, so the founder got the fallback instead of a real Read. The check saw onboarding answers one by one while the model saw them joined | Unreliable | The check now uses exactly what the model was shown, and a test compares the two |
| 4 | The model used our internal word "evidence" in a reply to the founder | Unhelpful | Every internal input name is on a server-side banned list, not only in the prompt |
| 5 | One follow-up mode answered from general knowledge instead of the book passages | Incorrect | Every mode that receives passages must build on one, and the server checks it |
| 6 | A founder asked "when does this convo end" and got no move, because a fixed phrase list missed it | Unhelpful | Wanting to leave is now treated as asking for the move |
| 7 | Pull quotes showed verified but meaningless fragments ("...final thing was payments") and credited a podcast host for his guest's words | Unhelpful, incorrect | Pull quotes removed; interview lessons credit the guest, not the host |
| 9 | Live run, Nov 8: the first reading quoted "avoids most: pricing, asking for money", joining our form label to the founder's picks. The check rejected it, so the founder got the plain fallback instead of a real reading | Unreliable | The check worked as designed (no misquote shown). Root fix: the model is now shown each answer without our labels (labels moved into the question), so any whole answer it quotes is the founder's own; a regression test covers the live case (backlog #12) |
| 8 | The care check missed distress written with spaced letters or missing spaces, and treated an invalid model answer as "no concern". 9 gaps in total, found by the independent test set | Unreliable (safety) | All 9 fixed; the test set runs on every change |

---

## B. User testing and feedback
[Fill in only from real sessions. See testing_kit.md.]

**Target user profile:** first-time founders at idea to pre-seed stage, building a company now. Testers from the team's personal or academic circle are listed separately and not counted toward the 10.

### B1. Testers
| # | Role and stage | Country | Fits target? | How recruited | Date | Journey tested | Completed up to | Reported back? |
|---|---|---|---|---|---|---|---|---|
| 1 | [ ] | [ ] | [ ] | [ ] | [ ] | Sign-up to Report | [ ] | [ ] |
| 2–10 | | | | | | | | |

### B2. Completion
| Step | Testers who reached it (of [N]) |
|---|---|
| Sign-in and onboarding | [ ] |
| First reading | [ ] |
| Situation and Read | [ ] |
| Learn | [ ] |
| Move committed | [ ] |
| Report (Done / Couldn't / Didn't) | [ ] |

### B3. Ratings (1 to 5, from the feedback form)
| Question | Average | Range |
|---|---|---|
| The Read described my situation accurately | [ ] | [ ] |
| The lesson was relevant to my situation | [ ] | [ ] |
| The move was clear and doable today | [ ] | [ ] |
| I would use Axiom for my next hard decision | [ ] | [ ] |

### B4. Feedback and observations
[Quotes and what we saw, grouped by step.]

### B5. Problems, friction points and unexpected behaviour
[Each with how many testers hit it.]

### B6. Key insights
[3 to 5 insights, each tied to evidence above.]

---

## C. Prioritised feature and issue backlog
Priority: P0 = blocks testing or breaks trust; P1 = hurts the core journey; P2 = improves it; P3 = later.
Evidence column: "Internal" = found in our own live runs or reviews. Rows from user testing are added after B is complete, and priorities re-ranked by how many testers hit each issue.

| # | Issue / Feature | Evidence or feedback | Priority | Action | Status |
|---|---|---|---|---|---|
| 1 | Web version deployed so testers can use it without the App Store | No Apple developer account; assignment needs a deployed MVP | P0 | Build | [In progress] |
| 2 | Server cold start (33 s wake on the free plan) | Measured Nov 6. A tester may leave during the wait | P0 | Fix (always-on plan during testing) | To do |
| 3 | Evening Report reminder without push | Push is off and web has no push. Report is where the value is proven | P1 | Improve (manual reminder now, push once in the stores) | Manual for testing |
| 4 | Founder stories in Learn | Core of the value proposition ("what founders like you did"); none shown yet | P1 | Build, after real consented stories exist | To do |
| 5 | Give-to-get unlock not enforced | Unlock is written but never read (internal review). The shared line promises something the code does not do | P1 | Fix | To do |
| 6 | Verified lesson library | Learn has book-level citations only; loading hint empty | P2 | Build | Waiting on real use first |
| 7 | Calm / Direct / Hard setting not used | Saved but ignored (internal review) | P2 | Fix or remove the setting | To decide |
| 8 | Care help numbers per country | Only findahelpline.com shown; numbers unverified | P1 | Build (a person verifies each number) | To do |
| 9 | Privacy Policy and Terms reviewed | Drafts only | P1 | Improve (legal review) | To do |
| 10 | App Store release (Apple account, TestFlight) | Needed for push and the real app experience | P2 | Build | Blocked on account |
| 11 | Proactive Axiom and connected accounts | Product vision, phase 2 | P3 | Defer | Parked |
| 12 | First reading falls back when the model quotes a form label with the answer | Live run Nov 8 (failure #9): "avoids most: pricing, asking for money" | P1 | Fix (keep labels out of what the model can quote) | Fixed Nov 8, with a regression test; live once merged to main |
| 13–[ ] | [Issues from user testing] | [Tester feedback, count] | [ ] | [ ] | [ ] |
