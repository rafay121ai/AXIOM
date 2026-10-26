// When a Move may be offered in the Learn conversation, and the words of the
// notice. Pure: no model, no I/O. The server calls this; the model never decides.
import { isFillerReply } from '../filler.js'
import { norm } from '../ownWords.js'

export const MAX_MOVE_OFFERS = 2
export const REPLIES_NEEDED = 2

// A founder asking, in any wording, what to do next.
const ASKS_NEXT = [
  /\bwhat (should|do|can|shall|would|am) (i|we)\b.{0,20}\b(do|be doing)\b/,
  /\bwhat (do|should|can|would) you (want|suggest|recommend|have) (me )?(to do|for me)?\b.{0,12}$/,
  /\bso what now\b|\bwhat now\b|\bwhat next\b|\bwhat comes next\b|\bwhats next\b|\bwhat is next\b|\bwhat to do next\b/,
  /\bnext step\b/,
  /\bwhat (is|s) (my|the) (move|step|task)\b|\bwhats (my|the) (move|step|task)\b/,
  /\b(give|show|tell) me (my|the|a|your) (move|step|task|plan)\b/,
  /\btell me what to do\b/,
  /\bwhere (do|should|can) (i|we) (start|begin)\b|\bhow (do|should) (i|we) (start|begin)\b/,
]

export function asksWhatNext(text) {
  const t = norm(text).replace(/['’]/g, '').replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim()
  return t !== '' && ASKS_NEXT.some((rx) => rx.test(t))
}

// A reply counts when it says something: not filler, and more than one word.
export const isRealReply = (text) => asksWhatNext(text) || !isFillerReply(text, { minWords: 2 })

// replies: every founder message in this Learn conversation, oldest first,
//   including the one just received.
// offers: the real-reply count at the time of each offer already made
//   (for example [2] after the first offer was made on the second real reply).
// Returns { offer: 'none' | 'first' | 'second', reason: 'replies' | 'intent' | 'cap' | null, realReplyCount }.
export function decideMoveOffer({ replies = [], offers = [] }) {
  const realReplyCount = replies.filter(isRealReply).length
  const last = replies.length ? replies[replies.length - 1] : ''
  const intent = asksWhatNext(last)

  if (offers.length >= MAX_MOVE_OFFERS) return { offer: 'none', reason: 'cap', realReplyCount }
  if (offers.length === 0) {
    if (intent) return { offer: 'first', reason: 'intent', realReplyCount }
    if (realReplyCount >= REPLIES_NEEDED && isRealReply(last)) return { offer: 'first', reason: 'replies', realReplyCount }
    return { offer: 'none', reason: null, realReplyCount }
  }
  // Second offer: the chat went on after the first one, with a real reply.
  if (isRealReply(last) && realReplyCount > offers[offers.length - 1]) {
    return { offer: 'second', reason: intent ? 'intent' : 'replies', realReplyCount }
  }
  return { offer: 'none', reason: null, realReplyCount }
}

// Wording, from tasks/decisions.md (Decision 5, "always say what to do next")
// and the approved Learn mock. Slots must be filled with the founder's real
// words and facts; the server never invents a subject, a fact or a deadline.
//   subject: what the move is for, from the situation ("the two clinics").
//   fact: one real fact, ending in a full stop ("The two clinics have heard nothing from you for three weeks.").
export const MOVE_NOTICE = Object.freeze({
  first: Object.freeze({
    kicker: 'Your move',
    text: ({ subject } = {}) => (subject ? `Your move for ${subject} is ready.` : 'Your move is ready.'),
  }),
  second: Object.freeze({
    kicker: 'Still waiting',
    text: ({ name, fact } = {}) => `It takes 10 minutes${name ? `, ${name}` : ''}.${fact ? ` ${fact}` : ''}`,
  }),
})

// Axiom's fixed lines in the chat, from the approved Learn mock. The move
// itself is a card inside the chat (decisions.md, "the move is a card in the
// chat"), so no line points at a note at the top.
//   intent: the founder asked what to do next; the card follows.
//   after_cap: both cards have shown; the move waits on the home screen.
export const AXIOM_LINES = Object.freeze({
  intent: 'Here is your move.',
  after_cap: 'Your move is waiting for you on the home screen.',
})
