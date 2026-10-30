// Journey routes: sign-up answers and the first reading. Mounted by app.js
// after requireAuth is in place for /api/signup and /api/first-reading.
import rateLimit from 'express-rate-limit'
import { createSignupHandlers, signupFreeText } from './signup.js'
import { createFirstReading } from './firstReading.js'
import { mountSituationRoutes } from './situationRoutes.js'
import { mountLearnRoutes } from './learn/learnRoutes.js'
import { mountMoveRoutes } from './move/moveRoutes.js'
import { mountReportRoutes } from './report/reportRoutes.js'
import { mountSharingRoutes } from './report/sharingRoutes.js'
import { mountHomeRoutes } from './home/homeRoutes.js'

export function mountJourneyRoutes(app, { supabase, knowledgeSupabase = null, embed = null, care, callStructured, clock, links = {} }) {
  const limiter = (max) => rateLimit({
    windowMs: 60 * 1000,
    max,
    keyGenerator: (req) => req.user.id,
    message: { error: 'Too many requests, please slow down.' },
    standardHeaders: true,
    legacyHeaders: false,
  })
  const signup = createSignupHandlers({ supabase, clock })

  mountSituationRoutes(app, { supabase, care, callStructured, clock })
  mountLearnRoutes(app, { supabase, knowledgeSupabase, embed, care, callStructured, clock })
  mountMoveRoutes(app, { supabase, care, callStructured, clock })
  mountReportRoutes(app, { supabase, care, callStructured, clock })
  mountSharingRoutes(app, { supabase, clock })
  mountHomeRoutes(app, { supabase, care, callStructured, clock, links })

  app.get('/api/signup', limiter(60), signup.get)
  app.put('/api/signup/answers/:key', limiter(60), care.careGate(signupFreeText), signup.put)

  // Reads the stored answers; the founder sends no text here, so no care gate.
  app.post('/api/first-reading', limiter(5), async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'Service not configured' })
    try {
      const { answers, next } = await signup.view(req.user.id)
      if (next) return res.status(409).json({ error: 'Sign-up is not finished', next })
      const { reading } = await createFirstReading({
        answers,
        deps: {
          callStructured,
          userId: req.user.id,
          log: (what, detail) => console.error(`[FirstReading] ${what}`, detail?.message || detail?.problems || ''),
        },
      })
      return res.json(reading)
    } catch (error) {
      console.error('[FirstReading] failed', error?.message || error)
      return res.status(500).json({ error: 'Failed to build the first reading' })
    }
  })
}
