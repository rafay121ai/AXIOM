// Read-only Composio calls for ingestion, with the global circuit breaker and error classes.
// Errors carry a short code only (auth | gone | composio | paused); never content.
export const CALL_TIMEOUT_MS = 20 * 1000
const GONE = /not.?found|404|does not exist|has been deleted|resource.*deleted/i
const AUTH = /unauthori|forbidden|invalid_grant|token.*(expired|revoked)|no connected account|not connected|reauth/i

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

export function createReader({ connectors, breaker, timeoutMs = CALL_TIMEOUT_MS }) {
  return async function read(userId, slug, args) {
    if (breaker.isOpen()) throw Object.assign(new Error('paused'), { code: 'paused' })
    let res
    let timer
    try {
      // A hung call must not hold a poll or worker run open forever.
      res = await Promise.race([
        connectors.run(userId, slug, args),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), timeoutMs) }),
      ])
      if (res?.successful === false) throw Object.assign(new Error(String(res.error ?? 'failed')), { status: res.status })
    } catch (err) {
      if (err.code === 'paused') throw err
      const msg = err.message ?? ''
      const auth = err.status === 401 || err.status === 403 || AUTH.test(msg)
      // A founder's own expired login, or one deleted item, says nothing about Composio.
      const gone = !auth && (err.status === 404 || GONE.test(msg))
      if (!auth && !gone) breaker.failure()
      const code = auth ? 'auth' : gone ? 'gone' : 'composio'
      throw Object.assign(new Error(code), { code })
    } finally {
      clearTimeout(timer)
    }
    breaker.success()
    return res?.data?.data ?? res?.data ?? res ?? {}
  }
}
