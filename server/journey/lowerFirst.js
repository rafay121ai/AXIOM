// Lowercases a capitalised ordinary first word ("A few", "Both") so a title or prediction reads
// mid-sentence; keeps "I", I'm/I'll/I've/I'd and all-caps words (AI, MRR, B2B).
export const lowerFirst = (s) => {
  const word = /^[A-Za-z0-9'’]+/.exec(s)?.[0] ?? ''
  const keep = /^I(['’](m|ll|ve|d))?$/.test(word) || /^[A-Z0-9]{2,}$/.test(word)
  return /^[A-Z]/.test(s) && !keep ? s.charAt(0).toLowerCase() + s.slice(1) : s
}
