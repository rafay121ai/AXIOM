import { readFileSync } from 'fs';
import { join } from 'path';
import type { Auth } from '../src/api/auth';
import { createFakeApi } from '../src/api/fake';
import { createHttpApi } from '../src/api/http';
import { memoryStore } from '../src/api/outbox';
import { HttpError } from '../src/api/queue';
import { backTarget } from '../src/backTarget';
import { copy } from '../src/copy';
import { anyConnected, clearShown, connectGate, connectLine, connectTool } from '../src/connect/flow';

const auth: Auth = { signInWithGoogle: async () => {}, signOut: async () => {}, isSignedIn: async () => true, getName: async () => undefined, getToken: async () => 'tok' };
const res = (status: number, body: unknown = {}) => ({ ok: status < 400, status, json: async () => body }) as Response;
const calls = (f: jest.Mock) => f.mock.calls.map(([url, init]) => [init.method, url, init.body]);

describe('connector routes', () => {
  it('go to the right routes', async () => {
    const f = jest.fn().mockResolvedValue(res(200, { url: 'u', forgotten: true, learn_how_i_work: true }));
    const api = createHttpApi({ baseUrl: 'http://x', auth, fetch: f });
    await api.getConnectors();
    await api.connectConnector('gmail');
    await api.disconnectConnector('notion');
    await api.forgetConnector('googlecalendar');
    await api.setLearnHowIWork(true);
    expect(calls(f)).toEqual([
      ['GET', 'http://x/api/connectors', undefined],
      ['POST', 'http://x/api/connectors/gmail/connect', undefined],
      ['DELETE', 'http://x/api/connectors/notion', undefined],
      ['POST', 'http://x/api/connectors/googlecalendar/forget', undefined],
      ['PUT', 'http://x/api/connectors/learn', JSON.stringify({ on: true })],
    ]);
  });

  it('a 404 means switched off: null, nothing shown', async () => {
    const api = createHttpApi({ baseUrl: 'http://x', auth, fetch: jest.fn().mockResolvedValue(res(404)) });
    expect(await api.getConnectors()).toBeNull();
  });

  it('any other failure still throws', async () => {
    const api = createHttpApi({ baseUrl: 'http://x', auth, fetch: jest.fn().mockResolvedValue(res(500)) });
    await expect(api.getConnectors()).rejects.toBeInstanceOf(HttpError);
  });
});

describe('the connect screen is shown once', () => {
  it('skips when connectors are off, and does not mark it shown', async () => {
    const store = memoryStore();
    expect(await connectGate({ getConnectors: async () => null }, store)).toBeNull();
    expect(await store.getItem('connect_shown')).toBeNull();
  });

  it('shows the first time, never again, and again for the next founder after sign-out', async () => {
    const store = memoryStore();
    const api = createFakeApi();
    expect(await connectGate(api, store)).not.toBeNull();
    expect(await connectGate(api, store)).toBeNull();
    await clearShown(store);
    expect(await connectGate(api, store)).not.toBeNull();
  });

  it('skips when the server cannot be reached', async () => {
    const api = { getConnectors: async () => { throw new HttpError(); } };
    expect(await connectGate(api, memoryStore())).toBeNull();
  });
});

describe('connecting', () => {
  it('opens the link then reads the rows again; Continue only once one is active', async () => {
    const api = createFakeApi();
    const first = (await api.getConnectors())!;
    expect(anyConnected(first)).toBe(false);
    const open = jest.fn().mockResolvedValue(undefined);
    const after = await connectTool(api, 'gmail', open);
    expect(open).toHaveBeenCalledWith('https://example.com/connect/gmail');
    expect(anyConnected(after)).toBe(true);
    expect(after!.connectors.find((c) => c.toolkit === 'gmail')!.status).toBe('active');
  });

  it('a row that is not active on return stays a Connect row', async () => {
    const api = { ...createFakeApi(), connectConnector: async () => ({ url: 'u' }) };
    expect(anyConnected(await connectTool(api, 'notion', async () => {}))).toBe(false);
  });

  it('the switch is off by default and PUT turns it on', async () => {
    const api = createFakeApi();
    expect((await api.getConnectors())!.learn_how_i_work).toBe(false);
    await api.setLearnHowIWork(true);
    expect((await api.getConnectors())!.learn_how_i_work).toBe(true);
  });

  it('disconnect turns the row back to not connected', async () => {
    const api = createFakeApi();
    await api.connectConnector('gmail');
    await api.disconnectConnector('gmail');
    expect(anyConnected(await api.getConnectors())).toBe(false);
  });
});

describe('words and errors', () => {
  it('shows the server line when it sent one, else the plain line', () => {
    expect(connectLine(new HttpError(409, 'pending_delete', 'Not while your account is waiting to be deleted.'))).toBe('Not while your account is waiting to be deleted.');
    expect(connectLine(new HttpError(500))).toBe(copy.settings.notSaved);
    expect(connectLine(new Error('boom'))).toBe(copy.settings.notSaved);
  });

  it('fills the tool name in the lines', () => {
    expect(copy.connect.forget.replace('{tool}', 'Gmail')).toBe('Delete what Axiom learned from Gmail');
    expect(copy.connect.needsYou.replace('{tool}', 'Gmail')).toBe('Gmail needs you to sign in again.');
  });

  it('How this works goes back to Settings', () => {
    const s = { name: 'settings' }, h = { name: 'home' }, hi = { name: 'history' };
    expect(backTarget({ name: 'how' }, h, s, hi)).toBe(s);
  });
});

it('the screens use the buttons the mock names', () => {
  const src = (f: string) => readFileSync(join(__dirname, '../src', f), 'utf8');
  expect(src('screens/ConnectScreen.tsx')).toMatch(/anyConnected\(rows\) \? <GoldButton[^]*TextAction label=\{copy\.connect\.notNow\}/);
  const rows = src('components/ConnectionRows.tsx');
  expect(rows).toMatch(/disconnectConnector/);
  expect(rows).toMatch(/forgetConnector/);
  expect(rows).toMatch(/needsYou/);
});
