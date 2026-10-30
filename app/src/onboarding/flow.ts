import type {
  Answer, GoalAnswer, MultiAnswer, Question, SingleAnswer, TextAnswer, TwoAnswer, WhereAnswer,
} from '../api/types';

// The rules of the question flow, with no screen code in them.

export const MAX_OPTIONS = 5;

/** Every group of options a question shows at once. */
export function optionGroups(q: Question): string[][] {
  switch (q.type) {
    case 'single':
    case 'multi':
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

export function isOther(q: Question, a: Answer | undefined): boolean {
  return q.type === 'single' && !!q.otherOption && !!a && (a as SingleAnswer).value === q.otherOption;
}

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
    case 'multi':
      return (a as MultiAnswer).length > 0;
    case 'text':
      return (a as TextAnswer).trim().length >= q.minLength;
  }
}

/** Continue exists only where the founder types, ticks several things or picks a date. */
export function needsContinue(q: Question, a: Answer | undefined): boolean {
  switch (q.type) {
    case 'text':
    case 'two':
    case 'multi':
    case 'where':
      return true;
    case 'single':
      return isOther(q, a);
    case 'goal':
      return (a as GoalAnswer | undefined)?.when === q.dateOption;
  }
}

/** A tap moves the founder on by itself when the answer is complete and no Continue is shown. */
export function autoAdvances(q: Question, a: Answer | undefined): boolean {
  return isDone(q, a) && !needsContinue(q, a);
}

export function tapSingle(prev: Answer | undefined, value: string): SingleAnswer {
  return { value, other: (prev as SingleAnswer | undefined)?.other };
}

export function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
}

export function tapMulti(q: Question, prev: Answer | undefined, value: string): MultiAnswer {
  const list = (prev as MultiAnswer | undefined) ?? [];
  const exclusive = q.type === 'multi' ? q.exclusive : undefined;
  if (value === exclusive) return list.includes(value) ? [] : [value];
  return toggle(list.filter((x) => x !== exclusive), value);
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

export function progress(index: number, total: number): number {
  return (index + 1) / total;
}

/** One line that says what the founder answered, for the list of answers in Settings. Empty when nothing is answered. */
export function answerSummary(a: Answer | undefined): string {
  if (a === undefined) return '';
  if (typeof a === 'string') return a;
  if (Array.isArray(a)) return a.join(', ');
  if ('value' in a) return a.other ? `${a.value}: ${a.other}` : a.value;
  if ('a' in a) return [...a.a, ...a.b].join(', ');
  if ('country' in a || 'customers' in a) return [(a as WhereAnswer).country, (a as WhereAnswer).customers].filter(Boolean).join(', ');
  const g = a as GoalAnswer;
  return [g.goal, g.date ?? g.when].filter(Boolean).join(', ');
}
