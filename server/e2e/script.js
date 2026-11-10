// What the founder says and what the scripted model answers, for the
// end-to-end walk. The founder's words are their own; every model reply is one
// the server's checks were built to accept (or, where noted, to reject).
import { FULL_ANSWERS } from '../journey/fixtures.js'

export { FULL_ANSWERS }

export const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

// Situation: the founder's opening text and two answers to follow-ups.
export const SITUATION_TEXT = 'I have a demo ready but I have not emailed the 2 clinics that asked for pricing three weeks ago.'
export const TURN_2 = 'The owner of each clinic decides. Both are in Karachi.'
export const TURN_3 = 'Nothing yet. I only sent the demo link three weeks ago.'
export const Q1 = 'Who at the 2 clinics decides about pricing?'
export const Q2 = 'What have you sent the 2 clinics since the demo?'
export const Q3_REFUSED = 'When did you last speak to the 2 clinics?'

export const situationVerdict = (over = {}) => ({
  topic: 'same', has_situation: true, has_detail: false, missing: 'person', question: Q1, title: 'Pricing emails to clinics', ...over,
})

export const FIRST_READING = {
  headline: 'The clinics asked for pricing and have heard nothing since.',
  body: 'You wrote that you have a demo ready. You also wrote "I have not emailed the 2 clinics that asked for pricing three weeks ago". Nobody pays yet, and you are working evenings and weekends. Sending the price is the gap. We start there.',
  underlines: ['asked for pricing'],
}

export const READ = {
  headline: 'You have not sent the price the clinics asked for.',
  body: 'You wrote "I have a demo ready". You also wrote that the clinics asked for pricing three weeks ago. Nobody has had an answer since then. That is the open gap.',
  closing_question: 'Have you gone back to either of those clinics since the demo?',
}
export const READ_ANSWER = "No, I haven't gone back to either since the demo three weeks ago."
export const READ_TALK_Q = 'What do you want from the 2 clinics since the demo?'
export const READ_TALK_ANSWER = 'I want both clinics to start a paid pilot this month.'

// Knowledge search rows. E1 and E2 are The Mom Test, E3 Never Split the
// Difference (a third Mom Test passage is dropped: at most 2 per book).
const MOM_TEST = 'Compliments are worthless. When someone says they will think about it, you have learned nothing. It only counts when they give up something real, such as time, reputation or money.'
export const KNOWLEDGE_ROWS = [
  { id: uuid(901), pillar: 'move_people', title: 'The Mom Test', author: 'Rob Fitzpatrick', key_frameworks: MOM_TEST, similarity: 0.52 },
  { id: uuid(902), pillar: 'move_people', title: 'The Mom Test', author: 'Rob Fitzpatrick', key_frameworks: 'Ask about their life, not your idea. Facts about the past beat opinions about the future.', similarity: 0.49 },
  { id: uuid(903), pillar: 'move_people', title: 'The Mom Test', author: 'Rob Fitzpatrick', key_frameworks: 'Keep it casual and push for commitment.', similarity: 0.47 },
  { id: uuid(904), pillar: 'move_people', title: 'Never Split the Difference', author: 'Chris Voss', key_frameworks: 'No is the start of the negotiation, not the end of it. Most people hear no and stop.', similarity: 0.41 },
]
const VERIFIED_QUOTE = 'you have learned nothing'
export const VERIFIED_QUOTE_SHOWN = '…you have learned nothing'
// Not in the Never Split the Difference passage: the server must strip it.
export const FABRICATED_QUOTE = 'Always split the difference with a buyer'

// The lesson cites E1 with a real quote and E3 with an invented one. The
// server asks again once, then shows the cleaned reply: both sources, only
// the verified quote.
export const LESSON = {
  reply: 'It has been three weeks since either clinic heard from you. Two clinics saw the demo and nothing has been asked of them since. Rob Fitzpatrick\'s point in The Mom Test is that a maybe tells you nothing; it only counts when they give up time or money. What would a real yes from one of those clinics be?',
  citations: [{ handle: 'E1', quote: VERIFIED_QUOTE }, { handle: 'E3', quote: FABRICATED_QUOTE }],
  picture_json: JSON.stringify({ type: 'timeline', data: { events: [{ when: 'three weeks ago', label: 'Clinics asked for pricing' }, { when: 'Today', label: 'No price sent yet' }] } }),
  follow_ups: ['What if they say no?', 'Give me the exact words to use'],
  move_subject: 'the two clinics',
  move_fact: 'The two clinics have heard nothing from you for three weeks.',
}
const plainReply = (reply) => ({ reply, citations: [], picture_json: '', follow_ups: [], move_subject: '', move_fact: '' })
// A follow-up builds on a passage the lesson was given (checkReply sends an uncited one back).
export const FOLLOWUP_ANSWER = { ...plainReply('A no from the clinics is still an answer, and it ends three weeks of waiting. Send the price to both clinics and ask each for a call.'), citations: [{ handle: 'E1', quote: '' }] }
export const LEARN_REPLY_1 = plainReply('The owner decides, so the ask goes to the owner of the first clinic. Both clinics have waited three weeks for a price. What would you ask that owner for?')
export const LEARN_OFFER = plainReply('A paid pilot is a real yes from the first clinic, and the owner can give it. Your move is ready.')
export const LEARN_AFTER_CARE = plainReply('The first clinic has waited three weeks for the price. Send it to the owner of the first clinic. What will you ask that owner for?')
export const REAL_1 = 'Yes, the owner of the first clinic decides about buying.'
export const REAL_2 = 'I want a paid pilot from the first clinic this month.'
export const WHAT_NEXT = 'What should I do next?'

export const MOVE = {
  title: 'Ask both clinics that asked for pricing for a call.',
  mission: 'Email the 2 clinics that asked for pricing and ask each for a 20-minute call.',
  success: 'Both clinics reply with a day and time for the call.',
  words: 'I have the pricing you asked for. Can we book 20 minutes to go through it?',
  checklist: ['Open the last email from each clinic', 'Paste the wording and make it sound like you', 'Send it to both clinics'],
  prediction: 'At least one of the clinics will not reply. That is also an answer.',
  hypothesis: 'Tests whether the clinics will reply with a day and time when asked directly.',
  start_minutes: 5,
}
export const SWAPPED_MOVE = {
  ...MOVE,
  title: 'Call both clinics that asked for pricing.',
  mission: 'Call the 2 clinics that asked for pricing and ask each for a 20-minute call.',
  checklist: ['Find the phone number of each clinic', 'Call both clinics'],
}
export const SWAP_REASON = 'I only have their phone numbers, not their email.'

export const REPORT_NOTE = 'One clinic gave me a time on Thursday, the other did not reply.'
export const REPORT_REPLY = {
  reply: 'One clinic gave you Thursday and one did not reply. I said at least one would not reply, and I was right. Send the clinic that replied a message confirming Thursday.',
  prediction_check: 'right',
}

// Clear distress: caught by the rules, so no model call is needed.
export const DISTRESS = 'Honestly I want to end it all.'
export const CHECK_IN_ANSWER = 'Better today. I slept and talked to a friend.'

// An approved founder story from someone else, for the give-to-get offer.
export const PEER_STORY_ID = uuid(950)
export const PEER_STORY = {
  id: PEER_STORY_ID, status: 'approved', stage: 'validating', customer_market: 'Mostly abroad', business_model: 'b2b',
  outcome: 'done', story: 'A founder selling to clinics sent the price after a month of waiting. One clinic said yes to a pilot.',
  lesson: 'Send the price. Waiting does not make it easier.', draft: null, reviewed_by: 'reviewer', reviewed_at: '2026-10-01T00:00:00.000Z',
  withdrawn_at: null, created_at: '2026-09-20T00:00:00.000Z',
}
