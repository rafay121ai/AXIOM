import type {
  Answer, GoalAnswer, Question, SingleAnswer, SkipAnswer, TextAnswer, TwoAnswer, WhereAnswer,
} from '../api/types';

// The rules of the question flow, with no screen code in them.

export const MAX_OPTIONS = 5;

/** Every group of options a question shows at once. */
export function optionGroups(q: Question): string[][] {
  switch (q.type) {
    case 'single':
      return [q.options];
    case 'goal':
      return [q.goals, q.whens];
    case 'two':
      return [q.groups[0].options, q.groups[1].options];
    case 'where':
      return [q.customers];
    case 'text':
      return [];
  }
}

export const SKIP: SkipAnswer = { skipped: true };

export const isSkip = (a: Answer | undefined): a is SkipAnswer => typeof a === 'object' && 'skipped' in a;

export function isDone(q: Question, a: Answer | undefined): boolean {
  if (a === undefined) return false;
  switch (q.type) {
    case 'single':
      return !!(a as SingleAnswer).value;
    case 'where': {
      const w = a as WhereAnswer;
      return (w.country ?? '').trim().length > 1 && !!w.customers;
    }
    case 'goal': {
      const g = a as GoalAnswer;
      return !!g.goal && !!g.when && (g.when !== q.dateOption || !!g.date);
    }
    case 'two': {
      const t = a as TwoAnswer;
      return t.a.length > 0 && t.b.length > 0;
    }
    case 'text':
      return isSkip(a) || (a as TextAnswer).trim().length >= q.minLength;
  }
}

/** Continue exists only where the founder types, ticks several things or picks a date. */
export function needsContinue(q: Question, a: Answer | undefined): boolean {
  switch (q.type) {
    case 'text':
    case 'two':
    case 'where':
      return true;
    case 'single':
      return false;
    case 'goal':
      return (a as GoalAnswer | undefined)?.when === q.dateOption;
  }
}

/** A tap moves the founder on by itself when the answer is complete and no Continue is shown. */
export function autoAdvances(q: Question, a: Answer | undefined): boolean {
  return isDone(q, a) && !needsContinue(q, a);
}

export function tapSingle(value: string): SingleAnswer {
  return { value };
}

export function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
}

export function tapTwo(prev: Answer | undefined, group: 0 | 1, value: string): TwoAnswer {
  const t = (prev as TwoAnswer | undefined) ?? { a: [], b: [] };
  return group === 0 ? { ...t, a: toggle(t.a, value) } : { ...t, b: toggle(t.b, value) };
}

export function countrySuggestions(countries: string[], typed: string): string[] {
  const t = typed.trim().toLowerCase();
  if (t.length === 0) return [];
  const hits = countries.filter((c) => c.toLowerCase().startsWith(t) && c.toLowerCase() !== t);
  return hits.slice(0, MAX_OPTIONS);
}

/** Where the questions start: at the first one not answered yet (`next`, from the server), or the first. */
export function startIndex(questions: Question[], next: string | null | undefined): number {
  return Math.max(0, questions.findIndex((q) => q.key === next));
}

/** Name and birthday come before question 1, only for a founder who has answered nothing yet. */
export const LEAD_STEPS = 2;

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS_IN = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** The days a month can have (February always 29: no year is ever asked). */
export const daysIn = (month: number) => DAYS_IN[month - 1];

export type Birthday = { month?: number; day?: number };

/** Picking a month drops a day that month does not have. */
export function pickMonth(b: Birthday, month: number): Birthday {
  return { month, day: b.day !== undefined && b.day <= daysIn(month) ? b.day : undefined };
}

export const birthdayDone = (b: Birthday) => b.month !== undefined && b.day !== undefined;

/** Name and birthday count for nothing: the hairline starts at 0 and fills over the 14 questions. */
export function progressAt(step: number, lead: number, total: number): number {
  return step < lead ? 0 : progress(step - lead, total);
}

export function progress(index: number, total: number): number {
  return (index + 1) / total;
}

/** One line that says what the founder answered, for the list of answers in Settings. Empty when nothing is answered. */
export function answerSummary(a: Answer | undefined): string {
  if (a === undefined) return '';
  if (typeof a === 'string') return a;
  if (isSkip(a)) return '';
  if ('value' in a) return a.value;
  if ('a' in a) return [...a.a, ...a.b].join(', ');
  if ('country' in a || 'customers' in a) return [(a as WhereAnswer).country, (a as WhereAnswer).customers].filter(Boolean).join(', ');
  const g = a as GoalAnswer;
  return [g.goal, g.date ?? g.when].filter(Boolean).join(', ');
}
