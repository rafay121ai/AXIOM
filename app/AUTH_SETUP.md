# Google sign-in: what you set up outside the code

The app code is done and tested with fakes. It has not been run against real Google or Supabase keys, so the first real sign-in is the real test.

## How it works
The app asks Supabase for a Google sign-in page and opens it in the phone's browser sheet. Google sends the founder back to the app through a link (`axiom://auth/callback`). The app hands what came back to Supabase, which makes the session. The app uses Supabase for sign-in only; everything else goes through the Express API.

## 1. Google Cloud (console.cloud.google.com)
1. Create a project (or use one). Under APIs and Services, set up the OAuth consent screen (app name Axiom, your support email).
2. Credentials, Create credentials, OAuth client ID. Make a **Web application** client. This is the one Supabase uses.
3. Under "Authorized redirect URIs" add Supabase's callback: `https://<your-project-ref>.supabase.co/auth/v1/callback` (the Supabase dashboard shows it on the Google provider page).
4. Copy the client ID and client secret. Keep the secret out of the repo.

Because the browser sheet goes through Supabase's web callback, you do not need separate iOS or Android Google clients for this flow. Make them only if you later add Google's native sign-in button.

## 2. Supabase dashboard (main project)
1. Authentication, Providers, Google: switch on, paste the client ID and secret from step 1.
2. Authentication, URL Configuration, Redirect URLs: add
   - `axiom://auth/callback` (release and development builds)
   - the web address you serve the web app from, for example `http://localhost:8081` while testing
   - in Expo Go only (not for real sign-in): the `exp://...` address that `npx expo start` prints, ending in `/--/auth/callback`
3. Leave Site URL as your web address.

## 3. Environment variables
In `app/.env` (never committed) or the build service's secrets:

| Variable | Value |
| --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | main project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | its anon (public) key, never the service key |
| `EXPO_PUBLIC_API` | `http` |
| `EXPO_PUBLIC_API_URL` | the Express server URL |

With `EXPO_PUBLIC_API` unset the app uses fixtures and skips real sign-in, as before.

## 4. Expo Go does not work for real sign-in
Expo Go uses its own link scheme, not `axiom://`, so the return link will not match what you allowed. Use a development build, which carries the `axiom` scheme (set in `app.json`):

    cd app
    npx expo install expo-dev-client
    eas build --profile development --platform ios     # or android
    # or locally: npx expo run:ios / npx expo run:android

Run `npx expo prebuild` or a new build after changing `app.json`; the scheme and the browser plugin are compiled in.

## 5. How to test
1. Start the Express server and the app with the variables above, open the development build, tap Continue with Google.
2. Pick an account. The browser sheet closes and you land on the sign-up questions (new founder) or home (returning).
3. Close the sheet without choosing: you stay on the sign-in screen, nothing is said.
4. Break it on purpose (remove the redirect URL in Supabase, try again): the screen says "Sign-in didn't work. Try again." and the button works again.
5. Web: `npx expo start --web`, tap the button; the page goes to Google and back.
