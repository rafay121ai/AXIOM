import { createFakeApi } from '../src/api/fake';
import type { GoalQuestion, Question, TextQuestion, TwoQuestion, WhereQuestion } from '../src/api/types';
import {
  MAX_OPTIONS, autoAdvances, countrySuggestions, isDone, needsContinue, optionGroups, startIndex, tapSingle, tapTwo, SKIP, isSkip, pickMonth, birthdayDone, daysIn, progressAt,
} from '../src/onboarding/flow';
import { clip, waitLines } from '../src/onboarding/waitLines';

let questions: Question[];
beforeAll(async () => { questions = (await createFakeApi().getSignup()).questions; });
const byKey = <T extends Question>(k: string) => questions.find((q) => q.key === k) as T;

describe('questions', () => {
  it('has the 14, in order, one per screen', () => {
    expect(questions.map((q) => q.key)).toEqual(['stage', 'commitment', 'business_model', 'where', 'goal', 'building', 'why', 'strengths', 'decision', 'drop_plan', 'hard_truth', 'contrarian', 'people', 'stuck']);
  });
  it('never shows more than 5 options at once', () => {
    for (const q of questions) for (const g of optionGroups(q)) expect(g.length).toBeLessThanOrEqual(MAX_OPTIONS);
  });

  it('only the strengths question has two groups, and no question ticks several in one', () => {
    expect(questions.filter((q) => q.type === 'two').map((q) => q.key)).toEqual(['strengths']);
  });

  it('the new single questions are plain single choices', () => {
    for (const k of ['decision', 'drop_plan', 'hard_truth']) expect(byKey(k).type).toBe('single');
  });

  it('only contrarian and people can be skipped', () => {
    expect(questions.filter((q) => q.type === 'text' && q.optional).map((q) => q.key)).toEqual(['contrarian', 'people']);
  });
});

describe('resuming part way', () => {
  it('starts at the first question the server says is unanswered, not question 1', () => {
    expect(startIndex(questions, 'building')).toBe(5);
    expect(startIndex(questions, 'stage')).toBe(0);
  });
  it('starts at question 1 when the server names none or an unknown one', () => {
    expect(startIndex(questions, null)).toBe(0);
    expect(startIndex(questions, undefined)).toBe(0);
    expect(startIndex(questions, 'gone')).toBe(0);
  });
  it('a founder the server calls complete gets no question to start at', async () => {
    const signup = await createFakeApi('none', 0, false, 'morning').getSignup();
    expect(signup).toMatchObject({ complete: true, next: null });
  });
  it('is what a new fake founder gets from the sign-up', async () => {
    const signup = await createFakeApi().getSignup();
    expect(signup).toMatchObject({ answers: {}, next: 'stage', complete: false, total: 14 });
  });
});

describe('auto-advance', () => {
  it('a single choice moves on by itself', () => {
    const q = questions[0];
    const a = tapSingle(q.type === 'single' ? q.options[0] : '');
    expect(isDone(q, a)).toBe(true);
    expect(needsContinue(q, a)).toBe(false);
    expect(autoAdvances(q, a)).toBe(true);
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

describe('two-group select', () => {
  it('strengths needs at least one pick in each group and ticks toggle', () => {
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
});

describe('optional written questions', () => {
  it('typed text of 3 characters counts, 2 does not, and a skip counts', () => {
    const q = byKey<TextQuestion>('contrarian');
    expect(isDone(q, 'ab')).toBe(false);
    expect(isDone(q, 'abc')).toBe(true);
    expect(isDone(q, SKIP)).toBe(true);
    expect(isSkip(SKIP)).toBe(true);
    expect(isSkip('abc')).toBe(false);
    expect(needsContinue(q, SKIP)).toBe(true);
  });
  it('a required written question refuses nothing here but never shows Skip', () => {
    expect((byKey<TextQuestion>('stuck')).optional).toBeUndefined();
  });
});

describe('name and birthday', () => {
  it('the hairline stays empty on them and fills over the 14', () => {
    expect(progressAt(0, 2, 14)).toBe(0);
    expect(progressAt(1, 2, 14)).toBe(0);
    expect(progressAt(2, 2, 14)).toBeCloseTo(1 / 14);
    expect(progressAt(15, 2, 14)).toBe(1);
    expect(progressAt(0, 0, 14)).toBeCloseTo(1 / 14);
  });
  it('a birthday is done with a month and a day, and a month change drops a day it does not have', () => {
    expect(birthdayDone({ month: 3 })).toBe(false);
    expect(birthdayDone({ month: 3, day: 31 })).toBe(true);
    expect(pickMonth({ month: 3, day: 31 }, 4)).toEqual({ month: 4, day: undefined });
    expect(pickMonth({ month: 3, day: 30 }, 4)).toEqual({ month: 4, day: 30 });
    expect(daysIn(2)).toBe(29);
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
  it('marks a cut with no comma to cut at', () => {
    expect(clip('I am building a scheduling tool for independent physiotherapists in Lahore who lose a fifth of bookings.', 60)).toBe('I am building a scheduling tool for independent…');
  });
});
