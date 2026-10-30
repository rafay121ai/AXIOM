// The real Expo push sender. Constructed only in index.js, and only when
// EXPO_PUSH=on. Tests use createFakePushSender (testing/fakes.js); nothing in
// a test ever reaches Expo.
//
// send(message) resolves to one of:
// - { ok: true }: Expo took it;
// - { ok: false, unknown: true, error }: a timeout, a network error, a 5xx or
//   an answer without a ticket. The push may have reached the phone, so it is
//   never sent again;
// - { ok: false, unknown: false, invalidToken, error }: Expo clearly refused it
//   (a 4xx or an error ticket), so it may be retried. invalidToken: Expo says
//   the device is gone (DeviceNotRegistered), so the token is dropped.
// Delivery receipts are not checked yet.
export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send'
const TIMEOUT_MS = 10_000

const unknown = (error) => ({ ok: false, unknown: true, invalidToken: false, error })

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
        return unknown(err?.name === 'TimeoutError' ? 'timeout' : 'network')
      }
      if (res.status >= 500) return unknown(`http_${res.status}`)
      const json = await res.json().catch(() => null)
      const ticket = Array.isArray(json?.data) ? json.data[0] : json?.data
      if (res.ok && ticket?.status === 'ok') return { ok: true }
      if (res.ok && ticket?.status !== 'error') return unknown('no_ticket')
      const code = ticket?.details?.error ?? json?.errors?.[0]?.code ?? `http_${res.status}`
      return { ok: false, unknown: false, invalidToken: code === 'DeviceNotRegistered', error: String(code) }
    },
  }
}
