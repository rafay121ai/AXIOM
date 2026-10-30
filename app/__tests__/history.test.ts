import type { Auth } from '../src/api/auth';
import { createFakeApi } from '../src/api/fake';
import { createHttpApi } from '../src/api/http';
import { destinationOf } from '../src/home/flow';

const auth: Auth = { signInWithGoogle: async () => {}, signOut: async () => {}, getToken: async () => 'tok' };
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
