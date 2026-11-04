// Every word the home screen, the drawer and the account stub can show, in one
// place. Lines marked (mock) are the approved mock's words, (draft) are lines
// from Rafay's earlier approved short set, (new) wait for Rafay's approval.
// {name} always sits INSIDE the sentence. With no name, ", {name}" is dropped.

// Greeting lines by time of day. Each context has at least two lines so the
// same line is never shown twice in a row. No model call.
export const GREETINGS = Object.freeze({
  early: [
    { id: 'early:a', text: "{hour} am, {name}. Most people aren't up. Their loss. What's the plan?" }, // (mock)
    { id: 'early:b', text: "{hour} am, {name}. Most people aren't up. What's the plan?" }, // (draft)
  ],
  morning: [
    { id: 'morning:goal', text: '{days} days to {goal}, {name}. No pressure. Some pressure. What\'s the move?', needs: 'goal' }, // (mock)
    { id: 'morning:a', text: "Morning, {name}. What's the move?" }, // (new)
    { id: 'morning:b', text: "{hour} am, {name}. What's the move today?" }, // (new)
  ],
  midday: [
    { id: 'midday:a', text: "Midday, {name}. Coffee doesn't count as progress. What have you moved?" }, // (mock)
    { id: 'midday:b', text: 'Midday, {name}. What have you moved?' }, // (draft)
  ],
  evening: [
    { id: 'evening:a', text: "Day's nearly done, {name}. What got done besides email?" }, // (mock)
    { id: 'evening:b', text: "Day's nearly done, {name}. What got done?" }, // (draft)
  ],
  late: [
    { id: 'late:a', text: 'Still up, {name}? Make it count, or go to sleep.' }, // (mock)
    { id: 'late:b', text: 'Still up, {name}? Make it count.' }, // (draft)
  ],
  weekend: [
    { id: 'weekend:a', text: "{day}, {name}. Nobody's watching. What are you building?" }, // (mock)
  ],
})

// Labels say what to DO. {title} is the founder's own move or situation.
export const ITEM_LABELS = Object.freeze({
  moveToday: 'Today: {title}', // (mock)
  moveStill: 'Still to do: {title}', // (mock)
  report: 'Tell me how it went', // (mock)
  situation: 'Pick up: {title}', // (new)
  situationNoTitle: 'Pick up where you left off', // (new)
})

// History: the one status word on each row.
export const STATUS_LABELS = Object.freeze({
  open: 'Open', done: 'Done', couldnt: "Couldn't", didnt: "Didn't", paused: 'Paused',
}) // (PRODUCT.md)

// History: the one action on a past situation. (PRODUCT.md)
export const HISTORY_ACTIONS = Object.freeze({
  pick_up: 'Pick it up',
  bring_back: 'Bring it back',
  talk_again: 'Talk about this again',
})

// Account: export, and deletion with a grace period. {date} is the day the
// deletion happens, written out (for example "7 November 2026"). The care
// versions are shorter and warmer: used when a care check is open. (new)
export const ACCOUNT_COPY = Object.freeze({
  exportReady: 'Here is everything Axiom holds about you. It is yours to keep.',
  exportTooLarge: 'Your history is too big to send in one file. I have not sent a partial copy.',
  deletePending: 'Done. On {date} I will delete everything Axiom holds about you. Until then you can cancel and nothing changes. After that it cannot be undone.',
  deletePendingCare: 'Your request is in. On {date} everything will be deleted. Until then you can change your mind.',
  deleteWaiting: 'Your deletion is waiting. On {date} I will delete everything Axiom holds about you. Until then you can cancel and nothing changes. After that it cannot be undone.',
  deleteCancelled: 'Cancelled. Nothing was deleted. Everything is still here.',
  deleteNothingToCancel: 'There is no deletion waiting.',
  confirmNeeded: 'To delete everything, type DELETE to confirm.',
  // Delete switch off: the request is recorded and nothing is removed.
  deleteRecorded: 'I have your request. Nothing has been deleted. Deleting everything Axiom knows about you is not switched on yet, and I will not guess with your history.',
  deleteRecordedCare: 'I have your request. Nothing has been deleted yet.',
})

// What deleting covers. Names only, shown with the recorded answer. (new)
export const DELETION_PLAN = Object.freeze({
  would_remove: [
    'Your situations, Reads and lessons',
    'Your moves and your reports',
    'What Axiom remembers about you',
    'Your sign-up answers and settings',
    'Your reminders and devices',
  ],
  shared_outcomes: 'Outcomes you shared hold no name. Stories already published stay, with nothing that links them to you. Anything still waiting for review is removed.',
})
