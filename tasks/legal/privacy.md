# Axiom Privacy Policy

DRAFT. Not in force. Last updated: [DATE].

---

## For Rafay (delete this section before publishing)

This is a draft from a standard template, checked against the code on the
`journey` branch on 3 November 2026. It is not legal advice. A lawyer should
read it before it goes live, and again before each app store submission.

Decisions you must make:
1. **Who runs Axiom.** Fill in [OPERATOR LEGAL NAME], [ADDRESS], [COUNTRY],
   [CONTACT EMAIL]. If you register a company, the company is the operator.
2. **Minimum age.** Drafted as 18+. [DECIDE] 16+ is possible in some
   countries but adds parental-consent rules.
3. **Account deletion must be switched on before launch.** Today
   `ACCOUNT_DELETE` is off: a delete request is only recorded and nothing is
   removed. Apple and Google both require in-app deletion that really deletes.
   This policy describes the switched-on behaviour (7-day grace period).
4. **Published stories after deletion.** The code keeps an approved,
   published story (anonymised) after the founder deletes their account, and
   removes the private link, so it can no longer be taken down. Section 7
   says so. If you choose to remove published stories too, change the code
   and this section together.
5. **Backups.** How long Supabase backups keep deleted data on your plan.
   [CHECK Supabase plan backup retention] and fill in [BACKUP DAYS].
6. **Retention while the account is open.** Nothing in the code deletes old
   rows on a timer. The draft says "kept until you delete your account". If
   you want limits (for example cost logs after 12 months), they need code.
7. **Old web app.** If the Vercel web app is still live for anyone, add
   Vercel as a processor. [CHECK]
8. **Who reviews shared stories.** Drafted as "a person at Axiom" (you, per
   PRODUCT.md). If anyone else ever reviews, name the role.

A lawyer should check:
- The legal bases in section 4 (GDPR), and whether you need an EU/UK
  representative (Art. 27) given you serve founders worldwide.
- OpenAI API data terms: retention, training, and where it processes data.
  [CHECK OpenAI API data terms]. Also whether a Data Processing Addendum is
  signed with OpenAI, Supabase, Render.
- International transfer wording (section 10): Standard Contractual Clauses
  with each processor.
- Care data (section 6) may be health-related "special category" data under
  GDPR. Even storing only "a care check happened" may count. Needs a view.
- California (CCPA/CPRA) and other state wording, if you want US coverage.
- App Store privacy "nutrition label" and Google Play Data safety form must
  match this policy. A draft of the answers is at the end of this file.

---

## 1. Who we are

Axiom is a free app for founders. It is run by [OPERATOR LEGAL NAME],
[ADDRESS], [COUNTRY] ("Axiom", "we"). For anything about your data, write to
[CONTACT EMAIL].

## 2. The short version

- What you tell Axiom stays private unless you choose to share it.
- We use it to run Axiom for you: the Read, the lessons, your moves and your
  reports.
- What you write is sent to OpenAI to produce Axiom's replies.
- No ads. We do not sell your data. We do not share it for advertising.
- You can download your data and delete your account in the app, at any time.

## 3. What we collect

**From Google sign-in.** Your email address and first name. We do not get your
Google password.

**Your sign-up answers.** Your stage, business model, customers and country,
your goal and its date, the time you want to report, your time zone, and any
open answers you type.

**What you write and what Axiom writes back.** Your situations and the
follow-up answers, the Read Axiom gives you and your answer to its question,
your Learn conversations and which lessons you were shown, your moves (the
move, what success means, Axiom's prediction, any swap and its reason), and
your reports (Done, Couldn't or Didn't, and your note).

**Your sharing choices.** Each time you choose Share or Keep private, or
withdraw a share, we keep a record of the choice, the time, and which version
of the wording you saw.

**Care checks.** See section 6.

**Settings.** Share automatically (off by default), morning and evening
reminders, quiet hours (default 10 pm to 6 am), what reminders show on your
lock screen, how direct Axiom is, and similar choices.

**Your device, for reminders.** If you allow notifications: a push token for
your phone, the platform (iOS or Android) and your time zone. We also log which
reminders were sent and when, so we never send more than 2 a day.

**Usage and cost records.** For each AI call: which step it was for, the model,
the number of tokens, the time it took, the cost, and any error. These records
hold no text you wrote. We also record a few product events (for example "a
move was reported") linked to your account. [CHECK the properties stored with
each product event before launch]

**Server logs.** Our server logs hold technical details only, not what you
write and not your account id. [CHECK]

We do not collect your location, contacts, photos, microphone, payment details
or advertising ids.

## 4. Why we use it

| What | Why | Legal basis (where GDPR applies) [CHECK with lawyer] |
|---|---|---|
| Sign-in details | To keep your account yours | Contract |
| Sign-up answers, situations, reads, conversations, moves, reports | To give you the Read, lessons and moves that fit you, and remember what happened | Contract |
| Care checks | To stop the journey and point to real help when you may be in distress | Vital interests / legitimate interests [CHECK] |
| Push token, reminder log, settings | To send the reminders you turned on, and no more than 2 a day | Contract |
| Sharing choices | To prove what you agreed to, and to honour a withdrawal | Consent, and legal obligation |
| Usage and cost records, product events | To keep Axiom running, find faults, and control cost | Legitimate interests |
| Shared stories | To show your anonymised story to other founders, only if you chose to share | Consent |

We do not use your data for advertising. We do not sell it. We do not use it
to build profiles for anyone else.

## 5. AI processing (OpenAI)

Axiom's replies are written by AI models from OpenAI, through OpenAI's API.
To produce them, our server sends OpenAI:
- what you write in Axiom (situations, answers, Learn messages, report notes);
- your sign-up answers, where a reply needs them (for example your stage and
  goal for the first Read);
- earlier parts of the same situation, so the reply follows on;
- passages from published books, for lessons.

Your messages are also checked for signs of distress before anything else
happens. Most checks run on our server with fixed rules. When the rules are
unsure, the message is sent to OpenAI for a second opinion.

We do not send OpenAI your email address. [CHECK that no prompt includes the
email or Google name]

How long OpenAI keeps API data, and whether it uses it for training, is set by
OpenAI's terms for API customers. [CHECK OpenAI API data terms] and state them
here in one line.

AI output can be wrong. See the Terms of Use.

## 6. Care and distress

Some founders share hard personal things. Every message is checked before any
lesson or move. If it shows signs of distress, Axiom stops the journey, shows
a calm screen with a way to reach real help, and pauses all reminders.

What we store about a care check: that it happened, its level (unclear or
clear), which situation it was in, when it happened, and when it was closed.
**We do not store the words that triggered it in the care record.** [CHECK
whether a message stopped by the care check is saved anywhere else, for
example as a situation turn]

Care records are never used in shared stories, analytics or later prompts. If
a care check happens after you shared a story from the same period, that
story is taken down.

Axiom is not a crisis service. If you are in danger, call your local emergency
number.

## 7. Sharing your story with other founders

Your story is shared only if you choose it.

- After every report, Axiom asks: Share or Keep private. Nothing is
  pre-selected. Skipping means not shared.
- In Settings you can turn on "Share automatically". Then reports are shared
  without asking each time. It is off unless you turn it on.
- A shared report becomes a draft. A person at Axiom writes an anonymised
  version: no name, no company, no details that point to you. Nobody else sees
  it until that person approves it.
- Other founders see the approved story with only coarse tags: your stage,
  business model and customer market.
- The story is stored with no link to your account. A separate private record,
  which only our server can read, connects the story to you. It exists so you
  can take your story down, and so an introduction between two founders could
  happen in future, only if both say yes. It is never shown to anyone.
- You can withdraw a share at any time. The story's text is removed and it is
  no longer shown.

**If you delete your account:** stories still waiting for review, rejected or
withdrawn are removed. An approved, published story stays, anonymised, and its
private link to you is removed. After that, nobody, including you and us, can
tell it was yours, so it can no longer be taken down. If you want a published
story removed, withdraw it before you delete your account. [DECIDE: see For
Rafay, item 4]

## 8. Who we share data with

We do not sell your data. We share it only with the services that run Axiom:

| Service | What it does | Where |
|---|---|---|
| Supabase | Database and sign-in | Singapore (AWS ap-southeast-1) |
| Render | Runs our server | Singapore [CHECK in Render dashboard] |
| Google | Sign-in with Google | [CHECK] |
| OpenAI | Writes Axiom's replies, second check for distress | United States [CHECK OpenAI API data terms] |
| Expo, Apple (APNs), Google (FCM) | Deliver reminders to your phone | [CHECK] |

Reminders pass through Expo and Apple or Google. They carry the reminder text,
which can name your move or situation. In Settings you choose whether the lock
screen shows the full text, a short version, or nothing.

We may also disclose data if the law requires it, or to protect someone's
life. [CHECK with lawyer]

## 9. How long we keep it

- Your account data: until you delete your account.
- After you ask to delete: 7 days, in case you change your mind. Then it is
  deleted (see section 11).
- Database backups: deleted data can remain in backups for up to [BACKUP
  DAYS] days, then it is gone. [CHECK Supabase plan backup retention]
- OpenAI: under OpenAI's own retention. [CHECK OpenAI API data terms]
- Published anonymised stories: see section 7.

## 10. International transfers

Our database is in Singapore. OpenAI and other services may process data in
other countries, including the United States. Where the law requires it, we
rely on safeguards such as Standard Contractual Clauses. [CHECK with lawyer
and with each provider's terms]

## 11. Your choices and rights

In the app, at any time:
- **Download your data.** Settings gives you one file (JSON) with your account,
  sign-up answers, settings, situations, reads, Learn conversations, moves,
  reports, sharing choices, care records (no text) and devices (tokens hidden).
  It does not include usage and cost records or product events. [DECIDE:
  include them, or answer those requests by email]
- **Delete your account.** Settings, "Delete my account", then type DELETE.
  Deletion is scheduled 7 days later and the app shows the date. You can
  cancel during those 7 days. No reminders are sent while it is pending. After
  7 days everything we hold about you is removed: sign-up answers,
  situations, reads, conversations, moves, reports, sharing records, care
  records, devices, settings, usage and cost records, product events, and your
  sign-in account. Published stories: see section 7.
- **Stop reminders.** In Settings, or in your phone's settings.
- **Stop sharing.** Turn off "Share automatically", choose Keep private, or
  withdraw a share.
- **Correct your sign-up answers** in the app. [CHECK the edit screen ships
  before launch; PRODUCT.md lists it as not yet designed]

You can also write to [CONTACT EMAIL] to ask for access, correction, deletion
or a copy of your data, to object to how we use it, or to ask us to limit it.
We answer within [30] days. [CHECK] You can complain to the data protection
authority where you live.

## 12. Security

- Only our server can write to the database. The app uses Supabase only to
  sign you in.
- Every request to our server is checked against your sign-in.
- Every table is locked so one founder cannot read another's data.
- Secret keys stay on the server, never in the app.
- What you write is not sent to outside logging services.

No system is perfectly safe. If a breach affects you, we will tell you as the
law requires.

## 13. Children

Axiom is for people aged [18] and over. [DECIDE] We do not knowingly collect
data from anyone younger. If you think a child has an account, write to
[CONTACT EMAIL] and we will delete it.

## 14. Changes

If we change this policy, we will update the date at the top. If the change
matters, we will tell you in the app before it takes effect.

## 15. Contact

[OPERATOR LEGAL NAME], [ADDRESS], [COUNTRY]. [CONTACT EMAIL].

---

## Appendix for Rafay: app store answers (draft, delete before publishing)

Apple App Privacy / Google Play Data safety, from the code. [CHECK each
against the store forms]
- Contact info: email address, name. Linked to the user. App functionality.
- User content: other user content (situations, conversations, reports).
  Linked. App functionality.
- Identifiers: user id. Linked. App functionality.
- Usage data: product interaction (product events). Linked. Analytics [CHECK
  category].
- Diagnostics: none sent from the app [CHECK if the app adds crash reporting].
- Sensitive info: care check records [CHECK whether to declare as health].
- Tracking: none. No data used for third-party advertising.
- Data encrypted in transit: yes (HTTPS) [CHECK].
- Users can request deletion: yes, in the app (once `ACCOUNT_DELETE` is on).
