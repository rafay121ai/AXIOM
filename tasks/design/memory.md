# What Axiom thinks: notes for the app builder

Prototype: `tasks/design/memory.html` (sample data, labelled "Sample"). Tokens, fonts, header, drawer and wash are copied from `mock-onboarding-v2.html`. Nothing new in colour, font or pattern, with one exception to approve (the grid drawing in, below).

## What it is
A private page where the founder sees what Axiom has learned, sees why (a receipt), and can remove any line. Removal is permanent: the item disappears and is never rebuilt (`founder_corrections`). No scores, no percentages, no personality labels, no "Says they". Every line is a plain sentence to the founder in the second person.

## Layout, top to bottom
1. Wash (existing `Wash`), the construction grid behind it, `PageHeader` with the title.
2. Summary line, serif 22, with the number counting up.
3. One quiet line under it (sans 13, ink .5).
4. Sections in this order, each with a thin gold 16px mark, a 10px caps label, then its lines. A section with no lines is not shown.
5. Each line is a row (serif 17 / 25). Tap opens its receipt beneath it. Receipt: a gold hairline draws across, label, the founder's words or the move, the date, then the two text actions.
6. Empty state: one centred serif line, nothing else (no summary, no hint line).

### Sections (group key, label, what goes in it)
| group | label | holds |
|---|---|---|
| `decide` | How you decide | the six closed-list traits (`founder_traits`): speed, what you trust, after a setback, move size, detail, follow-through |
| `work` | How you work | patterns and communication preferences (`founder_beliefs` kind `pattern` / `preference`) |
| `business` | Your business | facts (`founder_beliefs` kind `fact`) |
| `people` | People and words | `founder_world` and `founder_vocabulary` |
| `open` | Still open | `founder_threads` with status `open` |

Within a section: newest receipt first.

## Copy (every new string)
All are NEW and need Rafay's approval. Nothing here reuses an existing string except "Back" (`copy.history.back`) and "Try again" (`copy.tryAgain`).

| Where | String |
|---|---|
| Screen title and menu row | What Axiom thinks |
| Summary (n = 1) | Axiom has learned 1 thing about you and your work. |
| Summary (n > 1) | Axiom has learned {n} things about you and your work. |
| Line under the summary | Tap a line to see where it comes from. If it is wrong or out of date, mark it and Axiom stops using it. |
| Section labels | How you decide / How you work / Your business / People and words / Still open |
| Receipt label | Where this comes from |
| Receipt, no stored source | Axiom has no note of where this came from. |
| Action 1 | Wrong |
| Action 2 | Outdated |
| Action spoken labels | Mark as wrong: {line text} / Mark as outdated: {line text} |
| Confirmation (same for both) | Removed. Axiom will not use it again. |
| Empty state | Axiom hasn't learned anything about you yet. |
| Load failure | reuse `failureLine(e, 'read')` and the existing `TextAction` "Try again" |

Receipt text itself comes from the server, not from copy: the founder's own words in quotation marks, or `Your move: {title}` for a move. Dates: day and short month ("3 Nov"), with the year only when it is not this year.

Sample item lines (voice check, all second person, plain): "You decide fast and adjust later." "You look at the numbers before you decide." "When something fails, you change the approach straight away." "You finish small moves the same day. Moves over an hour wait." The real lines are built by code from the closed trait list, never by the model.

## Mapping to existing components
| Part | Use |
|---|---|
| Background | `Wash` (non-corner) |
| Grid | `Construction`, plus a small new `draw` option (see motion). This is the one pattern outside DESIGN.md, which lists the grid for journey screens only. NEW, needs approval. |
| Header | `PageHeader` (back arrow + serif title). Right side stays empty in the app (the "Sample" mark is mock only). |
| Summary and entrance | `Fade` (delay, duration 1000) |
| Row | Same shape as the History row (`HistoryScreen` `styles.row`) with a serif title and the `›` that turns to `v` when open. Not `Choice` Row: that is the sign-up glass row with depth. |
| Section label and hairline | The `Section` pattern in `HomeDrawer` (10px caps label, 1px line at ink .14). Add the 16px mark. |
| Receipt actions | `TextAction` size 14 (44px target, thin underline on hover and press) |
| Confirmation | a floating line, so glass: `GlassFill` in a small `View`, radius 16 |
| Empty and failure text | plain `Text` as in `HistoryScreen` `none` |
| Menu entry | new row in `HomeDrawer`, in its own unlabeled section above the Settings foot. Not a `MenuRow` of a situation. |
| Not used | `PickerChip`, `Step` (that is the `MenuMark` step type), `GoldButton`, `GoldDot` (no "something to do" here) |

Open question: Settings already has "What Axiom knows about you" (the sign-up answers, `settings.knowsSub`). Two near-identical titles will confuse. Either rename that Settings row or keep this title and accept it. Rafay to decide.

## Motion
All values reuse the mock/`theme.motion` where one exists.

| What | Spec |
|---|---|
| Grid draws in | vertical lines reveal top to bottom 1400 ms, horizontal lines left to right 1400 ms (150 ms later), points fade in over 1200 ms (from 800 ms). Easing `cubic-bezier(.3,.6,.2,1)`. Then the normal still grid with the 60 s drift (`DRIFT_MS`). Starts on mount, so it plays while data loads; no spinner. In RN: animate a mask or a clip width/height over the existing SVG lines. |
| Summary and hint | `Fade`, duration 1000, delays 300 and 500 ms |
| Number count up | 0 to n over 900 ms, ease out cubic, starts at 300 ms. On a removal it ticks down over 400 ms. Tabular figures. The full sentence is in the accessibility label, not the animating digits. |
| Section hairline | scale 0 to 1 from the left, 900 ms, `cubic-bezier(.2,.8,.2,1)` (the drawer easing), starts 260 ms before its first line |
| Lines enter | `Fade` 1000 ms, blur clearing, staggered 95 ms per line across the whole screen, first at 900 ms (so about 2 s for ten lines) |
| Receipt open | height 0 to content 450 ms drawer easing; gold hairline draws across 600 ms from 100 ms; content fades in 350 ms from 250 ms; `›` turns 90 degrees in 350 ms. One receipt open at a time. Scroll the row into view after 300 ms. |
| Remove | the sentence dissolves one rendered line at a time: each line 600 ms to opacity 0, blur 6, up 3px, lines 170 ms apart; the receipt fades 300 ms. Then the row's height, padding and opacity close in 550 ms (drawer easing) so the list below slides up. If it was the last line of a section, the whole section (label and hairline) closes instead. Count ticks down. Confirmation fades in 300 ms, stays 2600 ms. In RN, split by `onTextLayout` lines. |
| Empty | line fades in 1000 ms, delay 400 ms |
| Reduce motion (`useReduceMotion`) | no grid drawing, no drift, no blur, no count up, no dissolve. Everything is simply there; a removed row is gone at once; the confirmation still appears. |

## Behaviour
- Wrong and Outdated do the same thing for the founder (gone for good). The reason is stored (`founder_corrections.reason`). There is no undo and no "Are you sure?": the actions only appear after a deliberate open. Rafay to confirm.
- Focus after a removal moves to the next line (else the previous, else the back arrow via `PageHeader`'s optional `backRef`), so keyboard and VoiceOver users do not lose their place.
- Reached from the menu only. Back returns to the home with the menu open (same as other pages).
- Items whose receipt is `null` still show, with the "no stored source" line.

## Accessibility
- Each row is a button: role button, `accessibilityState.expanded`, label is the sentence. The receipt is not focusable while closed.
- Actions have spoken labels that include the sentence ("Mark as wrong: You decide fast and adjust later.").
- The page title is a header. Section labels are headings (level 2) and each section is a labelled group.
- The confirmation is one persistent polite live region that stays mounted and changes its text (`accessibilityLiveRegion="polite"` on Android and web, plus `AccessibilityInfo.announceForAccessibility` on iOS).
- Targets are 44px or higher. Text scales with system size: rows grow, nothing is clipped (the dissolve measures real lines).
- Contrast: lines at .92, receipt text at .7, date and labels at .5 (not the only place a fact appears).

## Data shape (proposal, backend to match)
```
GET /api/memory
-> { items: [{
     id: string,
     table: 'founder_beliefs' | 'founder_traits' | 'founder_world' | 'founder_vocabulary' | 'founder_threads',
     group: 'decide' | 'work' | 'business' | 'people' | 'open',
     text: string,                       // built by code, second person, no "Says they"
     receipt: { text: string, at: string /* ISO date */ } | null
   }] }

POST /api/memory/:table/:id/wrong
body: { reason: 'wrong' | 'outdated' }
-> { ok: true }
```
Server rules this design relies on: only `status = 'active'` rows; only the signed-in founder's rows; the returned `text` never contains a score, a confidence or a personality label; after the POST the row is superseded, a `founder_corrections` row is written, and the extractor is told not to recreate it. The app does not write anything itself (CLAUDE.md: all writes go through the Express API). The list is not paged (the brief caps at about 900 characters, the stored set stays small).

## Rules to check with Rafay
- PRODUCT.md says "No rating, ever... If a founder had to mark it wrong, that could end the app on the spot", and DESIGN.md forbids a "That's right / Not quite" control. That was about the Read. This is a separate, optional page, and the control is a removal, not a rating of Axiom. Please confirm it is allowed.
- PRODUCT.md says Axiom never announces that it remembers. This screen is opened by the founder, never pushed, and shown nowhere else.
