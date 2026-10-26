import { createFakeApi } from '../src/api/fake';
import { careParagraphs, routeScreened } from '../src/care/route';

describe('screening routes', () => {
  it('carries on when nothing is flagged', async () => {
    const api = createFakeApi('none');
    expect(routeScreened(await api.startSituation('how do I price this', 'turn-1'))).toEqual({ kind: 'carry' });
    expect(routeScreened(await api.saveAnswer('building', 'a thing'))).toEqual({ kind: 'carry' });
  });

  it('sends clear distress to the care screen with its help lines', async () => {
    const r = routeScreened(await createFakeApi('clear').startSituation('x', 'turn-2'));
    expect(r.kind).toBe('care');
    if (r.kind === 'care') {
      expect(r.help.length).toBeGreaterThan(0);
      expect(r.message.length).toBeGreaterThan(0);
    }
  });

  it('gives unclear messages a soft reply, not the care screen', async () => {
    const r = routeScreened(await createFakeApi('unclear').saveAnswer('stuck', 'x'));
    expect(r).toEqual({ kind: 'unclear', reply: expect.any(String) });
  });
});

describe('care message', () => {
  it('uses the first paragraph as the heading', () => {
    expect(careParagraphs('One.\n\nTwo.\n\n\nThree.')).toEqual({ heading: 'One.', body: ['Two.', 'Three.'] });
  });
});
