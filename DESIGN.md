# Axiom: Design Document

Rewritten October 2026 to match the approved screens
(`tasks/design/mock-onboarding-v2.html`, `mock-loading-v1.html`,
`mock-states-v1.html`, `mock-report-buttons.html`) and `tasks/decisions.md`.
The previous version described the old product (3D brain, warnings, gold-heavy
glass) and is in git history. Nothing from it applies.

## Design Philosophy
Minimal, low-key, premium. Reference feel: Apple and Superhuman. Phone first.
Dark and quiet. Calm and editorial, with a serif for Axiom's words.

Four rules decide everything:
1. **One thing per screen.** The screen has one job and shows only that.
2. **Quiet over loud.** No spinners, no dots, no big blocks, no badges, no
   streaks, no scores. If it can be a thin line or a word, it is.
3. **Axiom is the voice, the interface is the room.** Axiom's words are in a
   serif. Everything the founder does is in a clean sans.
4. **Plain words on every label.** Say what to do, not our internal names.

---

## Colour
| Role | Value |
|------|-------|
| Base | `#050505`, near black |
| Writing | `rgb(234,236,238)`, a bright mix of white and stone. Lower levels by opacity: 0.9 body, 0.7 secondary, 0.5 labels, 0.35 hints |
| Highlight (Gold) | gradient from `rgb(205,178,126)` to `rgb(168,142,94)`. Used for the key mark, ticks, the Continue and Send buttons, thin underlines, small dots |
| Wash | a very faint, smooth gold gradient behind the black: strongest at the bottom (about 20 to 26%), a whisper at the top (about 8 to 10%). Never blobs on the home, drawer, settings or history |
| Construction grid | on the journey screens (situation, Read, Learn, move, report), a faint gold 32px grid of 1px lines at 3.5% with a small point at every fourth crossing, fading out at the top and bottom, drifting one cell over 60 seconds (still when the phone asks for reduced motion). Gives the glass something to blur. The grid is also used on the "What Axiom thinks" screen, where it draws in (the `draw` option on `Construction`); approved by Rafay (Nov 14 2026). The sign-up page has none: black, a warm glow rising from the bottom and a very faint gold spider web behind the emblem |
| Delete | a muted red `rgb(222,160,150)`, only for "delete everything" |

Parked: rotating a new highlight per situation (Seafoam `#7FBFAA`, Periwinkle
`#8EA0DD`, Rose `#D49A9F`). For now the whole app is Gold.

The care screen has **no wash, no glow, no gradient**.

---

## Typography
- **Axiom's words:** a serif. `ui-serif, "New York", "Iowan Old Style",
  "Palatino Linotype", Georgia`. On devices without a good serif, load one
  free serif so it looks the same everywhere.
- **Everything the founder does:** the system sans (`-apple-system, SF Pro
  Text, Inter`).
- Sizes (phone, 390 wide): sign-up question 27, home greeting 28, Read
  headline 25, lesson and Read body 18.5 to 19.5, chat message 17, founder
  message 14.5 (small, quiet, right aligned), option rows 16, labels in small
  caps 10 with wide spacing, loading quote 12.5.
- **Emphasis is a thin underline in the highlight colour, at most 2 phrases in
  a block. Never colour or gradient the letters themselves.**
- No all caps for sentences. Never shout.

---

## Surfaces and lines
- **Thin lines divide things.** Lists (History, drawer, Settings) are plain
  rows separated by 1px lines at about 14% writing colour. No boxes around
  rows.
- **Glass only where something floats:** the chat bar, the push banner, the
  move card in the chat, and the choice rows and chips on the sign-up screens.
  Glass is frosted (blur about 24 to 42px, a bright top edge) with a faint
  tint.
- Sign-up choice rows and chips have a little depth (lit top edge, darker
  underside, soft shadow) and lift on hover. **Chat screens do not use depth.**
- Sheets (the Move) are solid, not see-through.

---

## Buttons, choices and controls
- **Sign-up single choices:** tap and it moves on by itself, no Continue.
  Continue appears only for written answers, multi-select, typed answers and a
  chosen date. Continue is a gold gradient with a soft bevel.
- **Report choices:** small round marks (38px), thin outline, with a short
  label. Done is a tick, Couldn't is a pause, Didn't is a dash. The pressed one
  fills gold and the others dim. The same marks are used for Yes / Not now
  (tick, pause) and Share / Keep private (tick, lock).
- **Tapping a choice never posts it as a message** from the founder.
- **Text actions** ("Try again", "Skip this question", "Keep talking") are
  plain text with a thin underline. No outlined pills in chat screens.
- **Switches** are small and quiet, gold when on.
- **Mentor style** (Calm / Direct / Hard) and the lock-screen choice are
  words with a thin gold line under the chosen one.
- **Tap targets** at least 44px high.

---

## Layout
- Phone first. On a computer, a centred phone-width column, the same on every
  device.
- Sign-up: no more than 5 options per question, one question per screen, no
  scrolling, no question counter, only a thin progress line and a back arrow.
- Chat: Axiom on the left in serif, the founder on the right in small plain
  text, no bubbles. A floating glass chat bar at the bottom, with a gold send
  button. A suggestion (never pre-filled text) may sit above an empty bar.
- Centre the one thing when a screen is mostly empty (the Report opening, the
  first reading wait, the care screen, the home greeting).
- **Home:** the greeting in serif in the middle, the chat bar at the bottom,
  at most 2 small items above the bar (gold dot plus plain words) that fade
  after about 8 seconds and stay while touched. The menu button top left.
- **Menu button:** the emblem as one thin soft-white line (no gold), top left on
  Home, Situation, Read and Learn. On Home it opens the drawer; on the others it
  goes home with the drawer open, and the situation stays open (Rafay, Nov 2).
- **Drawer:** slides in from the left, about 84% wide, pushing the home aside.
  Sections divided by thin lines: Start something new, What's open, History,
  Paused, and the founder's name with Settings. No day headings.
- **Move:** a solid sheet that slides up over the chat. Mission, what success
  looks like, the words to use, a checklist, Axiom's prediction, Commit, and a
  quiet "Change this move".
- **Move card in the chat:** a small glass card with the emblem, a short label
  ("Your move" / "Still waiting") and one plain line. The whole card is
  tappable. No buttons. At most two per situation.
- **Report:** the question and three marks centred; when one is pressed the
  question rises to the top and Axiom continues below. No Continue.
- **Founder story:** a thin card labelled with the founder's stage; sample
  stories carry a visible **Sample** label (prototypes only).

---

## Pictures in lessons
A fixed library of five types (split bar, before and after bars, side by side
table, timeline, 2x2 box). At most one per reply. Premium and interactive but
quiet: one highlight colour, thin lines, small type, a meter or checklist the
founder can tap. Every number is the founder's, calculated by our code, or from
a verified passage. No forecasts. No decoration.

---

## Motion
- Screen change: the old content fades and slides out (about 0.25 to 0.3
  seconds), the new slides in.
- Sentences of the first reading, the Read and the greeting fade in one at a
  time with a soft blur clearing (about 1 second).
- Questions on sign-up slide sideways when you move on.
- Hover (computer only): rows, chips and the sign-in button lift 3 to 4px with
  a deeper shadow. Press sinks them.
- **Logo drawing:** the emblem draws itself in gold and glows softly, looping
  (3.6 to 4.2 seconds). Used on the wait screen and the loading hint.
- **Sign-up film (about 8 seconds, every open until sign-up):** a point of light at the emblem's tip stretches into a thin gold streak and collapses back; the emblem draws itself outward from its tip with a bright point at each end; a very faint spider web spreads behind it; the emblem glows, a band of light crosses it, and it settles a little higher and smaller; "SEE. LEARN. BECOME." arrives beneath it one word at a time, out of a slight blur; the Google button rises in last and one soft shine crosses it. Fine film grain over everything. Restrained, never playful (no particles, no full-screen words). Drawn with Skia; timings in `app/src/intro/timeline.ts`; approved prototype `tasks/design/intro-v3.html`. A tap skips to the end; reduce motion shows the end at once.
- **Loading hint:** see below.
- Respect "reduce motion": no drifting light, no sweeps, no drawing; show the
  logo still.

### Loading hint (replaces any spinner)
Where Axiom's answer will appear: a small logo (24px) drawing itself, one real
verified quote at about 12.5px under a soft moving light with the book name
under it (no author on this screen), and two very thin faint answer lines
shimmering in time. When the answer arrives the lines and quote fade and the
answer's words fill in one by one in the same place. No "your message is
saved" line. If no verified quote fits, only the logo and the lines show.
Long waits swap the quote every 5 seconds. Quotes are word for word from the
library, shown with "…" when the original starts mid-sentence.

### In-between states
- Error: Axiom's plain line ("I couldn't answer that just now. Your message is
  saved.") and a quiet "Try again". No "sorry".
- No connection: **no separate notice.** The chat bar's hint becomes "No
  connection. Your messages are saved." with a small gold dot; unsent messages
  show a tiny "Waiting to send".
- No verified source: nothing is shown or said.
- Reminders refused: one card line after Commit, one quiet row in Settings.

---

## Screens, in order
1. **Sign-in:** the emblem only (no wordmark), a brighter short line (not yet
   written), a glass "Continue with Google", one quiet privacy line.
2. **13 questions:** as above, gold progress line.
3. **Wait:** the logo drawing and lines made for founders, the first quoting
   their own words. No dots.
4. **First reading:** small emblem on top, about 5 sentences appearing one at a
   time, at most 2 underlined phrases, Continue appears after the last.
5. **Situation:** the emblem, Axiom's one plain question, an empty chat bar
   with the earlier answer as a one-tap suggestion above it.
6. **Read:** headline in larger serif, short sentences, one closing question
   set apart by a hairline, a reply bar, "Skip this question", "Something else
   on my mind".
7. **Learn:** a chat with the lesson, source line (author and book), an
   interactive picture when it helps, one closing question; the move card
   appears in the chat after two real replies or when asked.
8. **Move sheet** and **Commit**, then "Want a reminder tonight?".
9. **Report:** see Layout.
10. **Home, drawer, History, past situation, Settings.**
11. **Care:** calm, no glow, one human message, real help, a quiet way to keep
    talking. Dashed placeholders in mocks stand for numbers a person must
    verify.

---

## Accessibility
- Text contrast on black at least AA. Hints at 0.35 are decoration only, never
  the only place a fact appears.
- Tap targets 44px. Everything reachable with a screen reader; the marks have
  text labels.
- The fading home items stay while touched, can be kept on screen in Settings,
  and stay by default if reminders are refused.
- Text scales with the system text size.

## Not allowed
Coloured or gradient letters, big button blocks in chats, outlined pills in
chat screens, spinners or dots, scores, streaks, badges, red warning styling
(except delete), boxes around list rows, a count of questions, anything that
makes the founder look like they are begging, a pre-filled chat box, a
"That's right / Not quite" control.
