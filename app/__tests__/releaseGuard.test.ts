// The fixtures hold sample founders, stories and quotes: a release build must refuse them.
jest.mock('@react-native-async-storage/async-storage', () => ({}));

const load = () => jest.isolateModules(() => require('../src/api/index'));

describe('which API the app picks', () => {
  const dev = (global as { __DEV__?: boolean }).__DEV__;
  const api = process.env.EXPO_PUBLIC_API;
  afterEach(() => {
    (global as { __DEV__?: boolean }).__DEV__ = dev;
    process.env.EXPO_PUBLIC_API = api;
  });

  it('refuses the fixtures in a release build', () => {
    (global as { __DEV__?: boolean }).__DEV__ = false;
    delete process.env.EXPO_PUBLIC_API;
    expect(load).toThrow(/EXPO_PUBLIC_API=http/);
  });

  it('uses the fixtures in a development build', () => {
    (global as { __DEV__?: boolean }).__DEV__ = true;
    delete process.env.EXPO_PUBLIC_API;
    expect(load).not.toThrow();
  });
});
