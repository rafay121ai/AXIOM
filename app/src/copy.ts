import { isDailyLimit, isMoveCap, isSwapUsed } from './api/queue';

// The words the app itself says in the Situation, Read, Learn and Move screens. Everything else Axiom says comes
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
    // mock-onboarding-v2.html, after Commit: "I will remind you at 8 pm." The time comes from the server.
    remind: (time: string) => `I will remind you at ${time}.`,
    // NEEDS APPROVAL: the server's own line when both places are taken (server/journey/move/room.js NO_ROOM_LINE), shown as it is.
    noRoom: 'You have 2 moves open. Tell me how one of them went first, then I will give you the next.',
    // NEEDS APPROVAL: the server's own line when the one change is used up (moveService.js), shown as it is.
    swapUsed: 'You have changed this move once already.',
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
