// The wait screen's lines, word for word from the approved mock. The first
// quotes the founder's own first sentence about what they are building.

/** The first sentence of what the founder wrote, cut at a comma if it runs long. */
export function clip(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, ' ');
  const first = (t.match(/^.*?[.!?](\s|$)/) ?? [t])[0].trim().replace(/[.!?]+$/, '');
  if (first.length <= max) return first;
  const comma = first.lastIndexOf(',', max);
  return comma > 20 ? first.slice(0, comma) : first.slice(0, max).replace(/\s+\S*$/, '');
}

export function waitLines(building: string): string[] {
  const quote = clip(building, 60);
  return [
    quote ? `Reading what you wrote about\n“${quote}”` : 'Reading what you wrote.',
    'Every founder has one thing they keep circling. Finding yours.',
    'Looking for the gap between what you said and what you did.',
    'Checking what you have already tried, so I do not hand it back to you.',
  ];
}

/** How long each line stays before the next, and how long the last stays: from the mock. */
export const LINE_EVERY = 3000;
const LAST_HOLD = 3200;

/** The least time the wait is shown, so every line is read. */
export const waitMinMs = (lines: string[]) => (lines.length - 1) * LINE_EVERY + LAST_HOLD;
