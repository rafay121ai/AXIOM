// Journey routes: sign-up answers and the first reading. Mounted by app.js
// after requireAuth is in place for /api/signup and /api/first-reading.
import rateLimit from 'express-rate-limit'
import { createSignupHandlers, signupFreeText, nameFreeText } from './signup.js'
import { createFirstReading } from './firstReading.js'
import { mountSituationRoutes } from './situationRoutes.js'
import { mountLearnRoutes } from './learn/learnRoutes.js'
import { mountMoveRoutes } from './move/moveRoutes.js'
import { mountReportRoutes } from './report/reportRoutes.js'
import { mountSharingRoutes } from './report/sharingRoutes.js'
import { mountHomeRoutes } from './home/homeRoutes.js'
import { createStoredAnswers } from './storedAnswers.js'
import { scheduleMemory } from './memory/extractBeliefs.js'
import { seedFromSignup } from './memory/signupSeed.js'

export function mountJourneyRoutes(app, { supabase, knowledgeSupabase = null, embed = null, care, cap, callStructured, clock, lessonCites = false, links = {}, deleteOn = false, noDailyLimit = () => false }) {
  const limiter = (max) => rateLimit({
    windowMs: 60 * 1000,
    max,
    keyGenerator: (req) => req.user.id,
    message: { error: 'That is too many at once. Wait a minute.' },
    standardHeaders: true,
    legacyHeaders: false,
  })
  const stored = createStoredAnswers(supabase)
  const signup = createSignupHandlers({ supabase, clock })

  mountSituationRoutes(app, { supabase, care, cap, stored, callStructured, clock, noDailyLimit })
  mountLearnRoutes(app, { supabase, knowledgeSupabase, embed, care, cap, stored, callStructured, clock, lessonCites })
  mountMoveRoutes(app, { supabase, care, cap, stored, callStructured, clock })
  mountReportRoutes(app, { supabase, care, callStructured, clock, isCapped: cap.isCapped })
  mountSharingRoutes(app, { supabase, clock })
  mountHomeRoutes(app, { supabase, care, callStructured, clock, links, deleteOn })

  app.get('/api/signup', limiter(60), signup.get)
  app.put('/api/signup/answers/:key', limiter(60), care.careGate(signupFreeText), signup.put)
  app.put('/api/signup/birthday', limiter(20), signup.putBirthday)
  app.put('/api/signup/name', limiter(20), care.careGate(nameFreeText), signup.putName)

  // The reading was just built and stored: seed memory from the answers, after the response.
  // Not on a replay of a stored reading: that is free at the daily cost cap, and the seed makes a model call.
  const seedMemory = (userId, answers) => {
    const log = (what, detail) => console.error(`[Memory] ${what}`, detail?.message || '')
    scheduleMemory(() => seedFromSignup({ supabase, callStructured, userId, answers, log, clock, isCapped: cap.isCapped }), log)
  }
  const building = new Map()
  const storedReading = async (userId) => {
    const { data, error } = await supabase.from('founder_profiles').select('first_reading').eq('user_id', userId).maybeSingle()
    if (error) throw error
    return data?.first_reading ?? null
  }

  // Reads the stored answers; the founder sends no text here, so no care gate,
  // but no reading while care is open.
  app.post('/api/first-reading', limiter(5), care.careHold, cap(stored.firstReading), async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'Service not configured' })
    try {
      const { answers, next } = await signup.view(req.user.id)
      if (next) return res.status(409).json({ error: 'Sign-up is not finished', code: 'signup_unfinished', next })
      const stored = await storedReading(req.user.id)
      if (stored) return res.json(stored)
      // One build per founder at a time, so two taps never show two readings.
      if (!building.has(req.user.id)) {
        const build = (async () => {
          const { reading, source } = await createFirstReading({
            answers,
            deps: {
              callStructured,
              userId: req.user.id,
              log: (what, detail) => console.error(`[FirstReading] ${what}`, detail?.message || detail?.problems || ''),
            },
          })
          // A fallback is shown but not kept, so the next open tries for a real reading.
          if (source === 'fallback') return reading
          // Only the first writer wins; whoever reads back gets the stored one.
          const { data: changed, error } = await supabase.from('founder_profiles')
            .update({ first_reading: reading }).eq('user_id', req.user.id).is('first_reading', null).select('user_id')
          if (error) throw error
          // Seed only when this write changed a row: a second writer must not seed twice.
          if ((changed ?? []).length > 0) seedMemory(req.user.id, answers)
          return (await storedReading(req.user.id)) ?? reading
        })().finally(() => building.delete(req.user.id))
        building.set(req.user.id, build)
      }
      return res.json(await building.get(req.user.id))
    } catch (error) {
      console.error('[FirstReading] failed', error?.message || error)
      return res.status(500).json({ error: 'Failed to build the first reading' })
    }
  })
}
