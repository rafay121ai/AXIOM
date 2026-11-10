import { HttpError } from './api/queue';

// The words the app itself says in the Situation, Read, Learn, Move and Report screens. Everything else Axiom says comes
// from the server. Source for each line: tasks/design/mock-onboarding-v2.html, mock-states-v1.html,
// or a line no mock has yet.

export const copy = {
  situation: {
    opening: 'Do you want to start with what you said you are stuck on, or is something else on your mind?',
    openingFresh: 'What is on your mind?',
    placeholder: 'What is going on?',
    suggestion: 'Use what you wrote earlier',
    // Said when Axiom has enough, so the founder sees the step end before the Read (Rafay, Nov 2).
    ready: "Got it. Here's what I see.",
  },
  read: {
    placeholder: 'Your answer',
    skip: 'Skip this question',
    somethingElse: 'Something else on my mind',
  },
  learn: {
    // mock-minimal-v5.html, the Learn composer
    placeholder: 'Reply',
    // mock-minimal-v5.html, the label over a picture built from the founder's own numbers
    pictureLabel: 'From your numbers',
    calculated: 'Calculated',
    // row labels in the before/after bars picture; no mock shows them.
    before: 'Before',
    after: 'After',
  },
  // mock-onboarding-v2.html, the Move sheet (screen 6), word for word.
  move: {
    kicker: 'Your move',
    mission: 'The mission',
    success: 'It worked if',
    words: 'The words to use',
    wordsNote: 'Suggested wording',
    // A move may be a post or a call, not only a message (Rafay, Nov 2).
    checklist: 'Before you start',
    commit: 'Commit to this move',
    committed: 'Committed.',
    change: 'Change this move',
    back: 'Back to chat',
    swapAsk: 'You can change it once. Tell me what makes this one wrong for you. A real reason works best, like "I only have their email".',
    swapPlaceholder: 'What makes this the wrong move?',
    swapNote: '"I\'m busy" isn\'t a reason I can work with.',
    swapGo: 'Give me a different move',
    // mock-onboarding-v2.html, after Commit: "Want a reminder tonight?" Yes / No thanks. Yes: "I will remind you at 8 pm."
    // (the time comes from the server). No: "No problem."
    remindAsk: 'Want a reminder tonight?',
    remindYes: 'Yes',
    remindNo: 'No thanks',
    remind: (time: string) => `I will remind you at ${time}.`,
    remindNone: 'No problem.',
    // mock-states-v1.html, section 4: said once, after the phone's own permission box was refused.
    remindersOff: "Reminders are off on your phone. I'll keep tonight's check-in waiting on your home screen.",
    phoneSettings: 'Turn on in phone settings',
    // used only if the server sends no line of its own with "no room" (it sends NO_ROOM_LINE, which names the limit).
    noRoom: 'You have no room for another move. Tell me how one of them went first, then I will give you the next.',
    // the server's own line when the one change is used up (moveService.js), shown as it is.
    swapUsed: 'You have changed this move once already.',
  },
  // mock-onboarding-v2.html, the Report (screen 8), word for word. Axiom's own lines come from the server.
  report: {
    // The small label top right, as the mock has it.
    title: "Tonight's check-in",
    placeholder: 'What happened?',
    outcome: { done: 'Done', couldnt: "Couldn't", didnt: "Didn't" },
    seeStory: 'Yes, show me',
    notNow: 'Not now',
    storyLabel: 'A founder before you',
    share: 'Share',
    keepPrivate: 'Keep private',
    // mock-states-v1.html, the evening Report with no signal, word for word. "You can close the app." is true: the
    // check-in is written to the phone before it is sent (src/api/outbox.ts) and goes out when the app is next opened.
    saved: 'Your check-in is saved.',
    willSend: "I'll send it as soon as you're back online. You can close the app.",
  },
  // mock-onboarding-v2.html, screen 9 (home) and its menu drawer.
  // The step names: a short title card on entering each step, then beside the menu logo (Rafay, Nov 2).
  // The two screens before question 1. Wording from Rafay's Nov 9 brief.
  onboarding: { nameTitle: 'What should I call you?', birthdayTitle: 'When is your birthday?', birthdaySub: 'Month and day. No year.', skip: 'Skip' },
  steps: { situation: 'Situation', read: 'Read', learn: 'Learn' },
  home: {
    placeholder: "What's going on?",
    menu: 'Menu',
    startNew: 'Start something new',
    open: "What's open",
    nothingToDo: 'Nothing to do right now.',
    history: 'History',
    seeAll: 'See all history ›',
    paused: 'Paused',
    // a situation the server sent without a title; no mock shows one.
    untitled: 'No title yet',
    // opening a home item or a menu row failed; no mock says what Axiom says.
    couldNotOpen: "I couldn't open that just now.",
  },
  // mock-onboarding-v2.html, screens 12 and 13 (History and a past situation).
  history: {
    title: 'History',
    search: 'Search your situations',
    none: 'Nothing matches that.',
    back: 'Back',
    read: 'What I read',
    learned: 'What you learned',
    move: 'Your move',
    how: 'How it went',
    shared: 'Shared without your name',
    private: 'Kept private',
    // the mock styles a withdraw link (.withdraw) but shows no words for it.
    takeDown: 'Take it down',
  },
  // mock-onboarding-v2.html, screen 11 (Settings) and mock-states-v1.html section 4, word for word.
  settings: {
    title: 'Settings',
    you: 'You',
    name: 'Name',
    email: 'Email',
    country: 'Country',
    knows: 'What Axiom knows about you',
    knowsSub: 'Your sign-up answers. Change them any time.',
    reminders: 'Reminders',
    checkin: 'Check-in time',
    checkinSub: 'When I ask how your move went.',
    morning: 'Morning reminder',
    morningSub: 'Your move for the day.',
    evening: 'Evening check-in',
    eveningSub: 'How the move went.',
    lock: 'On the lock screen, show',
    lockFull: 'Full',
    lockShort: 'Short',
    lockHidden: 'Nothing',
    lockNote: 'Short: your name and "how did it go?". Full: names your move. Nothing: just "Axiom".',
    off: 'Reminders are off',
    offSub: "They're switched off in your phone's settings, so I can't remind you. Tonight's check-in will wait on your home screen.",
    openPhone: 'Open phone settings',
    morningOff: 'Off until phone reminders are on.',
    talks: 'How Axiom talks',
    calm: 'Calm',
    direct: 'Direct',
    hard: 'Hard',
    talksNote: 'Direct is the default. Hard is blunter and pushes harder. You can change it any time.',
    onScreen: 'On screen',
    keep: 'Keep my open items on screen',
    keepSub: 'Stops the small items on the home screen from fading after a few seconds.',
    privacy: 'Privacy',
    share: 'Share with other founders',
    privacyLink: 'Privacy',
    terms: 'Terms',
    account: 'Account',
    signOut: 'Sign out',
    delete: 'Delete everything Axiom knows about me',
    confirmTitle: 'Delete everything Axiom knows about you?',
    keepData: 'Keep my data',
    deleteAll: 'Delete everything',
    cancelDeletion: 'Cancel deletion',
    // not in any mock. Quiet hours (Decision 10 lists them; the mock draws no row), the export row,
    // the sign-up answers list's button, and the line when a setting did not save.
    quiet: 'Quiet hours',
    quietFrom: 'From',
    quietUntil: 'Until',
    export: 'Export my data',
    answersDone: 'Done',
    notSaved: "I couldn't save that just now.",
  },
  send: 'Send',
  tryAgain: 'Try again',
  noConnection: 'No connection. Your messages are saved.',
  waitingToSend: 'Waiting to send',
  // mock-states-v1.html, the error state
  couldNotAnswer: "I couldn't answer that just now. Your message is saved.",
  // the same line for a Read that would not load, where there is no message to save.
  couldNotRead: "I couldn't answer that just now.",
  // no mock says what Axiom says at the daily limit (decision E only says "plainly, and offer the open ones").
  // no mock shows a failed Google sign-in. Plain and short, per tasks/voice.md.
  // The sign-up film (src/intro/timeline.ts): one word per beat, then together as the tagline. Chosen by Rafay, Oct 31.
  intro: { words: ['See.', 'Learn.', 'Become.'] },
  signInFailed: "Sign-in didn't work. Try again.",
  dailyLimit: 'That is the limit for new situations today. Pick one that is still open.',
} as const;

type Line = { text: string; canRetry: boolean };

// every line below is new (no mock has them). One per stable error code the server sends. A "moment"
// line is for a step the server is still finishing, so trying again can work; the rest will not change by waiting.
const BY_CODE: Record<string, Line> = {
  daily_limit: { text: copy.dailyLimit, canRetry: false },
  swap_used: { text: copy.move.swapUsed, canRetry: false },
  move_not_ready: { text: 'Your move is not ready yet. Try again in a moment.', canRetry: true },
  move_changing: { text: 'I am still changing this move. Try again in a moment.', canRetry: true },
  move_not_committable: { text: 'You already started this move.', canRetry: false },
  move_not_changeable: { text: 'You already started this move.', canRetry: false },
  turn_busy: { text: 'I am still on your last message. Try again in a moment.', canRetry: true },
  report_saving: { text: 'Your check-in is still saving. Try again in a moment.', canRetry: true },
  report_not_allowed: { text: 'This move cannot be checked in.', canRetry: false },
  share_not_allowed: { text: 'This check-in cannot be shared.', canRetry: false },
  read_started: { text: 'I have already read this one. Start something new for anything else.', canRetry: false },
  read_missing: { text: 'I have not read this one yet.', canRetry: false },
  read_unanswered: { text: 'Answer or skip the question first.', canRetry: false },
  situation_empty: { text: 'Tell me what is going on first.', canRetry: false },
  lesson_not_started: { text: 'This lesson has not started yet.', canRetry: false },
  signup_unfinished: { text: 'Finish the sign-up questions first.', canRetry: false },
  quiet_hours_clash: { text: 'That time is inside your quiet hours. Pick another.', canRetry: false },
};

/** The line for a failure that is not "no connection" (that one waits and sends by itself), and whether trying again can help. */
export function failureLine(e: unknown, whatFailed: 'message' | 'read' | 'save' | 'open' = 'message'): Line {
  if (e instanceof HttpError) {
    // Both places taken: the server words it with its own limit; the app never writes the number.
    if (e.code === 'move_cap') return { text: e.line ?? copy.move.noRoom, canRetry: false };
    // The day's spend is used up: the server words it; waiting a moment changes nothing.
    if (e.code === 'daily_cost_cap') return { text: e.line ?? copy.couldNotAnswer, canRetry: false };
    const known = e.code ? BY_CODE[e.code] : undefined;
    if (known) return known;
  }
  switch (whatFailed) {
    case 'read': return { text: copy.couldNotRead, canRetry: true };
    case 'save': return { text: copy.settings.notSaved, canRetry: false };
    case 'open': return { text: copy.home.couldNotOpen, canRetry: false };
    case 'message': return { text: copy.couldNotAnswer, canRetry: true };
  }
}
