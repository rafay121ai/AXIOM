export const PRODUCT_EVENTS = Object.freeze([
  'onboarding_completed',
  'chat_started',
  'message_sent',
  'experiment_created',
  'experiment_committed',
  'experiment_reported',
  'thread_resumed',
])

export function createEventTracker({ supabase, logger = console } = {}) {
  return async function trackEvent(userId, event, properties = {}) {
    try {
      if (!supabase) throw new Error('Supabase service client is not configured')

      const { error } = await supabase
        .from('product_events')
        .insert({
          user_id: userId,
          event,
          properties: properties && typeof properties === 'object' && !Array.isArray(properties)
            ? properties
            : {},
        })

      if (error) throw error
      return true
    } catch (error) {
      logger.error('[Product Event] tracking failed', {
        event,
        user_id: userId,
        error: error?.message || String(error),
      })
      return false
    }
  }
}
