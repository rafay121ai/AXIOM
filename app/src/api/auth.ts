import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Supabase is used here for sign-in and nothing else. Every read and write goes through the Express API.
export type Auth = {
  signInWithGoogle(): Promise<void>;
  /** The signed-in founder's access token, sent to the API as a Bearer token. */
  getToken(): Promise<string>;
};

export function createAuth(client: SupabaseClient): Auth {
  return {
    async signInWithGoogle() {
      const { error } = await client.auth.signInWithOAuth({ provider: 'google' });
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
  return createAuth(createClient(url, key));
}
