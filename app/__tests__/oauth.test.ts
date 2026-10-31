import { readFileSync } from 'fs';
import { join } from 'path';
import { parseRedirect, signInOnPhone, SignInCancelled } from '../src/auth/oauth';

const CB = 'axiom://auth/callback';

describe('parseRedirect', () => {
  it('reads a PKCE code from the query', () => expect(parseRedirect(`${CB}?code=abc`)).toEqual({ code: 'abc' }));
  it('reads tokens from the fragment', () =>
    expect(parseRedirect(`${CB}#access_token=a&refresh_token=r&expires_in=3600`)).toEqual({ accessToken: 'a', refreshToken: 'r' }));
  it('prefers the code when both are present', () => expect(parseRedirect(`${CB}?code=c#access_token=a&refresh_token=r`)).toEqual({ code: 'c' }));
  it('reports an error from either place', () => {
    expect(parseRedirect(`${CB}?error=access_denied&error_description=No+way`)).toEqual({ error: 'No way' });
    expect(parseRedirect(`${CB}#error=access_denied`)).toEqual({ error: 'access_denied' });
  });
  it('returns null when there is nothing to use', () => {
    expect(parseRedirect(CB)).toBeNull();
    expect(parseRedirect(`${CB}#access_token=a`)).toBeNull();
  });
});

describe('signInOnPhone', () => {
  const ok = { data: {}, error: null };
  const make = () => ({
    signInWithOAuth: jest.fn().mockResolvedValue({ data: { url: 'https://g/auth' }, error: null }),
    exchangeCodeForSession: jest.fn().mockResolvedValue(ok),
    setSession: jest.fn().mockResolvedValue(ok),
  });
  const run = (auth: ReturnType<typeof make>, result: { type: string; url?: string }) =>
    signInOnPhone(auth as never, { redirectTo: CB, openAuthSession: jest.fn().mockResolvedValue(result) });

  it('asks Supabase for the page without redirecting, then exchanges the code', async () => {
    const auth = make();
    await run(auth, { type: 'success', url: `${CB}?code=abc` });
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({ provider: 'google', options: { redirectTo: CB, skipBrowserRedirect: true } });
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith('abc');
  });
  it('sets the session from fragment tokens', async () => {
    const auth = make();
    await run(auth, { type: 'success', url: `${CB}#access_token=a&refresh_token=r` });
    expect(auth.setSession).toHaveBeenCalledWith({ access_token: 'a', refresh_token: 'r' });
  });
  it('a closed browser is a cancel, not a failure', async () => {
    const auth = make();
    await expect(run(auth, { type: 'cancel' })).rejects.toBeInstanceOf(SignInCancelled);
    await expect(run(auth, { type: 'dismiss' })).rejects.toBeInstanceOf(SignInCancelled);
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });
  it('fails on a provider error, a bare redirect or a failed exchange', async () => {
    await expect(run(make(), { type: 'success', url: `${CB}?error=denied` })).rejects.toThrow('denied');
    await expect(run(make(), { type: 'success', url: CB })).rejects.toThrow();
    const auth = make();
    auth.exchangeCodeForSession.mockResolvedValue({ data: {}, error: new Error('bad code') });
    await expect(run(auth, { type: 'success', url: `${CB}?code=x` })).rejects.toThrow('bad code');
  });
});

it('the auth code touches Supabase only through client.auth', () => {
  for (const f of ['../src/auth/oauth.ts', '../src/api/auth.ts']) {
    const text = readFileSync(join(__dirname, f), 'utf8');
    expect(text).not.toMatch(/\bclient\.(?!auth\b)/);
    expect(text).not.toMatch(/\.from\(|\.rpc\(|\.storage\./);
  }
});
