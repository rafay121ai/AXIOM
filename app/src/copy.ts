import { isDailyLimit } from './api/queue';

// The words the app itself says in the Situation and Read screens. Everything else Axiom says comes
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
  return { text: whatFailed === 'read' ? copy.couldNotRead : copy.couldNotAnswer, canRetry: true };
}
