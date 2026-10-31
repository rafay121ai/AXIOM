import type { Auth } from '../src/api/auth';
import { createHttpApi } from '../src/api/http';

const auth: Auth = { signInWithGoogle: async () => {}, signOut: async () => {}, isSignedIn: async () => true, getToken: async () => 'tok' };
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;

describe('http api', () => {
  it('sends the Bearer token and reads the sign-up from GET /api/signup', async () => {
    const f = jest.fn().mockResolvedValue(ok({ questions: [{ key: 'stage' }], answers: {}, next: 'stage', complete: false, total: 13 }));
    const api = createHttpApi({ baseUrl: 'http://x', auth, fetch: f });
    await expect(api.getSignup()).resolves.toEqual({ questions: [{ key: 'stage' }], answers: {}, next: 'stage', complete: false });
    expect(f).toHaveBeenCalledWith('http://x/api/signup', expect.objectContaining({ method: 'GET', headers: expect.objectContaining({ Authorization: 'Bearer tok' }) }));
  });

  it('saves with PUT and treats a plain save as carry on', async () => {
    const f = jest.fn().mockResolvedValue(ok({ answers: {}, next: 'months_in' }));
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
});
