import type { Auth } from '../src/api/auth';
import { createHttpApi } from '../src/api/http';
import { createOutbox, memoryStore, type Unsent } from '../src/api/outbox';
import { HttpError } from '../src/api/queue';
import { copy } from '../src/copy';

const auth: Auth = { signInWithGoogle: async () => {}, signOut: async () => {}, isSignedIn: async () => true, getName: async () => undefined, getToken: async () => 'tok' };
const ok = (body: unknown = {}) => ({ ok: true, status: 200, json: async () => body }) as Response;
const refuse = (status: number, body: unknown = {}) => ({ ok: false, status, json: async () => body }) as Response;
const req = (id: string, extra: Partial<Unsent> = {}): Unsent => ({ id, method: 'POST', path: `/api/${id}`, body: { id }, ...extra });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('outbox', () => {
  it('writes a request down before sending it and crosses it off when the server has it', async () => {
    const store = memoryStore();
    let seenWhileSending: string | null = null;
    const outbox = createOutbox({ store, send: async () => { seenWhileSending = await store.getItem('axiom.unsent.v1'); return { done: true }; } });
    await expect(outbox.deliver(req('a'))).resolves.toEqual({ done: true });
    expect(JSON.parse(seenWhileSending!)).toEqual([req('a')]);
    expect(JSON.parse((await store.getItem('axiom.unsent.v1'))!)).toEqual([]);
  });

  it('keeps a request that could not get through, so it survives a restart', async () => {
    const store = memoryStore();
    const down = createOutbox({ store, send: async () => { throw new HttpError(); } });
    await expect(down.deliver(req('a'))).rejects.toBeInstanceOf(HttpError);
    const sent: Unsent[] = [];
    const restarted = createOutbox({ store, send: async (r) => { sent.push(r); } });
    await restarted.resume();
    expect(sent).toEqual([req('a')]);
    expect(JSON.parse((await store.getItem('axiom.unsent.v1'))!)).toEqual([]);
  });

  it('crosses off a request the server refuses for good, and sends it no more', async () => {
    const store = memoryStore();
    const outbox = createOutbox({ store, send: async () => { throw new HttpError(400); } });
    await expect(outbox.deliver(req('a'))).rejects.toMatchObject({ status: 400 });
    expect(JSON.parse((await store.getItem('axiom.unsent.v1'))!)).toEqual([]);
  });

  it('sends oldest first, and a newer request with the same id replaces the older one', async () => {
    const store = memoryStore();
    const down = createOutbox({ store, send: async () => { throw new HttpError(); } });
    await Promise.allSettled([down.deliver(req('a')), down.deliver(req('b')), down.deliver(req('a', { body: { id: 'a', newer: true } }))]);
    const sent: Unsent[] = [];
    await createOutbox({ store, send: async (r) => { sent.push(r); } }).resume();
    expect(sent).toEqual([req('a', { body: { id: 'a', newer: true } }), req('b')]);
  });

  it('retries in the background after a failure and settles the first pass at that failure', async () => {
    const store = memoryStore();
    const down = createOutbox({ store, send: async () => { throw new HttpError(); } });
    await down.deliver(req('a')).catch(() => {});
    let online = false;
    const sent: string[] = [];
    const outbox = createOutbox({ store, retryDelay: () => 1, send: async (r) => { if (!online) throw new HttpError(503); sent.push(r.id); } });
    await outbox.resume();
    expect(sent).toEqual([]);
    online = true;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent).toEqual(['a']);
  });

  it('forgets everything on sign-out', async () => {
    const store = memoryStore();
    const outbox = createOutbox({ store, retryDelay: () => 1, send: async () => { throw new HttpError(); } });
    await outbox.deliver(req('a')).catch(() => {});
    void outbox.resume();
    await settle();
    await outbox.clear();
    const sent: Unsent[] = [];
    await createOutbox({ store, send: async (r) => { sent.push(r); } }).resume();
    expect(sent).toEqual([]);
  });

  it('ignores storage that does not read back as requests', async () => {
    const store = memoryStore();
    await store.setItem('axiom.unsent.v1', '{not json');
    const sent: Unsent[] = [];
    await createOutbox({ store, send: async (r) => { sent.push(r); } }).resume();
    await store.setItem('axiom.unsent.v1', JSON.stringify([{ id: 1 }, 'x', req('ok')]));
    await createOutbox({ store, send: async (r) => { sent.push(r); } }).resume();
    expect(sent).toEqual([req('ok')]);
  });

  it('still sends when the phone cannot store it', async () => {
    const store = { ...memoryStore(), setItem: async () => { throw new Error('full'); } };
    const outbox = createOutbox({ store, send: async () => 'sent' });
    await expect(outbox.deliver(req('a'))).resolves.toBe('sent');
  });
});

describe('what the founder sends survives a restart (http)', () => {
  // The sign-up queue retries a down connection for as long as the app lives; fake timers stop that at the end of each test.
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('replays an unsent message, an answer and a check-in with the same turn ids', async () => {
    const store = memoryStore();
    const offline = createHttpApi({ baseUrl: 'http://x', auth, store, fetch: jest.fn().mockRejectedValue(new Error('offline')) });
    await expect(offline.startSituation('my hiring is going badly', 'turn-1')).rejects.toBeInstanceOf(HttpError);
    await expect(offline.sendTurn('s1', 'two people left', 'turn-2')).rejects.toBeInstanceOf(HttpError);
    await expect(offline.sendLearnTurn('l1', 'ten percent', 'turn-3')).rejects.toBeInstanceOf(HttpError);
    await expect(offline.sendReport('m1', 'done', 'I sent both', 'turn-4')).rejects.toBeInstanceOf(HttpError);
    await expect(offline.sendCheckIn('better today')).rejects.toBeInstanceOf(HttpError);
    void offline.saveAnswer('stage', { value: 'Just an idea' });
    await jest.advanceTimersByTimeAsync(0);

    const f = jest.fn().mockResolvedValue(ok());
    const online = createHttpApi({ baseUrl: 'http://x', auth, store, fetch: f });
    await online.resumeUnsent();
    const calls = f.mock.calls.map(([url, init]) => `${init.method} ${url} ${init.body}`);
    expect(calls).toEqual([
      `POST http://x/api/situations ${JSON.stringify({ text: 'my hiring is going badly', client_turn_id: 'turn-1' })}`,
      `POST http://x/api/situations/s1/turn ${JSON.stringify({ text: 'two people left', client_turn_id: 'turn-2' })}`,
      `POST http://x/api/learn/l1/turn ${JSON.stringify({ text: 'ten percent', client_turn_id: 'turn-3' })}`,
      `POST http://x/api/moves/m1/report ${JSON.stringify({ outcome: 'done', note: 'I sent both', client_turn_id: 'turn-4' })}`,
      `POST http://x/api/home/checkin ${JSON.stringify({ text: 'better today' })}`,
      `PUT http://x/api/signup/answers/stage ${JSON.stringify({ answer: { value: 'Just an idea' } })}`,
    ]);

    const again = jest.fn().mockResolvedValue(ok());
    await createHttpApi({ baseUrl: 'http://x', auth, store, fetch: again }).resumeUnsent();
    expect(again).not.toHaveBeenCalled();
  });

  it('keeps nothing for a message the server refused for good', async () => {
    const store = memoryStore();
    const api = createHttpApi({ baseUrl: 'http://x', auth, store, fetch: jest.fn().mockResolvedValue(refuse(409, { error: 'x', code: 'turn_busy' })) });
    await expect(api.sendTurn('s1', 'hello there friend', 'turn-9')).rejects.toMatchObject({ code: 'turn_busy' });
    const f = jest.fn().mockResolvedValue(ok());
    await createHttpApi({ baseUrl: 'http://x', auth, store, fetch: f }).resumeUnsent();
    expect(f).not.toHaveBeenCalled();
  });

  it('forgets what is unsent when the founder signs out', async () => {
    const store = memoryStore();
    const api = createHttpApi({ baseUrl: 'http://x', auth, store, fetch: jest.fn().mockRejectedValue(new Error('offline')) });
    await api.sendCheckIn('better today').catch(() => {});
    await api.signOut();
    const f = jest.fn().mockResolvedValue(ok());
    await createHttpApi({ baseUrl: 'http://x', auth, store, fetch: f }).resumeUnsent();
    expect(f).not.toHaveBeenCalled();
  });
});

describe('the offline check-in line', () => {
  it('is the mock\'s, including the line that is now true', () => {
    expect(`${copy.report.saved} ${copy.report.willSend}`).toBe("Your check-in is saved. I'll send it as soon as you're back online. You can close the app.");
  });
});
