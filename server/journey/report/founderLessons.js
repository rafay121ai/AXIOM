// Give to get: who may be shown a founder lesson (an approved peer story).
// Access is never stored. On every request it is worked out from stored truth:
//   open when the founder has fewer than FREE_LESSONS counted deliveries,
//   or user_settings.share_auto is on, or any 'share' unlock exists.
// There is no flag to fall out of sync: turning sharing on in Settings opens
// the very next request, and a share is never taken away.
// A delivery is counted only when an approved story is actually shown; with no
// story nothing is counted and nothing is said (PRODUCT.md).
// founder_lesson_log: unique (user_id, source_key) makes a repeat count
// nothing; unique (user_id, slot) is the compare-and-swap for the free slots.
import { FOUNDER_LESSONS_CLOSED_TEXT, FOUNDER_LESSONS_CLOSED_VERSION } from './wording.js'

export const FREE_LESSONS = 2
const NOTICE_KEY = 'closed_notice'

// sharing: createSharing(...). Returns { forSource }.
export function createFounderLessons({ supabase, sharing, clock }) {
  const iso = () => new Date(clock.now()).toISOString()
  const one = async (query) => {
    const { data, error } = await query
    if (error) throw error
    return data
  }
  const logOf = (userId) => one(supabase.from('founder_lesson_log').select('source_key, slot').eq('user_id', userId))
  const insert = (userId, sourceKey, slot) =>
    supabase.from('founder_lesson_log').insert({ user_id: userId, source_key: sourceKey, slot, created_at: iso() }).select('id')
  const hasShared = async (userId) =>
    (await one(supabase.from('peer_unlocks').select('id').eq('user_id', userId).eq('kind', 'share').limit(1))).length > 0

  // sourceKey: 'report:<id>' or 'learn:<conversation id>'. The caller has
  // already checked care. Returns { story, fresh, founder_lessons }: fresh is
  // true only the first time this source is served (Learn shows one case per
  // situation); founder_lessons is null, or { state: 'closed_notice', notice }
  // the one time the gate is closed and a story would have fitted. When the
  // gate is closed otherwise, nothing is shown and nothing is said.
  async function forSource({ userId, sourceKey }) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const log = await logOf(userId)
      const seen = log.some((l) => l.source_key === sourceKey)
      const used = log.filter((l) => l.slot != null).length
      const open = seen || used < FREE_LESSONS || (await sharing.shareAuto(userId)) || (await hasShared(userId))
      const story = open || !log.some((l) => l.source_key === NOTICE_KEY) ? await sharing.findStory(userId) : null
      if (!story) return { story: null, fresh: false, founder_lessons: null }

      if (!open) {
        const told = await insert(userId, NOTICE_KEY, null)
        if (told.error && told.error.code !== '23505') throw told.error
        return {
          story: null, fresh: false,
          founder_lessons: told.error
            ? null
            : { state: 'closed_notice', notice: { text: FOUNDER_LESSONS_CLOSED_TEXT, wording_version: FOUNDER_LESSONS_CLOSED_VERSION } },
        }
      }
      if (seen) return { story, fresh: false, founder_lessons: null }

      // Shown while sharing is on: logged (once per source) but not counted.
      const counted = used < FREE_LESSONS && !(await sharing.shareAuto(userId)) && !(await hasShared(userId))
      const res = await insert(userId, sourceKey, counted ? used + 1 : null)
      if (!res.error) return { story, fresh: true, founder_lessons: null }
      if (res.error.code !== '23505') throw res.error
      // Lost a race for the slot or for this source: read the log again.
    }
    return { story: null, fresh: false, founder_lessons: null }
  }

  return { forSource }
}
