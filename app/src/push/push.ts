import type { AxiomApi, PushPlatform } from '../api/types';

// The reminder: the phone's permission, and telling the server which phone to ring. Nothing here asks the phone
// anything until the founder has said yes to Axiom's own question.

/** What the phone itself can do. The real one is in expo.ts; tests pass their own. */
export type PushDriver = {
  /** null: this device cannot get a reminder (a browser). */
  platform: PushPlatform | null;
  permission(): Promise<'granted' | 'denied' | 'undetermined'>;
  ask(): Promise<'granted' | 'denied'>;
  token(): Promise<string>;
};

type Server = Pick<AxiomApi, 'registerPushToken' | 'removePushToken'>;

/**
 * `ask`: the phone has not been asked, so Axiom may ask. `on`: reminders are allowed already.
 * `off`: refused on the phone, or this device cannot get one.
 */
export type PushState = 'ask' | 'on' | 'off';

export type Push = {
  state(): Promise<PushState>;
  /** The founder said yes: ask the phone, and when it allows, register this phone. `refused` otherwise. */
  enable(): Promise<'on' | 'refused'>;
  /** Registers this phone again (a new token, or a new time zone). Does nothing unless reminders are allowed. */
  refresh(): Promise<void>;
  /** Sign-out on this phone: its token stops getting this founder's reminders. */
  release(): Promise<void>;
};

export function createPush(driver: PushDriver, server: Server, timeZone: () => string): Push {
  const state = async (): Promise<PushState> => {
    if (!driver.platform) return 'off';
    const p = await driver.permission();
    return p === 'granted' ? 'on' : p === 'denied' ? 'off' : 'ask';
  };
  const register = async (platform: PushPlatform) => server.registerPushToken(await driver.token(), platform, timeZone());
  return {
    state,
    async enable() {
      if (!driver.platform || (await driver.ask()) !== 'granted') return 'refused';
      await register(driver.platform);
      return 'on';
    },
    async refresh() {
      if (driver.platform && (await state()) === 'on') await register(driver.platform);
    },
    async release() {
      if (driver.platform && (await state()) === 'on') await server.removePushToken(await driver.token());
    },
  };
}
