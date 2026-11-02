import { splitAt } from '../src/components/Words';
import type { Auth } from '../src/api/auth';
import { sendUntilDelivered } from '../src/api/delivery';
import { createFakeApi } from '../src/api/fake';
import { createHttpApi } from '../src/api/http';
import { HttpError } from '../src/api/queue';
import type { LearnReply } from '../src/api/types';
import { applyLearnReply, lessonParagraphs, newLearnChat, sourceLines, suggestionTurn, tappedIndexes, verifiedQuotes } from '../src/learn/chat';
import { scaled, shares, withUnit } from '../src/learn/picture';

const auth: Auth = { signInWithGoogle: async () => {}, signOut: async () => {}, isSignedIn: async () => true, getToken: async () => 'tok' };
const json = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body }) as Response;

describe('learn calls', () => {
  it('go to the right routes, and send the turn id with a founder reply', async () => {
    const f = jest.fn().mockResolvedValue(json(200, { hint: null }));
    const api = createHttpApi({ baseUrl: 'http://x', auth, fetch: f });
    await api.startLearn('s1');
    await api.sendLearnTurn('l1', 'they want 30% off', 't1');
    await api.tapFollowUp('l1', 'turn-9', 1);
    await api.getLoadingHint('seed 1');
    const calls = f.mock.calls.map(([url, init]) => [init.method, url, init.body]);
    expect(calls).toEqual([
      ['POST', 'http://x/api/situations/s1/learn', undefined],
      ['POST', 'http://x/api/learn/l1/turn', JSON.stringify({ text: 'they want 30% off', client_turn_id: 't1' })],
      ['POST', 'http://x/api/learn/l1/followup/1', JSON.stringify({ turn_id: 'turn-9' })],
      ['GET', 'http://x/api/loading-hint?seed=seed%201', undefined],
    ]);
  });

  it('give no quote when the hint cannot be had', async () => {
    const api = createHttpApi({ baseUrl: 'http://x', auth, fetch: jest.fn().mockResolvedValue(json(500, {})) });
    expect(await api.getLoadingHint('s')).toBeNull();
  });

  it('retry a founder reply with the same turn id after a lost connection', async () => {
    const f = jest.fn()
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValue(json(200, { status: 'say_more', reply: 'Say a bit more.', turn: null }));
    const api = createHttpApi({ baseUrl: 'http://x', auth, fetch: f });
    const res = await sendUntilDelivered(() => api.sendLearnTurn('l1', 'ok', 'same'), { retryDelay: () => 0 });
    expect(res).toMatchObject({ status: 'say_more' });
    const bodies = f.mock.calls.map(([, init]) => init.body);
    expect(bodies).toEqual([bodies[0], bodies[0]]);
    expect(bodies[0]).toContain('"client_turn_id":"same"');
  });

  it('throw a plain error for a server failure so the screen can say so', async () => {
    const api = createHttpApi({ baseUrl: 'http://x', auth, fetch: jest.fn().mockResolvedValue(json(409, { error: 'busy' })) });
    await expect(api.startLearn('s1')).rejects.toBeInstanceOf(HttpError);
  });
});

describe('the fake learn api', () => {
  it('names author and book, offers follow-ups and gives a picture', async () => {
    const api = createFakeApi();
    const { turn } = await api.startLearn('s1');
    expect(turn?.sources.length).toBeGreaterThan(0);
    expect(turn?.sources[0]).toEqual({ author: expect.any(String), book: expect.any(String) });
    expect(turn?.follow_ups.length).toBeGreaterThan(0);
    expect(turn?.picture?.type).toBe('split_bar');
  });

  it('answers a thin reply with say_more and no turn', async () => {
    const res = await createFakeApi().sendLearnTurn('l', 'ok', 't');
    expect(res).toMatchObject({ status: 'say_more', turn: null, move_offer: 'none', move_notice: null });
  });

  it('offers the move on the second real reply, and the same turn id gives the same answer', async () => {
    const api = createFakeApi();
    const a = await api.sendLearnTurn('l', 'they want thirty percent off at renewal', 't1');
    const b = await api.sendLearnTurn('l', 'I would rather keep them at today price', 't2');
    const again = await api.sendLearnTurn('l', 'I would rather keep them at today price', 't2');
    expect(a).toMatchObject({ move_offer: 'none', move_notice: null });
    expect(b).toMatchObject({ move_offer: 'first', move_notice: { kind: 'first' } });
    expect(again).toEqual(b);
  });

  it('screens a founder reply before anything else', async () => {
    expect(await createFakeApi('clear').sendLearnTurn('l', 'text', 't')).toMatchObject({ care: 'clear' });
  });
});

describe('the learn chat', () => {
  it('shows a tapped follow-up as an Axiom answer, never as a founder message', async () => {
    const api = createFakeApi();
    const chat = newLearnChat();
    chat.items = applyLearnReply(chat, await api.startLearn('s1'));
    const lesson = suggestionTurn(chat.items);
    expect(lesson).not.toBeNull();
    chat.items = applyLearnReply(chat, await api.tapFollowUp(chat.learnId ?? '', lesson?.id ?? '', 0));
    expect(chat.items.some((i) => i.who === 'me')).toBe(false);
    expect(tappedIndexes(chat.items, lesson?.id ?? '')).toEqual([0]);
    expect(suggestionTurn(chat.items)?.id).toBe(lesson?.id);
  });

  it('adds one plain line for a thin reply, and the move card after the reply that offers it', () => {
    const chat = newLearnChat();
    const thin: LearnReply = { learn_id: 'l', situation_id: 's', status: 'say_more', reply: 'Say a bit more.', turn: null, move_offer: 'none', move_notice: null };
    expect(applyLearnReply(chat, thin).map((i) => i.who)).toEqual(['say']);
    const offer: LearnReply = {
      learn_id: 'l', situation_id: 's', status: 'reply', move_offer: 'first',
      turn: { id: 'a', kind: 'reply', text: 'x', sources: [], picture: null, follow_ups: [] },
      move_notice: { kind: 'first', kicker: 'Your move', text: 'Your move is ready.' },
    };
    expect(applyLearnReply(chat, offer).map((i) => i.who)).toEqual(['ax', 'card']);
    expect(chat.learnId).toBe('l');
  });

  it('lists each author and book once, and splits a lesson into paragraphs', () => {
    expect(sourceLines([{ author: 'A', book: 'B' }, { author: 'A', book: 'B' }, { author: 'C', book: 'D' }])).toEqual(['A · B', 'C · D']);
    expect(lessonParagraphs('one\n\ntwo\n')).toEqual(['one', 'two']);
  });
});

describe('picture numbers', () => {
  it('turn parts into shares of the whole', () => {
    expect(shares([12, 88])).toEqual([12, 88]);
    expect(shares([0, 0])).toEqual([0, 0]);
  });
  it('scale bars against the largest value', () => {
    expect(scaled([50, 100, 25])).toEqual([50, 100, 25]);
    expect(scaled([0])).toEqual([0]);
  });
  it('write a value with its unit', () => {
    expect(withUnit(12, '%')).toBe('12%');
    expect(withUnit(40, '$')).toBe('$40');
    expect(withUnit(3, 'hours')).toBe('3 hours');
    expect(withUnit(7)).toBe('7');
  });
});

describe('words filling in', () => {
  it('split a text after n words and keep every character', () => {
    const text = 'Say it  slowly. Then stop.';
    expect(splitAt(text, 0)).toEqual(['', text]);
    expect(splitAt(text, 2)).toEqual(['Say it  ', 'slowly. Then stop.']);
    expect(splitAt(text, 9)).toEqual([text, '']);
  });
});

describe('founder case and closed notice', () => {
  const base = { learn_id: 'l', situation_id: 's', status: 'reply' as const, turn: null, move_offer: 'none' as const, move_notice: null };
  it('adds a case and a notice only when the reply carries them', () => {
    const chat = newLearnChat();
    expect(applyLearnReply(chat, base)).toEqual([]);
    expect(applyLearnReply(chat, { ...base, founder_case: null })).toEqual([]);
    const items = applyLearnReply(chat, { ...base, founder_case: { story: 'a', outcome: 'done' }, founder_lessons: { state: 'closed_notice', notice: { text: 'n', wording_version: 'v' } } });
    expect(items.map((i) => i.who)).toEqual(['case', 'say']);
  });
});

describe('verified quotes', () => {
  it('shows only quotes the server verified, once each, with their author', () => {
    expect(verifiedQuotes([{ author: 'A', book: 'B', quote: 'q1' }, { author: 'A', book: 'B', quote: 'q1' }, { author: 'C', book: 'D' }])).toEqual([{ quote: 'q1', author: 'A' }]);
  });
});
