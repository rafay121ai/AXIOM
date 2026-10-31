// Settings > Privacy: "Share with other founders", meaning share
// automatically. Off by default; off means Axiom asks after every check-in.
// Turning it off stops future automatic sharing; past shares are taken down
// one by one with POST /api/reports/:id/withdraw.
import rateLimit from 'express-rate-limit'
import { createSharing } from './sharing.js'
import { SHARE_AUTO_TEXT } from './wording.js'

export function mountSharingRoutes(app, { supabase, clock }) {
  const limiter = (max) => rateLimit({
    windowMs: 60 * 1000,
    max,
    keyGenerator: (req) => req.user.id,
    message: { error: 'That is too many at once. Wait a minute.' },
    standardHeaders: true,
    legacyHeaders: false,
  })
  const sharing = createSharing({ supabase, clock })
  const view = (on) => ({ share_automatically: on, text: on ? SHARE_AUTO_TEXT.on : SHARE_AUTO_TEXT.off })

  const handle = (fn) => async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'Service not configured' })
    try {
      return await fn(req, res)
    } catch (err) {
      console.error('[Sharing] failed', err?.message || err)
      return res.status(500).json({ error: 'Something went wrong. Try again.' })
    }
  }

  app.get('/api/settings/sharing', limiter(60),
    handle(async (req, res) => res.json(view(await sharing.shareAuto(req.user.id)))))

  app.put('/api/settings/sharing', limiter(20),
    handle(async (req, res) => {
      const on = req.body?.share_automatically
      if (typeof on !== 'boolean') return res.status(400).json({ error: 'share_automatically must be true or false' })
      return res.json(view(await sharing.setShareAuto(req.user.id, on)))
    }))
}
