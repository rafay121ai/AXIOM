import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';

// Phone Google sign-in. It is handed the Supabase client's `auth` object (src/api/auth.ts is the only file that imports Supabase).
type Done = { error: Error | null };
type SupabaseAuth = {
  signInWithOAuth(o: { provider: 'google'; options: { redirectTo: string; skipBrowserRedirect: boolean } }): Promise<Done & { data: { url?: string | null } }>;
  exchangeCodeForSession(code: string): Promise<Done>;
  setSession(s: { access_token: string; refresh_token: string }): Promise<Done>;
};

export type BrowserResult = { type: string; url?: string };

export type Deps = {
  /** Opens the sign-in page and resolves with the app link it ends on. WebBrowser.openAuthSessionAsync in the app. */
  openAuthSession: (url: string, redirectTo: string) => Promise<BrowserResult>;
  redirectTo: string;
};

/** The founder closed the browser. Not an error: they stay on the sign-in screen. */
export class SignInCancelled extends Error {}

export type Redirect = { code: string } | { accessToken: string; refreshToken: string } | { error: string } | null;

/** Reads where the browser ended. A code (PKCE) comes in the query; tokens (implicit) come in the fragment. */
export function parseRedirect(url: string): Redirect {
  const [beforeHash, fragment = ''] = url.split('#');
  const params = new URLSearchParams(beforeHash.split('?')[1] ?? '');
  new URLSearchParams(fragment).forEach((v, k) => params.set(k, v));
  const error = params.get('error_description') ?? params.get('error');
  if (error) return { error };
  const code = params.get('code');
  if (code) return { code };
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  return accessToken && refreshToken ? { accessToken, refreshToken } : null;
}

export async function signInOnPhone(auth: SupabaseAuth, { openAuthSession, redirectTo }: Deps): Promise<void> {
  const { data, error } = await auth.signInWithOAuth({ provider: 'google', options: { redirectTo, skipBrowserRedirect: true } });
  if (error || !data.url) throw error ?? new Error('Supabase gave no sign-in page');
  const result = await openAuthSession(data.url, redirectTo);
  if (result.type !== 'success' || !result.url) throw new SignInCancelled();
  const found = parseRedirect(result.url);
  if (!found || 'error' in found) throw new Error(found ? found.error : 'Sign-in did not come back with a session');
  const done = 'code' in found
    ? await auth.exchangeCodeForSession(found.code)
    : await auth.setSession({ access_token: found.accessToken, refresh_token: found.refreshToken });
  if (done.error) throw done.error;
}

export const phoneDeps = (): Deps => ({
  openAuthSession: (url, redirectTo) => WebBrowser.openAuthSessionAsync(url, redirectTo),
  redirectTo: Linking.createURL('auth/callback'),
});
