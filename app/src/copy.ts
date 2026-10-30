import { isDailyLimit, isMoveCap, isSwapUsed } from './api/queue';

// The words the app itself says in the Situation, Read, Learn, Move and Report screens. Everything else Axiom says comes
// from the server. Source for each line: tasks/design/mock-onboarding-v2.html, mock-states-v1.html,
// or (marked NEEDS APPROVAL) a line no mock has yet.

export const copy = {
  situation: {
    opening: 'Do you want to start with what you said you are stuck on, or is something else on your mind?',
    openingFresh: 'What is on your mind?',
    placeholder: 'What is going on?',
    suggestion: 'Use what you wrote earlier',
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
    // NEEDS APPROVAL: row labels in the before/after bars picture; no mock shows them.
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
    checklist: 'Before you send',
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
    // NEEDS APPROVAL: the server's own line when both places are taken (server/journey/move/room.js NO_ROOM_LINE), shown as it is.
    noRoom: 'You have 2 moves open. Tell me how one of them went first, then I will give you the next.',
    // NEEDS APPROVAL: the server's own line when the one change is used up (moveService.js), shown as it is.
    swapUsed: 'You have changed this move once already.',
  },
  // mock-onboarding-v2.html, the Report (screen 8), word for word. Axiom's own lines come from the server.
  report: {
    // The small label top right, as the mock has it.
    title: 'Report',
    placeholder: 'What happened?',
    outcome: { done: 'Done', couldnt: "Couldn't", didnt: "Didn't" },
    seeStory: 'Yes, show me',
    notNow: 'Not now',
    storyLabel: 'A founder before you',
    share: 'Share',
    keepPrivate: 'Keep private',
    // mock-states-v1.html, the evening Report with no signal. The mock adds "You can close the app."; it is left out
    // because the app does not yet keep an unsent check-in once it is closed.
    saved: 'Your check-in is saved.',
    willSend: "I'll send it as soon as you're back online.",
  },
  // mock-onboarding-v2.html, screen 9 (home) and its menu drawer.
  home: {
    placeholder: "What's going on?",
    menu: 'Menu',
    startNew: 'Start something new',
    open: "What's open",
    nothingToDo: 'Nothing to do right now.',
    history: 'History',
    seeAll: 'See all history ›',
    paused: 'Paused',
    // NEEDS APPROVAL: a situation the server sent without a title; no mock shows one.
    untitled: 'No title yet',
    // NEEDS APPROVAL: opening a home item or a menu row failed; no mock says what Axiom says.
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
    lockNote: 'Short: "Axiom: tonight\'s check-in". Full: names your move. Nothing: just "Axiom".',
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
    confirmBody: "This removes your situations, check-ins, answers and anything you shared. It can't be undone.",
    keepData: 'Keep my data',
    deleteAll: 'Delete everything',
    // NEEDS APPROVAL: not in any mock. Quiet hours (Decision 10 lists them; the mock draws no row), the export row,
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
  // NEEDS APPROVAL: the same line for a Read that would not load, where there is no message to save.
  couldNotRead: "I couldn't answer that just now.",
  // NEEDS APPROVAL: no mock says what Axiom says at the daily limit (decision E only says "plainly, and offer the open ones").
  dailyLimit: 'That is the limit for new situations today. Pick one that is still open.',
} as const;

/** What to say when a send fails for a reason other than no connection, and whether trying again can help. */
export function failureLine(e: unknown, whatFailed: 'message' | 'read' = 'message'): { text: string; canRetry: boolean } {
  if (isDailyLimit(e)) return { text: copy.dailyLimit, canRetry: false };
  if (isMoveCap(e)) return { text: copy.move.noRoom, canRetry: false };
  if (isSwapUsed(e)) return { text: copy.move.swapUsed, canRetry: false };
  return { text: whatFailed === 'read' ? copy.couldNotRead : copy.couldNotAnswer, canRetry: true };
}
