import type { Auth } from '../src/api/auth';
import { createFakeApi } from '../src/api/fake';
import { createHttpApi } from '../src/api/http';
import { destinationOf } from '../src/home/flow';
import { copy, failureLine } from '../src/copy';

const auth: Auth = { signInWithGoogle: async () => {}, signOut: async () => {}, isSignedIn: async () => true, getName: async () => undefined, getToken: async () => 'tok' };
const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;

describe('history calls', () => {
  it('search with the typed text and read one page by id', async () => {
    const f = jest.fn().mockResolvedValueOnce(json({ items: [{ id: 'a' }] })).mockResolvedValueOnce(json({ id: 'a' }));
    const api = createHttpApi({ baseUrl: 'http://x', auth, fetch: f });
    expect(await api.getHistory('price & email')).toEqual([{ id: 'a' }]);
    expect(await api.getHistoryPage('a')).toEqual({ id: 'a' });
    expect(f.mock.calls.map(([url, init]) => [init.method, url])).toEqual([['GET', 'http://x/api/history?q=price%20%26%20email'], ['GET', 'http://x/api/history/a']]);
  });
});

describe('the fake history', () => {
  it('lists every situation, then searches titles and the read', async () => {
    const api = createFakeApi();
    expect((await api.getHistory('')).map((r) => r.status_label)).toEqual(['Open', 'Done', "Couldn't", "Didn't", 'Paused']);
    expect((await api.getHistory('clinics')).map((r) => r.id)).toEqual(['fake-situation-1']);
    expect(await api.getHistory('zzz')).toEqual([]);
  });

  it('names the one action by status, and the sharing line only where there is a report', async () => {
    const api = createFakeApi();
    expect((await api.getHistoryPage('fake-situation-1')).action.label).toBe('Pick it up');
    expect((await api.getHistoryPage('fake-situation-5')).action.label).toBe('Bring it back');
    const done = await api.getHistoryPage('fake-situation-2');
    expect(done.action.label).toBe('Talk about this again');
    expect(done.how_it_went?.sharing).toBe('shared');
    expect((await api.getHistoryPage('fake-situation-1')).how_it_went).toBeNull();
  });

  it('leads a pick-up to the situation stage it names', async () => {
    const api = createFakeApi();
    const { action } = await api.getHistoryPage('fake-situation-2');
    expect(await destinationOf(api, action.target)).toEqual({ kind: 'learn', situationId: 'fake-situation-2' });
  });
});

describe('a signal item', () => {
  const signal = { stage: 'signal', signal_id: 'fake-signal-1' } as const;

  it('is one the fake home can show, with the existing item shape', async () => {
    const home = await createFakeApi('none', 0, false, 'signal').getHome('UTC');
    expect(home.items).toEqual([expect.objectContaining({ kind: 'signal', target: signal })]);
    expect(home.drawer.open).toEqual([]);
  });

  it('opens the situation the server returns, with what is already said in it', async () => {
    const api = createFakeApi();
    const dest = await destinationOf(api, signal);
    expect(dest).toMatchObject({ kind: 'situation', turns: [expect.objectContaining({ role: 'axiom' })] });
    expect((dest as { turns: unknown[] }).turns).toHaveLength(1);
  });

  it('posts to the open route, writes no message, then reads the situation', async () => {
    const view = { situation: { id: 's1' }, turns: [{ role: 'axiom', text: 'Dana replied.' }], read: null };
    const f = jest.fn().mockResolvedValueOnce(json({ situation_id: 's1', stage: 'situation' })).mockResolvedValueOnce(json(view));
    const api = createHttpApi({ baseUrl: 'http://x', auth, fetch: f });
    expect(await destinationOf(api, signal)).toEqual({ kind: 'situation', situationId: 's1', turns: view.turns });
    expect(f.mock.calls.map(([url, init]) => [init.method, url])).toEqual([['POST', 'http://x/api/home/signals/fake-signal-1/open'], ['GET', 'http://x/api/situations/s1']]);
  });

  it('shows the daily-limit line on 429, and the plain line otherwise', async () => {
    const refuse = (status: number, body: unknown) => jest.fn().mockResolvedValue({ ok: false, status, json: async () => body } as Response);
    const limited = createHttpApi({ baseUrl: 'http://x', auth, fetch: refuse(429, { error: 'daily_limit', open: [] }) });
    const e = await destinationOf(limited, signal).catch((err) => err);
    expect(failureLine(e, 'open')).toEqual({ text: copy.dailyLimit, canRetry: false });
    const racing = createHttpApi({ baseUrl: 'http://x', auth, fetch: refuse(409, { error: 'busy' }) });
    expect(failureLine(await destinationOf(racing, signal).catch((err) => err), 'open').text).toBeTruthy();
  });
});
