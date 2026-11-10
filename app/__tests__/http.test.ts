import type { Auth } from '../src/api/auth';
import { createHttpApi } from '../src/api/http';

const auth: Auth = { signInWithGoogle: async () => {}, signOut: async () => {}, isSignedIn: async () => true, getName: async () => undefined, getToken: async () => 'tok' };
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;

describe('http api', () => {
  it('sends the Bearer token and reads the sign-up from GET /api/signup', async () => {
    const f = jest.fn().mockResolvedValue(ok({ questions: [{ key: 'stage' }], answers: {}, next: 'stage', complete: false, total: 14 }));
    const api = createHttpApi({ baseUrl: 'http://x', auth, fetch: f });
    await expect(api.getSignup()).resolves.toEqual({ questions: [{ key: 'stage' }], answers: {}, next: 'stage', complete: false, total: 14 });
    expect(f).toHaveBeenCalledWith('http://x/api/signup', expect.objectContaining({ method: 'GET', headers: expect.objectContaining({ Authorization: 'Bearer tok' }) }));
  });

  it('saves with PUT and treats a plain save as carry on', async () => {
    const f = jest.fn().mockResolvedValue(ok({ answers: {}, next: 'commitment' }));
    const api = createHttpApi({ baseUrl: 'http://x', auth, fetch: f });
    await expect(api.saveAnswer('stage', { value: 'Just an idea' })).resolves.toEqual({});
    expect(f.mock.calls[0][0]).toBe('http://x/api/signup/answers/stage');
    expect(f.mock.calls[0][1]).toMatchObject({ method: 'PUT', body: JSON.stringify({ answer: { value: 'Just an idea' } }) });
  });

  it('passes the care responses through', async () => {
    const care = { care: 'unclear', reply: 'What is going on?' };
    const api = createHttpApi({ baseUrl: 'http://x', auth, fetch: jest.fn().mockResolvedValue(ok(care)) });
    await expect(api.saveAnswer('stuck', 'text')).resolves.toEqual(care);
  });

  it('asks for the first reading only after the queued saves have gone through', async () => {
    const calls: string[] = [];
    let offline = true;
    const f = jest.fn(async (url: string, init: RequestInit) => {
      if (init.method === 'PUT' && offline) throw new TypeError('network');
      calls.push(`${init.method} ${url}`);
      return ok(init.method === 'POST' ? { headline: 'h', body: 'b', underlines: [] } : {});
    });
    jest.useFakeTimers();
    const api = createHttpApi({ baseUrl: 'http://x', auth, fetch: f as unknown as typeof fetch });
    void api.saveAnswer('stage', { value: 'Just an idea' });
    const reading = api.getFirstReading();
    await jest.advanceTimersByTimeAsync(0);
    expect(calls).toEqual([]);
    offline = false;
    await jest.advanceTimersByTimeAsync(2000);
    await expect(reading).resolves.toEqual({ headline: 'h', body: 'b', underlines: [] });
    expect(calls).toEqual(['PUT http://x/api/signup/answers/stage', 'POST http://x/api/first-reading']);
    jest.useRealTimers();
  });

  it('saves an optional question typed or skipped, with the shapes the server takes', async () => {
    const f = jest.fn().mockResolvedValue(ok({ answers: {}, next: 'people' }));
    const api = createHttpApi({ baseUrl: 'http://x', auth, fetch: f });
    await api.saveAnswer('contrarian', 'Nobody wants a calendar');
    await api.saveAnswer('people', { skipped: true });
    expect(f.mock.calls[0][0]).toBe('http://x/api/signup/answers/contrarian');
    expect(f.mock.calls[0][1].body).toBe(JSON.stringify({ answer: 'Nobody wants a calendar' }));
    expect(f.mock.calls[1][0]).toBe('http://x/api/signup/answers/people');
    expect(f.mock.calls[1][1].body).toBe(JSON.stringify({ answer: { skipped: true } }));
  });

  it('saves the name with PUT /api/signup/name and the birthday as month and day only', async () => {
    const f = jest.fn().mockResolvedValueOnce(ok({ name: 'Rafay' })).mockResolvedValueOnce(ok({ month: 3, day: 9 }));
    const api = createHttpApi({ baseUrl: 'http://x', auth, fetch: f });
    await expect(api.saveName('Rafay')).resolves.toEqual({ name: 'Rafay' });
    await api.saveBirthday(3, 9);
    expect(f.mock.calls[0][0]).toBe('http://x/api/signup/name');
    expect(f.mock.calls[0][1]).toMatchObject({ method: 'PUT', body: JSON.stringify({ name: 'Rafay' }) });
    expect(f.mock.calls[1][0]).toBe('http://x/api/signup/birthday');
    expect(f.mock.calls[1][1]).toMatchObject({ method: 'PUT', body: JSON.stringify({ month: 3, day: 9 }) });
  });

  it('a care answer to the name comes back so the app can route it', async () => {
    const care = { care: 'unclear', reply: 'x' };
    const api = createHttpApi({ baseUrl: 'http://x', auth, fetch: jest.fn().mockResolvedValue(ok(care)) });
    await expect(api.saveName('x')).resolves.toEqual(care);
  });

  it('a founder the server calls complete is complete as sent, whatever the answers are', async () => {
    const body = { questions: [], answers: { stage: { value: 'Just an idea' } }, next: null, complete: true, total: 14 };
    const api = createHttpApi({ baseUrl: 'http://x', auth, fetch: jest.fn().mockResolvedValue(ok(body)) });
    await expect(api.getSignup()).resolves.toMatchObject({ complete: true, next: null });
  });
});
