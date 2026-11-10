import type { Auth } from '../src/api/auth';
import { createFakeApi } from '../src/api/fake';
import { createHttpApi } from '../src/api/http';
import { HttpError } from '../src/api/queue';
import type { MemoryItem } from '../src/api/types';
import { focusAfter, receiptDate, removeLine, sectionsOf, shownOrder, summaryText } from '../src/memory/flow';

const auth: Auth = { signInWithGoogle: async () => {}, signOut: async () => {}, isSignedIn: async () => true, getName: async () => undefined, getToken: async () => 'tok' };
const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;

const item = (id: string, group: MemoryItem['group'], at: string | null): MemoryItem => ({
  id, group, table: 'founder_beliefs', text: `line ${id}`, receipt: at ? { text: `receipt ${id}`, at } : null,
});
const ITEMS = [
  item('o1', 'open', '2026-11-06T09:00:00Z'),
  item('d1', 'decide', '2026-10-27T09:00:00Z'),
  item('d2', 'decide', '2026-11-03T09:00:00Z'),
  item('d3', 'decide', null),
  item('b1', 'business', '2026-10-24T09:00:00Z'),
];

describe('sections', () => {
  it('come in the written order, newest receipt first, no receipt last, empty sections left out', () => {
    const s = sectionsOf(ITEMS);
    expect(s.map((x) => x.group)).toEqual(['decide', 'business', 'open']);
    expect(s[0].label).toBe('How you decide');
    expect(s[0].items.map((i) => i.id)).toEqual(['d2', 'd1', 'd3']);
    expect(shownOrder(ITEMS).map((i) => i.id)).toEqual(['d2', 'd1', 'd3', 'b1', 'o1']);
    expect(sectionsOf([])).toEqual([]);
  });
});

describe('summary', () => {
  it('says thing for one and things for many', () => {
    expect(summaryText(1)).toBe('Axiom has learned 1 thing about you and your work.');
    expect(summaryText(10)).toBe('Axiom has learned 10 things about you and your work.');
  });
});

describe('receipt date', () => {
  const now = new Date('2026-11-10T12:00:00Z');
  it('is day and short month this year, with the year otherwise', () => {
    expect(receiptDate('2026-11-03T09:00:00Z', now)).toBe('3 Nov');
    expect(receiptDate('2025-10-24T09:00:00Z', now)).toBe('24 Oct 2025');
  });
});

describe('removing a line', () => {
  const send = jest.fn().mockResolvedValue(undefined);
  beforeEach(() => send.mockClear());

  it('sends the reason, then the line is gone and the others keep their order', async () => {
    const r = await removeLine(ITEMS, 'd1', 'outdated', send);
    expect(send).toHaveBeenCalledWith(ITEMS[1], 'outdated');
    expect(shownOrder(r.items).map((i) => i.id)).toEqual(['d2', 'd3', 'b1', 'o1']);
  });

  it('closes a section when its last line goes, and ends in the empty state', async () => {
    let items = (await removeLine(ITEMS, 'o1', 'wrong', send)).items;
    expect(sectionsOf(items).map((s) => s.group)).toEqual(['decide', 'business']);
    for (const id of ['d1', 'd2', 'd3', 'b1']) items = (await removeLine(items, id, 'wrong', send)).items;
    expect(items).toEqual([]);
    expect(sectionsOf(items)).toEqual([]);
  });

  it('keeps the line, and reports the failure, when the send fails', async () => {
    const boom = new HttpError(500);
    const r = await removeLine(ITEMS, 'd1', 'wrong', jest.fn().mockRejectedValue(boom));
    expect(r.items).toBe(ITEMS);
    expect(r.failure).toBe(boom);
  });

  it('moves focus to the next line, else the previous, else nowhere', () => {
    expect(focusAfter(ITEMS, 'd1')).toBe('d3');
    expect(focusAfter(ITEMS, 'o1')).toBe('b1');
    expect(focusAfter([ITEMS[0]], 'o1')).toBeNull();
  });
});

describe('http memory calls', () => {
  it('reads the lines from GET /api/memory', async () => {
    const f = jest.fn().mockResolvedValue(json({ items: ITEMS }));
    await expect(createHttpApi({ baseUrl: 'http://x', auth, fetch: f }).getMemory()).resolves.toEqual(ITEMS);
    expect(f).toHaveBeenCalledWith('http://x/api/memory', expect.objectContaining({ method: 'GET' }));
  });

  it('removes a line with POST and the reason', async () => {
    const f = jest.fn().mockResolvedValue(json({ ok: true }));
    await createHttpApi({ baseUrl: 'http://x', auth, fetch: f }).markWrong('founder_traits', 'abc', 'outdated');
    expect(f.mock.calls[0][0]).toBe('http://x/api/memory/founder_traits/abc/wrong');
    expect(f.mock.calls[0][1]).toMatchObject({ method: 'POST', body: JSON.stringify({ reason: 'outdated' }) });
  });

  it.each([500, 429])('throws on %i and queues nothing, so a failed removal never completes later', async (status) => {
    const f = jest.fn().mockResolvedValue({ ok: false, status, json: async () => ({}) } as Response);
    const api = createHttpApi({ baseUrl: 'http://x', auth, fetch: f });
    await expect(api.markWrong('founder_traits', 'abc', 'wrong')).rejects.toBeInstanceOf(HttpError);
    await api.resumeUnsent();
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('the fake memory', () => {
  it('forgets a removed line', async () => {
    const api = createFakeApi();
    const before = await api.getMemory();
    await api.markWrong(before[0].table, before[0].id, 'wrong');
    expect((await api.getMemory()).map((i) => i.id)).toEqual(before.slice(1).map((i) => i.id));
  });
});
