# Axiom app (Expo)

Screens are built against fixtures by default. To talk to the real Express server, set these (in `app/.env` or the shell):

| Variable | What it is |
| --- | --- |
| `EXPO_PUBLIC_API` | `http` uses the server. Anything else (the default) uses the fixtures in `src/api/fake.ts`, in development builds only: a release build without `http` refuses to start, because the fixtures are samples. |
| `EXPO_PUBLIC_API_URL` | Server base URL, for example `http://localhost:3001`. Needed when `EXPO_PUBLIC_API=http`. |
| `EXPO_PUBLIC_SUPABASE_URL` | Main Supabase project URL. Used for sign-in only. |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Its anon key. Used for sign-in only. |
| `EXPO_PUBLIC_FAKE_DUE` | Fixtures only: `report` puts the evening check-in waiting, so sign-in lands on the Report. |
| `EXPO_PUBLIC_FAKE_HOME` | Fixtures only: `morning`, `report`, `evening`, `nothing` or `care` makes the fake a returning founder, and sign-in lands on that home state. |
| `EXPO_PUBLIC_FAKE_PUSH` | Fixtures only: `refuse` makes the pretend phone refuse reminders when asked. By default it allows them. |
| `EXPO_PUBLIC_FAKE_CARE` | Fixtures only: `clear` or `unclear` makes every typed text take that care route. |

The app never reads or writes Supabase tables. Supabase gives the app a sign-in token, sent to the API as a Bearer token.

Reminders: after Commit the app asks "Want a reminder tonight?" and asks the phone only when the founder says yes (`src/push`). Real device tokens need `expo.extra.eas.projectId` in `app.json`.

Not done yet: Google sign-in on phones (the web redirect works once the keys exist; phones need the native flow), and keeping unsent answers across an app restart (the retry queue is in memory).

Commands: `npm test`, `npm run typecheck`, `npx expo export --platform web`.
