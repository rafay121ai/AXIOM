// Regression tests for mistakes found in B2 to B5 (see tasks/lessons.md):
// copy drifting from the approved mock, invented facts in fallbacks, removed
// behaviour coming back, and tests colliding with the build office port.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CARE_COPY } from '../care/copy.js'
import { fallbackRead, checkRead } from './theRead.js'
import { buildEvidence, fallbackReading } from './firstReading.js'
import { checkFirstReading } from './ownWords.js'
import { FULL_ANSWERS } from './fixtures.js'
import { READ_SCHEMA } from './prompts/read.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const decode = (s) => s.replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"')
const mock = readFileSync(join(ROOT, 'tasks/design/mock-onboarding-v2.html'), 'utf8')
const careBlock = mock.slice(mock.indexOf('id="care"'), mock.indexOf('<!-- 11 settings -->'))
const grab = (re) => [...careBlock.matchAll(re)].map((m) => decode(m[1].trim()))

test('care copy is word for word the approved mock', () => {
  const approved = [
    ...grab(/<h2 class="crh">([^<]*)</g),
    ...grab(/<p class="crp">([^<]*)</g),
    ...grab(/<p class="crsmall">([^<]*)</g),
  ]
  const ours = CARE_COPY.clearMessage.split('\n\n')
  assert.equal(ours.length, approved.length)
  for (const p of ours) assert.ok(approved.includes(p), `not in the approved mock: ${p}`)
})

test('fake app care text may only repeat server sentences or say Placeholder', () => {
  const fake = readFileSync(join(ROOT, 'app/src/api/fake.ts'), 'utf8')
  const block = fake.slice(fake.indexOf('const CLEAR'), fake.indexOf('help:'))
  const lines = [...block.matchAll(/^\s+(['"])(.*)\1,$/gm)].map((m) => m[2].replace(/\\'/g, "'"))
  const server = CARE_COPY.clearMessage.split('\n\n')
  for (const l of lines) assert.ok(l.startsWith('Placeholder') || server.includes(l), `care sentence only in the app: ${l}`)
})

test('fallback read invents nothing: every fact comes from the founder, grammar is whole', () => {
  const text = 'I run a skincare brand and three clinics asked for pricing. We have no website yet.'
  const r = fallbackRead([text])
  const all = `${r.headline} ${r.body} ${r.closing_question}`
  assert.doesNotMatch(all, /no customer|yet\?|\bundefined\b|\bnull\b|\s{2,}|\.\./i)
  for (const m of all.matchAll(/"([^"]+)"/g)) assert.ok(text.includes(m[1].trim()), `quote not from the founder: ${m[1]}`)
  assert.match(r.body, /[.!?]$/)
  assert.match(r.closing_question, /\?$/)
})

test('fallback read with an empty founder text does not crash or invent', () => {
  const r = fallbackRead([''])
  assert.ok(r.headline && r.body && r.closing_question)
  assert.doesNotMatch(`${r.body} ${r.closing_question}`, /undefined|null/)
})

const readOk = (texts) => checkRead({ read: fallbackRead(texts), answerTexts: [...buildEvidence(FULL_ANSWERS).answerTexts, ...texts] })

test('fallback read: a long opening gives a whole question that passes checkRead', () => {
  const long = 'I have a demo ready for the clinics and they all asked for pricing three weeks ago but I keep putting off the email because I am afraid of the answer and so on and on'
  const r = fallbackRead([long])
  assert.ok(r.closing_question.length < 170 && /^On ".+": what is the next step, as you see it\?$/.test(r.closing_question), r.closing_question)
  assert.doesNotMatch(r.closing_question, /"[^"]*\b(and|but|so|or)"/)
  assert.deepEqual(readOk([long]), { ok: true, problems: [] })
})

test('fallback read: the follow-up clause appears only when there is a follow-up', () => {
  const a = 'Clinics asked for pricing and I stalled.'
  assert.equal(fallbackRead([a]).body, 'Here is what I have, in your words: "Clinics asked for pricing and I stalled".\nNext is what authors have said about it, then one move you can start today.')
  const w = fallbackRead([a, 'Two clinics.', 'I am afraid of the answer, but']).body
  assert.match(w, /"Clinics asked for pricing and I stalled", and "I am afraid of the answer"\.\n/)
  assert.deepEqual(readOk([a, 'Two clinics.', 'I am afraid of the answer, but']), { ok: true, problems: [] })
})

test('fallback read: an empty quote drops the quoted sentence and asks the plain question', () => {
  const r = fallbackRead(['...'])
  assert.equal(r.body, 'Next is what authors have said about it, then one move you can start today.')
  assert.equal(r.closing_question, 'What is the next step, as you see it?')
})

test('first reading fallback never says "have not", has no comma before the deadline, and passes its checker', () => {
  for (const tried of [[], ['Launched it']]) {
    const reading = fallbackReading({ ...FULL_ANSWERS, tried })
    assert.doesNotMatch(reading.body, /have not/)
    assert.match(reading.body, /You are aiming for your first 10 customers in 3 months\./)
    assert.deepEqual(checkFirstReading({ reading, answerTexts: buildEvidence({ ...FULL_ANSWERS, tried }).answerTexts }), { ok: true, problems: [] })
  }
})

test('the Read has no underlines in its schema or prompt', () => {
  assert.doesNotMatch(JSON.stringify(READ_SCHEMA), /underline/i)
  const prompt = readFileSync(join(ROOT, 'server/journey/prompts/read.js'), 'utf8')
  for (const line of prompt.split('\n').filter((l) => /underline/i.test(l))) assert.match(line, /\bNo underlines\b/)
})

test('no source file hard-codes the build office ports (8765, 8791)', () => {
  const hits = []
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      if (['node_modules', 'dist', '.git', '.expo'].includes(f)) continue
      const p = join(d, f)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(js|ts|tsx|json)$/.test(f) && f !== 'package-lock.json' && f !== 'drift.test.js' && /\b(8765|8791)\b/.test(readFileSync(p, 'utf8'))) hits.push(p)
    }
  }
  walk(join(ROOT, 'server')); walk(join(ROOT, 'app'))
  assert.deepEqual(hits, [])
})

test('fallback read: the closing question carries a shorter quote than the body', () => {
  const long = 'I have a demo ready for the clinics and they all asked for pricing three weeks ago but I keep putting off the email'
  const r = fallbackRead([long])
  const q = r.closing_question.match(/^On "(.+)": /)[1]
  assert.ok(q.length <= 60 && long.startsWith(q), q)
  assert.ok(r.body.includes(long))
  assert.deepEqual(readOk([long]), { ok: true, problems: [] })
})

test('fallback read: a greeting is skipped for the first sentence with three words or more', () => {
  const r = fallbackRead(['Hi! Our churn doubled last month.'])
  assert.match(r.body, /"Our churn doubled last month"/)
  assert.match(r.closing_question, /^On "Our churn doubled last month": /)
  assert.deepEqual(readOk(['Hi! Our churn doubled last month.']), { ok: true, problems: [] })
})
