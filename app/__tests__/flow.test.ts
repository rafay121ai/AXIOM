import { createFakeApi } from '../src/api/fake';
import type { GoalQuestion, MultiQuestion, Question, TextQuestion, TwoQuestion, WhereQuestion } from '../src/api/types';
import {
  MAX_OPTIONS, autoAdvances, countrySuggestions, isDone, needsContinue, optionGroups, tapMulti, tapSingle, tapTwo,
} from '../src/onboarding/flow';
import { clip, waitLines } from '../src/onboarding/waitLines';

let questions: Question[];
beforeAll(async () => { questions = await createFakeApi().getQuestions(); });
const byKey = <T extends Question>(k: string) => questions.find((q) => q.key === k) as T;

describe('questions', () => {
  it('has 13, one per screen', () => expect(questions).toHaveLength(13));

  it('never shows more than 5 options at once', () => {
    for (const q of questions) for (const g of optionGroups(q)) expect(g.length).toBeLessThanOrEqual(MAX_OPTIONS);
  });

  it('only question 10 is multi-select in two groups, question 11 ticks several', () => {
    expect(questions[9].type).toBe('two');
    expect(questions[10].type).toBe('multi');
    expect(questions.filter((q) => q.type === 'two' || q.type === 'multi')).toHaveLength(2);
  });
});

describe('auto-advance', () => {
  it('a single choice moves on by itself', () => {
    const q = questions[0];
    const a = tapSingle(undefined, q.type === 'single' ? q.options[0] : '');
    expect(isDone(q, a)).toBe(true);
    expect(needsContinue(q, a)).toBe(false);
    expect(autoAdvances(q, a)).toBe(true);
  });

  it('"Other" waits for Continue', () => {
    const q = byKey('background');
    const a = tapSingle(undefined, 'Other');
    expect(needsContinue(q, a)).toBe(true);
    expect(autoAdvances(q, a)).toBe(false);
  });

  it('written answers never advance by themselves', () => {
    for (const q of [byKey<TextQuestion>('building'), byKey<TextQuestion>('stuck')]) {
      const a = 'x'.repeat(q.minLength + 5);
      expect(isDone(q, a)).toBe(true);
      expect(autoAdvances(q, a)).toBe(false);
    }
  });

  it('text needs its minimum length before Continue opens', () => {
    const q = byKey<TextQuestion>('building');
    expect(isDone(q, 'short')).toBe(false);
    expect(isDone(q, '   ')).toBe(false);
  });

  it('goal advances once both are picked, except for a date', () => {
    const q = byKey<GoalQuestion>('goal');
    expect(isDone(q, { goal: q.goals[0] })).toBe(false);
    expect(autoAdvances(q, { goal: q.goals[0], when: q.whens[0] })).toBe(true);
    const date = { goal: q.goals[0], when: q.dateOption };
    expect(isDone(q, date)).toBe(false);
    expect(needsContinue(q, date)).toBe(true);
    expect(isDone(q, { ...date, date: '2027-01-31' })).toBe(true);
    expect(autoAdvances(q, { ...date, date: '2027-01-31' })).toBe(false);
  });

  it('where needs a country and customers', () => {
    const q = byKey<WhereQuestion>('where');
    expect(isDone(q, { country: 'India' })).toBe(false);
    expect(isDone(q, { country: 'I', customers: q.customers[0] })).toBe(false);
    expect(isDone(q, { country: 'India', customers: q.customers[0] })).toBe(true);
  });
});

describe('multi-select', () => {
  it('question 10 needs at least one pick in each group and ticks toggle', () => {
    const q = byKey<TwoQuestion>('strengths');
    let a = tapTwo(undefined, 0, q.groups[0].options[0]);
    expect(isDone(q, a)).toBe(false);
    a = tapTwo(a, 0, q.groups[0].options[1]);
    expect(a.a).toHaveLength(2);
    a = tapTwo(a, 1, q.groups[1].options[0]);
    expect(isDone(q, a)).toBe(true);
    expect(autoAdvances(q, a)).toBe(false);
    a = tapTwo(a, 0, q.groups[0].options[1]);
    expect(a.a).toEqual([q.groups[0].options[0]]);
  });

  it('"None of it yet" clears the rest, and picking another clears it', () => {
    const q = byKey<MultiQuestion>('tried');
    let a = tapMulti(q, undefined, 'Talked to customers');
    a = tapMulti(q, a, 'Launched it');
    expect(a).toEqual(['Talked to customers', 'Launched it']);
    a = tapMulti(q, a, 'None of it yet');
    expect(a).toEqual(['None of it yet']);
    a = tapMulti(q, a, 'Launched it');
    expect(a).toEqual(['Launched it']);
  });
});

describe('country suggestions', () => {
  it('shows at most 5 and none once the name is complete', () => {
    const q = byKey<WhereQuestion>('where');
    expect(countrySuggestions(q.countries, 'u').length).toBeLessThanOrEqual(MAX_OPTIONS);
    expect(countrySuggestions(q.countries, 'india')).toEqual([]);
    expect(countrySuggestions(q.countries, '')).toEqual([]);
  });
});

describe('wait lines', () => {
  it('quotes the first sentence of what they are building', () => {
    expect(waitLines('I am building a booking app for clinics. It is early.')[0]).toBe('Reading what you wrote about\n“I am building a booking app for clinics”');
  });
  it('has four lines and a plain first line when nothing was written', () => {
    const lines = waitLines('');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe('Reading what you wrote.');
  });
  it('cuts a long sentence at a comma', () => {
    expect(clip('A scheduling tool for small dental clinics in Karachi, which they can use on any phone and pay monthly.', 60)).toBe('A scheduling tool for small dental clinics in Karachi');
  });
});
