// Push token and reminder settings routes. Auth comes from app.js (/api/push
// and /api/settings). The founder sends no free text here, so no care gate.
import rateLimit from 'express-rate-limit'
import { cleanTokenPayload, cleanTokenRemoval, createPushTokens } from './tokens.js'
import { cleanReminderSettings, createReminderSettings } from './settings.js'

export function mountPushRoutes(app, { supabase, clock }) {
  const limiter = (max) => rateLimit({
    windowMs: 60 * 1000,
    max,
    keyGenerator: (req) => req.user.id,
    message: { error: 'Too many requests, please slow down.' },
    standardHeaders: true,
    legacyHeaders: false,
  })
  const tokens = createPushTokens({ supabase, clock })
  const settings = createReminderSettings({ supabase, clock })

  // clean: (body) => { value } | { error }. run: (userId, value) => result,
  // where a result may itself be { error } (a 400) or { value }.
  const handle = (clean, run) => async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'Service not configured' })
    const cleaned = clean(req.body)
    if (cleaned.error) return res.status(400).json({ error: cleaned.error })
    try {
      const out = await run(req.user.id, cleaned.value)
      if (out?.error) return res.status(400).json({ error: out.error })
      return res.json(out?.value ?? out)
    } catch (err) {
      console.error('[Push] failed', err?.message || err)
      return res.status(500).json({ error: 'Something went wrong. Try again.' })
    }
  }
  const none = () => ({ value: null })

  app.post('/api/push/token', limiter(20),
    handle(cleanTokenPayload, (userId, v) => tokens.register({ userId, ...v })))

  app.delete('/api/push/token', limiter(20),
    handle(cleanTokenRemoval, (userId, v) => tokens.remove({ userId, ...v })))

  app.get('/api/settings/reminders', limiter(60),
    handle(none, (userId) => settings.load(userId)))

  app.put('/api/settings/reminders', limiter(20),
    handle(cleanReminderSettings, (userId, v) => settings.update(userId, v)))
}
