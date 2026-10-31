import type { Auth } from '../src/api/auth';
import { newTurnId, sendUntilDelivered } from '../src/api/delivery';
import { createFakeApi } from '../src/api/fake';
import { createHttpApi } from '../src/api/http';
import { HttpError } from '../src/api/queue';
import type { SituationReply } from '../src/api/types';
import { routeScreened } from '../src/care/route';
import { copy, failureLine } from '../src/copy';
import { applyReply, newChat } from '../src/situation/chat';
import { paragraphs } from '../src/situation/read';

const auth: Auth = { signInWithGoogle: async () => {}, signOut: async () => {}, isSignedIn: async () => true, getToken: async () => 'tok' };
const reply = (r: Partial<SituationReply>): SituationReply => ({
  situation_id: 's1', status: 'follow_up', reply: 'A question?', follow_up_count: 1, follow_ups_left: 1, ...r,
});
const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body }) as Response;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('turn ids', () => {
  it('are uuids and differ for every send', () => {
    const [a, b] = [newTurnId(), newTurnId()];
    expect(a).toMatch(UUID);
    expect(a).not.toBe(b);
  });
});

describe('situation calls', () => {
  it('post the text with the turn id, and to the right routes', async () => {
    const f = jest.fn().mockResolvedValue(json(200, reply({})));
    const api = createHttpApi({ baseUrl: 'http://x', auth, fetch: f });
    await api.startSituation('my hiring is going badly', 't1');
    await api.sendTurn('s1', 'two people left', 't2');
    await api.getRead('s1');
    await api.answerRead('s1', { text: 'no' });
    await api.answerRead('s1', { skip: true });
    const calls = f.mock.calls.map(([url, init]) => [init.method, url, init.body]);
    expect(calls).toEqual([
      ['POST', 'http://x/api/situations', JSON.stringify({ text: 'my hiring is going badly', client_turn_id: 't1' })],
      ['POST', 'http://x/api/situations/s1/turn', JSON.stringify({ text: 'two people left', client_turn_id: 't2' })],
      ['POST', 'http://x/api/situations/s1/read', undefined],
      ['POST', 'http://x/api/situations/s1/read/answer', JSON.stringify({ text: 'no' })],
      ['POST', 'http://x/api/situations/s1/read/answer', JSON.stringify({ skip: true })],
    ]);
  });

  it('keep the server error name, so the daily limit can be told from a rate limit', async () => {
    const f = jest.fn().mockResolvedValue(json(429, { error: 'daily_limit', message: 'raw server text' }));
    const api = createHttpApi({ baseUrl: 'http://x', auth, fetch: f });
    const err = await api.startSituation('a long enough text', 't1').catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err).toMatchObject({ status: 429, code: 'daily_limit' });
  });
});

describe('sending until delivered', () => {
  it('retries a send that had no connection with the same request', async () => {
    const f = jest.fn()
      .mockRejectedValueOnce(new TypeError('network'))
      .mockRejectedValueOnce(new TypeError('network'))
      .mockResolvedValue(json(200, reply({ status: 'ready', reply: null })));
    const api = createHttpApi({ baseUrl: 'http://x', auth, fetch: f });
    const turnId = newTurnId();
    const waiting: boolean[] = [];
    const res = await sendUntilDelivered(() => api.startSituation('my hiring is going badly', turnId), { onWaiting: (w) => waiting.push(w), retryDelay: () => 0 });
    expect(res).toMatchObject({ status: 'ready' });
    expect(f).toHaveBeenCalledTimes(3);
    const sent = f.mock.calls.map(([, init]) => JSON.parse(init.body).client_turn_id);
    expect(sent).toEqual([turnId, turnId, turnId]);
    expect(waiting).toEqual([true, true, false]);
  });

  it('does not retry a refusal; the screen explains it', async () => {
    const attempt = jest.fn().mockRejectedValue(new HttpError(409, 'busy'));
    await expect(sendUntilDelivered(attempt, { retryDelay: () => 0 })).rejects.toBeInstanceOf(HttpError);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('stops trying once the screen is gone', async () => {
    const attempt = jest.fn().mockRejectedValue(new HttpError());
    await expect(sendUntilDelivered(attempt, { cancelled: () => true, retryDelay: () => 0 })).rejects.toBeInstanceOf(HttpError);
    expect(attempt).toHaveBeenCalledTimes(1);
  });
});

describe('plain words for failures', () => {
  it('never shows the server text', () => {
    for (const e of [new HttpError(409, 'The Read has started'), new HttpError(500), new HttpError(429, 'Too many requests'), new HttpError(404)]) {
      expect(failureLine(e)).toEqual({ text: copy.couldNotAnswer, canRetry: true });
    }
  });
  it('says the daily limit in the app copy, with no retry', () => {
    expect(failureLine(new HttpError(429, 'daily_limit'))).toEqual({ text: copy.dailyLimit, canRetry: false });
  });
  it('has its own line for a Read that would not load', () => {
    expect(failureLine(new HttpError(500), 'read').text).toBe(copy.couldNotRead);
  });
});

describe('the conversation', () => {
  const me = { id: 1, who: 'me', text: 'x', turnId: 't', state: 'sent' } as const;
  it('adds the follow-up question after the founder text', () => {
    const chat = { ...newChat(), items: [me], nextId: 2 };
    const items = applyReply(chat, reply({ reply: 'And then?' }), me);
    expect(items.map((i) => i.who)).toEqual(['me', 'ax']);
    expect(chat.situationId).toBe('s1');
  });
  it('adds nothing when Axiom is ready: it moves on without a closing line', () => {
    const chat = { ...newChat(), items: [me], nextId: 2 };
    expect(applyReply(chat, reply({ status: 'ready', reply: null }), me)).toEqual([me]);
  });
  it('starts a fresh conversation for a new topic', () => {
    const old = { id: 0, who: 'ax', text: 'old question' } as const;
    const chat = { ...newChat({ situationId: 's1' }), items: [old, me], nextId: 3 };
    const items = applyReply(chat, reply({ situation_id: 's2', started_new: true }), me);
    expect(items.map((i) => i.who)).toEqual(['me', 'ax']);
    expect(chat.situationId).toBe('s2');
  });
});

describe('fixtures follow the same rules as the server', () => {
  it('answers "ok" with "Say a bit more." and starts nothing', async () => {
    const res = await createFakeApi().startSituation('ok', newTurnId());
    expect(res).toMatchObject({ status: 'say_more', reply: 'Say a bit more.', situation_id: null });
  });
  it('asks at most 2 follow-ups, then is ready', async () => {
    const api = createFakeApi();
    const first = await api.startSituation('my hiring is going badly', newTurnId());
    if (first.care || !first.situation_id) throw new Error('expected a situation');
    expect(first).toMatchObject({ status: 'follow_up', follow_up_count: 1, follow_ups_left: 1 });
    const second = await api.sendTurn(first.situation_id, 'it has been slow lately', newTurnId());
    expect(second).toMatchObject({ status: 'follow_up', follow_up_count: 2, follow_ups_left: 0 });
    const third = await api.sendTurn(first.situation_id, 'we are not sure about anyone', newTurnId());
    expect(third).toMatchObject({ status: 'ready', reply: null, follow_ups_left: 0 });
  });
  it('gives the same answer when a turn id is sent twice', async () => {
    const api = createFakeApi();
    const id = newTurnId();
    expect(await api.startSituation('my hiring is going badly', id)).toEqual(await api.startSituation('my hiring is going badly', id));
  });
  it('sends clear distress on every text route to care', async () => {
    const api = createFakeApi('clear');
    expect(routeScreened(await api.startSituation('x y z', 't1')).kind).toBe('care');
    expect(routeScreened(await api.sendTurn('s1', 'x y z', 't2')).kind).toBe('care');
    expect(routeScreened(await api.answerRead('s1', { text: 'x y z' })).kind).toBe('care');
  });
  it('lets a skip through and counts "ok" as no answer', async () => {
    const api = createFakeApi();
    expect(await api.answerRead('s1', { skip: true })).toMatchObject({ status: 'stored', skipped: true });
    expect(await api.answerRead('s1', { text: 'ok' })).toMatchObject({ status: 'say_more' });
    expect(await api.answerRead('s1', { text: 'No, I have not gone back since the demo' })).toMatchObject({ status: 'stored', skipped: false });
  });
});

describe('the Read', () => {
  it('is split into paragraphs', () => {
    expect(paragraphs('One.\n\nTwo.\nThree.\n')).toEqual(['One.', 'Two.', 'Three.']);
  });
  it('comes from the fixtures as two short paragraphs and a question, with no underlines', async () => {
    const read = await createFakeApi().getRead('s1');
    expect(paragraphs(read.body)).toHaveLength(2);
    expect(read.closing_question.endsWith('?')).toBe(true);
    expect(read).not.toHaveProperty('underlines');
  });
});
