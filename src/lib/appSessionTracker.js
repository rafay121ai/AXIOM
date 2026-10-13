import { postApiJson } from './api'

const ACTIVE_APP_SESSION_KEY = 'axiom_active_app_session_id'

function deviceLabel() {
  if (typeof navigator === 'undefined') return 'unknown'
  const pointer = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches
    ? 'touch'
    : 'pointer'
  return `${pointer}; ${navigator.platform || 'unknown'}`
}

export async function startAppSession({ userId, entryPoint = 'direct' } = {}) {
  if (!userId) return null

  let data = null
  try {
    data = await postApiJson('/api/app-sessions', {
      entry_point: entryPoint,
      device: deviceLabel(),
    })
  } catch {
    return null
  }
  if (!data?.id) return null

  try {
    sessionStorage.setItem(ACTIVE_APP_SESSION_KEY, data.id)
  } catch {
    // ignore storage failures
  }

  return data
}

export async function pingAppSession(appSessionId) {
  if (!appSessionId) return
  try {
    await postApiJson(`/api/app-sessions/${encodeURIComponent(appSessionId)}/ping`)
  } catch {
    // best effort, like the direct write it replaces
  }
}

// Duration is computed server-side from the stored started_at. keepalive lets
// the request survive page unload (sendBeacon cannot carry the auth header).
export async function closeAppSession(appSessionId) {
  if (!appSessionId) return
  try {
    await postApiJson(`/api/app-sessions/${encodeURIComponent(appSessionId)}/close`, {}, { keepalive: true })
  } catch {
    // best effort
  }

  try {
    if (sessionStorage.getItem(ACTIVE_APP_SESSION_KEY) === appSessionId) {
      sessionStorage.removeItem(ACTIVE_APP_SESSION_KEY)
    }
  } catch {
    // ignore storage failures
  }
}

export async function incrementAppSessionMessagesSent(amount = 1) {
  let appSessionId = null
  try {
    appSessionId = sessionStorage.getItem(ACTIVE_APP_SESSION_KEY)
  } catch {
    return
  }
  if (!appSessionId) return

  try {
    await postApiJson(`/api/app-sessions/${encodeURIComponent(appSessionId)}/messages-sent`, { amount })
  } catch {
    // best effort
  }
}
