// One Learn reply: the model writes it, the server checks it. Rules enforced
// here, not in the prompt: the 200-word cap, citations by handle only (author
// and book from the evidence row, quotes verified word for word), no author or
// book named in prose, no quotation marks in prose, only the founder's own
// numbers, one closing question where the turn needs one, a picture only when
// every number in it is traceable. One retry names the problems; after that
// the reply is cleaned rather than refused. Pure apart from the injected
// callStructured.
import { validateCitations, cleanProse } from './citations.js'
import { checkPicture, numbersIn as numbersWithWords } from './pictures.js'
import { stripFiller } from '../filler.js'
import { checkHook, threadKinds } from '../hooks.js'
import { BANNED_PHRASES, TEASER, norm, wordRx } from '../ownWords.js'
import { LEARN_SCHEMA, learnMessages, MAX_FOLLOW_UPS, FOLLOW_UP_MAX } from './prompts/learn.js'

export const WORD_CAP = 200
const SUBJECT_MAX = 40
const FACT_MAX = 160
const QUESTION_MODES = new Set(['lesson', 'reply'])
const NO_QUESTION_MODES = new Set(['offer', 'followup'])

const QUOTE_MARKS = /["“”„‟«»]|‘[^’]{2,}’/
const words = (text) => String(text ?? '').split(/\s+/).filter(Boolean).length
const sentencesOf = (text) => String(text ?? '').split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean)
const digitsIn = (text) => [...norm(text).matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0].replace(/,/g, '').replace(/\.$/, ''))
const hasBanned = (text) => BANNED_PHRASES.some((b) => wordRx(b).test(norm(text)))
const sameText = (s) => norm(s).replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim()

// A sentence that names an author or a book from the evidence. The prose
// never names them; the app shows them from the citation.
function namesSource(sentence, evidence) {
  const s = ` ${sameText(sentence)} `
  return evidence.some((e) => {
    const last = sameText(e.author).split(' ').pop()
    const title = sameText(e.source_title).split(' ').slice(0, 4).join(' ')
    return (last.length > 2 && s.includes(` ${last} `)) || (title.length >= 6 && s.includes(` ${title}`))
  })
}

// Cuts at a sentence boundary so the text has at most `cap` words. Keeps the
// last sentence when it carries the closing question.
export function capWords(text, cap = WORD_CAP, { keepLast = false } = {}) {
  if (words(text) <= cap) return text
  const sentences = sentencesOf(text)
  const last = keepLast && sentences.length > 1 ? sentences.pop() : null
  const budget = cap - (last ? words(last) : 0)
  const kept = []
  let used = 0
  for (const s of sentences) {
    if (used + words(s) > budget) break
    kept.push(s)
    used += words(s)
  }
  if (kept.length === 0 && !last) return `${String(text).split(/\s+/).slice(0, cap).join(' ').replace(/[,;:]$/, '')}.`
  return [...kept, ...(last ? [last] : [])].join(' ')
}

function cleanFollowUps(list) {
  const out = []
  for (const raw of Array.isArray(list) ? list : []) {
    const t = stripFiller(raw).text.trim()
    if (!t || t.length > FOLLOW_UP_MAX || TEASER.test(norm(t)) || hasBanned(t) || QUOTE_MARKS.test(t)) continue
    if (out.some((o) => norm(o) === norm(t))) continue
    out.push(t)
    if (out.length >= MAX_FOLLOW_UPS) break
  }
  return out
}

// A phrase in the founder's own words: every content word is one they wrote,
// every number one they gave.
export function checkSubject(subject, founderTexts) {
  const t = String(subject ?? '').trim().replace(/[.!?]+$/, '')
  if (!t || t.length > SUBJECT_MAX || QUOTE_MARKS.test(t) || hasBanned(t) || /[?]/.test(t)) return null
  const corpus = founderTexts.map(norm).join(' ')
  const ownWords = new Set(corpus.match(/[\p{L}\p{N}']+/gu) ?? [])
  const ownNumbers = new Set(founderTexts.flatMap(numbersWithWords))
  const tokens = norm(t).match(/[\p{L}\p{N}']+/gu) ?? []
  const ok = tokens.every((w) => {
    if (w.length < 3 || ['the', 'and', 'for', 'with', 'your', 'their', 'from', 'about'].includes(w)) return true
    if (ownWords.has(w)) return true
    const n = numbersWithWords(w)
    return n.length > 0 && n.every((x) => ownNumbers.has(x))
  })
  return ok ? t : null
}

// One true sentence built from the founder's facts: a real thread, no number
// they did not give, no question, no teaser.
export function checkFact(fact, founderTexts) {
  const t = String(fact ?? '').trim()
  if (!t || t.length > FACT_MAX || sentencesOf(t).length !== 1 || !/[.]$/.test(t) || QUOTE_MARKS.test(t)) return null
  if (!checkHook({ text: t, sources: founderTexts, requireQuestion: false }).ok || /\?/.test(t)) return null
  const ownNumbers = new Set(founderTexts.flatMap(numbersWithWords))
  return numbersWithWords(t).every((n) => ownNumbers.has(n)) ? t : null
}

// data: the model's output. Returns { reply, problems }. `reply` is the
// cleaned version (every hard rule applied), used when the retry fails too.
export function checkReply({ data, mode, evidence, founderTexts }) {
  const problems = []
  const handles = new Map(evidence.map((e) => [e.handle, e]))
  const citations = (data.citations ?? []).map((c) => ({ handle: c.handle, ...(c.quote?.trim() ? { quote: c.quote } : {}) }))
  const verdict = validateCitations({ answer: { text: data.reply, citations }, evidence })
  for (const f of verdict.flags) {
    if (f.type === 'unverified_quote') problems.push('a quote is not word for word in its passage: copy it exactly or leave quote empty')
    else if (f.type === 'unknown_handle') problems.push('a handle that is not in the evidence')
    else if (f.type === 'author_not_in_evidence' || f.type === 'book_not_in_evidence') problems.push('names an author or book in the reply')
  }
  const sources = verdict.status === 'ok' ? verdict.sources : []
  // A follow-up given passages but citing none came out generic on live (Rafay, Nov 2): ask once more.
  if (mode === 'followup' && evidence.length && sources.length === 0) problems.push('build the answer on the passage that fits it best: put its handle in citations')
  let text = verdict.status === 'ok' ? verdict.text : cleanProse({ text: data.reply, sources: [], handles }).text

  // Sentence by sentence: what may never reach the founder goes. A cited author or book may be named; any other may not.
  const uncited = evidence.filter((e) => !sources.some((s) => s.handle === e.handle))
  const passageNumbers = new Set(evidence.filter((e) => sources.some((s) => s.handle === e.handle)).flatMap((e) => digitsIn(e.text)))
  const ownNumbers = new Set(founderTexts.flatMap(digitsIn))
  const kept = []
  for (const sentence of sentencesOf(text)) {
    if (namesSource(sentence, uncited)) { problems.push('names an author or book it did not cite'); continue }
    if (QUOTE_MARKS.test(sentence)) { problems.push('quotation marks in the reply'); continue }
    if (hasBanned(sentence)) { problems.push('a banned phrase'); continue }
    if (TEASER.test(norm(sentence))) { problems.push('a teaser'); continue }
    const unknown = digitsIn(sentence).find((n) => !ownNumbers.has(n) && !passageNumbers.has(n))
    if (unknown) { problems.push(`a number the founder never gave: ${unknown}`); continue }
    kept.push(sentence)
  }
  text = stripFiller(kept.join(' ')).text

  const questions = (text.match(/\?/g) ?? []).length
  if (QUESTION_MODES.has(mode) && (questions !== 1 || !text.trim().endsWith('?'))) problems.push('it must end with exactly one plain question')
  if (NO_QUESTION_MODES.has(mode) && questions > 0) {
    problems.push('no question in this reply')
    text = sentencesOf(text).filter((s) => !s.includes('?')).join(' ')
  }
  if (words(text) > WORD_CAP) {
    problems.push(`too long: ${words(text)} words, the cap is ${WORD_CAP}`)
    text = capWords(text, WORD_CAP, { keepLast: QUESTION_MODES.has(mode) })
  }
  if (text && threadKinds(text, founderTexts).length === 0) problems.push('nothing from this founder: use their own words, a number or a date they gave')

  let picture = null
  if (data.picture_json?.trim()) {
    let parsed = null
    try { parsed = JSON.parse(data.picture_json) } catch { parsed = null }
    const checked = checkPicture({ picture: parsed, founderTexts, passageTexts: sources.map((s) => s.quote).filter(Boolean) })
    if (checked.ok) picture = checked.picture
  }

  const reply = {
    text,
    sources,
    picture,
    follow_ups: mode === 'followup' ? [] : cleanFollowUps(data.follow_ups),
    move_subject: checkSubject(data.move_subject, founderTexts),
    move_fact: checkFact(data.move_fact, founderTexts),
    flags: verdict.flags,
  }
  if (!text) problems.push('nothing usable is left in the reply')
  return { reply, problems: [...new Set(problems)] }
}

// context: { signUp, situation, read, learn, tapped? } as the prompt takes it.
// founderTexts: every string the founder wrote or chose (sign-up, situation,
// Read answer, Learn replies). deps: { callStructured, userId, log }.
// Throws only when no usable reply exists after two attempts.
export async function composeReply({ mode, step, context, evidence, founderTexts, usageContext, deps }) {
  // Author and title are shown so the lesson can name who taught it (Rafay, Nov 2); the server still checks every name.
  const shown = evidence.map((e) => ({ handle: e.handle, author: e.author, title: e.source_title, text: e.text }))
  let problems = null
  let fallback = null
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    let data
    try {
      ;({ data } = await deps.callStructured({
        step,
        schema: LEARN_SCHEMA,
        schemaName: 'learn_reply',
        maxCompletionTokens: 1200,
        userId: deps.userId,
        usageContext,
        messages: learnMessages({ mode, ...context, evidence: shown }, problems),
      }))
    } catch (err) {
      deps.log?.('model call failed', err)
      if (fallback) return fallback
      throw err
    }
    const verdict = checkReply({ data, mode, evidence, founderTexts })
    if (verdict.problems.length === 0) return verdict.reply
    if (verdict.reply.text) fallback = verdict.reply
    problems = verdict.problems
  }
  deps.log?.('learn reply cleaned after retry', { problems })
  if (fallback) return fallback
  throw new Error('No usable Learn reply')
}
