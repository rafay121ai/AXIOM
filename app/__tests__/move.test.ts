import type { Auth } from '../src/api/auth';
import { createFakeApi } from '../src/api/fake';
import { createHttpApi } from '../src/api/http';
import { HttpError } from '../src/api/queue';
import { routeScreened } from '../src/care/route';
import { copy, failureLine } from '../src/copy';
import { spokenTime } from '../src/move/format';

const auth: Auth = { signInWithGoogle: async () => {}, signOut: async () => {}, isSignedIn: async () => true, getToken: async () => 'tok' };
const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body }) as Response;

describe('move calls', () => {
  it('go to the right routes and send the phone time zone with a commit', async () => {
    const f = jest.fn().mockResolvedValue(json(200, { move: { id: 'm1' } }));
    const api = createHttpApi({ baseUrl: 'http://x', auth, fetch: f });
    expect(await api.openMove('l1')).toEqual({ id: 'm1' });
    await api.commitMove('m1', 'Asia/Karachi');
    await api.swapMove('m1', 'I only have their email');
    expect(f.mock.calls.map(([url, init]) => [init.method, url, init.body])).toEqual([
      ['POST', 'http://x/api/learn/l1/move', undefined],
      ['POST', 'http://x/api/moves/m1/commit', JSON.stringify({ timezone: 'Asia/Karachi' })],
      ['POST', 'http://x/api/moves/m1/swap', JSON.stringify({ reason: 'I only have their email' })],
    ]);
  });

  it('say the server line for a full house and never offer a retry', async () => {
    const api = createHttpApi({ baseUrl: 'http://x', auth, fetch: jest.fn().mockResolvedValue(json(409, { error: 'move_cap', code: 'move_cap', message: 'You have 3 moves open. Tell me first.', moves: [] })) });
    const e = await api.openMove('l1').catch((err) => err);
    expect(e).toBeInstanceOf(HttpError);
    expect(failureLine(e, 'read')).toEqual({ text: 'You have 3 moves open. Tell me first.', canRetry: false });
  });

  it('never write the number of moves themselves when the server sends no line', () => {
    expect(copy.move.noRoom).not.toMatch(/\d/);
    expect(failureLine(new HttpError(409, 'move_cap'))).toEqual({ text: copy.move.noRoom, canRetry: false });
  });

  it('say the swap is used and never offer a retry', async () => {
    const api = createHttpApi({ baseUrl: 'http://x', auth, fetch: jest.fn().mockResolvedValue(json(409, { error: 'swap_used', code: 'swap_used', message: 'You have changed this move once already.' })) });
    const e = await api.swapMove('m1', 'no email').catch((err) => err);
    expect(failureLine(e)).toEqual({ text: copy.move.swapUsed, canRetry: false });
  });
});

describe('the fake move', () => {
  it('has the mock\'s move: mission, success, words and a checklist of 2 to 4', async () => {
    const m = await createFakeApi().openMove('fake-learn-1');
    expect(m.title).toBe('Ask both clinics for one concrete next step.');
    expect(m.words).toContain('20 minutes');
    expect(m.checklist.length).toBeGreaterThanOrEqual(2);
    expect(m.checklist.length).toBeLessThanOrEqual(4);
    expect(m.can_swap).toBe(true);
  });

  it('commits once however often it is asked, and reports the time to remind', async () => {
    const api = createFakeApi();
    const m = await api.openMove('l');
    const a = await api.commitMove(m.id, 'Asia/Karachi');
    const b = await api.commitMove(m.id, 'Asia/Karachi');
    expect(b).toEqual(a);
    expect(a.report.local_time).toBe('20:00');
    expect((await api.openMove('l')).status).toBe('committed');
  });

  it('asks for a real reason, then changes the move once and takes the control away', async () => {
    const api = createFakeApi();
    const m = await api.openMove('l');
    expect(await api.swapMove(m.id, "I'm busy")).toMatchObject({ status: 'need_reason', reply: expect.any(String) });
    const done = await api.swapMove(m.id, 'I only have their email');
    expect(done).toMatchObject({ status: 'swapped', replaced_id: m.id });
    if (done.care || done.status !== 'swapped') throw new Error('expected a swap');
    expect(done.move.can_swap).toBe(false);
    expect((await api.swapMove(m.id, 'I only have their email'))).toEqual(done);
    await expect(api.swapMove(done.move.id, 'I only have their phone')).rejects.toMatchObject({ status: 409, code: 'swap_used' });
  });

  it('screens the swap reason first', async () => {
    const api = createFakeApi('clear');
    const m = await api.openMove('l');
    expect(routeScreened(await api.swapMove(m.id, 'I only have their email')).kind).toBe('care');
    expect(await createFakeApi().openMove('l')).toMatchObject({ status: 'draft' });
  });
});

describe('the reminder time', () => {
  it('is said the way the mock says it', () => {
    expect(spokenTime('20:00')).toBe('8 pm');
    expect(spokenTime('18:30')).toBe('6:30 pm');
    expect(spokenTime('07:05')).toBe('7:05 am');
    expect(spokenTime('00:00')).toBe('12 am');
    expect(spokenTime('12:00')).toBe('12 pm');
  });
});
