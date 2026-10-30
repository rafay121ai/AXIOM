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

// The account stubs. Nothing is deleted. (new)
export const ACCOUNT_COPY = Object.freeze({
  exportQueued: 'I have your request. Your export is queued.',
  deleteRecorded: 'I have your request. Nothing has been deleted. Deleting everything Axiom knows about you needs a plan I have not finished, and I will not guess with your history.',
})

// What a deletion would cover once a plan is approved. Names only; shown as
// the plan. Nothing here deletes anything. (new)
export const DELETION_PLAN = Object.freeze({
  status: 'awaiting_plan',
  would_remove: [
    'Your situations, Reads and lessons',
    'Your moves and your reports',
    'What Axiom remembers about you',
    'Your sign-up answers and settings',
    'Your reminders and devices',
  ],
  shared_outcomes: 'Outcomes you shared hold no name. The private link between you and them would be removed.',
})
