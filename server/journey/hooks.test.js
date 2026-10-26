import assert from 'node:assert/strict'
import test from 'node:test'
import { checkHook, threadKinds } from './hooks.js'
import { stripFiller, isFillerReply } from './filler.js'

const SOURCES = ['I have a demo ready but I have not emailed the 2 clinics that asked for pricing three weeks ago.']
const hook = (text, extra = {}) => checkHook({ text, sources: SOURCES, ...extra })

test('hook gate golden: real threads pass, with the kind named', () => {
  assert.deepEqual(hook('Which of the 2 clinics asked first?').kinds, ['own_words', 'number'])
  assert.ok(hook('Have you gone back to either of those clinics since the demo?').ok)
  assert.ok(hook('Who asked for pricing three weeks ago, and what did they say?').kinds.includes('date'))
  assert.deepEqual(hook('You said the demo is ready, but you have not emailed. Who asked for pricing three weeks ago?').kinds, ['own_words', 'date', 'contradiction'])
  assert.ok(hook('You wrote "emailed the 2 clinics". What did you send them?').kinds.includes('own_words'))
})

test('hook gate golden: generic and off-topic lines are rejected', () => {
  for (const text of ['What is your biggest fear?', 'Do you like your customers?', 'What have you tried so far?']) {
    const r = hook(text)
    assert.equal(r.ok, false, text)
    assert.match(r.problems.join(), /no thread from the founder/)
  }
})

test('hook gate golden: teasers, forbidden phrases and filler restating are rejected', () => {
  assert.match(hook('Want to see why the 2 clinics went quiet?').problems.join(), /teaser/)
  assert.match(hook('Find out why the clinics went quiet?').problems.join(), /teaser/)
  assert.match(hook('Great, which of the 2 clinics asked first?').problems.join(), /banned phrase: great/)
  assert.match(hook("That's interesting. Which of the 2 clinics asked first?").problems.join(), /banned phrase: that's interesting/)
  assert.match(hook('It sounds like you have a demo ready for the 2 clinics?').problems.join(), /restates/)
})

test('hook gate: one question exactly, unless the step is allowed to end without one', () => {
  assert.match(hook('You have 2 clinics waiting.').problems.join(), /not a question/)
  assert.match(hook('Which of the 2 clinics? And when?').problems.join(), /more than one question/)
  assert.ok(hook('The 2 clinics have waited three weeks.', { requireQuestion: false }).ok)
})

test('hook gate: banned phrases match whole words only', () => {
  assert.ok(hook('Which of the 2 clinics is greatly interested in pricing?').ok === true)
  assert.ok(!hook('Which of the 2 clinics said great?').ok)
})

test('hook gate: a number or date that is not the founder\'s is not a thread', () => {
  assert.deepEqual(threadKinds('Did 5 buyers reply in June?', SOURCES), [])
})

test('filler filter strips leading acknowledgements and banned phrases, keeps the question', () => {
  assert.deepEqual(stripFiller('Got it. Which of the 2 clinics asked first?'), { text: 'Which of the 2 clinics asked first?', changed: true })
  assert.equal(stripFiller('Great, which clinic asked first?').text, 'Which clinic asked first?')
  assert.equal(stripFiller('Absolutely! Of course. I understand. Which clinic?').text, 'Which clinic?')
  assert.equal(stripFiller('Which clinic asked first? That is a great start.').text, 'Which clinic asked first?')
  assert.equal(stripFiller('Right now, who is waiting on you?').text, 'Right now, who is waiting on you?')
  assert.equal(stripFiller('Great. Certainly.').text, '')
  assert.equal(stripFiller('Which clinic asked first?').changed, false)
})

test('filler replies: acknowledgements are filler, short real answers are not', () => {
  for (const t of ['ok', 'OK.', 'makes sense', 'Got it!', '  ', '...']) assert.equal(isFillerReply(t), true, t)
  for (const t of ['3', 'no', 'Two clinics', 'not yet']) assert.equal(isFillerReply(t), false, t)
  assert.equal(isFillerReply('pricing help', { minWords: 3 }), true)
  assert.equal(isFillerReply('help with pricing', { minWords: 3 }), false)
})
