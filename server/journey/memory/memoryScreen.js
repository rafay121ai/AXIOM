// "What Axiom thinks": the founder's active memory in plain second person, and the
// "this is wrong" control. Reads and the retire step only; no model, and nothing
// internal (confidence, user_id, sources) leaves here. Code-made wording, no model text.
import { HttpError } from '../situations.js'
import { IN_THEIR_WORDS, USE_THRESHOLD, cleanStoredText } from './beliefRules.js'
import { createMemoryStore } from './memoryStore.js'

export const GROUP_MAX = 12
export const TABLES = Object.freeze(['founder_beliefs', 'founder_traits', 'founder_world', 'founder_vocabulary', 'founder_threads'])
export const REASONS = Object.freeze(['wrong', 'outdated'])

// NEW copy, one sentence per dimension and value (needs Rafay's approval).
export const TRAIT_TEXT = Object.freeze({
  decision_speed: {
    fast: 'You decide fast and adjust later.',
    deliberate: 'You take time to weigh a decision before you make it.',
    waits_until_forced: 'You usually decide when the deadline is close.',
  },
  evidence_basis: {
    numbers_first: 'You look at the numbers before you decide.',
    gut_first: 'You trust your own judgement first and check it later.',
    asks_others: 'You ask people you trust before you decide.',
  },
  after_setback: {
    changes_approach: 'When something fails, you change the approach.',
    digs_into_why: 'When something fails, you look for the reason before the next step.',
    pauses: 'When something fails, you stop for a while before the next step.',
    pushes_harder: 'When something fails, you try the same plan again with more effort.',
  },
  move_size: {
    small_steps: 'You prefer small steps.',
    big_swings: 'You prefer big moves.',
  },
  detail_level: {
    big_picture: 'You start with the whole plan, then the detail.',
    detail: 'You want the detail before you commit.',
  },
  pace_of_follow_through: {
    same_day: 'You usually finish a move the same day.',
    within_48h: 'You usually finish a move within two days.',
    drifts: 'You often finish a move after the time you set.',
  },
})

// Third person (as stored) to second person. Only known openings are changed; anything else, and any sentence
// where "they" could mean someone else (another subject, a second clause, a plural third party), is left exactly as written.
const VERBS = { says: 'say', wants: 'want', sells: 'sell', prefers: 'prefer', avoids: 'avoid', drops: 'drop', skips: 'skip', decides: 'decide', has: 'have', is: 'are', likes: 'like' }
const PRONOUNS = [[/\bthemselves\b/gi, 'yourself'], [/\btheirs\b/gi, 'yours'], [/\btheir\b/gi, 'your'], [/\bthem\b/gi, 'you'], [/\bthey(?=['’](?:re|ve|ll|d)\b)/gi, 'you'], [/\bthey\b/gi, 'you']]
const swapPronouns = (t) => PRONOUNS.reduce((s, [rx, to]) => s.replace(rx, (m) => (m[0] === m[0].toUpperCase() ? to[0].toUpperCase() + to.slice(1) : to)), t)
const OPENINGS = [ // [opening, replacement]; the rest of the sentence gets the pronoun swap
  [/^Says they /, 'You say you '],
  [/^Where they /, 'Where you '],
  [/^Why they /, 'Why you '],
  [/^They /, 'You '],
  [/^Their /, 'Your '],
  [/^Based in /, 'You are based in '],
]
const OTHER_SUBJECT = /\b(who|whom|whose|which|that|because|while)\b[^.]*\b(they|them|their)\b/i
// A plural third party as a possible subject (start, after Their, a comma or a joining word); as an object ("avoid talking to customers") it is safe.
const PLURAL_THIRD = /(^|[,;]\s*|\b(their|and|but|because|when|while|that|if|so)\s+)(the\s+)?(customers|clients|users|people|team|investors|competitors)\b/i
const SUBJECT_THEY = /\bthey\b/gi

export function toSecondPerson(text) {
  const t = cleanStoredText(text)
  if (t.startsWith(IN_THEIR_WORDS)) return `You said: "${t.slice(IN_THEIR_WORDS.length)}"`
  if (PLURAL_THIRD.test(t) || (t.match(SUBJECT_THEY) ?? []).length > 1) return t
  const open = OPENINGS.find(([rx]) => rx.test(t))
  if (open) return OTHER_SUBJECT.test(t) || (open[1] === 'Your ' && SUBJECT_THEY.test(t)) ? t : swapPronouns(t.replace(open[0], open[1]))
  const verb = (/^(?:The founder\s+)?(\p{L}+)\s/u.exec(t) ?? [])[1]
  const to = verb && VERBS[verb.toLowerCase()]
  // "The founder sells ..." or a leading verb ("Wants hard things said gently."): only when no pronoun is left that could mean someone else.
  if (to && !/\b(they|them|their|theirs|he|she|him|her|his)\b/i.test(t) && (t.match(/\bthe founder\b/gi) ?? []).length <= 1) {
    return t.replace(/^(?:The founder\s+)?\p{L}+/u, `You ${to}`)
  }
  return t
}

const newest = (a, b) => String(b.at).localeCompare(String(a.at))
// Sign-up questions answered in the founder's own typed words; every other sign-up receipt is a tapped option.
const TYPED_SIGNUP = new Set(['building', 'stuck', 'contrarian', 'people'])

export function createMemoryScreen({ supabase, clock }) {
  const store = createMemoryStore({ supabase, clock })
  const usable = (r) => r.confidence >= USE_THRESHOLD

  // The receipt as the screen shows it: the founder's words in quotes, "Your move: title", or "You picked: label".
  async function receiptsFor(userId, evidence) {
    const rows = Object.values(evidence).flatMap((byItem) => Object.values(byItem))
    const ids = [...new Set(rows.filter((e) => ['move', 'swap'].includes(e.source_kind) && e.source_id).map((e) => e.source_id))]
    const titles = {}
    if (ids.length > 0) {
      const { data, error } = await supabase.from('moves').select('id, title').eq('user_id', userId).in('id', ids)
      if (error) throw error
      for (const m of data ?? []) titles[m.id] = m.title
    }
    return (e) => {
      if (!e) return null
      let text = `"${e.snippet}"`
      if (e.source_kind === 'signup' && !TYPED_SIGNUP.has(e.source_key)) text = `You picked: ${e.snippet}`
      else if (titles[e.source_id]) text = `Your move: ${titles[e.source_id]}`
      return { text, at: e.created_at }
    }
  }

  async function list(userId) {
    const [beliefs, traits, world, vocabulary, threads, proof] = await Promise.all([
      store.activeBeliefs(userId), store.activeTraits(userId), store.activeWorld(userId), store.activeVocabulary(userId), store.openThreads(userId),
      Promise.all(TABLES.map((t) => store.latestEvidence(userId, t))),
    ])
    const evidence = Object.fromEntries(TABLES.map((t, i) => [t, proof[i]]))
    const receiptOf = await receiptsFor(userId, evidence)
    // at: newest receipt, else when the row was made; only for sorting.
    const item = (table, row, group, text) => {
      const receipt = receiptOf(evidence[table][row.id])
      return { id: row.id, table, group, text, receipt, at: receipt?.at ?? String(row.created_at ?? '') }
    }
    const groups = [
      traits.filter((t) => usable(t) && TRAIT_TEXT[t.dimension]?.[t.value]).map((t) => item('founder_traits', t, 'decide', TRAIT_TEXT[t.dimension][t.value])).sort(newest).slice(0, GROUP_MAX),
      beliefs.filter((b) => b.kind !== 'fact' && usable(b)).map((b) => item('founder_beliefs', b, 'work', toSecondPerson(b.belief))).sort(newest).slice(0, GROUP_MAX),
      beliefs.filter((b) => b.kind === 'fact' && usable(b)).map((b) => item('founder_beliefs', b, 'business', toSecondPerson(b.belief))).sort(newest).slice(0, GROUP_MAX),
      [ // people first, then shorthand; each capped on its own (12 + 12) so shorthand is never hidden by a long people list
        ...world.map((w) => item('founder_world', w, 'people', `${w.role ? `${w.name}: ${cleanStoredText(w.role).replace(/\.$/, '')}.` : `${w.name}.`}${w.mention_count > 1 ? ` You have mentioned ${w.name} ${w.mention_count} times.` : ''}`)).sort(newest).slice(0, GROUP_MAX),
        ...vocabulary.map((v) => item('founder_vocabulary', v, 'people', `"${v.term}" means ${cleanStoredText(v.meaning).replace(/\.$/, '')}.`)).sort(newest).slice(0, GROUP_MAX),
      ],
      threads.map((t) => item('founder_threads', t, 'open', toSecondPerson(t.title))).sort(newest).slice(0, GROUP_MAX),
    ]
    return { items: groups.flat().map(({ id, table, group, text, receipt }) => ({ id, table, group, text, receipt })) }
  }

  // Corrections first, then the row is retired. A row that is already retired answers ok and writes nothing.
  async function markWrong({ userId, table, id, reason }) {
    if (!TABLES.includes(table)) throw new HttpError(404, { error: 'Not found' })
    if (!REASONS.includes(reason)) throw new HttpError(400, { error: 'reason must be wrong or outdated' })
    const row = await store.item(table, userId, id)
    if (!row) throw new HttpError(404, { error: 'Not found' })
    if (row.status !== (table === 'founder_threads' ? 'open' : 'active')) return { ok: true }
    const itemText = { founder_beliefs: row.belief, founder_traits: `${row.dimension}: ${row.value}`, founder_world: row.name, founder_vocabulary: row.term, founder_threads: row.title }[table]
    await store.addCorrection({ userId, itemTable: table, itemText: itemText.slice(0, 240), reason })
    await store.retire(table, userId, id)
    return { ok: true }
  }

  return { list, markWrong }
}
