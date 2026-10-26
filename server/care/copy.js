// Every word the founder can see from the care check lives in this file, so it
// can be reviewed in one place. DRAFT: not approved. Voice rules: plain words,
// no filler, no mentor tone, no moves, no lessons, no performance framing.
// Before launch a person (ideally with a mental-health background) reviews it.

export const CARE_COPY = Object.freeze({
  // Care screen: shown when the text is clear distress or explicit words.
  // Paragraphs separated by a blank line. The first is the heading; the app shows
  // the help block after the third paragraph, then the rest. The app holds no care words.
  clearMessage: [
    'What you just wrote matters more than the business.',
    "I'm not going to give you a lesson or a move right now.",
    "If you might hurt yourself, or you're in danger, please call your local emergency number now.",
    "If you can, tell someone near you how you're feeling. You don't have to be okay for me to be here.",
    "I'm an assistant, not a counsellor. But I'm here if you want to keep talking.",
  ].join('\n\n'),

  // Unclear: one soft question. No lesson, no move, no model-written text.
  unclearReply:
    'That sounded heavier than a work problem. How are you doing right now?',

  // Help block. Used when no verified line exists for the founder's country.
  fallbackLine:
    'To find a helpline in your country, use a worldwide directory such as findahelpline.com.',

  // Opening line on the next visit after a care event.
  returnCheckIn: 'How are you doing today?',
})
