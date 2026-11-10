// The sign-up seed. Part 1 is code only: the founder's tapped answers become
// first beliefs, one trait and a preference, all self-reported (confidence at
// most 0.5, receipt = the exact option label). Part 2 is one facts-only model
// pass over the written answers, checked like any extraction. The two parts
// are recorded separately, so either can be retried on its own. Never throws.
import { deadlineFor } from '../signup.js'
import { isSkip } from '../questions.js'
import { createSharing } from '../report/sharing.js'
import { IN_THEIR_WORDS, NEW_PATTERN_CONFIDENCE, SELF_REPORT_CAP, checkBeliefText, cleanStoredText, snippetInSource } from './beliefRules.js'
import { applyExtraction, isCorrected, overCap } from './extractBeliefs.js'
import { createMemoryStore } from './memoryStore.js'
import { FACTS_ONLY_SCHEMA, signupMessages } from './prompts/beliefs.js'

const DECISION_TRAIT = {
  'Decide now and adjust later': ['decision_speed', 'fast'],
  'Wait and collect more': ['decision_speed', 'deliberate'],
  'Ask someone I trust': ['evidence_basis', 'asks_others'],
  'Put it off until I have to': ['decision_speed', 'waits_until_forced'],
}
const DROP_PLAN = {
  'A better idea showed up': 'Says they drop plans when a better idea shows up.',
  'It got repetitive': 'Says they drop plans when the work gets repetitive.',
  'Nobody was checking on me': 'Says they drop plans when nobody is checking on them.',
  'It got uncomfortable': 'Says they drop plans when the work gets uncomfortable.',
} // 'I rarely drop plans' creates nothing
const HARD_TRUTH = {
  Gently: 'Wants hard things said gently.',
  Straight: 'Wants hard things said straight.',
  'Blunt, no padding': 'Wants hard things said bluntly, with no padding.',
}
const CUSTOMERS = {
  'Mostly in my own country': 'Your customers are mostly in your own country.',
  'Mostly abroad': 'Your customers are mostly abroad.',
  'Both': 'Your customers are in your own country and abroad.',
}
const low = (s) => s.charAt(0).toLowerCase() + s.slice(1)
const written = (v) => (typeof v === 'string' && !isSkip(v) && v.trim() ? v.trim() : null)

// The rows part 1 writes: [{ key, kind, text, snippet }]. Pure.
export function seedRows(answers, nowMs = Date.now()) {
  const rows = []
  const add = (key, kind, text, snippet) => rows.push({ key, kind, text: cleanStoredText(text), snippet: cleanStoredText(snippet) })
  const a = answers ?? {}
  if (a.stage?.value) add('stage', 'fact', `You are at this stage: ${low(a.stage.value)}.`, a.stage.value)
  if (a.commitment?.value) add('commitment', 'fact', `Your time on it: ${low(a.commitment.value)}.`, a.commitment.value)
  if (a.business_model?.value) add('business_model', 'fact', `Who pays you: ${low(a.business_model.value)}.`, a.business_model.value)
  // Free text: it passes the same checks as every other belief, and is dropped if it fails.
  const country = written(a.where?.country)
  if (country) {
    const checked = checkBeliefText({ text: `Based in ${country}.`, sourceTexts: [country] })
    if (checked.ok) add('where', 'fact', checked.text, country)
  }
  if (a.where?.customers) if (CUSTOMERS[a.where.customers]) add('where', 'fact', CUSTOMERS[a.where.customers], a.where.customers)
  if (a.goal?.goal && a.goal?.when) {
    const by = deadlineFor(a.goal, nowMs)
    add('goal', 'fact', `Your goal: ${low(a.goal.goal)}, ${a.goal.date ? `by ${by}` : low(a.goal.when)}.`, a.goal.goal)
  }
  if (a.why?.value) add('why', 'fact', `Why they are doing it: ${a.why.value}.`, a.why.value)
  for (const label of a.strengths?.a ?? []) add('strengths', 'pattern', `Says they are better than most at ${low(label)}.`, label)
  for (const label of a.strengths?.b ?? []) add('strengths', 'pattern', `Says they avoid ${low(label)}.`, label)
  if (DROP_PLAN[a.drop_plan?.value]) add('drop_plan', 'pattern', DROP_PLAN[a.drop_plan.value], a.drop_plan.value)
  if (HARD_TRUTH[a.hard_truth?.value]) add('hard_truth', 'preference', HARD_TRUTH[a.hard_truth.value], a.hard_truth.value)
  // The contrarian belief stays verbatim, so code copies it: nothing to invent.
  const own = written(a.contrarian)
  const checked = own && checkBeliefText({ text: `${IN_THEIR_WORDS}${own}`, sourceTexts: [own] })
  if (checked?.ok) add('contrarian', 'fact', checked.text, own)
  return rows
}

// isCapped(userId): true when the founder is over the daily cost cap. The code part is free and always runs; the model part is then skipped.
export async function seedFromSignup({ supabase, store, callStructured, userId, answers, log = () => {}, clock = { now: () => Date.now() }, isCapped = async () => false }) {
  const mem = store ?? createMemoryStore({ supabase, clock, log })
  const run = (mode, status, model = null) => mem.recordRun({ userId, sourceKind: 'signup', sourceId: userId, mode, status, model })
  const proof = (itemTable, itemId, key, snippet) => mem.addEvidence([{ userId, itemTable, itemId, sourceKind: 'signup', sourceKey: key, snippet }])
  const result = { code: 'skipped', model: 'skipped' }

  try {
    if (!(await mem.hasRun(userId, 'signup', userId, 'signup_seed'))) {
      const taken = new Set((await mem.activeBeliefs(userId)).map((b) => b.belief))
      const traits = await mem.activeTraits(userId)
      const corrections = await mem.corrections(userId)
      const trait = DECISION_TRAIT[answers?.decision?.value]
      // Recorded as done before the first write, so a second seed finds the claim and writes nothing; each row is then written on its own.
      if (await run('signup_seed', 'done')) {
        for (const r of seedRows(answers, clock.now())) {
          if (taken.has(r.text) || isCorrected(corrections, 'founder_beliefs', r.text)) continue
          try {
            const row = await mem.insertBelief({
              userId, belief: r.text, kind: r.kind, source: 'signup',
              confidence: r.kind === 'pattern' ? NEW_PATTERN_CONFIDENCE : SELF_REPORT_CAP,
            })
            await proof('founder_beliefs', row.id, r.key, r.snippet)
          } catch (err) {
            log('sign-up seed row skipped', err)
          }
        }
        if (trait && !traits.some((t) => t.dimension === trait[0]) && !isCorrected(corrections, 'founder_traits', trait.join(' ').replace(/_/g, ' '))) {
          try {
            const row = await mem.upsertTrait({ userId, dimension: trait[0], value: trait[1], confidence: SELF_REPORT_CAP, origin: 'self_report' })
            if (row) await proof('founder_traits', row.id, 'decision', answers.decision.value)
          } catch (err) {
            log('sign-up seed trait skipped', err)
          }
        }
        result.code = 'done'
      }
    }
  } catch (err) {
    log('sign-up seed failed', err)
    await run('signup_seed', 'failed').catch(() => {})
    result.code = 'failed'
  }

  try {
    if (!(await mem.hasRun(userId, 'signup', userId, 'facts_only')) && !(await createSharing({ supabase, clock }).careOpen(userId))) {
      result.model = await modelPart({ mem, callStructured, userId, answers, run, clock, isCapped, log })
    }
  } catch (err) {
    log('sign-up model pass failed', err)
    await run('facts_only', 'failed').catch(() => {})
    result.model = 'failed'
  }
  return result
}

// The written answers (building, stuck, contrarian, people; skipped ones are left out) through one facts-only call.
async function modelPart({ mem, callStructured, userId, answers, run, clock, isCapped, log }) {
  const texts = Object.fromEntries(['building', 'stuck', 'contrarian', 'people'].map((k) => [k, written(answers?.[k])]).filter(([, v]) => v))
  const goal = answers?.goal ? Object.values(answers.goal).filter((v) => typeof v === 'string') : []
  if (Object.keys(texts).length === 0) {
    await run('facts_only', 'done')
    return 'skipped'
  }
  const corrections = await mem.corrections(userId)
  if (await overCap(isCapped, userId)) return 'skipped' // over the daily cost cap: no paid call, nothing recorded
  const { data, model } = await callStructured({
    step: 'beliefs',
    schema: FACTS_ONLY_SCHEMA,
    schemaName: 'beliefs_facts_only',
    maxCompletionTokens: 1000,
    userId,
    usageContext: { step: 'beliefs', mode: 'facts_only', source_kind: 'signup' },
    messages: signupMessages({ answers: texts, goal: answers?.goal ?? null, corrections: corrections.map((c) => ({ item_text: c.item_text })) }),
  })
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('memory output is not an object')
  const applied = await applyExtraction({
    store: mem, userId, data: { ...data, reinforce: [], weaken: [], supersede: [] }, mode: 'facts_only',
    founderTexts: [...Object.values(texts), ...goal],
    receipt: (snippet) => ({ sourceKind: 'signup', sourceKey: Object.keys(texts).find((k) => snippetInSource(snippet, [texts[k]])) ?? 'building' }),
    beliefSource: 'signup', nowMs: clock.now(), corrections, cap: SELF_REPORT_CAP, log,
    claim: async () => !(await mem.hasRun(userId, 'signup', userId, 'facts_only')) && (await run('facts_only', 'done', model)) !== null,
  })
  return applied ? 'done' : 'skipped'
}
