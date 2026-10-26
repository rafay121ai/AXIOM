import assert from 'node:assert/strict'
import test from 'node:test'
import { checkFirstReading, norm, quotedPhrases } from './ownWords.js'
import { fallbackReading } from './firstReading.js'
import { FULL_ANSWERS } from './fixtures.js'
import { buildEvidence } from './firstReading.js'

const { answerTexts } = buildEvidence(FULL_ANSWERS)
const check = (reading) => checkFirstReading({ reading, answerTexts })
const GOOD = {
  headline: 'The clinics asked for pricing and have heard nothing since.',
  body: 'You wrote that you have a demo ready. You also wrote that "2 clinics that asked for pricing three weeks ago" are still waiting. The demo is not what is holding you back. Sending the price is.',
  underlines: ['asked for pricing'],
}

test('golden pass: quote, number and underline all come from the answers', () => {
  assert.deepEqual(check(GOOD), { ok: true, problems: [] })
})

test('quote match ignores case, curly quotes and extra spaces', () => {
  const r = { ...GOOD, body: GOOD.body.replace('"2 clinics that asked for pricing three weeks ago"', '“2  Clinics that asked for pricing THREE weeks ago”') }
  assert.equal(check(r).ok, true)
})

test('fail: an invented quote', () => {
  const r = { ...GOOD, body: 'You wrote "the clinics love my demo". Send the price today.' }
  const v = check(r)
  assert.equal(v.ok, false)
  assert.match(v.problems.join(), /quoted words are not in the answers/)
})

test('fail: a quote that is two answers stitched together', () => {
  assert.equal(check({ ...GOOD, body: 'You wrote "Just me Talking to customers". Send the price today.' }).ok, false)
})

test('fail: an altered number', () => {
  const r = { ...GOOD, body: GOOD.body.replace('"2 clinics', '"3 clinics') }
  assert.equal(check(r).ok, false)
  const noQuote = { ...GOOD, body: 'Five clinics are waiting, for 4 weeks. Send the price today.' }
  const v = check(noQuote)
  assert.match(v.problems.join(), /number is not in the answers: 4/)
})

test('fail: a month that is not in the answers', () => {
  const v = check({ ...GOOD, body: `${GOOD.body} Do it before March.` })
  assert.match(v.problems.join(), /date is not in the answers: march/)
})

test('fail: more than 2 underlines', () => {
  const v = check({ ...GOOD, underlines: ['asked for pricing', 'demo ready', 'three weeks ago'] })
  assert.match(v.problems.join(), /more than 2 underlines/)
})

test('fail: underline not in the answers, or not in the body', () => {
  assert.match(check({ ...GOOD, underlines: ['nobody replies'] }).problems.join(), /underlined words are not in the answers/)
  assert.match(check({ ...GOOD, underlines: ['Karachi'] }).problems.join(), /not in the body/)
})

test('fail: banned phrases and teasers', () => {
  assert.match(check({ ...GOOD, body: `Great start. ${GOOD.body}` }).problems.join(), /banned phrase: great/)
  assert.match(check({ ...GOOD, body: `${GOOD.body} I understand.` }).problems.join(), /banned phrase: i understand/)
  assert.match(check({ ...GOOD, body: `${GOOD.body} Want to see why?` }).problems.join(), /teaser/)
  assert.match(check({ ...GOOD, body: `${GOOD.body} Was I right? That's right or not quite?` }).problems.join(), /banned phrase/)
})

test('"greater" is not the banned word "great"', () => {
  assert.equal(check({ ...GOOD, body: `${GOOD.body} The greater risk is silence.` }).ok, true)
})

test('fail: unbalanced quote mark and wrong shape', () => {
  assert.match(check({ ...GOOD, body: 'You wrote "demo ready and then silence.' }).problems.join(), /unbalanced/)
  assert.equal(check({ headline: 'x' }).ok, false)
})

test('helpers', () => {
  assert.equal(norm('  “Hi”   THERE '), '"hi" there')
  assert.deepEqual(quotedPhrases('a "b c" d').phrases, ['b c'])
})

test('the fallback reading passes the checker for every stage and has no quote or underline', () => {
  for (const stage of ['Just an idea', "I'm talking to people about it", 'Someone is paying me', "It's growing"]) {
    for (const tried of [['None of it yet'], ['Talked to customers', 'Launched it']]) {
      for (const goal of [{ goal: 'Ship it', when: 'This month' }, { goal: 'Raise money', when: 'Pick a date', date: '2027-03-01' }]) {
        const answers = { ...FULL_ANSWERS, stage: { value: stage }, tried, goal }
        const reading = fallbackReading(answers)
        assert.deepEqual(reading.underlines, [])
        assert.ok(!reading.headline.includes('"') && !reading.body.includes('"'))
        const { answerTexts: texts } = buildEvidence(answers)
        assert.deepEqual(checkFirstReading({ reading, answerTexts: texts }), { ok: true, problems: [] }, reading.body)
      }
    }
  }
})
