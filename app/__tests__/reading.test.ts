import { loadReading, readingSentences } from '../src/onboarding/reading';
import { LINE_EVERY, waitLines, waitMinMs } from '../src/onboarding/waitLines';

const reading = (body: string, underlines: string[]) => ({ headline: 'h', body, underlines });
const text = (s: { text: string }[]) => s.map((g) => g.text).join('');

describe('reading sentences', () => {
  const body = 'You wrote “I keep adding features. Not selling”, and avoid talking to customers. That is one problem. We begin now.';

  it('splits into sentences without losing a word', () => {
    const s = readingSentences(reading(body, []));
    expect(s.map(text).join(' ')).toBe(body);
    expect(s).toHaveLength(4);
  });

  it('underlines only the given phrases and never splits inside one', () => {
    const s = readingSentences(reading(body, ['I keep adding features. Not selling', 'talking to customers']));
    expect(s.map(text).join(' ')).toBe(body);
    expect(s.flat().filter((g) => g.underline).map((g) => g.text)).toEqual(['I keep adding features. Not selling', 'talking to customers']);
  });

  it('underlines at most 2 phrases and ignores phrases that are not in the body', () => {
    const s = readingSentences(reading(body, ['not in the body', 'That is one problem', 'We begin now', 'avoid']));
    expect(s.flat().filter((g) => g.underline).map((g) => g.text)).toEqual(['That is one problem']);
  });

  it('does not split after a closing quote that continues the sentence', () => {
    expect(readingSentences(reading('You said “nobody pays” and left. Next.', []))).toHaveLength(2);
  });
});

describe('the wait', () => {
  it('shows the lines for as long as the mock does', () => {
    expect(waitMinMs(waitLines('x'))).toBe(3 * LINE_EVERY + 3200);
  });

  it('holds a fast reading until the minimum time has passed', async () => {
    const waits: number[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const wait = async (ms: number) => { waits.push(ms); if (ms === 500) await gate; };
    const r = { headline: 'h', body: 'b', underlines: [] };
    let done = false;
    const p = loadReading(async () => r, { minMs: 500, retryMs: 10, wait }).then((x) => { done = true; return x; });
    await Promise.resolve();
    await Promise.resolve();
    expect(done).toBe(false);
    release();
    await expect(p).resolves.toBe(r);
  });

  it('keeps the wait going and tries again when the reading fails', async () => {
    const r = { headline: 'h', body: 'b', underlines: [] };
    const fetchReading = jest.fn().mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(r);
    const waits: number[] = [];
    await expect(loadReading(fetchReading, { minMs: 1, retryMs: 7, wait: async (ms) => { waits.push(ms); } })).resolves.toBe(r);
    expect(fetchReading).toHaveBeenCalledTimes(3);
    expect(waits.filter((w) => w === 7)).toHaveLength(2);
  });
});
