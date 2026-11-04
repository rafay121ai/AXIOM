import type { Auth } from '../src/api/auth';
import { createFakeApi } from '../src/api/fake';
import { createHttpApi } from '../src/api/http';
import { routeScreened } from '../src/care/route';
import { copy } from '../src/copy';
import { destinationOf, menuRows } from '../src/home/flow';
import { newChat } from '../src/situation/chat';
import { createFakePhone } from '../src/push/fake';
import { createPush, type PushDriver } from '../src/push/push';

const auth: Auth = { signInWithGoogle: async () => {}, signOut: async () => {}, isSignedIn: async () => true, getToken: async () => 'tok' };
const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body }) as Response;

describe('home calls', () => {
  it('go to the right routes with the phone time zone, the check-in answer and the push token', async () => {
    const f = jest.fn().mockResolvedValue(json(200, { ok: true }));
    const api = createHttpApi({ baseUrl: 'http://x', auth, fetch: f });
    await api.getHome('Asia/Karachi');
    await api.sendCheckIn('A bit better today');
    await api.getMove('m1');
    await api.registerPushToken('ExponentPushToken[abcdefgh1]', 'ios', 'Asia/Karachi');
    await api.removePushToken('ExponentPushToken[abcdefgh1]');
    expect(f.mock.calls.map(([url, init]) => [init.method, url, init.body])).toEqual([
      ['GET', 'http://x/api/home?time_zone=Asia%2FKarachi', undefined],
      ['POST', 'http://x/api/home/checkin', JSON.stringify({ text: 'A bit better today' })],
      ['GET', 'http://x/api/moves/m1', undefined],
      ['POST', 'http://x/api/push/token', JSON.stringify({ token: 'ExponentPushToken[abcdefgh1]', platform: 'ios', timezone: 'Asia/Karachi' })],
      ['DELETE', 'http://x/api/push/token', JSON.stringify({ token: 'ExponentPushToken[abcdefgh1]' })],
    ]);
  });

  it('passes a care answer to the check-in through unchanged', async () => {
    const care = { care: 'clear', message: 'm', help: { line: 'f', url: 'https://findahelpline.com' } };
    const api = createHttpApi({ baseUrl: 'http://x', auth, fetch: jest.fn().mockResolvedValue(json(200, care)) });
    expect(routeScreened(await api.sendCheckIn('text')).kind).toBe('care');
  });
});

describe('the fake home', () => {
  it('shows only the move in the morning, with the server wording', async () => {
    const home = await createFakeApi('none', 0, false, 'morning').getHome('UTC');
    expect(home.items.map((i) => i.label)).toEqual(['Today: ask the clinics for a call']);
    expect(home.care_check_in).toBe(false);
  });

  it('never shows more than 2 items, and shows the check-in when the move is still open in the evening', async () => {
    const home = await createFakeApi('none', 0, false, 'evening').getHome('UTC');
    expect(home.items).toHaveLength(2);
    expect(home.items.map((i) => i.kind)).toEqual(['move', 'report']);
    expect(home.due_reports).toHaveLength(1);
  });

  it('has no items for nothing open, and still lists the menu', async () => {
    const home = await createFakeApi('none', 0, false, 'nothing').getHome('UTC');
    expect(home.items).toEqual([]);
    expect(home.drawer.recent.length).toBeGreaterThan(0);
  });

  it('puts Axiom\'s own question first; it stays, opens the situation with Axiom\'s line, and the reply continues it', async () => {
    const api = createFakeApi('none', 0, false, 'opener');
    const [item] = (await api.getHome('UTC')).items;
    expect(item).toMatchObject({ kind: 'situation', stays: true });
    expect(item.label).toMatch(/^Axiom asked: You said your first 10 customers by /);
    const d = await destinationOf(api, item.target);
    expect(d).toMatchObject({ kind: 'situation', situationId: 'fake-opener-1' });
    if (d.kind !== 'situation') throw new Error('not a situation');
    expect(d.turns.map((x) => x.role)).toEqual(['axiom']);
    const reply = await api.sendTurn('fake-opener-1', 'Three clinics said maybe, none have paid yet.', 'turn-1');
    expect(reply).toMatchObject({ situation_id: 'fake-opener-1' });
  });

  it('is only the gentle line while a care check-in is open, until it is answered', async () => {
    const api = createFakeApi('none', 0, false, 'care');
    const first = await api.getHome('UTC');
    expect(first).toMatchObject({ care_check_in: true, items: [], greeting: { text: 'How are you doing today?' } });
    await api.sendCheckIn('a bit better');
    expect((await api.getHome('UTC')).care_check_in).toBe(false);
  });

  it('keeps the check-in open when the answer is screened as care', async () => {
    const api = createFakeApi('clear', 0, false, 'care');
    expect(routeScreened(await api.sendCheckIn('text')).kind).toBe('care');
    expect((await api.getHome('UTC')).care_check_in).toBe(true);
  });

  it('is a returning founder only when asked to be', async () => {
    expect((await createFakeApi().getSignup()).complete).toBe(false);
    expect((await createFakeApi('none', 0, false, 'morning').getSignup()).complete).toBe(true);
  });
});

describe('the menu rows', () => {
  const drawer = {
    to_do: [{ kind: 'move' as const, label: 'Today: ask the clinics for a call', title: 't', stays: false, target: { stage: 'move' as const, situation_id: 's1', move_id: 'm1' } }],
    open: [
      { id: 's1', title: 'Clinics', stage: 'move' as const, last_activity_at: 'x' },
      { id: 's2', title: null, stage: 'read' as const, last_activity_at: 'x' },
    ],
    paused: [{ id: 's3', title: 'Hiring plan', stage: null, last_activity_at: 'x' }],
    recent: [{ id: 's1', title: 'Clinics', status: 'open' }, { id: 's3', title: 'Hiring plan', status: 'paused' }],
  };

  it('lists what is to do first, then other open situations once each', () => {
    const rows = menuRows(drawer);
    expect(rows.open.map((r) => r.label)).toEqual(['Today: ask the clinics for a call', copy.home.untitled]);
    expect(rows.open[1].target).toEqual({ stage: 'read', situation_id: 's2' });
  });

  it('sends history and paused rows to the situation page, not to a live screen', () => {
    const rows = menuRows(drawer);
    expect(rows.history.every((r) => r.situationId && !r.target && !r.dot)).toBe(true);
    expect(rows.paused).toEqual([{ key: 's3', label: 'Hiring plan', dot: false, situationId: 's3' }]);
  });
});

describe('where a tap leads', () => {
  it('opens a move by its id when the server gave one, and through its lesson when it did not', async () => {
    const api = createFakeApi('none', 0, false, 'morning');
    expect(await destinationOf(api, { stage: 'move', situation_id: 's1', move_id: 'm1' })).toEqual({ kind: 'move', source: { moveId: 'm1' } });
    expect(await destinationOf(api, { stage: 'move', situation_id: 's1' })).toEqual({ kind: 'move', source: { learnId: 'fake-learn-1' } });
  });

  it('opens the check-in that is waiting, by id or when it is the only one', async () => {
    const api = createFakeApi('none', 0, true);
    const [due] = await api.getDueReports();
    const byId = await destinationOf(api, { stage: 'report', situation_id: 's1', move_id: due.move_id });
    expect(byId).toMatchObject({ kind: 'report', report: { move_id: due.move_id }, next: [] });
    expect(await destinationOf(api, { stage: 'report', situation_id: 's1' })).toMatchObject({ kind: 'report' });
  });

  it('goes home when no check-in matches', async () => {
    const api = createFakeApi('none', 0, false, 'morning');
    expect(await destinationOf(api, { stage: 'report', situation_id: 's1', move_id: 'gone' })).toEqual({ kind: 'home' });
  });

  it('picks up a situation, a Read or a lesson by the situation', async () => {
    const api = createFakeApi();
    expect(await destinationOf(api, { stage: 'read', situation_id: 's9' })).toEqual({ kind: 'read', situationId: 's9' });
  });

  it('starts a chat with what was typed at home, or picks one up by its situation', () => {
    expect(newChat({ pending: 'my hiring is going badly' })).toMatchObject({ situationId: null, pending: 'my hiring is going badly', items: [] });
    expect(newChat({ situationId: 's1' })).toMatchObject({ situationId: 's1', pending: null });
  });
});

describe('the reminder', () => {
  function phone(permission: 'granted' | 'denied' | 'undetermined', answer: 'granted' | 'denied' = 'granted', platform: PushDriver['platform'] = 'ios') {
    const calls: string[] = [];
    const driver: PushDriver = {
      platform,
      async permission() { calls.push('permission'); return permission; },
      async ask() { calls.push('ask'); return answer; },
      async token() { calls.push('token'); return 'ExponentPushToken[abcdefgh1]'; },
    };
    const server = {
      async registerPushToken(token: string, p: string, zone: string) { calls.push(`register ${token} ${p} ${zone}`); },
      async removePushToken(token: string) { calls.push(`remove ${token}`); },
    };
    return { calls, push: createPush(driver, server, () => 'Asia/Karachi') };
  }

  it('asks the founder only when the phone has not been asked, and never touches the phone to find out', async () => {
    const { push, calls } = phone('undetermined');
    expect(await push.state()).toBe('ask');
    expect(calls).toEqual(['permission']);
  });

  it('says on when allowed and off when refused or when the device cannot get one', async () => {
    expect(await phone('granted').push.state()).toBe('on');
    expect(await phone('denied').push.state()).toBe('off');
    expect(await phone('undetermined', 'granted', null).push.state()).toBe('off');
  });

  it('registers this phone only after the phone allows it', async () => {
    const yes = phone('undetermined', 'granted');
    expect(await yes.push.enable()).toBe('on');
    expect(yes.calls).toEqual(['ask', 'token', 'register ExponentPushToken[abcdefgh1] ios Asia/Karachi']);
    const no = phone('undetermined', 'denied');
    expect(await no.push.enable()).toBe('refused');
    expect(no.calls).toEqual(['ask']);
  });

  it('does not ask or register on a browser', async () => {
    const web = phone('undetermined', 'granted', null);
    expect(await web.push.enable()).toBe('refused');
    expect(web.calls).toEqual([]);
  });

  it('refreshes and releases only when reminders are allowed', async () => {
    const off = phone('denied');
    await off.push.refresh();
    await off.push.release();
    expect(off.calls).toEqual(['permission', 'permission']);
    const on = phone('granted');
    await on.push.refresh();
    await on.push.release();
    expect(on.calls.filter((c) => c.startsWith('register') || c.startsWith('remove'))).toEqual([
      'register ExponentPushToken[abcdefgh1] ios Asia/Karachi', 'remove ExponentPushToken[abcdefgh1]',
    ]);
  });
});

describe('the reminder words', () => {
  it('are the mock\'s, word for word', () => {
    expect(copy.move.remindAsk).toBe('Want a reminder tonight?');
    expect([copy.move.remindYes, copy.move.remindNo, copy.move.remindNone]).toEqual(['Yes', 'No thanks', 'No problem.']);
    expect(copy.move.remind('8 pm')).toBe('I will remind you at 8 pm.');
    expect(copy.move.remindersOff).toBe("Reminders are off on your phone. I'll keep tonight's check-in waiting on your home screen.");
  });
});

describe('the pretend phone', () => {
  it('is not asked until told to ask, and then says what it was set to say', async () => {
    const phone = createFakePhone('denied');
    expect(await phone.permission()).toBe('undetermined');
    expect(phone.asked).toBe(0);
    expect(await phone.ask()).toBe('denied');
    expect(await phone.permission()).toBe('denied');
  });
});
