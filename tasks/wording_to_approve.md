# Wording to approve (draft, not committed)

Checked against tasks/voice.md, PRODUCT.md voice, CLAUDE.md, tasks/lessons.md and the mocks (onboarding-v2, states-v1, loading-v1, report-buttons, plus minimal-v5 for Learn). "Mock" means the exact text is in an approved mock.

## A. Violations or likely violations
**APPLIED 2026-10-31 (approved by Rafay):** every suggested fix in this table, except the home greeting joke, which stays. The old web app's two knowledge/experiment rate-limit lines were left alone. The care-line fix also updated the approved mock (tasks/design/mock-onboarding-v2.html) so the drift test still guards it.
| Where | Text | Rule | Suggested fix |
|---|---|---|---|
| app/src/onboarding/waitLines.ts:17 | "Every founder has one thing they keep circling. Finding yours." | Metaphor ("circling"); true of any founder, so not specific. (In the mock, but breaks plain/specific rules.) | "Finding the one thing you keep putting off." |
| waitLines.ts:18 | "Looking for the gap between what you said and what you did." | Abstract. (In the mock.) | "Comparing what you said you would do with what you did." |
| server/journey/home/wording.js:14 (and app/src/api/fake.ts:241) | "{days} days to {goal}, {name}. No pressure. Some pressure. What's the move?" | Clever contrast. Allowed only as a greeting joke; uses "move" as a word. (In the mock.) | Keep only if Rafay wants it. Plain: "{days} days to {goal}, {name}. What's the move today?" |
| server/journey/home/wording.js:58-59 ACCOUNT_COPY | "I have your request. Your export is queued." / "I have your request. Nothing has been deleted. Deleting everything Axiom knows about you needs a plan I have not finished, and I will not guess with your history." | Generic hand-off ("I have your request"); internal/abstract; no next step. | "Your export is on its way." / "Nothing has been deleted yet. This is not ready. I will tell you when it is." |
| server/journey/report/wording.js:32 | "That is fine, things changed. ..." (Couldn't reply) | Assumes a cause the founder did not give; "fine" is filler. | "{move line} What is the smallest part of it you could still do?" |
| wording.js:33 | "That happens. ..." (Didn't reply) | Filler remark. | Drop "That happens." |
| server/care/copy.js:15 | "I'm an assistant, not a counsellor. But I'm here if you want to keep talking." | "not X, but Y" contrast. (In the mock.) | "I'm an assistant, not a counsellor. I'm here if you want to keep talking." |
| app/src/copy.ts:63 | Report screen title "Report" | Internal term as a label. (Mock has it.) | "Tonight's check-in" or "How it went" |
| server/push/compose.js:42 | "did you get to your move?" | Internal term in a push; the full line names the real subject. | "did you get to it?" |
| app/src/copy.ts:53 and :126 vs :124 | Lock note says Short is "Axiom: tonight's check-in" but the real short push is "{name}, how did it go?" | Text promises something different from what is sent. | Make the note match the push, or the push match the note. |
| server/journey/move/moveRoutes.js:17, learn/learnRoutes.js:31, routes.js:18, situationRoutes.js:13 | "Too many requests, please slow down." | Customer-service tone ("please"). Only shown if the app prints it. | "That is too many at once. Wait a minute." |
| moveRoutes.js:31, learnRoutes.js:45 | "Something went wrong. Try again." | Generic. App replaces it with its own error line, so only a problem if shown. | Make sure the app never prints server error text. |
| learn.js:175 | "Answer or skip the question on the Read first." | Internal term "Read". | "Answer or skip the question first." |
| moveService.js:230, 250, 265 | "This move can no longer be committed / changed." | Internal term "committed". | "You already started this move." |
No exclamation marks, emoji, swearing, forbidden phrases, gendered words, "That's right / Not quite", pre-filled chat box or sign-up question count found in the founder-facing strings. Loading hint shows book only (LoadingHint.tsx, loadingHint.js).

## B. New wording needing approval (not in any mock or the voice guide)
### app/src/copy.ts
| Line | Text |
|---|---|
| 26-27 | "Before", "After" (bars picture row labels) |
| 56 | "You have 2 moves open. Tell me how one of them went first, then I will give you the next." |
| 58 | "You have changed this move once already." |
| 87 | "No title yet" |
| 89 | "I couldn't open that just now." |
| 150-155 | "Quiet hours", "From", "Until", "Export my data", "Done" (sign-up answers button), "I couldn't save that just now." |
| 164 | "I couldn't answer that just now." (Read, no saved message) |
| 166 | "That is the limit for new situations today. Pick one that is still open." |
| 12, 14-17 | "Use what you wrote earlier" etc. are in mock-onboarding-v2: no approval needed |
| History 97-102 | Labels "What I read", "What you learned", "Your move", "How it went", "Shared without your name", "Kept private" are in mock-onboarding-v2 (what-you-learned and "Your move" not found word for word; please confirm) |

### app/src/screens, components
| File:line | Text |
|---|---|
| QuestionBody.tsx:23 | Placeholder "In a few words" |
| ReadingScreen.tsx:54 | Button "Continue" (also QuestionsScreen.tsx:117 "Continue"/"Done") |
| LoadingHint.tsx:53 | Screen-reader label "Axiom is answering" |
| SignInScreen.tsx:20 | Legal line is in the mock; no approval needed |

### server/journey/home/wording.js
| Line | Text |
|---|---|
| 15 | "Morning, {name}. What's the move?" |
| 16 | "{hour} am, {name}. What's the move today?" |
| 40-41 | "Pick up: {title}", "Pick up where you left off" |
| 51-53 | "Pick it up" (the other two history actions are in the mock) |
| 58-59 | Both ACCOUNT_COPY lines (see A) |
| 67-73 | Deletion plan list: "Your situations, Reads and lessons", "Your moves and your reports", "What Axiom remembers about you", "Your sign-up answers and settings", "Your reminders and devices", "Outcomes you shared hold no name. The private link between you and them would be removed." |
Draft lines (early:b, midday:b, evening:b, late:b) are shortened mock lines marked "earlier approved short set": confirm.

### server/journey/report/wording.js
| Line | Text |
|---|---|
| 11 | "What happened when you did it?" |
| 24-25 | "Your move was to {move}. I said {prediction}. What happened?" (from PRODUCT.md, not a mock) |
| 31-33 | The three fallback replies (see A) |
| 53 | "Taken down. Nothing from this check-in is shared." |
| 38 | STORY_OFFER is marked mock; wording not found exactly in mock-onboarding-v2 ("Yes, show me" / "Not now" buttons are): confirm |

### server/care/copy.js
| Line | Text |
|---|---|
| 28 | "How are you doing today?" (return after a care event; code says not approved) |
| whole file | Header says DRAFT, needs review by a person with a mental-health background before launch. server/care/help.js has PLACEHOLDER crisis lines (contact: null), unverified |

### server/push/compose.js (all "new" except the first)
| Line | Text |
|---|---|
| 34 | mock: "{name}, how did {subject} go?" |
| 35 | "{title}. How did it go, {name}?" |
| 36 | "{name}, how did it go?" |
| 40-42 | "{name}, did you get to {subject}?" / "{title}. Did you get to it, {name}?" / "{name}, did you get to your move?" |
| 45-46 | "Morning, {name}. Today: {title}." / "Morning, {name}. Your move for today is waiting." |
| 49-50 | "{name}, where are you with {situation title}?" / "{name}, where are you with what we talked about?" |

### server/journey/learn/moveOffer.js
| Line | Text |
|---|---|
| 60 | "Your move for {subject} is ready." / "Your move is ready." (first one is mock with "the two clinics") |
| 63-64 | "Still waiting", "It takes 10 minutes, {name}. {fact}" (mock uses an urgent line; the exact template is new) |
| 74-75 | "Here is your move." and "Your move is waiting for you on the home screen." (both in mock) |

### Server error text that could reach a founder (new, unapproved)
"Sign-up is not finished", "Failed to build the first reading", "Finish sign-up first.", "The move is not ready yet.", "This move is still being changed. Try again in a moment.", "This turn is still being processed. Try again in a moment.", "The lesson has not started yet.", "Not found", "Service not configured".

### Fixtures that could ship (app/src/api/fake.ts)
Sample headlines and notes at lines 42, 79, 187-206 ("You are afraid a price will end the conversation." etc.), author/book pairs (Rob Fitzpatrick, Alex Hormozi, Eric Ries, Chris Voss: unverified in the library here). Must stay behind the fake-API switch and be labelled Sample if ever shown.

## C. Internal terms shown to founders (lessons.md: labels say what to DO)
- "Report" as the screen title (copy.ts:63). Fix: "Tonight's check-in".
- "Your move", "The mission", "Commit to this move", "Change this move" (copy.ts:31-39): in the Move mock, but "move" and "Commit" are our terms. "Your move" is the agreed kicker; "Commit to this move" could be "Start this move".
- "What I read" / "Reads" (history, deletion plan): "Read" is internal. Use "What I found".
- "situations" (copy.ts:94, 144, 166; wording.js:67): internal. Use "what you brought me" / "your topics".
- "check-ins" is used for Report in Settings and pushes, "Report" on the screen. Pick one name.
- Home item labels are fine ("Today: ...", "Tell me how it went").

## UNSURE ABOUT
- Whether mock-only lines that break the plain rule (wait lines, "No pressure. Some pressure.") stay because Rafay approved the mock, or get rewritten.
- LLM-written text (Read, Learn, Report replies) not checked line by line, only the fixed lines in prompts. Prompt examples are plain and in voice.

## C. Added in the final review (Oct 31)
| Where | Text | Note |
|---|---|---|
| app/src/copy.ts history.takeDown | "Take it down" | Link on a past page to take a share back. The mock styles the link (.withdraw) but shows no words. |
| app/src/copy.ts:181 | "This move can no longer be changed." | Not in a mock. Section A suggests "You already started this move." |
| server/journey/situations.js:224 | "You have started 5 situations today... Pick one of the open ones." | Server text, not approved. The app shows its own copy.dailyLimit, so founders should not see this; listed so it is not missed. |

## D. Give to get: founder lessons closed (Oct 31)
| Where | Text | Note |
|---|---|---|
| server/journey/report/wording.js FOUNDER_LESSONS_CLOSED_TEXT (founder-lessons-closed-v1) | "I would like to keep showing you what worked for founders a step ahead of you. Share one of your check-ins, or turn on "Share with other founders" in Settings, and they open straight away." (v2, approved by Rafay 2026-10-31 as a short invitation) | New. Said once, in place of the third founder lesson, only when an approved story fits. The Settings switch name matches the mock. |

## E. Calm / Direct / Hard: the three style instructions (Oct 31)
They shape every Read, Learn reply, Move and Report reply, so please read them. Direct adds nothing (it is the voice already in every prompt). Defined once in server/journey/prompts/style.js. Flag: "Hard" must not collide with voice.md "never confrontational": it says hard on the situation, never on the person, never cruel, shaming or cold. Is that enough, or should "pushing" be softer? The first reading at sign-up is not styled (no setting exists yet).
| Style | Instruction sent to the model |
|---|---|
| Direct | (none: today's voice) |
| Calm | "Style: calm. Gentler in pace and framing: a little more room, softer openings. Still specific, still name the real problem plainly, never vague, never flattering. Tone only: every other rule above stays exactly as it is." |
| Hard | "Style: hard. Blunter and more pushing: shorter sentences, fewer softeners, get to the point first. Hard on the situation, never on the person: never cruel, never shaming, never cold. Tone only: every other rule above stays exactly as it is." |

## F. Account export and delete (Oct 31)
All in server/journey/home/wording.js ACCOUNT_COPY. The app shows server text only. {date} is the deletion day written out, for example "7 November 2026". The "care" versions are used when a care check is open: shorter, nothing added.
| Where | Text | Note |
|---|---|---|
| exportReady | "Here is everything Axiom holds about you. It is yours to keep." | First field of the export file. |
| exportTooLarge | "Your history is too big to send in one file. I have not sent a partial copy." | Over 10 MB. |
| confirmNeeded | "To delete everything, type DELETE to confirm." | Shown when the typed word is missing or wrong. |
| deletePending | "Done. On {date} I will delete everything Axiom holds about you. Until then you can cancel and nothing changes. After that it cannot be undone." | Delete switch on. |
| deletePendingCare | "Your request is in. On {date} everything will be deleted. Until then you can change your mind." | Same, care open. |
| deleteWaiting | "Your deletion is waiting. On {date} I will delete everything Axiom holds about you. Until then you can cancel and nothing changes. After that it cannot be undone." | Sent in Settings as `pending_deletion.message` when a deletion is waiting, so it shows after the app was closed. |
| deleteCancelled | "Cancelled. Nothing was deleted. Everything is still here." | |
| deleteNothingToCancel | "There is no deletion waiting." | |
| deleteRecorded | "I have your request. Nothing has been deleted. Deleting everything Axiom knows about you is not switched on yet, and I will not guess with your history." | Delete switch off (replaces the older "plan I have not finished" line). |
| deleteRecordedCare | "I have your request. Nothing has been deleted yet." | Same, care open. |
| DELETION_PLAN.shared_outcomes | "Outcomes you shared hold no name. Stories already published stay, with nothing that links them to you. Anything still waiting for review is removed." | Shown with the recorded answer. Depends on the shared-outcomes decision in supabase/DELETION_PLAN.md. |
There is no "deleted" sentence: once deletion runs, the sign-in account is gone and nobody is left to read it.
