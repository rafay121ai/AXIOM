// Read-only Composio calls for ingestion, with the global circuit breaker and error classes.
// Errors carry a short code only (auth | composio | paused); never content.
const AUTH = /unauthori|forbidden|invalid_grant|token.*(expired|revoked)|no connected account|not connected|reauth/i

export const isAuthError = (err) => err?.code === 'auth'

// Opens after `threshold` Composio failures in a row (any founder); closes after `pauseMs` or on a success.
export function createBreaker({ clock, threshold = 5, pauseMs = 10 * 60 * 1000 } = {}) {
  let failures = 0
  let openUntil = 0
  return {
    isOpen() {
      if (openUntil && clock.now() >= openUntil) { openUntil = 0; failures = 0 }
      return openUntil > 0
    },
    failure() { failures += 1; if (failures >= threshold) openUntil = clock.now() + pauseMs },
    success() { failures = 0; openUntil = 0 },
  }
}

export function createReader({ connectors, breaker }) {
  return async function read(userId, slug, args) {
    if (breaker.isOpen()) throw Object.assign(new Error('paused'), { code: 'paused' })
    let res
    try {
      res = await connectors.run(userId, slug, args)
      if (res?.successful === false) throw Object.assign(new Error(String(res.error ?? 'failed')), { status: res.status })
    } catch (err) {
      if (err.code === 'paused') throw err
      const auth = err.status === 401 || err.status === 403 || AUTH.test(err.message ?? '')
      if (!auth) breaker.failure() // a founder's own expired login says nothing about Composio
      throw Object.assign(new Error(auth ? 'auth' : 'composio'), { code: auth ? 'auth' : 'composio' })
    }
    breaker.success()
    return res?.data?.data ?? res?.data ?? res ?? {}
  }
}
