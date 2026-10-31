// The sign-up film: one clock, in milliseconds. Every beat of IntroSequence is read off these numbers, so Rafay tunes them here.
// Approved prototype: tasks/design/intro-v3.html (same numbers).
type Span = readonly [number, number];

export const INTRO = {
  point: [200, 1000] as Span, // a point of light at the emblem's tip
  pointOut: [2200, 2700] as Span,
  streakIn: [800, 1900] as Span, // it stretches into a streak ...
  streakOut: [1900, 2500] as Span, // ... that collapses back into the tip
  draw: [1900, 3600] as Span, // the emblem draws outward from its tip
  web: [2100, 4600] as Span, // a faint web spreads behind it
  bloom: [3400, 4100] as Span,
  sweep: [3700, 4500] as Span, // a band of light crosses the emblem
  floor: [3400, 5400] as Span, // warm light rises from the bottom
  settle: [4300, 5400] as Span, // the emblem settles higher and smaller
  tag: 5200, // the tagline, one word at a time, in its final place
  tagGap: 280,
  tagIn: 800,
  sweep2: [6500, 7300] as Span,
  button: [6300, 7100] as Span, // the Google button rises in
  shine: [7200, 8100] as Span, // one soft shine crosses it
  end: 8200,
} as const;

export type Beat = 'light' | 'emblem' | 'settle' | 'tagline' | 'final';

/** Which beat is on screen at `ms` into the film. */
export function beatAt(ms: number): Beat {
  if (ms < INTRO.draw[0]) return 'light';
  if (ms < INTRO.settle[0]) return 'emblem';
  if (ms < INTRO.tag) return 'settle';
  if (ms < INTRO.button[0]) return 'tagline';
  return 'final';
}

// Easing, shared by the film's worklets (UI thread) and the tests.
export const clamp = (x: number) => {
  'worklet';
  return Math.max(0, Math.min(1, x));
};
export const seg = (t: number, [a, b]: Span) => {
  'worklet';
  return clamp((t - a) / (b - a));
};
export const out3 = (x: number) => {
  'worklet';
  return 1 - Math.pow(1 - x, 3);
};
export const inOut = (x: number) => {
  'worklet';
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
export const bell = (x: number) => {
  'worklet';
  return Math.sin(Math.PI * clamp(x));
};

/** Once per app open, on the sign-in screen only, so it stops for good once the founder signs up. Sign-out, a failed sign-in or a cancel never replay it in the same open. */
export const session = { played: false };

/** Where the film begins: 0 to play it, `end` (the finished screen) once it has played. Reduced motion and a tap jump to `end` too. */
export function startAt(played: boolean): number {
  return played ? INTRO.end : 0;
}
