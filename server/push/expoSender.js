// The real Expo push sender. Constructed only in index.js, and only when
// EXPO_PUSH=on. Tests use createFakePushSender (testing/fakes.js); nothing in
// a test ever reaches Expo.
//
// send(message) resolves to { ok: true } or { ok: false, invalidToken, error }.
// invalidToken: Expo says the device is gone (DeviceNotRegistered), so the
// token is dropped. Delivery receipts are not checked yet.
export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'
const TIMEOUT_MS = 10_000

export function createExpoSender({ accessToken = null, fetchImpl = fetch } = {}) {
  return {
    async send(message) {
      let res
      try {
        res = await fetchImpl(EXPO_PUSH_URL, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify(message),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })
      } catch (err) {
        return { ok: false, invalidToken: false, error: err?.name === 'TimeoutError' ? 'timeout' : 'network' }
      }
      const json = await res.json().catch(() => null)
      const ticket = Array.isArray(json?.data) ? json.data[0] : json?.data
      if (res.ok && ticket?.status === 'ok') return { ok: true }
      const code = ticket?.details?.error ?? json?.errors?.[0]?.code ?? `http_${res.status}`
      return { ok: false, invalidToken: code === 'DeviceNotRegistered', error: String(code) }
    },
  }
}
