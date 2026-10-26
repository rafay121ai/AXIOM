import type { FirstReading } from '../api/types';

// The rules of the first reading and its wait, with no screen code in them.

export const MAX_UNDERLINES = 2;

export type Segment = { text: string; underline: boolean };

/** Where each underlined phrase sits in the body. Phrases not in the body are dropped, and at most 2 are kept. */
function underlineRanges(body: string, phrases: string[]): [number, number][] {
  const ranges: [number, number][] = [];
  for (const phrase of phrases.slice(0, MAX_UNDERLINES)) {
    const at = phrase ? body.indexOf(phrase) : -1;
    if (at >= 0) ranges.push([at, at + phrase.length]);
  }
  return ranges.sort((a, b) => a[0] - b[0]);
}

/**
 * The body as sentences, each a list of plain and underlined pieces, so the screen can
 * bring them in one by one. A sentence never breaks inside an underlined phrase.
 */
export function readingSentences(reading: FirstReading): Segment[][] {
  const { body } = reading;
  const ranges = underlineRanges(body, reading.underlines).filter(([s], i, all) => i === 0 || s >= all[i - 1][1]);
  const inside = (at: number) => ranges.some(([s, e]) => at > s && at < e);

  const cuts: number[] = [0];
  for (const m of body.matchAll(/[.!?]+[”"]?\s+/g)) {
    const end = m.index + m[0].length;
    if (!inside(end)) cuts.push(end);
  }
  cuts.push(body.length);

  const sentences: Segment[][] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const from = cuts[i];
    const to = cuts[i + 1];
    const segments: Segment[] = [];
    let at = from;
    for (const [s, e] of ranges.filter(([s, e]) => s >= from && e <= to)) {
      if (s > at) segments.push({ text: body.slice(at, s), underline: false });
      segments.push({ text: body.slice(s, e), underline: true });
      at = e;
    }
    if (at < to) segments.push({ text: body.slice(at, to), underline: false });
    const last = segments[segments.length - 1];
    if (last && !last.underline) last.text = last.text.trimEnd();
    if (segments.some((g) => g.text.length > 0)) sentences.push(segments);
  }
  return sentences;
}

type Wait = (ms: number) => Promise<void>;
const sleep: Wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetches the first reading, trying again until it arrives, and never returns before
 * `minMs` has passed, so the wait lines are always read to the end.
 */
export async function loadReading(
  fetchReading: () => Promise<FirstReading>,
  { minMs, retryMs, wait = sleep }: { minMs: number; retryMs: number; wait?: Wait },
): Promise<FirstReading> {
  const fetched = (async () => {
    for (;;) {
      try {
        return await fetchReading();
      } catch {
        await wait(retryMs);
      }
    }
  })();
  const [reading] = await Promise.all([fetched, wait(minMs)]);
  return reading;
}
