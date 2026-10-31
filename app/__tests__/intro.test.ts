import { copy } from '../src/copy';
import { beatAt, inOut, INTRO, out3, seg, session, startAt, type Beat } from '../src/intro/timeline';

describe('intro timeline', () => {
  it('shows the beats in order', () => {
    const seen: Beat[] = [];
    for (let ms = 0; ms <= INTRO.end; ms += 50) {
      const b = beatAt(ms);
      if (seen[seen.length - 1] !== b) seen.push(b);
    }
    expect(seen).toEqual(['light', 'emblem', 'settle', 'tagline', 'final']);
  });

  // A tap and reduced motion both jump the clock to INTRO.end.
  it('skipping, or reduced motion, lands on the final beat', () => {
    expect(beatAt(INTRO.end)).toBe('final');
  });

  it('the tagline is in place before the button rises, and the shine ends with the film', () => {
    expect(copy.intro.words).toHaveLength(3);
    expect(INTRO.tag + (copy.intro.words.length - 1) * INTRO.tagGap + INTRO.tagIn).toBeLessThanOrEqual(INTRO.button[1]);
    expect(INTRO.shine[1]).toBeLessThanOrEqual(INTRO.end);
  });

  it('easing starts at 0 and lands at 1', () => {
    for (const f of [out3, inOut]) { expect(f(0)).toBe(0); expect(f(1)).toBe(1); }
    expect(seg(INTRO.draw[0], INTRO.draw)).toBe(0);
    expect(seg(INTRO.draw[1], INTRO.draw)).toBe(1);
  });

  it('plays from the start the first time, never again after it played', () => {
    expect(startAt(session.played)).toBe(0);
    session.played = true;
    expect(startAt(session.played)).toBe(INTRO.end);
    session.played = false;
  });
});
