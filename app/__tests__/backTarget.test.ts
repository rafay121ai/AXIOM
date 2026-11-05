import { backTarget } from '../src/backTarget';

const H = { name: 'home' }, S = { name: 'settings' }, Hi = { name: 'history' };
const go = (stage: { name: string; back?: unknown }) => backTarget(stage, H, S, Hi);

describe('Android back button', () => {
  it('goes up one level from the side screens', () => {
    expect(go({ name: 'history' })).toBe(H);
    expect(go({ name: 'settings' })).toBe(H);
    expect(go({ name: 'past' })).toBe(Hi);
    expect(go({ name: 'answers' })).toBe(S);
  });
  it('returns a move to where it came from', () => {
    const from = { name: 'learn' };
    expect(go({ name: 'move', back: from })).toBe(from);
  });
  it('leaves the app only from home', () => {
    expect(go(H)).toBe('exit');
  });
  it('stays put on the care screen and mid-journey', () => {
    for (const name of ['care', 'signin', 'questions', 'wait', 'reading', 'situation', 'read', 'learn', 'report']) {
      expect(go({ name })).toBe('stay');
    }
  });
});
