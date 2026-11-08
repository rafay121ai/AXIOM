# Axiom demo day deck: text and script (draft 1, Nov 7 2026)

Format: live on Zoom. 5:00 pitch including the demo, then 3:00 Q&A. Judged on product quality, execution, problem understanding, evidence, pitch clarity. No ask (judges, not investors).

8 slides in the pitch, appendix slides for Q&A. Spoken script is about 700 words at a calm pace.
`[ ]` = placeholder still open. `[VERIFY]` = check against the original source before it goes on a slide.

---

## Slide 1: Hook (0:00 to 0:20)
**On screen:** "4 months of cash. Two customers asking for custom features. Decide by Friday."
Small, bottom: Axiom logo.

**Say:**
"Four months of cash. Two customers asking for features nobody else wants. You have to decide by Friday, and there's no one to ask. Every founder knows this week. We built Axiom for it."

---

## Slide 2: The problem (0:20 to 1:00)
**On screen:**
- "1 in 3 new startups now has a single founder." (17% in 2017, 35% in 2024. Carta)
- "Founders mentored by successful founders: 33% became top performers. Others: about 10%." (Endeavor Insight, NYC) [VERIFY]
- "Y Combinator: 260 companies from 27,000+ applications. Under 1%." (Winter 2024)
- [2 short quotes from our interviews, with role and stage]

**Say:**
"More founders build alone than ever. A third of new startups have one founder. We know guidance from founders who've been there works: in one study, mentored founders were three times as likely to become top performers. But that guidance is rare. The best-known accelerator takes less than one in a hundred.
We talked to [N] founders. [One line on what they told us, e.g. 'X of them said they make their hardest calls alone.'] One told us: '[quote].'"

---

## Slide 3: Why now (1:00 to 1:30)
**On screen:**
- "Advice is free now. Proof isn't."
- "53% of small business owners already ask AI for business advice." (Worldpay, UK)
- Line at the bottom: **"ChatGPT knows you. Axiom knows what founders like you did next."**

**Say:**
"Founders already ask AI. Over half of small business owners use it for advice. So advice is free and endless. What's missing is proof: what did founders in your exact spot actually do, and did it work? For the first time, AI makes it cheap to turn thousands of founder stories into that proof. That's the gap Axiom fills."

---

## Slide 4: Demo (1:30 to 3:00)
**On screen:** the 90-second recording, phone-sized, with the step name in the corner (Situation, Read, Learn, Move, Report).

**Say, over the recording:**
- Situation: "A founder types what's going on, in their own words. Axiom asks at most two questions."
- Read: "Then it tells them what's really going on, quoting their own words back. Not a summary, a read."
- Learn: "It teaches what they need now, from the books that cover it. Every lesson names the author and the book, and the quote is checked against the source text in code. No invented quotes."
- Move: "Then one move for today. The founder is the only one who has to act, it starts in ten minutes, and it either happens or it doesn't."
- Report: "That evening, Axiom asks how it went: Done, Couldn't, or Didn't. That answer is the most valuable thing in Axiom. It's what a founder actually did, and what happened."
- Close: "Every report makes the next founder's advice better. Real founder stories, shared with consent and reviewed by a person, come next."

Note: founder stories are not in Learn yet, so the demo must not show or imply them.

---

## Slide 5: Why not just use ChatGPT? (3:00 to 3:40)
**On screen:** table.

| | ChatGPT or Claude project | Coach or mentor | Accelerator | **Axiom** |
|---|---|---|---|---|
| Knows your situation | Yes | Yes | Partly | **Yes** |
| Lessons checked against the source | No | n/a | n/a | **Yes** |
| What founders like you did, and what happened | No | One person's experience | One cohort | **Every report adds one** |
| Turns it into one move today, then checks back | If you set it up | Yes | Weekly at best | **Built in** |
| Founder network | No | Their contacts | Yes | **Phase 2** |
| Access | $20 a month | Expensive, hard to find | Under 1% get in | **[$12] a month** |

**Say:**
"The fair question: why not prompt ChatGPT to do this? You can copy the format with a prompt. You can't copy the data. ChatGPT can know everything about you and still have no idea what ten other founders at your stage tried last month, and how it went. Every Axiom report adds to that. A prompt doesn't."

---

## Slide 6: Business model and market (3:40 to 4:20)
**On screen:**
- "[$12] a month for founders."
- "Under 2 cents of AI per situation. About 90% margin." (our live cost logs)
- "First market: US first-time founders, idea to pre-seed, especially solo."
- Market size: [N founders] x [$144] a year = [$X] [VERIFY, bottom-up]

**Say:**
"Founders pay [twelve] dollars a month. A full situation costs us under two cents in AI, so the margin is around ninety percent. We start with first-time founders in the US, at idea or pre-seed, especially the third who build alone. [One line of market size once verified.]"

---

## Slide 7: Where Axiom goes (4:20 to 4:45)
**On screen:** four steps left to right. Step 1 marked "Built". Steps 2 to 4 marked "Next".
1. **Learn by doing:** situation, read, learn, move, report. Real outcomes and founder stories. (Built)
2. **Founder network:** meet founders with the skills you're missing. Stories flow between founders.
3. **Founder agent:** connect your accounts. Axiom spots problems before you do. "At this burn rate, you're cash-negative by February."
4. **Company agent:** the same understanding, for your team and company.

**Say:**
"General AI agents do anything for anyone. We're building the agent for one job: being a founder. Each step runs on what the step before it learned. A general AI can't start at step two, because it never ran step one."

---

## Slide 8: Team (4:45 to 5:00)
**On screen:** names, roles, one line each. [ ]
Bottom line: "ChatGPT knows you. Axiom knows what founders like you did next."

**Say:**
"We're [names]. [One line on why us.] Axiom: built for the week every founder knows. Thank you."

---

# Appendix (for Q&A, not presented)

## A1: How we know the AI works
- Lessons: author and book come from the library record, and quotes must match the source text exactly, checked in code.
- The Read: every quoted phrase is checked to be the founder's own words.
- Moves: rules enforced in code (founder is the only one who acts, startable in 10 minutes, yes or no, max 2 open).
- Care: if a founder shows signs of distress, the journey stops, no lessons, no move, and Axiom points to real help.
- What we caught and fixed:
  - An independent test set for the care check found 9 bugs. All fixed.
  - A lesson cited Eric Ries without naming him, because "name the author" lived only in the prompt. Now checked in code.
  - The Read quoted our own form labels ("Based in") as if the founder said them. Fixed and tested.

## A2: Cost per founder (live logs, Nov 2026)
| Step | Avg cost per call |
|---|---|
| Read | $0.0041 |
| Learn (2 to 3 per situation) | $0.0026 |
| Move | $0.0017 |
| Follow-up questions | $0.0008 |
| Report | $0.0007 |
| One full situation | about $0.016 |
1 situation a day = about $0.47 a month. Hard limit of $1 a day per founder.
Sample: 6 situations from one founder (our own testing). Say so if asked.

## A3: Data laws in different countries
"We build to the strictest standard, GDPR level, everywhere, so we don't need a system per country. Sharing is opt-in and asked every time. Shared stories carry no link to the founder. Founders can export or delete all their data, and both already work. Only our server touches the database. Before each new country, a lawyer reviews it."
Open items (don't claim these are done): Privacy and Terms are drafts; data is stored in Singapore, so US and EU transfers need the right contracts; OpenAI data agreement; Gmail connector needs Google's security review.

## A4: Roadmap detail
- Now: learn-by-doing loop, book lessons with checked citations.
- Next: real founder stories in Learn (consented, reviewed), founder matching (double opt-in).
- Then: proactive, in three levels: from what Axiom already knows, from numbers the founder types in, from connected accounts (Stripe, Notion, calendar, CRM, then Gmail).
- Later: company agent.

## A5: Market sizing [ ]
Bottom-up: number of US first-time founders at idea or pre-seed x $144 a year. Source to find and verify.

---

# Q&A prep (3 minutes: keep answers to 20 seconds)

1. **"Why not just prompt ChatGPT?"**
   "You can copy the format. You can't copy what other founders did and how it went. That only exists because founders report back in Axiom."
2. **"Why pay [$12] on top of ChatGPT?"**
   "For what ChatGPT doesn't have: real founder outcomes and stories, and a system that turns advice into one move and checks back. [Pre-order numbers if we have them.]"
3. **"You have no users. What's your evidence?"**
   "The problem: [N] interviews plus the public data. The product: it works end to end, you just saw it. The demand: [waitlist and pre-order numbers from Monday]."
4. **"Where do founder stories come from, before you have users?"**
   "From our first founders, with consent, reviewed by a person before anyone sees them. Today Learn uses books only. We don't show anything we can't stand behind."
5. **"What if the AI gives bad advice?"**
   "Lessons come from named books, checked in code. Moves are small and testable in a day, so a bad one costs an evening, not the company. If someone's in distress, Axiom stops and points to real help."
6. **"Data laws in different countries?"** See A3.
7. **"How do you know the AI is working?"** See A1, then: "And the Report tells us. If moves keep coming back 'Couldn't', the advice is wrong, and we see it."
8. **"Why the US?"**
   "Most founders willing to pay for software, the solo founder data comes from there, and we reach them online where they already gather."
9. **"Want to see it live?"** Have the app open, server already awake. Ask a judge for a situation and run Situation and Read.

---

# Open placeholders
- [ ] Interview count, 2 quotes, one finding (from your other project)
- [ ] Price: $10, $12 or $15
- [ ] Market size, bottom-up, verified
- [ ] Team names, roles, "why us" line
- [ ] Waitlist and pre-order numbers (Wednesday)
- [ ] Demo situation (from your real run of the journey)
- [VERIFY] Endeavor 33% vs 10% (only secondary reports found)
- [VERIFY] Worldpay 53% (UK owners, via Financial IT)

Sources: Carta Solo Founders Report 2025 and Founder Ownership Report; YC Winter 2024 batch figures (Irish Examiner); Endeavor Insight NYC study (TechCrunch 2015, TechCabal 2015); Worldpay research (Financial IT); our model_usage_logs (read Nov 7 2026).
