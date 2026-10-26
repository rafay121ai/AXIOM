import { createFakeApi, type CareSim } from './fake';

// The one place the app picks its API. Swap for the real client when it exists.
// EXPO_PUBLIC_FAKE_CARE=clear|unclear makes the fake screen every text that way.
export const api = createFakeApi((process.env.EXPO_PUBLIC_FAKE_CARE as CareSim | undefined) ?? 'none');
