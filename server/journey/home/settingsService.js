// Settings, as one page: You, Reminders, How Axiom talks, On screen, Privacy.
// Reminders and "share with other founders" keep their own rules and their own
// routes (push/settings.js, report/sharing.js); this reads and saves them
// together. Everything is validated before anything is written.
import { cleanReminderSettings, createReminderSettings, writeSettingsPlan } from '../../push/settings.js'
import { validTimeZone } from '../move/schedule.js'
import { createSignupStore } from '../signup.js'
import { createSharing } from '../report/sharing.js'
import { SHARE_AUTO_TEXT } from '../report/wording.js'
import { DELETION_PLAN } from './wording.js'

export const MENTOR_STYLES = Object.freeze(['calm', 'direct', 'hard'])
export const DEFAULT_MENTOR_STYLE = 'direct'

const OWN_KEYS = ['mentor_style', 'keep_items', 'share_automatically', 'timezone']
const fail = (error, code) => (code ? { error, code } : { error })

const one = async (query) => {
  const { data, error } = await query
  if (error) throw error
  return data
}

// PATCH body: any of the settings, nothing else. { value } | { error }.
export function cleanSettings(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('settings must be an object')
  if (Object.keys(body).length === 0) return fail('nothing to change')
  const own = {}
  const reminders = {}
  for (const [k, v] of Object.entries(body)) (OWN_KEYS.includes(k) ? own : reminders)[k] = v
  if ('mentor_style' in own && !MENTOR_STYLES.includes(own.mentor_style)) return fail(`mentor_style must be one of ${MENTOR_STYLES.join(', ')}`)
  for (const k of ['keep_items', 'share_automatically']) {
    if (k in own && typeof own[k] !== 'boolean') return fail(`${k} must be true or false`)
  }
  if ('timezone' in own && !(typeof own.timezone === 'string' && validTimeZone(own.timezone))) return fail('timezone must be a time zone name')
  if (Object.keys(reminders).length === 0) return { value: { own, reminders: null } }
  const cleaned = cleanReminderSettings(reminders)
  return cleaned.error ? cleaned : { value: { own, reminders: cleaned.value } }
}

export function createSettings({ supabase, clock, links = {}, pendingDeletion = async () => null }) {
  const iso = () => new Date(clock.now()).toISOString()
  const reminders = createReminderSettings({ supabase, clock })
  const sharing = createSharing({ supabase, clock })
  const signup = createSignupStore({ supabase, clock })

  async function get({ user }) {
    const [profile, row, reminderSettings, shareAutomatically, pending_deletion] = await Promise.all([
      one(supabase.from('users').select('first_name').eq('id', user.id).maybeSingle()),
      one(supabase.from('user_settings').select('mentor_style, keep_items').eq('user_id', user.id).maybeSingle()),
      reminders.load(user.id),
      sharing.shareAuto(user.id),
      pendingDeletion(user.id),
    ])
    const founder = await one(supabase.from('founder_profiles').select('country, timezone').eq('user_id', user.id).maybeSingle())
    const { answers } = await signup.load(user.id)
    return {
      you: { name: profile?.first_name ?? null, email: user.email ?? null, country: founder?.country ?? null, timezone: founder?.timezone ?? null },
      // Edit one answer with PUT /api/signup/answers/:key.
      signup_answers: answers,
      links: { privacy: links.privacy ?? null, terms: links.terms ?? null },
      reminders: reminderSettings,
      mentor_style: MENTOR_STYLES.includes(row?.mentor_style) ? row.mentor_style : DEFAULT_MENTOR_STYLE,
      keep_items: row?.keep_items === true,
      pending_deletion,
      // What the delete screen says before the founder confirms.
      deletion: { would_remove: DELETION_PLAN.would_remove, shared_outcomes: DELETION_PLAN.shared_outcomes },
      privacy: { share_automatically: shareAutomatically, text: shareAutomatically ? SHARE_AUTO_TEXT.on : SHARE_AUTO_TEXT.off },
    }
  }

  // value: the result of cleanSettings. Returns { value: the page } or { error }.
  // Every check (sign-up finished, check-in time outside quiet hours) runs
  // before the first write, so a refused change writes nothing.
  async function update({ user, value: { own, reminders: reminderPatch } }) {
    if ('timezone' in own) {
      const profile = await one(supabase.from('founder_profiles').select('user_id').eq('user_id', user.id).maybeSingle())
      if (!profile) return fail('Finish sign-up first.', 'signup_unfinished')
    }
    const planned = reminderPatch ? await reminders.plan(user.id, reminderPatch) : { profile: {}, settings: {} }
    if (planned.error) return planned

    if ('timezone' in own) planned.profile.timezone = new Intl.DateTimeFormat('en-US', { timeZone: own.timezone }).resolvedOptions().timeZone
    if ('mentor_style' in own) planned.settings.mentor_style = own.mentor_style
    if ('keep_items' in own) planned.settings.keep_items = own.keep_items
    await writeSettingsPlan(supabase, user.id, planned, iso())
    if ('share_automatically' in own) await sharing.setShareAuto(user.id, own.share_automatically)
    return { value: await get({ user }) }
  }

  return { get, update }
}
