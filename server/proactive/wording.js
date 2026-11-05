// Every sentence Axiom opens a situation with. Fixed sentences filled with the
// founder's own words: no model call. All approved by Rafay on Nov 4.
const lowerFirst = (s) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s)
const plain = (s) => lowerFirst(String(s ?? '').trim().replace(/[.!?\s]+$/, ''))

// facts: from triggers.js. Returns the opener text.
export function openerText(kind, facts) {
  if (kind === 'two_misses') {
    return `Your last two moves did not happen: ${plain(facts.moves[0])} and ${plain(facts.moves[1])}. What got in the way?` // (approved Nov 4)
  }
  if (facts.window === 3) {
    return `${facts.days} ${facts.days === 1 ? 'day' : 'days'} to ${facts.date}, and you said "${facts.goal}". What is left?` // (approved Nov 4)
  }
  return `You said "${facts.goal}" by ${facts.date}. That is ${facts.days} days away. Where is it now?` // (approved Nov 4)
}
