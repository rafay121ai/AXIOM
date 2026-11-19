import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { createFakeSupabase } from '../testing/fakes.js'
import { READ_PROMPT, readMessages } from './prompts/read.js'
import { LEARN_PROMPT, learnMessages } from './learn/prompts/learn.js'
import { MOVE_PROMPT, moveMessages } from './move/prompts/move.js'
import { REPORT_PROMPT, reportMessages } from './report/prompts/report.js'
import { STYLE_INSTRUCTIONS, styleMessages, styleOf } from './prompts/style.js'

const sha = (s) => createHash('sha256').update(s).digest('hex')
// Snapshot of the prompts as they were before styles existed.
const OLD = {
  read: '50e663cae8fb8695c1fe5997961ae8688b782daeb90321e103118a71656b60da', // Nov 19: no quote or 4-word run in the headline and closing question; no "not X, it is Y"; no brackets
  learn: 'd04a02aaaa40cca1e283f0a90e3c428ff391405817de43d82c974cdb9eea6cca', // Nov 19: a bare number keeps the words the founder gave it
  move: '638208fc55357aa86e4866f32610a66ebf9033f660be7be304dab0cbe031e5a5', // Nov 19: a swap is a different move, not a rewording
  report: '6ce24f154ae001da47b70fddb78b7365b1d79fd8f9ecb8dea1622566694127a7',
}
const base = { signUp: [], conversation: [], situation: [], read: null, learn: [], evidence: [], subject: 's', fact: 'f', move: {}, outcome: 'done', note: 'n' }
const BUILDERS = {
  read: [READ_PROMPT, (style) => readMessages({ ...base, style })],
  learn: [LEARN_PROMPT, (style) => learnMessages({ ...base, mode: 'offer', style })],
  move: [MOVE_PROMPT, (style) => moveMessages({ ...base, style })],
  report: [REPORT_PROMPT, (style) => reportMessages({ ...base, style })],
}
const SYSTEM = (messages) => messages.filter((m) => m.role === 'system').map((m) => m.content)

test('base prompts are unchanged', () => {
  for (const [name, [prompt]] of Object.entries(BUILDERS)) assert.equal(sha(prompt), OLD[name], name)
})

test('direct, unknown and missing add nothing; calm and hard add their own block', () => {
  assert.ok(STYLE_INSTRUCTIONS.calm.includes('calm') && STYLE_INSTRUCTIONS.hard.includes('hard'))
  for (const [name, [prompt, build]] of Object.entries(BUILDERS)) {
    const plain = build(undefined)
    assert.equal(plain[0].content, prompt, name)
    for (const style of ['direct', 'bogus', null, '__proto__', 'toString']) assert.deepEqual(build(style), plain, `${name} ${style}`)
    for (const style of ['calm', 'hard']) {
      const styled = build(style)
      assert.equal(styled.length, plain.length + 1)
      assert.deepEqual(styled[0], plain[0])
      assert.deepEqual(styled[1], { role: 'system', content: STYLE_INSTRUCTIONS[style] })
      assert.ok(SYSTEM(styled).includes(STYLE_INSTRUCTIONS[style]))
    }
  }
  assert.deepEqual(styleMessages('direct'), [])
})

test('the style is read fresh on every call, default direct', async () => {
  const supabase = createFakeSupabase()
  assert.equal(await styleOf(supabase, 'u1'), 'direct')
  await supabase.from('user_settings').insert({ user_id: 'u1', mentor_style: 'hard' })
  assert.equal(await styleOf(supabase, 'u1'), 'hard')
  await supabase.from('user_settings').update({ mentor_style: 'calm' }).eq('user_id', 'u1')
  assert.equal(await styleOf(supabase, 'u1'), 'calm')
  await supabase.from('user_settings').update({ mentor_style: 'loud' }).eq('user_id', 'u1')
  assert.equal(await styleOf(supabase, 'u1'), 'direct')
  assert.equal(await styleOf(supabase, 'someone-else'), 'direct')
})

test('a founder in a care hold, or an unreadable store, is never styled', async () => {
  const supabase = createFakeSupabase({ tables: {
    user_settings: [{ user_id: 'u1', mentor_style: 'hard' }],
    care_events: [{ id: 'c1', user_id: 'u1', level: 'clear', resolved_at: null }],
  } })
  assert.equal(await styleOf(supabase, 'u1'), 'direct')
  await supabase.from('care_events').update({ resolved_at: '2026-01-01T00:00:00Z' }).eq('id', 'c1')
  assert.equal(await styleOf(supabase, 'u1'), 'hard')
  assert.equal(await styleOf({ from() { throw new Error('down') } }, 'u1'), 'direct')
})
