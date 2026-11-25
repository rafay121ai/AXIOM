// "What is Axiom?" typed where a situation starts: answered with fixed, approved wording (Rafay, Nov 23, version A),
// never a model, never a situation. Specific to the founder: their last situation and their open move, when they have them.
import { norm } from './ownWords.js'

const MAX_WORDS = 14 // a question about Axiom is short; a longer message is a real situation that mentions it

const ASKS = [
  /\b(what|who|how)\b[^?]*\baxiom\b/, // "what is axiom", "how does axiom work"
  /\bwhat (can|do) you do\b/, // "what can you do"
  /\bwhat (can|do) i (use (you|this|it)( for)?|ask( you)?|do (with|here|on) (you|this|it))\b/, // "what can I use you for", never "what can I do about my cofounder"
  /\bwhat (is|does) (this|this app|it) (do|for)\b/,
  /\bhow (does|do) (this|it|you) work\b/,
  /\b(who|what) are you\b/,
  /\bhow (can|do|will) you help\b/,
]

export function asksAboutAxiom(text) {
  const t = norm(text).replace(/[^\p{L}\p{N}\s'?]/gu, ' ').replace(/\s+/g, ' ').trim()
  if (!t || t.split(' ').length > MAX_WORDS) return false
  return ASKS.some((rx) => rx.test(t))
}

export const ABOUT_AXIOM = [
  "You're making calls nobody around you has made before, usually alone, usually by Friday.",
  "That's what I'm for. Tell me what's going on, in your own words. I'll tell you what you're not seeing, show you what founders and authors who've been there learned, and hand you one thing you can do today. Not a plan. One move.",
  "Tonight I'll ask how it went. Whatever happens, I keep it, so the next time you're stuck, I already know you.",
]
export const ABOUT_CLOSING = "What's the decision you keep putting off?"

const plain = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().replace(/[.!?]+$/, '')
const lowerFirst = (s) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s)

// lastTitle: their newest situation's title; openMove: the title of a committed move not yet reported. Either may be null.
export function aboutAxiomText({ lastTitle = null, openMove = null } = {}) {
  const title = plain(lastTitle)
  const move = plain(openMove)
  const yours = title
    ? (move ? `Last time it was "${title}", and your move to ${lowerFirst(move)} is still open.` : `Last time it was "${title}".`)
    : null
  return [...ABOUT_AXIOM, ...(yours ? [yours] : []), ABOUT_CLOSING].join('\n\n')
}
