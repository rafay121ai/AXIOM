import AsyncStorage from '@react-native-async-storage/async-storage';
import { authFromEnv } from './auth';
import { createFakeApi, type CareSim, type FounderSim, type HomeSim, type AccountSim } from './fake';
import { createHttpApi } from './http';
import type { AxiomApi } from './types';

// The one place the app picks its API.
// EXPO_PUBLIC_API=http uses the Express server at EXPO_PUBLIC_API_URL; anything else uses the fixtures.
// EXPO_PUBLIC_FAKE_CARE=clear|unclear makes the fake screen every text that way.
// EXPO_PUBLIC_FAKE_DUE=report puts the mock's evening check-in waiting after sign-in.
// EXPO_PUBLIC_FAKE_HOME=morning|report|evening|nothing|care|opener makes the fake a returning founder on that home state.
// EXPO_PUBLIC_FAKE_FOUNDER=closed makes the fake send the closed founder-lessons notice instead of a case.
// EXPO_PUBLIC_FAKE_ACCOUNT=pending|off makes a deletion already wait when Settings opens (pending) or delete only be recorded (off). Unset: delete starts a grace period.
// EXPO_PUBLIC_FAKE_LATENCY=<ms> makes the fake's Learn answers slow, to see the loading hint.
function pick(): AxiomApi {
  if (process.env.EXPO_PUBLIC_API === 'http') {
    const baseUrl = process.env.EXPO_PUBLIC_API_URL;
    if (!baseUrl) throw new Error('Set EXPO_PUBLIC_API_URL (see app/README.md)');
    return createHttpApi({ baseUrl, auth: authFromEnv(), store: AsyncStorage });
  }
  // The fixtures hold sample founders, stories and quotes: never in a release build.
  if (!__DEV__) throw new Error('Release builds must set EXPO_PUBLIC_API=http (see app/README.md)');
  return createFakeApi((process.env.EXPO_PUBLIC_FAKE_CARE as CareSim | undefined) ?? 'none', Number(process.env.EXPO_PUBLIC_FAKE_LATENCY ?? 0), process.env.EXPO_PUBLIC_FAKE_DUE === 'report', process.env.EXPO_PUBLIC_FAKE_HOME as HomeSim | undefined, process.env.EXPO_PUBLIC_FAKE_FOUNDER as FounderSim | undefined, process.env.EXPO_PUBLIC_FAKE_ACCOUNT as AccountSim | undefined);
}

export const api = pick();
