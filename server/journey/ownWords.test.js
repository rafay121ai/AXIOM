import assert from 'node:assert/strict'
import test from 'node:test'
import { checkFirstReading, norm, quotedPhrases, unquoteUnknown } from './ownWords.js'
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

test('fallback states only what was picked, never infers, and reads naturally for every goal', async () => {
  const { QUESTIONS } = await import('./questions.js')
  const { FIRST_READING_PROMPT } = await import('./prompts/firstReading.js')
  const goals = QUESTIONS.find((q) => q.key === 'goal').goals
  for (const goal of goals) {
    const r = fallbackReading({ ...FULL_ANSWERS, goal: { goal, when: 'This month' } })
    assert.match(r.body, /You are aiming (for|to) [a-z0-9 ]+ this month\./, r.body)
    assert.ok(!/have not/.test(r.body) && /Next: what you wrote you are most stuck on\.$/.test(r.body))
    assert.ok(!/also told me/.test(r.body))
  }
  const idea = fallbackReading({ ...FULL_ANSWERS, stage: { value: 'Just an idea' } })
  assert.equal(idea.headline, 'You have an idea.')
  const talking = fallbackReading({ ...FULL_ANSWERS, stage: { value: "I'm talking to people about it" } })
  assert.equal(talking.headline, 'You are talking to people about it.')
  assert.ok(!/no customer|nobody has bought/i.test(`${idea.headline} ${idea.body} ${talking.headline} ${talking.body}`))
  assert.throws(() => fallbackReading({ ...FULL_ANSWERS, stage: undefined }), /stage/)
  for (const need of [/End the body on one plain question/, /No exclamation marks, no emoji, no jokes/, /I have what I need/]) {
    assert.match(FIRST_READING_PROMPT, need)
  }
})

// Live Read fell back on Nov 2: it quoted the answers as it was shown them, joined, and once reworded them.
test('a quote of the answers exactly as the model was shown them is accepted', () => {
  const { answerTexts } = buildEvidence({ goal: { goal: 'My first customer', when: 'This month' }, tried: ['Talked to customers', 'Launched it'] })
  const reading = { headline: 'You want "my first customer, this month".', body: 'You have "talked to customers, launched it" and still have no one paying, which is what to change first.', underlines: [] }
  const { problems } = checkFirstReading({ reading, answerTexts })
  assert.ok(!problems.some((p) => p.startsWith('quoted words')), problems.join('; '))
})

test('a reworded quote loses its quotation marks; an exact one keeps them', () => {
  const answerTexts = ['Talked to customers', 'Launched it']
  assert.equal(unquoteUnknown('You tried "talking to customers, launching" so far.', answerTexts), 'You tried talking to customers, launching so far.')
  assert.equal(unquoteUnknown('You "talked to customers".', answerTexts), 'You "talked to customers".')
  assert.equal(unquoteUnknown('You \u201Ctalked to customers\u201D.', answerTexts), 'You \u201Ctalked to customers\u201D.')
})

test('a quote with a word they never used keeps its marks, so the check still sends it back', () => {
  assert.equal(unquoteUnknown('You wrote "the clinics love my demo".', ['I have a demo ready for the clinics']), 'You wrote "the clinics love my demo".')
})

// Rafay, Nov 2: the Read quoted "Avoids most: Talking to customers, Launching", our form label, as the founder's words.
test('the Read quotes only typed words: a picked option loses its marks, our labels are never theirs', () => {
  const { answerTexts, typedTexts } = buildEvidence({ goal: { goal: 'My first customer', when: 'This month' }, strengths: { a: ['Building'], b: ['Talking to customers'] }, stuck: 'Nobody opens the beta' })
  assert.ok(!answerTexts.some((t) => t.includes('Avoids most')))
  assert.deepEqual(typedTexts, ['Nobody opens the beta'])
  assert.equal(unquoteUnknown('You want "my first customer, this month".', typedTexts, answerTexts), 'You want my first customer, this month.')
  assert.equal(unquoteUnknown('You said "nobody opens the beta".', typedTexts, answerTexts), 'You said "nobody opens the beta".')
  assert.equal(unquoteUnknown('You "avoids most: talking to customers".', typedTexts, answerTexts), 'You "avoids most: talking to customers".')
})

// Live run, Nov 8: the first reading quoted "avoids most: pricing, asking for money" because our label sat inside
// the answer the model was shown, and fell back. Labels now live in the question; the answer is only their picks.
test('the model is shown answers without our labels, so quoting a whole answer is quoting the founder', () => {
  const answers = { strengths: { a: ['Building the product', 'Not quitting'], b: ['Pricing', 'Asking for money'] }, where: { country: 'United States', customers: 'Mostly in my own country' } }
  const { evidence, answerTexts } = buildEvidence(answers)
  assert.deepEqual(evidence.map((e) => e.answer), ['United States', 'Mostly in my own country', 'Building the product, Not quitting', 'Pricing, Asking for money'])
  assert.ok(evidence.some((e) => e.question.includes('What I avoid most')))
  const quote = (q) => checkFirstReading({ reading: { headline: 'h', body: `You picked "${q}". Start there today.`, underlines: [] }, answerTexts }).problems.filter((p) => p.startsWith('quoted words'))
  assert.deepEqual(quote('pricing, asking for money'), [])
  assert.equal(quote('avoids most: pricing, asking for money').length, 1)
  assert.equal(quote('based in united states').length, 1)
})

// A quoted single number must be a whole number the founder typed: "40" is not inside "400".
test('a quoted bare number: typed is fine; never typed, or only inside a bigger number, is caught; a picked one loses its marks', () => {
  const typed = ['I have 400 users and $3k in the bank']
  const quote = (n) => ({ headline: 'h', body: `You wrote "${n}". Send the price today.`, underlines: [] })
  const run = (n, texts = typed) => checkFirstReading({ reading: quote(n), answerTexts: texts }).problems.filter((p) => p.startsWith('quoted words'))
  assert.deepEqual(run('400'), [])
  assert.deepEqual(run('$3k'), [])
  assert.equal(run('40').length, 1)
  assert.equal(run('4').length, 1)
  assert.equal(run('3').length, 1)
  assert.equal(run('900').length, 1)
  // Not part of a decimal or a thousands group, but a sentence's full stop or comma is fine.
  const money = ['We charge 40.5 a seat, 1,000,000 visits, and 40, then 25.']
  assert.equal(run('40.5', money).length, 0)
  assert.equal(run('1,000,000', money).length, 0)
  assert.equal(run('1,000', money).length, 1)
  assert.equal(run('000', money).length, 1)
  assert.equal(run('40', money).length, 0)
  assert.equal(run('25', money).length, 0)
  assert.equal(run('5', money).length, 1)
  assert.equal(unquoteUnknown('Only "12" weeks.', ['Nobody opens the beta'], ['Nobody opens the beta', '12 weeks']), 'Only 12 weeks.')
  assert.equal(unquoteUnknown('Only "13" weeks.', ['Nobody'], ['Nobody', '12 weeks']), 'Only "13" weeks.')
})
