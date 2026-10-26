import { authFromEnv } from './auth';
import { createFakeApi, type CareSim } from './fake';
import { createHttpApi } from './http';
import type { AxiomApi } from './types';

// The one place the app picks its API.
// EXPO_PUBLIC_API=http uses the Express server at EXPO_PUBLIC_API_URL; anything else uses the fixtures.
// EXPO_PUBLIC_FAKE_CARE=clear|unclear makes the fake screen every text that way.
// EXPO_PUBLIC_FAKE_LATENCY=<ms> makes the fake's Learn answers slow, to see the loading hint.
function pick(): AxiomApi {
  if (process.env.EXPO_PUBLIC_API === 'http') {
    const baseUrl = process.env.EXPO_PUBLIC_API_URL;
    if (!baseUrl) throw new Error('Set EXPO_PUBLIC_API_URL (see app/README.md)');
    return createHttpApi({ baseUrl, auth: authFromEnv() });
  }
  return createFakeApi((process.env.EXPO_PUBLIC_FAKE_CARE as CareSim | undefined) ?? 'none', Number(process.env.EXPO_PUBLIC_FAKE_LATENCY ?? 0));
}

export const api = pick();
