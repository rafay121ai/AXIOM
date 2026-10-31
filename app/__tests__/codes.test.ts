import type { Auth } from '../src/api/auth';
import { createHttpApi } from '../src/api/http';
import { HttpError } from '../src/api/queue';
import { copy, failureLine } from '../src/copy';

const auth: Auth = { signInWithGoogle: async () => {}, signOut: async () => {}, isSignedIn: async () => true, getToken: async () => 'tok' };
const refuse = (status: number, body: unknown) => jest.fn().mockResolvedValue({ ok: false, status, json: async () => body } as Response);

// Every 409 the server sends carries `code`, and the settings PUT sends `quiet_hours_clash`.
const CODES = [
  'move_not_ready', 'move_not_committable', 'move_not_changeable', 'move_changing', 'swap_used', 'move_cap', 'turn_busy',
  'read_started', 'situation_empty', 'read_missing', 'read_unanswered', 'lesson_not_started', 'report_saving',
  'report_not_allowed', 'share_not_allowed', 'signup_unfinished', 'quiet_hours_clash',
];
const TRANSIENT = ['move_not_ready', 'move_changing', 'turn_busy', 'report_saving'];

describe('every server code has its own plain line', () => {
  it.each(CODES)('%s', async (code) => {
    const api = createHttpApi({ baseUrl: 'http://x', auth, fetch: refuse(code === 'quiet_hours_clash' ? 400 : 409, { error: 'Server wording that is never shown.', code }) });
    const e = await api.getSettings().catch((err) => err);
    expect(e).toBeInstanceOf(HttpError);
    expect(e.code).toBe(code);
    const line = failureLine(e);
    expect(line.text).not.toMatch(/Server wording/);
    expect(line.text).not.toBe(copy.couldNotAnswer);
    expect(line.text).not.toBe(copy.couldNotRead);
    expect(line.canRetry).toBe(TRANSIENT.includes(code));
  });

  it('keeps the daily limit, which names itself in `error`', async () => {
    const api = createHttpApi({ baseUrl: 'http://x', auth, fetch: refuse(429, { error: 'daily_limit', message: 'x', open: [] }) });
    const e = await api.getSettings().catch((err) => err);
    expect(failureLine(e)).toEqual({ text: copy.dailyLimit, canRetry: false });
  });

  it('falls back only for a failure with no code', () => {
    expect(failureLine(new HttpError(500))).toEqual({ text: copy.couldNotAnswer, canRetry: true });
    expect(failureLine(new HttpError(), 'read')).toEqual({ text: copy.couldNotRead, canRetry: true });
    expect(failureLine(new HttpError(400), 'save')).toEqual({ text: copy.settings.notSaved, canRetry: false });
    expect(failureLine(new HttpError(404), 'open')).toEqual({ text: copy.home.couldNotOpen, canRetry: false });
  });

  it('does not take an error sentence for a code', async () => {
    const api = createHttpApi({ baseUrl: 'http://x', auth, fetch: refuse(404, { error: 'Not found' }) });
    const e = await api.getSettings().catch((err) => err);
    expect(e.code).toBeUndefined();
  });
});
