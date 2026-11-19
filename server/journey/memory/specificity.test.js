import assert from 'node:assert/strict'
import test from 'node:test'
import { createFakeClock, createFakeSupabase } from '../../testing/fakes.js'
import { EMPTY_BELIEFS } from '../../e2e/harness.js'
import { FULL_ANSWERS } from '../fixtures.js'
import { BRIEF_MAX_CHARS, buildBriefText } from './brief.js'
import { SENSITIVE } from './beliefRules.js'
import { seedFromSignup } from './signupSeed.js'

const A = '11111111-1111-4111-8111-111111111111'
const UNIQUE = { memory_runs: [{ cols: ['source_kind', 'source_id', 'mode'], where: (r) => r.status !== 'failed' }] }

// Anonymised from a real founder's sign-up.
const SHOPPER = {
  stage: { value: "It's growing" },
  commitment: { value: 'Evenings and weekends, under 15 hours' },
  where: { country: 'Karachi, Pakistan', customers: 'Mostly in my own country' },
  building: 'I am building a international shopping service brand. I source products from the world to Pakistan',
  stuck: 'Nothing much...it takes alot of time because i solely work on it',
  contrarian: 'Alot of people are doing it, why do you wanna come into competiton',
  people: 'Me myself and I',
  strengths: { a: ['Selling'], b: ['Asking for money', 'Talking to customers'] },
  decision: { value: 'Wait and collect more' },
  drop_plan: { value: 'A better idea showed up' },
  hard_truth: { value: 'Straight' },
}
// What a model that follows the sign-up prompt would return for it (a fake: no real call is made).
const SHOPPER_FACTS = [
  { belief: 'Sources products from the world to Pakistan.', kind: 'fact', snippet: 'I source products from the world to Pakistan' },
  { belief: 'Works alone.', kind: 'fact', snippet: 'Me myself and I' },
]
const SITUATION = 'I would like to manage it manually even if it take my time. I would order the products by myself to know the cost.'

async function briefFor(answers, newBeliefs, currentText) {
  const supabase = createFakeSupabase({ tables: {}, unique: UNIQUE })
  const callStructured = async () => ({ data: { ...EMPTY_BELIEFS, new_beliefs: newBeliefs }, model: 'gpt-test' })
  await seedFromSignup({ supabase, callStructured, userId: A, answers, clock: createFakeClock(Date.parse('2026-11-14T12:00:00Z')) })
  const beliefs = supabase.rows('founder_beliefs')
  return { beliefs, text: buildBriefText({ beliefs, traits: supabase.rows('founder_traits'), currentText, nowMs: Date.parse('2026-11-14T12:00:00Z') }) }
}

test('after one situation the brief holds things only this founder would say, within the rules', async () => {
  const { beliefs, text } = await briefFor(SHOPPER, SHOPPER_FACTS, SITUATION)
  const lines = text.split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2))
  const only = [
    'Sources products from the world to Pakistan.',
    'Better than most at selling, and avoids asking for money and talking to customers.',
    'decision speed: deliberate',
    'Works alone.',
  ]
  for (const line of only) assert.ok(lines.includes(line), `missing: ${line}`)
  assert.ok(text.length <= BRIEF_MAX_CHARS)
  assert.deepEqual(lines.filter((l) => SENSITIVE.some((rx) => rx.test(l.toLowerCase()))), []) // nothing on mood, health, family
  // no invented words: every word of the tension line is in a stored sign-up belief text
  const stored = new Set(beliefs.flatMap((r) => r.belief.toLowerCase().match(/[a-z]+/g)))
  for (const w of only[1].toLowerCase().match(/[a-z]+/g)) assert.ok(stored.has(w) || ['and', 'avoids'].includes(w), `invented: ${w}`)
})

test('a different founder gets a different brief', async () => {
  const mine = await briefFor(SHOPPER, SHOPPER_FACTS, SITUATION)
  const other = await briefFor(FULL_ANSWERS, [], 'I want to email the 2 clinics about pricing')
  assert.notEqual(mine.text, other.text)
  assert.ok(!other.text.includes('Pakistan') && !other.text.includes('selling'))
})
