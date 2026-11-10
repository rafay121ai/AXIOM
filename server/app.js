import express from 'express'
import cors from 'cors'
import rateLimit from 'express-rate-limit'
import { createUsageLogger } from './modelUsage.js'
import { resolveDailyCap, sumChargesPaged, keysetOrFilter, dailyCapGate } from './dailyCap.js'
import { callStructured } from './llm.js'
import { parseBearerToken } from './requestValidation.js'
import { mountJourneyRoutes } from './journey/routes.js'
import { mountPushRoutes } from './push/routes.js'
import { mountReviewRoutes } from './review/reviewRoutes.js'
import { createSharing } from './journey/report/sharing.js'
import { createEmbedder } from './journey/learn/retrieve.js'
import { createCare } from './care/middleware.js'

export const systemClock = Object.freeze({ now: () => Date.now() })

// Builds the Express app. Nothing is read from process.env or started here:
// clients, clock and env are injected, so tests can run it with fakes.
export function createApp({
  supabase = null,
  knowledgeSupabase = null,
  openai,
  clock = systemClock,
  env = {},
} = {}) {
  const app = express()
  // Render sits behind exactly one proxy hop; trust only that hop for req.ip.
  app.set('trust proxy', 1)

  const frontendUrl = env.FRONTEND_URL?.trim().replace(/\/$/, '')
  if (!frontendUrl) throw new Error('FRONTEND_URL is not set')

  const supabaseAdmin = supabase
  const knowledgeSupabaseAdmin = knowledgeSupabase
  const { logModelUsage } = createUsageLogger({ supabase: supabaseAdmin })
  const callStructuredForApp = (args) => callStructured({ openai, logModelUsage, clock, ...args })
  // Care that begins after a share takes the founder's shares down.
  const careSharing = supabaseAdmin ? createSharing({ supabase: supabaseAdmin, clock }) : null
  const care = createCare({
    supabase: supabaseAdmin,
    callStructured: callStructuredForApp,
    clock,
    onCare: careSharing && (({ userId }) => careSharing.takeDownForCare(userId)),
  })
  // Read by the push scheduler: no pushes while a care event is open.
  app.locals.isCareOpen = care.isCareOpen


  const allowedOrigins = new Set([
    frontendUrl,
    ...String(env.FRONTEND_URLS || '')
      .split(',')
      .map((origin) => origin.trim().replace(/\/$/, ''))
      .filter(Boolean),
  ])

  function corsOrigin(origin, callback) {
    // Allow non-browser requests: the phone app, Render health checks.
    if (!origin) return callback(null, true)

    const normalizedOrigin = origin.trim().replace(/\/$/, '')
    if (allowedOrigins.has(normalizedOrigin)) return callback(null, true)

    const err = new Error('CORS blocked origin')
    err.code = 'CORS_BLOCKED'
    return callback(err)
  }


  // True when the founder has spent the cap since 00:00 UTC. Fails open if the lookup errors (logged).
  function isOverCap(userId) {
    if (!supabaseAdmin) return Promise.resolve(false)
    return resolveDailyCap(userId, (id, since) => sumChargesPaged(async (cursor, pageSize) => {
      let query = supabaseAdmin
        .from('model_usage_logs')
        .select('id, created_at, estimated_cost_usd')
        .eq('user_id', id)
        .gte('created_at', since)
      if (cursor) query = query.or(keysetOrFilter(cursor))
      const { data, error } = await query
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(pageSize)
      if (error) throw new Error(error.message)
      return data
    }), new Date(clock.now()))
  }

  // ─── Auth middleware ──────────────────────────────────────────────────────────

  async function requireAuth(req, res, next) {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Auth service not configured' })
    const token = parseBearerToken(req.headers.authorization)
    if (!token) return res.status(401).json({ error: 'Unauthorized' })
    try {
      const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)
      if (error || !user) return res.status(401).json({ error: 'Unauthorized' })
      req.user = user
    } catch (err) {
      console.error('[Auth] getUser failed:', err)
      return res.status(503).json({ error: 'Auth service unavailable' })
    }
    next()
  }

  // ─── Rate limiters ────────────────────────────────────────────────────────────

  // Flood protection only; per-user limits do the real throttling. Relies on
  // `trust proxy 1` above, which assumes exactly one proxy hop (Render).
  // Re-check that setting if a CDN or other proxy is ever added in front.
  const ipRateLimit = rateLimit({
    windowMs: 60 * 1000,
    max: 2000,
    message: { error: 'That is too many at once. Wait a minute.' },
    standardHeaders: true,
    legacyHeaders: false,
  })

  // ─── Global middleware ────────────────────────────────────────────────────────

  const corsOptions = {
    origin: corsOrigin,
    credentials: true,
  }

  app.use(cors(corsOptions))
  app.options('*', cors(corsOptions))

  // Coarse per-IP limit runs before auth so unauthenticated floods never reach Supabase.
  app.use('/api', ipRateLimit)
  app.use(express.json({ limit: '1mb' }))
  app.use('/api/signup', requireAuth)
  app.use('/api/first-reading', requireAuth)
  app.use('/api/situations', requireAuth)
  app.use('/api/learn', requireAuth)
  app.use('/api/moves', requireAuth)
  app.use('/api/reports', requireAuth)
  app.use('/api/settings', requireAuth)
  app.use('/api/home', requireAuth)
  app.use('/api/history', requireAuth)
  app.use('/api/memory', requireAuth)
  app.use('/api/account', requireAuth)
  app.use('/api/push', requireAuth)
  app.use('/api/loading-hint', requireAuth)

  // ─── Routes ───────────────────────────────────────────────────────────────────

  app.get('/health', (_req, res) => {
    res.json({ ok: true })
  })

  function isAdminUser(user) {
    const allowed = String(env.ADMIN_USER_IDS || env.ADMIN_EMAILS || '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
    if (!allowed.length) return false
    // Emails are only trusted once confirmed; ids always are.
    return allowed.includes(String(user?.id || '').toLowerCase()) ||
      (Boolean(user?.email_confirmed_at) && allowed.includes(String(user?.email || '').toLowerCase()))
  }

  mountJourneyRoutes(app, {
    supabase: supabaseAdmin,
    knowledgeSupabase: knowledgeSupabaseAdmin,
    embed: createEmbedder({ openai, logModelUsage, clock }),
    care,
    cap: dailyCapGate({ isCapped: isOverCap, isAdmin: isAdminUser }),
    callStructured: callStructuredForApp,
    clock,
    deleteOn: env.ACCOUNT_DELETE === 'on',
    // Test accounts (ADMIN_USER_IDS / ADMIN_EMAILS) skip the daily limit on new situations (Rafay, Nov 2).
    noDailyLimit: isAdminUser,
    links: { privacy: env.PRIVACY_URL?.trim() || null, terms: env.TERMS_URL?.trim() || null },
  })
  mountPushRoutes(app, { supabase: supabaseAdmin, clock })
  mountReviewRoutes(app, { supabase: supabaseAdmin, callStructured: callStructuredForApp, clock, env, requireAuth })

  // Final error handler: fixed messages only, details stay in server logs.
  app.use((err, _req, res, _next) => {
    if (res.headersSent) return res.end()
    if (err?.code === 'CORS_BLOCKED') return res.status(403).json({ error: 'Origin not allowed' })
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON' })
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large' })
    console.error('[Server] Unhandled request error:', err)
    return res.status(500).json({ error: 'Internal server error' })
  })

  return app
}
