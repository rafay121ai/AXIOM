import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import { phoneDeps, signInOnPhone, type Deps } from '../auth/oauth';

// Supabase is used here for sign-in and nothing else. Every read and write goes through the Express API.
export type Auth = {
  signInWithGoogle(): Promise<void>;
  signOut(): Promise<void>;
  /** The signed-in founder's access token, sent to the API as a Bearer token. */
  getToken(): Promise<string>;
};

// On the web the page itself goes to Google and comes back; on a phone the browser opens over the app (src/auth/oauth.ts).
export function createAuth(client: SupabaseClient, phone?: Deps): Auth {
  return {
    async signInWithGoogle() {
      if (phone) return signInOnPhone(client.auth, phone);
      const { error } = await client.auth.signInWithOAuth({ provider: 'google' });
      if (error) throw error;
    },
    async signOut() {
      const { error } = await client.auth.signOut();
      if (error) throw error;
    },
    async getToken() {
      const { data } = await client.auth.getSession();
      if (!data.session) throw new Error('Not signed in');
      return data.session.access_token;
    },
  };
}

/** Reads EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY. */
export function authFromEnv(): Auth {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY (see app/README.md)');
  const web = Platform.OS === 'web';
  const client = createClient(url, key, { auth: { flowType: 'pkce', storage: AsyncStorage, detectSessionInUrl: web } });
  return createAuth(client, web ? undefined : phoneDeps());
}
