import type { Auth } from '../src/api/auth';
import { createFakeApi } from '../src/api/fake';
import { createHttpApi } from '../src/api/http';
import type { ConsentState } from '../src/api/types';
import { routeScreened } from '../src/care/route';
import { copy } from '../src/copy';
import { consentQuestion, OUTCOME_MARK, outcomeLabel } from '../src/report/flow';

const auth: Auth = { signInWithGoogle: async () => {}, signOut: async () => {}, isSignedIn: async () => true, getToken: async () => 'tok' };
const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body }) as Response;
const TURN = '11111111-1111-4111-8111-111111111111';

describe('report calls', () => {
  it('go to the right routes with the turn id, and the consent carries the wording version', async () => {
    const f = jest.fn().mockResolvedValue(json(200, { reports: [], story: null }));
    const api = createHttpApi({ baseUrl: 'http://x', auth, fetch: f });
    expect(await api.getDueReports()).toEqual([]);
    await api.sendReport('m1', 'couldnt', 'They never wrote back', TURN);
    expect((await api.getStory('r1')).story).toBeNull();
    await api.setConsent('r1', false, 'share-alone-v1');
    expect(f.mock.calls.map(([url, init]) => [init.method, url, init.body])).toEqual([
      ['GET', 'http://x/api/reports/due', undefined],
      ['POST', 'http://x/api/moves/m1/report', JSON.stringify({ outcome: 'couldnt', note: 'They never wrote back', client_turn_id: TURN })],
      ['GET', 'http://x/api/reports/r1/story', undefined],
      ['POST', 'http://x/api/reports/r1/consent', JSON.stringify({ share: false, wording_version: 'share-alone-v1' })],
    ]);
  });
});

describe('the fake report', () => {
  it('is waiting only when asked to be, and has the mock opening and the three outcomes', async () => {
    expect(await createFakeApi().getDueReports()).toEqual([]);
    const [due] = await createFakeApi('none', 0, true).getDueReports();
    expect(due.opening).toBe('Your move was to ask both clinics for a call within the next 3 days. I said at least one would not answer. What happened?');
    expect(due.outcomes).toEqual(['done', 'couldnt', 'didnt']);
    expect(due.questions).toEqual({ done: 'What did they say?', couldnt: 'What got in the way?', didnt: 'What stopped you?' });
  });

  it('says "Say a bit more." to a thin note and stores nothing', async () => {
    const api = createFakeApi('none', 0, true);
    const [due] = await api.getDueReports();
    expect(await api.sendReport(due.move_id, 'done', 'ok', TURN)).toEqual({ status: 'need_more', reply: 'Say a bit more.' });
    expect(await api.getDueReports()).toHaveLength(1);
  });

  it('reports once however often the same send arrives, then nothing is due', async () => {
    const api = createFakeApi('none', 0, true);
    const [due] = await api.getDueReports();
    const a = await api.sendReport(due.move_id, 'didnt', 'I was not sure what to write', TURN);
    const b = await api.sendReport(due.move_id, 'didnt', 'I was not sure what to write', TURN);
    expect(b).toEqual(a);
    expect(a).toMatchObject({ status: 'reported', unlock: { granted: true } });
    expect(await api.getDueReports()).toEqual([]);
  });

  it('screens the note first', async () => {
    const api = createFakeApi('clear', 0, true);
    const res = await api.sendReport('fake-move-1', 'done', 'something very heavy', TURN);
    expect(routeScreened(res).kind).toBe('care');
  });

  it('answers a share with "Shared" wording and a keep private with "Kept private"', async () => {
    const api = createFakeApi();
    expect((await api.setConsent('r', true, 'share-alone-v1')).reply).toBe('Thank you. That opens more founder stories for you.');
    expect((await api.setConsent('r', false, 'share-alone-v1')).reply).toMatch(/^Kept private/);
  });
});

describe('the sharing question', () => {
  const asked: ConsentState = {
    ask: true, state: 'asked', choices: ['share', 'keep_private'],
    question: { text: 'alone', wording_version: 'share-alone-v1' },
    question_after_story: { text: 'after', wording_version: 'share-after-story-v1' },
  };

  it('is the server\'s own text, and the after-story one only once a story was seen', () => {
    expect(consentQuestion(asked, false)).toEqual({ text: 'alone', wording_version: 'share-alone-v1' });
    expect(consentQuestion(asked, true)).toEqual({ text: 'after', wording_version: 'share-after-story-v1' });
  });

  it('falls back to the plain question when there is no after-story wording', () => {
    expect(consentQuestion({ ...asked, question_after_story: null }, true)?.wording_version).toBe('share-alone-v1');
  });

  it('is not asked when the server did not ask', () => {
    expect(consentQuestion({ ask: false, state: 'shared', automatic: true }, true)).toBeNull();
  });
});

describe('the outcome marks', () => {
  it('say Done, Couldn\'t and Didn\'t, in the mock\'s words', () => {
    expect((['done', 'couldnt', 'didnt'] as const).map(outcomeLabel)).toEqual(['Done', "Couldn't", "Didn't"]);
    expect(OUTCOME_MARK).toEqual({ done: 'tick', couldnt: 'pause', didnt: 'dash' });
    expect(copy.report.placeholder).toBe('What happened?');
  });
});
