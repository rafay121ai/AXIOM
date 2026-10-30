// Settings > Reminders: check-in time, morning push, evening push, what the
// lock screen shows, quiet hours. The check-in time lives where the Move
// already reads it (founder_profiles.report_time_local); the rest lives in
// user_settings. The cap of 2 a day is a product rule, not a setting.
import { DEFAULT_REPORT_TIME } from '../journey/move/schedule.js'
import { normalizeReportTime } from '../writeValidation.js'
import { DEFAULT_LOCK_SCREEN, LOCK_SCREEN_MODES } from './compose.js'
import { DEFAULT_QUIET_HOURS, isQuietTime } from './policy.js'

const KEYS = Object.freeze(['checkin_time', 'morning_on', 'evening_on', 'lock_screen', 'quiet_hours'])
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

const fail = (error, code) => (code ? { error, code } : { error })

// The settings the scheduler and the app use, from stored rows (or defaults).
export function reminderSettingsOf({ settingsRow = null, profileRow = null } = {}) {
  return {
    checkin_time: normalizeReportTime(profileRow?.report_time_local ?? '') ?? DEFAULT_REPORT_TIME,
    morning_on: settingsRow?.morning_on !== false,
    evening_on: settingsRow?.evening_on !== false,
    lock_screen: LOCK_SCREEN_MODES.includes(settingsRow?.lock_screen) ? settingsRow.lock_screen : DEFAULT_LOCK_SCREEN,
    quiet_hours: {
      start: normalizeReportTime(settingsRow?.quiet_start ?? '') ?? DEFAULT_QUIET_HOURS.start,
      end: normalizeReportTime(settingsRow?.quiet_end ?? '') ?? DEFAULT_QUIET_HOURS.end,
    },
  }
}

// PUT body: any of the keys, nothing else.
export function cleanReminderSettings(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('settings must be an object')
  const keys = Object.keys(body)
  if (keys.length === 0) return fail('nothing to change')
  const unknown = keys.find((k) => !KEYS.includes(k))
  if (unknown) return fail(`${unknown} is not a reminder setting`)
  const value = {}
  if ('checkin_time' in body) {
    if (!HHMM.test(body.checkin_time ?? '')) return fail('checkin_time must be HH:MM')
    value.checkin_time = body.checkin_time
  }
  for (const k of ['morning_on', 'evening_on']) {
    if (!(k in body)) continue
    if (typeof body[k] !== 'boolean') return fail(`${k} must be true or false`)
    value[k] = body[k]
  }
  if ('lock_screen' in body) {
    if (!LOCK_SCREEN_MODES.includes(body.lock_screen)) return fail(`lock_screen must be one of ${LOCK_SCREEN_MODES.join(', ')}`)
    value.lock_screen = body.lock_screen
  }
  if ('quiet_hours' in body) {
    const q = body.quiet_hours
    if (!q || !HHMM.test(q.start ?? '') || !HHMM.test(q.end ?? '')) return fail('quiet_hours needs start and end as HH:MM')
    if (q.start === q.end) return fail('quiet_hours start and end must differ')
    value.quiet_hours = { start: q.start, end: q.end }
  }
  return { value }
}


const one = async (query) => {
  const { data, error } = await query
  if (error) throw error
  return data
}

// Update the founder's row in a table keyed by user_id, or create it; a racing
// first save updates.
export async function saveOwnRow(supabase, table, userId, fields) {
  const updated = await one(supabase.from(table).update(fields).eq('user_id', userId).select('user_id'))
  if (updated.length > 0) return
  const inserted = await supabase.from(table).insert({ user_id: userId, ...fields }).select('user_id')
  if (inserted.error?.code === '23505') await one(supabase.from(table).update(fields).eq('user_id', userId).select('user_id'))
  else if (inserted.error) throw inserted.error
}

// What a reminder patch writes, checked against the current settings before
// anything is saved. Pure. current: reminderSettingsOf(...). hasProfile: the
// founder finished sign-up (the check-in time lives on founder_profiles, and
// no stub profile is ever made here). Returns { error } or
// { profile: fields for founder_profiles, settings: fields for user_settings }.
export function planReminderUpdate({ current, patch, hasProfile }) {
  const next = { ...current, ...patch }
  // The check-in time must not fall inside quiet hours, or it could never ring.
  if (isQuietTime(next.checkin_time, next.quiet_hours)) return fail('checkin_time falls inside quiet hours', 'quiet_hours_clash')
  if (patch.checkin_time && !hasProfile) return fail('Finish sign-up first.', 'signup_unfinished')
  const settings = {}
  for (const k of ['morning_on', 'evening_on', 'lock_screen']) if (k in patch) settings[k] = patch[k]
  if (patch.quiet_hours) Object.assign(settings, { quiet_start: patch.quiet_hours.start, quiet_end: patch.quiet_hours.end })
  return { profile: patch.checkin_time ? { report_time_local: patch.checkin_time } : {}, settings }
}

// Writes a checked plan: the founder's existing profile first (it may only be
// updated, never created), then their settings row.
export async function writeSettingsPlan(supabase, userId, { profile, settings }, now) {
  if (Object.keys(profile).length > 0) {
    const done = await one(supabase.from('founder_profiles').update({ ...profile, updated_at: now }).eq('user_id', userId).select('user_id'))
    if (done.length === 0) throw new Error('founder profile missing')
  }
  if (Object.keys(settings).length > 0) await saveOwnRow(supabase, 'user_settings', userId, { ...settings, updated_at: now })
}

export function createReminderSettings({ supabase, clock }) {
  const iso = () => new Date(clock.now()).toISOString()

  const rowsOf = (userId) => Promise.all([
    one(supabase.from('user_settings').select('morning_on, evening_on, lock_screen, quiet_start, quiet_end').eq('user_id', userId).maybeSingle()),
    one(supabase.from('founder_profiles').select('report_time_local, timezone').eq('user_id', userId).maybeSingle()),
    one(supabase.from('push_tokens').select('id').eq('user_id', userId).limit(1)),
  ]).then(([settingsRow, profileRow, devices]) => ({ settingsRow, profileRow, devices }))

  const view = ({ settingsRow, profileRow, devices }) => ({
    ...reminderSettingsOf({ settingsRow, profileRow }),
    timezone: profileRow?.timezone ?? null,
    push_registered: devices.length > 0,
  })

  const load = async (userId) => view(await rowsOf(userId))

  // patch: from cleanReminderSettings. { error } before any write, or the
  // plan for the caller to write with others ({ profile, settings }).
  async function plan(userId, patch) {
    const rows = await rowsOf(userId)
    return planReminderUpdate({ current: reminderSettingsOf(rows), patch, hasProfile: Boolean(rows.profileRow) })
  }

  async function update(userId, patch) {
    const planned = await plan(userId, patch)
    if (planned.error) return planned
    await writeSettingsPlan(supabase, userId, planned, iso())
    return { value: await load(userId) }
  }

  return { load, plan, update }
}
