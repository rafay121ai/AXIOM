import { api } from '../api';
import { deviceTimeZone } from '../move/format';
import { expoPushDriver } from './expo';
import { createFakePhone } from './fake';
import { createPush } from './push';

// The one reminder for this phone. With fixtures (no server) the phone is a pretend one, so the question can be
// seen in a browser; EXPO_PUBLIC_FAKE_PUSH=refuse makes it refuse the way a phone does.
const driver = process.env.EXPO_PUBLIC_API === 'http' ? expoPushDriver : createFakePhone(process.env.EXPO_PUBLIC_FAKE_PUSH === 'refuse' ? 'denied' : 'granted');

export const push = createPush(driver, api, deviceTimeZone);
