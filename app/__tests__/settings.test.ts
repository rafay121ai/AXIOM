import type { Auth } from '../src/api/auth';
import { createFakeApi } from '../src/api/fake';
import { createHttpApi } from '../src/api/http';
import { copy } from '../src/copy';
import { clockTime } from '../src/move/format';
import { answerSummary } from '../src/onboarding/flow';

const auth: Auth = { signInWithGoogle: async () => {}, signOut: async () => {}, getToken: async () => 'tok' };
const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;

describe('settings calls', () => {
  it('go to the right routes', async () => {
    const f = jest.fn().mockResolvedValue(json({}));
    const api = createHttpApi({ baseUrl: 'http://x', auth, fetch: f });
    await api.getSettings();
    await api.updateSettings({ mentor_style: 'hard', quiet_hours: { start: '23:00', end: '06:00' } });
    await api.requestExport();
    await api.requestDelete();
    await api.cancelDelete();
    expect(f.mock.calls.map(([url, init]) => [init.method, url, init.body])).toEqual([
      ['GET', 'http://x/api/settings', undefined],
      ['PUT', 'http://x/api/settings', JSON.stringify({ mentor_style: 'hard', quiet_hours: { start: '23:00', end: '06:00' } })],
      ['POST', 'http://x/api/account/export', undefined],
      ['DELETE', 'http://x/api/account', JSON.stringify({ confirm: 'DELETE' })],
      ['DELETE', 'http://x/api/account', JSON.stringify({ cancel: true })],
    ]);
  });

  it('signs out through the sign-in provider only', async () => {
    const signOut = jest.fn().mockResolvedValue(undefined);
    const f = jest.fn();
    await createHttpApi({ baseUrl: 'http://x', auth: { ...auth, signOut }, fetch: f }).signOut();
    expect(signOut).toHaveBeenCalled();
    expect(f).not.toHaveBeenCalled();
  });
});

describe('the fake settings', () => {
  it('start with sharing off and the server line that says so', async () => {
    const s = await createFakeApi().getSettings();
    expect(s.privacy).toMatchObject({ share_automatically: false });
    expect(s.privacy.text).toMatch(/^Off\. After each check-in I ask/);
    expect(s.mentor_style).toBe('direct');
    expect(s.reminders.lock_screen).toBe('short');
  });

  it('save one change at a time and return the whole page', async () => {
    const api = createFakeApi();
    const s = await api.updateSettings({ share_automatically: true, keep_items: true });
    expect(s.privacy.text).toMatch(/^On\./);
    expect(s.keep_items).toBe(true);
    expect((await api.getSettings()).keep_items).toBe(true);
  });

  it('refuse a check-in time inside quiet hours and keep the old one', async () => {
    const api = createFakeApi();
    await expect(api.updateSettings({ checkin_time: '23:00' })).rejects.toMatchObject({ status: 400, code: 'quiet_hours_clash' });
    expect((await api.getSettings()).reminders.checkin_time).toBe('20:00');
  });

  it('answer an export with the file and a delete with a dated grace period that can be cancelled', async () => {
    const api = createFakeApi();
    expect((await api.requestExport()).message).toMatch(/yours to keep/);
    const d = await api.requestDelete();
    expect(d).toMatchObject({ status: 'pending_deletion' });
    expect(d.delete_after).toBeTruthy();
    expect(d.message).not.toContain('{date}');
    expect((await api.requestDelete()).delete_after).toBe(d.delete_after);
    expect((await api.cancelDelete()).status).toBe('cancelled');
    expect((await api.cancelDelete()).status).toBe('none');
    expect((await api.getHistory('')).length).toBe(5);
  });

  it('only record the request while deletion is switched off', async () => {
    const api = createFakeApi('none', 0, false, undefined, undefined, 'off');
    expect(await api.requestDelete()).toMatchObject({ status: 'recorded', message: expect.stringMatching(/Nothing has been deleted/) });
  });
});

describe('settings words and helpers', () => {
  it('are the mock\'s', () => {
    expect(copy.settings.confirmTitle).toBe('Delete everything Axiom knows about you?');
    expect(copy.settings.confirmBody).toBe("This removes your situations, check-ins, answers and anything you shared. It can't be undone.");
    expect(copy.settings.lockNote).toBe('Short: "Axiom: tonight\'s check-in". Full: names your move. Nothing: just "Axiom".');
  });
  it('says the time like the mock', () => {
    expect(clockTime('20:00')).toBe('8:00 pm');
    expect(clockTime('00:30')).toBe('12:30 am');
  });
  it('summarises every kind of answer in one line', () => {
    expect(answerSummary(undefined)).toBe('');
    expect(answerSummary({ value: 'Other', other: 'a nurse' })).toBe('Other: a nurse');
    expect(answerSummary({ country: 'Pakistan', customers: 'Both' })).toBe('Pakistan, Both');
    expect(answerSummary({ goal: 'Ship it', when: 'This month' })).toBe('Ship it, This month');
    expect(answerSummary({ a: ['Selling'], b: ['Pricing'] })).toBe('Selling, Pricing');
    expect(answerSummary(['x', 'y'])).toBe('x, y');
    expect(answerSummary('text')).toBe('text');
  });
});
