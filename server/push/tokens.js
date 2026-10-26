// Device push tokens (Expo). One row per device token. A token belongs to the
// founder who registered it last: when a phone signs in to another account,
// the token moves with it, so the earlier founder's pushes never reach it.
// Only the owner can remove a token. Writes go through the injected supabase.
import { validTimeZone } from '../journey/move/schedule.js'

export const EXPO_TOKEN_RX = /^Expo(?:nent)?PushToken\[[A-Za-z0-9_-]{8,200}\]$/
export const PLATFORMS = Object.freeze(['ios', 'android'])

const fail = (error) => ({ error })

// POST body: { token, platform, timezone? }.
export function cleanTokenPayload(body) {
  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  if (!EXPO_TOKEN_RX.test(token)) return fail('token is not an Expo push token')
  if (!PLATFORMS.includes(body?.platform)) return fail('platform must be ios or android')
  const tz = body?.timezone
  if (tz !== undefined && tz !== null && !validTimeZone(tz)) return fail('timezone is not valid')
  return { value: { token, platform: body.platform, timezone: tz ?? null } }
}

// DELETE body: { token }.
export function cleanTokenRemoval(body) {
  const token = typeof body?.token === 'string' ? body.token.trim() : ''
  return EXPO_TOKEN_RX.test(token) ? { value: { token } } : fail('token is not an Expo push token')
}

export function createPushTokens({ supabase, clock }) {
  const iso = () => new Date(clock.now()).toISOString()
  const one = async (query) => {
    const { data, error } = await query
    if (error) throw error
    return data
  }

  async function register({ userId, token, platform, timezone }) {
    const fields = { user_id: userId, platform, timezone, updated_at: iso() }
    const moved = await one(supabase.from('push_tokens').update(fields).eq('token', token).select('id'))
    if (moved.length === 0) {
      const inserted = await supabase.from('push_tokens').insert({ token, ...fields, created_at: fields.updated_at }).select('id')
      if (inserted.error?.code === '23505') await one(supabase.from('push_tokens').update(fields).eq('token', token).select('id'))
      else if (inserted.error) throw inserted.error
    }
    return { registered: true, platform }
  }

  // Sign-out on this phone. Another founder's token is left alone.
  async function remove({ userId, token }) {
    const gone = await one(supabase.from('push_tokens').delete().eq('token', token).eq('user_id', userId).select('id'))
    return { removed: gone.length > 0 }
  }

  // The founder's devices, newest first.
  const forUser = (userId) => one(supabase.from('push_tokens').select('token, platform, timezone, updated_at')
    .eq('user_id', userId).order('updated_at', { ascending: false }))

  // Expo said the device no longer exists.
  const dropInvalid = (userId, token) => one(supabase.from('push_tokens').delete().eq('token', token).eq('user_id', userId).select('id'))

  return { register, remove, forUser, dropInvalid }
}
