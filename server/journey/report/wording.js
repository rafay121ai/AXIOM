// Every fixed line of the Report, the sharing question and the sharing
// setting, in one place. Lines marked (mock) are the approved Report mock's
// words; the others are new and wait for Rafay's approval. Consent wordings
// carry a version: the consent log stores which words the founder saw.

// The three outcomes, exactly. Nothing else can be reported.
export const OUTCOMES = Object.freeze(['done', 'couldnt', 'didnt'])

// The plain question after the tap, answered in the box.
export const OUTCOME_QUESTIONS = Object.freeze({
  done: 'What happened when you did it?', // new
  couldnt: 'What got in the way?', // (mock)
  didnt: 'What stopped you?', // (mock)
})

// A one-word answer. (mock)
export const NEED_MORE = 'Say a bit more.'

// The Report opens with the move and Axiom's own prediction (PRODUCT.md:
// "Your move was to … I said …. What happened?").
const lowerFirst = (s) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s)
const sentence = (s) => String(s ?? '').trim().replace(/[.!\s]+$/, '')
export const moveLine = (title) => `Your move was to ${lowerFirst(sentence(title))}.`
export const openingLine = ({ title, prediction }) =>
  `${moveLine(title)} I said ${lowerFirst(sentence(prediction))}. What happened?`

// Used when there is no note to answer, or the model's reply fails the checks
// twice. Named from the founder's own move; no humour after Couldn't or Didn't. (new)
export function fallbackReply({ outcome, title }) {
  const move = moveLine(title)
  if (outcome === 'done') return `${move} You did it. What do you want to move next?`
  if (outcome === 'couldnt') return `That is fine, things changed. ${move} What is the smallest part of it you could still do?`
  return `That happens. ${move} What would make it easier to start next time?`
}

// Offered before anything is asked of the founder, only when an approved
// story fits. (mock)
export const STORY_OFFER = 'A founder who was in your spot shared what went wrong and what worked. Want to see it?'

// The sharing question. Nothing pre-selected; skipping means private.
export const CONSENT_WORDINGS = Object.freeze({
  'share-after-story-v1': 'They shared theirs so it could help you. Would you share yours the same way, with no name?', // (mock)
  'share-alone-v1': 'One last thing: can I share what happened, with no name, to help founders behind you?', // (mock, without "No problem.")
})
export const AFTER_STORY_VERSION = 'share-after-story-v1'
export const ALONE_VERSION = 'share-alone-v1'

// After the choice. (mock)
export const SHARED_LINE = 'Thank you. That opens more founder stories for you.'
export const KEPT_PRIVATE_LINE = 'Kept private. You can change this any time in settings.'
// After a share is taken back. (new) The version names the app's withdraw
// control in the consent log.
export const WITHDRAWN_LINE = 'Taken down. Nothing from this check-in is shared.'
export const WITHDRAW_VERSION = 'withdraw-v1'

// Settings > Privacy, "Share with other founders" (share automatically). (mock)
export const SHARE_AUTO_VERSION = 'settings-share-auto-v1'
export const SHARE_AUTO_TEXT = Object.freeze({
  on: 'On. What happens in your check-ins is shared with other founders, with no name, without asking each time. Turn it off any time.',
  off: 'Off. After each check-in I ask if you want to share what happened, with no name. Nothing is shared unless you say yes.',
})
