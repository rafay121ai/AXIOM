import { readFileSync } from 'fs';
import { join } from 'path';
import type { Auth } from '../src/api/auth';
import { createFakeApi } from '../src/api/fake';
import { createHttpApi } from '../src/api/http';
import { memoryStore } from '../src/api/outbox';
import { HttpError } from '../src/api/queue';
import { clearShown, connectLine, newsletterGate, newsletterSaver, newsletterSub } from '../src/connect/flow';

const auth: Auth = { signInWithGoogle: async () => {}, signOut: async () => {}, isSignedIn: async () => true, getName: async () => undefined, getToken: async () => 'tok' };
const res = (status: number, body: unknown = {}) => ({ ok: status < 400, status, json: async () => body }) as Response;
const src = (f: string) => readFileSync(join(__dirname, '../src', f), 'utf8');

describe('newsletter routes', () => {
  it('GET and PUT go to the right route, and PUT sends the ticked ids', async () => {
    const f = jest.fn().mockResolvedValue(res(200, { newsletters: [] }));
    const api = createHttpApi({ baseUrl: 'http://x', auth, fetch: f });
    await api.getNewsletters();
    await api.setNewsletters(['a', 'b']);
    expect(f.mock.calls.map(([url, init]) => [init.method, url, init.body])).toEqual([
      ['GET', 'http://x/api/connectors/gmail/newsletters', undefined],
      ['PUT', 'http://x/api/connectors/gmail/newsletters', JSON.stringify({ watching: ['a', 'b'] })],
    ]);
  });

  it('a 404 is null (hides the Newsletters action); a refusal shows its line', async () => {
    expect(await createHttpApi({ baseUrl: 'http://x', auth, fetch: jest.fn().mockResolvedValue(res(404)) }).getNewsletters()).toBeNull();
    const line = 'Your account is being deleted, so nothing new can be connected.';
    const api = createHttpApi({ baseUrl: 'http://x', auth, fetch: jest.fn().mockResolvedValue(res(409, { error: 'account_deleting', line })) });
    const e = await api.setNewsletters(['a']).catch((x) => x);
    expect(connectLine(e)).toBe(line);
  });
});

describe('the picker is offered once', () => {
  it('offers the list the first time, never again, and again after sign-out', async () => {
    const store = memoryStore();
    const api = createFakeApi();
    expect((await newsletterGate(api, store))!.length).toBe(8);
    expect(await newsletterGate(api, store)).toBeNull();
    await clearShown(store);
    expect(await newsletterGate(api, store)).not.toBeNull();
  });

  it('an empty list, a switched-off server or a failure skips, and is not marked shown', async () => {
    for (const getNewsletters of [async () => [], async () => null, async () => { throw new HttpError(500); }]) {
      const store = memoryStore();
      expect(await newsletterGate({ getNewsletters }, store)).toBeNull();
      expect(await store.getItem('newsletters_shown')).toBeNull();
    }
  });

  it('nothing is ticked for the founder', async () => {
    expect((await createFakeApi().getNewsletters())!.some((n) => n.watching)).toBe(false);
  });

  it('the fake saves the ticked set, as Settings toggles do', async () => {
    const api = createFakeApi();
    const saved = await api.setNewsletters(['nl1', 'nl3']);
    expect(saved.filter((n) => n.watching).map((n) => n.id)).toEqual(['nl1', 'nl3']);
    expect((await api.setNewsletters(['nl1'])).filter((n) => n.watching).map((n) => n.id)).toEqual(['nl1']);
  });

  it('row subtitle reads as the mock', () => {
    expect(newsletterSub({ id: 'a', name: 'A', per_week: 3, opens: 'rarely', watching: false })).toBe('about 3 a week · you rarely open');
  });
});

it('the screens are wired as the mock says', () => {
  const picker = src('screens/NewsletterPicker.tsx');
  expect(picker).toMatch(/disabled=\{!ticked\.length\}/);
  expect(picker).toMatch(/setNewsletters\(ticked\)/);
  expect(src('screens/ConnectScreen.tsx')).toMatch(/newsletterGate/);
  expect(src('components/NewsletterRows.tsx')).toMatch(/accessibilityRole="checkbox"/);
  expect(src('components/ConnectionRows.tsx')).toMatch(/toolkit === 'gmail' && onNewsletters/);
  expect(src('screens/SettingsScreen.tsx')).toMatch(/onNewsletters=\{letters\.list\?\.length \|\| letters\.line \?/);
});

describe('saving taps', () => {
  const L = (...w: boolean[]) => w.map((watching, i) => ({ id: `n${i}`, name: 'N', per_week: 1, opens: 'most' as const, watching }));
  it('runs saves in order and reports only the newest answer', async () => {
    const order: string[][] = [];
    const api = { setNewsletters: async (ids: string[]) => { order.push(ids); return L(ids.includes('n0'), ids.includes('n1')); } };
    const onSaved = jest.fn();
    const save = newsletterSaver(api, L(false, false), { onSaved, onFailed: jest.fn() });
    save(['n0']);
    await save(['n0', 'n1']);
    expect(order).toEqual([['n0'], ['n0', 'n1']]);
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onSaved.mock.calls[0][0].map((n: any) => n.watching)).toEqual([true, true]);
  });
  it('a failed newest save hands back the last confirmed list and its refusal', async () => {
    const refusal = new HttpError(409, 'care_open', 'Not now.');
    let n = 0;
    const api = { setNewsletters: async () => { if (n++) throw refusal; return L(true); } };
    const onFailed = jest.fn();
    const save = newsletterSaver(api, L(false), { onSaved: jest.fn(), onFailed });
    await save(['n0']);
    await save([]);
    expect(onFailed).toHaveBeenCalledWith(L(true), refusal);
  });
});
