// Every word the founder can see from the care check lives in this file, so it
// can be reviewed in one place. DRAFT: not approved. Voice rules: plain words,
// no filler, no mentor tone, no moves, no lessons, no performance framing.
// Before launch a person (ideally with a mental-health background) reviews it.

export const CARE_COPY = Object.freeze({
  // Care screen: shown when the text is clear distress or explicit words.
  clearMessage:
    'What you wrote matters more than anything we were working on, so I have stopped there. '
    + 'If you are in danger or might act on these thoughts, call your local emergency number now. '
    + 'You do not have to be sure it is serious enough. '
    + 'I am an assistant, not a counsellor, and a person can help in ways I cannot. '
    + 'I am here if you want to keep talking.',

  // Unclear: one soft question. No lesson, no move, no model-written text.
  unclearReply:
    'That sounded heavier than a work problem. How are you doing right now?',

  // Help block. Used when no verified line exists for the founder's country.
  fallbackLine:
    'To find a helpline in your country, use a worldwide directory such as findahelpline.com.',

  // Opening line on the next visit after a care event.
  returnCheckIn: 'How are you doing today?',
})
