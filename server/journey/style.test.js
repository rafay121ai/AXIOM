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
  read: 'd45de31dad59877283d530982409b61c3889b1e35d2e32a9fa25a1996d00e514',
  learn: 'd7e5f563635f2f6158c05609e3adf7f6df1d5c86eebad58d4031219e3787898f', // Nov 2: cited authors named in the text, follow-ups built on a passage
  move: '156608d1bf36f1cd7830794f19a1bf727f5d9c1efe9ae2a110ccad8207d52f60',
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
