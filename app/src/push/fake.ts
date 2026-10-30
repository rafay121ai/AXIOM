import type { PushDriver } from './push';

/**
 * A phone for fixtures and tests: it has not been asked yet, and says `answer` when it is. Asking is
 * recorded in `asked` so a test can see that nothing was asked before the founder said yes.
 */
export function createFakePhone(answer: 'granted' | 'denied' = 'granted', platform: PushDriver['platform'] = 'ios'): PushDriver & { asked: number } {
  let permission: 'granted' | 'denied' | 'undetermined' = 'undetermined';
  const phone = {
    asked: 0,
    platform,
    async permission() { return permission; },
    async ask() {
      phone.asked += 1;
      permission = answer;
      return answer;
    },
    async token() { return 'ExponentPushToken[fixture-token-1]'; },
  };
  return phone;
}
