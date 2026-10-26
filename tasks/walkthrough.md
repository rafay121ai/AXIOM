# Full walkthrough, 0 to 1 (mock-onboarding-v2.html)

Walked end to end in the browser by me: sign-in, the 13 questions (real taps), wait screen, first reading, situation, the Read, Learn with the move card, Commit and the reminder, the evening push, the Report with the story and sharing, home, the drawer, History and a past situation, Settings, and the care screen. No script errors on any screen. All copy scanned for the banned phrases and exclamation marks: none.

## Found and fixed during the walk
1. Wait line cut the quote mid-phrase ("so front…"). Now cut at a natural break.
2. First reading had a stray comma ("your first customer, in 3 months").
3. The sample founder story assumed a gender ("he", "his"). Now neutral ("they", "their"). Rule: never assume gender for anyone, anywhere.
4. After Commit and the reminder choice the app dead-ended in the chat. It now goes to the home screen, where the move waits.
5. The Report ended on a dead end. It now closes with Axiom's line and goes home, showing only the next step it named.

## Checked and fine
- Questions: auto-advance on taps, Continue only on written, multi-select and typed answers; no counter; max 5 options each.
- First reading: two underlines, no rating, ends pointing forward.
- Situation: box empty, suggestion above it, Axiom opens with one plain question, no echo.
- Read: plain headline, no underlines, no Continue, ends with one real question, reply or skip.
- Learn: closing question, tappable picture, move card only after two real replies (or when they ask what to do), at most two cards, second one urgent with the name.
- Report: centred opening, three small marks, nothing sent as a message, story offered before the sharing ask, nothing pre-selected.
- Home: greeting with the name inside, items fade after about 8 seconds, drawer lists What's open, History, Paused and Settings.
- Care: only clear signs or explicit words; slang gets a reply from context or a soft question.

## Not designed yet (gaps I found; these matter before building)
1. **Loading.** What the founder sees while Axiom is thinking (after a reply, while the Read is written, while a lesson loads). Needs a quiet "thinking" state in the voice, not a spinner.
2. **Errors and offline.** The AI fails, the network drops, a reply is slow. What does Axiom say, and can the founder retry without losing what they typed?
3. **Lesson fallback.** If the citation check removes a quote or finds fewer than 2 verifiable lessons, the screen needs a plain, honest degraded state (no invented sources).
4. **Push permission denied.** If they say no to reminders, how does the Report still reach them (home items, the drawer)?
5. **Sign-in problems.** Google sign-in fails or is cancelled.
6. **Interrupted sign-up.** Someone quits at question 7 and comes back: resume where they stopped (the mock only describes it).
7. **Small screens still missing:** "What Axiom knows about you" (edit sign-up answers), Privacy, Terms, the delete-everything confirm in full, "change this move once" outcome.
8. **Move swap and the second active move** (max 2 active) have no screen yet.

## Parked, unchanged
Sign-in line (Rafay will provide), proactive Axiom and connected accounts, Seafoam colour rotation (the mock stays Gold throughout).
