import express from 'express'
import cors from 'cors'
import rateLimit from 'express-rate-limit'
import { validateExperimentQuality } from './experimentQuality.js'
import { createUsageLogger } from './modelUsage.js'
import { createEventTracker, PRODUCT_EVENTS, toReportedOutcome, shouldEmitExperimentReported } from './productEvents.js'
import { summarizeUsage } from './usageSummary.js'
import { resolveDailyCap, sumChargesPaged, keysetOrFilter, STREAM_INTERRUPTED_MARKER, CLIENT_ABORTED_MARKER, CHAT_MAX_COMPLETION_TOKENS } from './dailyCap.js'
import { ALLOWED_CLIENT_MODELS, MODELS } from './config.js'
import { callStructured } from './llm.js'
import { mountJourneyRoutes } from './journey/routes.js'
import { createEmbedder } from './journey/learn/retrieve.js'
import { createCare, bodyFields, lastUserMessage, founderMessageContent, onboardingAnswers, profileFreeText } from './care/middleware.js'
import { capExperimentMetadata } from './writeValidation.js'
import {
  cleanAppSessionStart,
  cleanMessageCreate,
  cleanMessageUpdate,
  decideMessageAccess,
  isThreadOwnedBy,
  cleanThreadPayload,
  cleanMessagesSentAmount,
  cleanOnboardingPayload,
  cleanFounderProfilePayload,
  normalizeReportTime,
  cleanSessionMemoryPayload,
  isExperimentExpired,
  isUuid,
} from './writeValidation.js'
import {
  validateChatMessages,
  isAllowedResponseFormat,
  validateEmbeddingInput,
  parseBearerToken,
  upstreamErrorStatus,
} from './requestValidation.js'

export const systemClock = Object.freeze({ now: () => Date.now() })

function getJwtRole(token) {
  try {
    const [, payload] = String(token || '').split('.')
    if (!payload) return null
    const decoded = Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    return JSON.parse(decoded)?.role || null
  } catch {
    return null
  }
}

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
  // Railway sits behind exactly one proxy hop; trust only that hop for req.ip.
  app.set('trust proxy', 1)

  const frontendUrl = env.FRONTEND_URL?.trim().replace(/\/$/, '')
  if (!frontendUrl) throw new Error('FRONTEND_URL is not set')

  const supabaseAdmin = supabase
  const knowledgeSupabaseAdmin = knowledgeSupabase
  const hasAppServiceRoleKey = getJwtRole(env.SUPABASE_SERVICE_ROLE_KEY) === 'service_role'
  const trackEvent = createEventTracker({ supabase: supabaseAdmin })
  const { logModelUsage } = createUsageLogger({ supabase: supabaseAdmin })
  const callStructuredForApp = (args) => callStructured({ openai, logModelUsage, clock, ...args })
  const care = createCare({
    supabase: supabaseAdmin,
    callStructured: callStructuredForApp,
    clock,
  })
  // Read by the push scheduler: no pushes while a care event is open.
  app.locals.isCareOpen = care.isCareOpen


  const allowedOrigins = new Set([
    frontendUrl,
    'https://axiom-delta-pied.vercel.app',
    ...String(env.FRONTEND_URLS || '')
      .split(',')
      .map((origin) => origin.trim().replace(/\/$/, ''))
      .filter(Boolean),
  ])

  function corsOrigin(origin, callback) {
    // Allow non-browser requests like Railway health checks or server-to-server probes.
    if (!origin) return callback(null, true)

    const normalizedOrigin = origin.trim().replace(/\/$/, '')
    if (allowedOrigins.has(normalizedOrigin)) return callback(null, true)

    const err = new Error('CORS blocked origin')
    err.code = 'CORS_BLOCKED'
    return callback(err)
  }


  const BROWSER_TRACKABLE_EVENTS = new Set([
    'onboarding_completed',
    'chat_started',
    'message_sent',
    'thread_resumed',
  ])

  function queueModelUsageLog(payload) {
    logModelUsage(payload).catch((err) => {
      console.error('[Usage Log]', err.message || err)
    })
  }

  // Daily cost cap. Returns the capped body when the founder has spent the cap
  // since 00:00 UTC, else null. Fails open if the lookup errors (logged).
  function getDailyCapResponse(userId) {
    if (!supabaseAdmin) return Promise.resolve(null)
    return resolveDailyCap(userId, (id, since) => sumChargesPaged(async (cursor, pageSize) => {
      let query = supabaseAdmin
        .from('model_usage_logs')
        .select('id, created_at, estimated_cost_usd, model, error, error_details')
        .eq('user_id', id)
        .gte('created_at', since)
      if (cursor) query = query.or(keysetOrFilter(cursor))
      const { data, error } = await query
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(pageSize)
      if (error) throw new Error(error.message)
      return data
    }))
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

  const chatRateLimit = rateLimit({
    windowMs: 60 * 1000,
    // One user message can fan out into query expansion, routing,
    // final answer streaming, and memory updates. Keep abuse protection without
    // throttling normal Axiom turns.
    max: 120,
    keyGenerator: (req) => req.user.id,
    message: { error: 'Too many requests, please slow down.' },
    standardHeaders: true,
    legacyHeaders: false,
  })

  const embeddingsRateLimit = rateLimit({
    windowMs: 60 * 1000,
    max: 180,
    keyGenerator: (req) => req.user.id,
    message: { error: 'Too many requests, please slow down.' },
    standardHeaders: true,
    legacyHeaders: false,
  })

  const knowledgeWriteRateLimit = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    keyGenerator: (req) => req.user.id,
    message: { error: 'Too many knowledge updates, please slow down.' },
    standardHeaders: true,
    legacyHeaders: false,
  })

  const experimentWriteRateLimit = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    keyGenerator: (req) => req.user.id,
    message: { error: 'Too many experiment updates, please slow down.' },
    standardHeaders: true,
    legacyHeaders: false,
  })

  const onboardingRateLimit = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    keyGenerator: (req) => req.user.id,
    message: { error: 'Too many requests, please slow down.' },
    standardHeaders: true,
    legacyHeaders: false,
  })

  // App session ping/close/start plus per-turn session writes (touch, memory).
  const sessionWriteRateLimit = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    keyGenerator: (req) => req.user.id,
    message: { error: 'Too many requests, please slow down.' },
    standardHeaders: true,
    legacyHeaders: false,
  })

  // Message and thread writes: one per chat turn plus edits, so a higher cap.
  const messageWriteRateLimit = rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    keyGenerator: (req) => req.user.id,
    message: { error: 'Too many requests, please slow down.' },
    standardHeaders: true,
    legacyHeaders: false,
  })

  const founderProfileRateLimit = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    keyGenerator: (req) => req.user.id,
    message: { error: 'Too many requests, please slow down.' },
    standardHeaders: true,
    legacyHeaders: false,
  })

  // Flood protection only; per-user limits do the real throttling. Relies on
  // `trust proxy 1` (line 44), which assumes exactly one proxy hop (Railway).
  // Re-check that setting if a CDN or other proxy is ever added in front.
  const ipRateLimit = rateLimit({
    windowMs: 60 * 1000,
    max: 2000,
    message: { error: 'Too many requests, please slow down.' },
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
  app.use('/api/openai', requireAuth)
  app.use('/api/session', requireAuth)
  app.use('/api/knowledge', requireAuth)
  app.use('/api/experiments', requireAuth)
  app.use('/api/personal-memories', requireAuth)
  app.use('/api/admin', requireAuth)
  app.use('/api/events', requireAuth)
  app.use('/api/onboarding', requireAuth)
  app.use('/api/app-sessions', requireAuth)
  app.use('/api/threads', requireAuth)
  app.use('/api/messages', requireAuth)
  app.use('/api/founder-profile', requireAuth)
  app.use('/api/signup', requireAuth)
  app.use('/api/first-reading', requireAuth)
  app.use('/api/situations', requireAuth)
  app.use('/api/learn', requireAuth)
  app.use('/api/moves', requireAuth)
  app.use('/api/reports', requireAuth)
  app.use('/api/settings', requireAuth)
  app.use('/api/loading-hint', requireAuth)

  // ─── Routes ───────────────────────────────────────────────────────────────────

  app.get('/health', (_req, res) => {
    res.json({ ok: true })
  })

  const EVENT_PROPERTY_KEYS = {
    onboarding_completed: ['answer_count'],
    chat_started: ['session_id', 'thread_id'],
    thread_resumed: ['session_id', 'thread_id'],
    message_sent: ['session_id', 'thread_id', 'message_id'],
  }
  const EVENT_STRING_MAX = 200
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

  const eventsRateLimit = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    keyGenerator: (req) => req.user.id,
    message: { error: 'Too many requests, please slow down.' },
    standardHeaders: true,
    legacyHeaders: false,
  })

  async function sanitizeEventProperties(userId, event, raw) {
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
    const clean = {}
    for (const key of EVENT_PROPERTY_KEYS[event] || []) {
      const value = source[key]
      if (typeof value === 'string') clean[key] = value.slice(0, EVENT_STRING_MAX)
      else if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) clean[key] = value
    }

    // Browser-supplied ids must belong to the caller, otherwise drop them.
    const { session_id: sessionId, thread_id: threadId, message_id: messageId } = clean
    if (sessionId !== undefined || threadId !== undefined || messageId !== undefined) {
      let sessionOk = false
      if (typeof sessionId === 'string' && UUID_PATTERN.test(sessionId) && supabaseAdmin) {
        const { data, error } = await supabaseAdmin
          .from('sessions')
          .select('user_id')
          .eq('id', sessionId)
          .maybeSingle()
        if (error) console.error('[Events] session lookup failed', { event, sessionId, error })
        sessionOk = !error && data?.user_id === userId
      }
      if (!sessionOk) {
        delete clean.session_id
        delete clean.thread_id
        delete clean.message_id
      } else {
        if (threadId !== undefined) {
          const { data, error } = typeof threadId === 'string' && UUID_PATTERN.test(threadId)
            ? await supabaseAdmin
              .from('conversation_threads')
              .select('id')
              .eq('id', threadId)
              .eq('session_id', sessionId)
              .maybeSingle()
            : { data: null, error: null }
          if (error) console.error('[Events] thread lookup failed', { event, threadId, error })
          if (error || !data) delete clean.thread_id
        }
        if (messageId !== undefined) {
          const { data, error } = typeof messageId === 'string' && UUID_PATTERN.test(messageId)
            ? await supabaseAdmin
              .from('messages')
              .select('id')
              .eq('id', messageId)
              .eq('session_id', sessionId)
              .maybeSingle()
            : { data: null, error: null }
          if (error) console.error('[Events] message lookup failed', { event, messageId, error })
          if (error || !data) delete clean.message_id
        }
      }
    }
    return clean
  }

  app.post('/api/events', eventsRateLimit, async (req, res) => {
    const event = typeof req.body?.event === 'string' ? req.body.event.trim() : ''

    if (!BROWSER_TRACKABLE_EVENTS.has(event) || !PRODUCT_EVENTS.includes(event)) {
      return res.status(400).json({ error: 'Invalid product event' })
    }

    const properties = await sanitizeEventProperties(req.user.id, event, req.body?.properties)
    await trackEvent(req.user.id, event, properties)
    return res.status(202).json({ accepted: true })
  })

  const CONCEPT_STATES = new Set(['encountered', 'partial', 'absorbed'])
  const PERSONAL_MEMORY_TYPES = new Set([
    'goal',
    'pattern',
    'belief',
    'experiment_result',
    'preference',
    'decision',
    'fact',
  ])
  const PERSONAL_MEMORY_PILLARS = new Set([
    'human_mind',
    'money_game',
    'how_companies_win',
    'whats_coming',
    'think_sharper',
    'move_people',
  ])

  function cleanConceptStateRows(rows, userId) {
    if (!Array.isArray(rows)) return []

    return rows
      .map((row) => ({
        user_id: userId,
        concept_id: typeof row?.concept_id === 'string' ? row.concept_id.trim() : '',
        state: typeof row?.state === 'string' ? row.state.trim().toLowerCase() : '',
        updated_at: new Date(clock.now()).toISOString(),
      }))
      .filter((row) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.concept_id) &&
        CONCEPT_STATES.has(row.state)
      )
      .slice(0, 60)
  }

  function normalizePersonalMemoryPillar(value) {
    const pillar = typeof value === 'string' ? value.trim() : ''
    return PERSONAL_MEMORY_PILLARS.has(pillar) ? pillar : null
  }

  function cleanEmbedding(value) {
    if (!Array.isArray(value) || value.length !== 1536) return null
    const embedding = value.map((item) => Number(item))
    return embedding.every((item) => Number.isFinite(item)) ? embedding : null
  }

  function cleanUuidList(value, limit = 30) {
    if (!Array.isArray(value)) return []
    return [...new Set(value.map((item) => String(item || '').trim()))]
      .filter((item) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item))
      .slice(0, limit)
  }

  function cleanPersonalMemory(rawMemory = {}) {
    const memory = rawMemory && typeof rawMemory === 'object' ? rawMemory : {}
    const type = String(memory.type || 'fact').trim()
    const content = String(memory.content || '').trim().replace(/\s+/g, ' ').slice(0, 1400)
    const primaryPillar = normalizePersonalMemoryPillar(memory.primary_pillar)
    const secondaryPillars = Array.isArray(memory.secondary_pillars)
      ? [...new Set(memory.secondary_pillars.map(normalizePersonalMemoryPillar).filter(Boolean))]
        .filter((pillar) => pillar !== primaryPillar)
        .slice(0, 2)
      : []
    const pillarConfidence = Number(memory.pillar_confidence)
    const importance = Number(memory.importance)
    const confidence = Number(memory.confidence)

    if (!content) return null

    return {
      type: PERSONAL_MEMORY_TYPES.has(type) ? type : 'fact',
      content,
      primary_pillar: primaryPillar,
      secondary_pillars: secondaryPillars,
      pillar_confidence: Number.isFinite(pillarConfidence) ? Math.min(1, Math.max(0, pillarConfidence)) : 0.7,
      importance: Number.isFinite(importance) ? Math.min(7, Math.max(1, Math.round(importance))) : 3,
      confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0.7,
    }
  }

  async function assertSessionOwner(sessionId, userId) {
    const { data: session, error } = await supabaseAdmin
      .from('sessions')
      .select('id,user_id')
      .eq('id', sessionId)
      .single()

    if (error || !session) return { ok: false, status: 404, error: 'Session not found' }
    if (session.user_id !== userId) return { ok: false, status: 403, error: 'Forbidden' }
    return { ok: true, session }
  }

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

  async function countRows(client, table, query = (q) => q) {
    if (!client) return null
    const { count, error } = await query(client.from(table).select('*', { count: 'exact', head: true }))
    if (error) return { error: error.message }
    return count || 0
  }

  async function getKnowledgeIntegrity() {
    if (!knowledgeSupabaseAdmin) return { configured: false }

    const [
      chunkCount,
      sourceCount,
      missingSourceId,
      learningMapCount,
    ] = await Promise.all([
      countRows(knowledgeSupabaseAdmin, 'wiki_chunks'),
      countRows(knowledgeSupabaseAdmin, 'wiki_sources'),
      countRows(knowledgeSupabaseAdmin, 'wiki_chunks', (q) => q.is('source_id', null)),
      countRows(knowledgeSupabaseAdmin, 'source_learning_maps'),
    ])

    let orphanChunkCount = 0
    let orphanLearningMapCount = 0
    try {
      const { data: sources } = await knowledgeSupabaseAdmin.from('wiki_sources').select('id')
      const sourceIds = new Set((sources || []).map((source) => source.id))
      const { data: chunks } = await knowledgeSupabaseAdmin.from('wiki_chunks').select('source_id').not('source_id', 'is', null)
      orphanChunkCount = (chunks || []).filter((chunk) => !sourceIds.has(chunk.source_id)).length
      const { data: maps } = await knowledgeSupabaseAdmin.from('source_learning_maps').select('source_id')
      orphanLearningMapCount = (maps || []).filter((map) => !sourceIds.has(map.source_id)).length
    } catch (error) {
      return {
        configured: true,
        chunkCount,
        sourceCount,
        missingSourceId,
        learningMapCount,
        integrity_error: error.message,
      }
    }

    return {
      configured: true,
      chunkCount,
      sourceCount,
      missingSourceId,
      orphanChunkCount,
      learningMapCount,
      orphanLearningMapCount,
    }
  }

  function normalizeExperimentPillarForStorage(pillar) {
    const normalized = String(pillar || '')
      .trim()
      .toLowerCase()
      .replace(/[’']/g, '')
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')

    const aliases = {
      the_human_mind: 'human_mind',
      human_mind: 'human_mind',
      money_game: 'money_game',
      the_money_game: 'money_game',
      how_companies_win: 'how_companies_win',
      whats_coming: 'whats_coming',
      what_s_coming: 'whats_coming',
      think_sharper: 'think_sharper',
      move_people: 'move_people',
    }

    return aliases[normalized] || null
  }

  function cleanExperimentPayload(value = {}) {
    const experiment = value && typeof value === 'object' ? value : {}
    const description = String(experiment.description || '').trim().slice(0, 1200)
    const windowHours = Number(experiment.window_hours)
    const pillar = normalizeExperimentPillarForStorage(experiment.pillar)

    return {
      original: experiment,
      title: String(experiment.title || '').trim().slice(0, 120) || null,
      description,
      pillar,
      topic: String(experiment.topic || '').trim().slice(0, 120) || null,
      hypothesis: String(experiment.hypothesis || '').trim().slice(0, 1200) || null,
      window_hours: Number.isFinite(windowHours) && windowHours > 0
        ? Math.min(336, Math.round(windowHours))
        : 48,
      how_to_do_it: String(experiment.how_to_do_it || '').trim().slice(0, 2400) || null,
      real_world_example: String(experiment.real_world_example || '').trim().slice(0, 1600) || null,
      what_to_notice: String(experiment.what_to_notice || '').trim().slice(0, 1600) || null,
      success_condition: String(experiment.success_condition || '').trim().slice(0, 1000) || null,
    }
  }

  function cleanExperimentStatusPayload(value = {}) {
    const body = value && typeof value === 'object' ? value : {}
    const status = String(body.status || '').trim().toLowerCase()
    const outcome = String(body.outcome || '').trim().slice(0, 2000)
    const outcomeReason = String(body.outcome_reason || '').trim().toLowerCase()
    const allowedOutcomeReasons = new Set(['couldnt', 'didnt', 'ghosted'])

    return {
      status,
      outcome,
      outcome_reason: allowedOutcomeReasons.has(outcomeReason) ? outcomeReason : null,
    }
  }

  app.post('/api/knowledge/concept-states', knowledgeWriteRateLimit, async (req, res) => {
    if (!knowledgeSupabaseAdmin) {
      return res.status(503).json({ error: 'Knowledge service not configured' })
    }

    const rows = cleanConceptStateRows(req.body?.rows, req.user.id)
    if (rows.length === 0) {
      return res.status(400).json({ error: 'No valid concept state updates' })
    }

    try {
      const { error } = await knowledgeSupabaseAdmin
        .from('user_concept_states')
        .upsert(rows, { onConflict: 'user_id,concept_id' })

      if (error) throw error
      return res.json({
        updated: rows.length,
        states: rows.reduce((counts, row) => {
          counts[row.state] = (counts[row.state] || 0) + 1
          return counts
        }, {}),
      })
    } catch (error) {
      console.error('[Axiom knowledge] concept state write failed', error)
      return res.status(500).json({ error: 'Failed to update concept states' })
    }
  })

  app.post('/api/personal-memories', knowledgeWriteRateLimit, async (req, res) => {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Personal memory service not configured' })
    if (!hasAppServiceRoleKey) {
      return res.status(503).json({
        error: 'Personal memory service role key is invalid',
        hint: 'Set SUPABASE_SERVICE_ROLE_KEY to the main app Supabase service_role key in Railway.',
      })
    }

    const sessionId = String(req.body?.session_id || '').trim()
    const memory = cleanPersonalMemory(req.body?.memory)
    const embedding = cleanEmbedding(req.body?.embedding)

    if (!sessionId || !memory || !embedding) {
      return res.status(400).json({ error: 'Invalid personal memory payload' })
    }
    if (!UUID_PATTERN.test(sessionId)) return res.status(400).json({ error: 'Invalid session_id' })

    const ownership = await assertSessionOwner(sessionId, req.user.id)
    if (!ownership.ok) return res.status(ownership.status).json({ error: ownership.error })

    try {
      const { data: matches, error: matchError } = await supabaseAdmin.rpc('find_similar_personal_memory', {
        query_embedding: embedding,
        match_user_id: req.user.id,
        match_type: memory.type,
        similarity_threshold: 0.82,
      })

      if (matchError) throw matchError
      const existing = matches?.[0] || null

      if (existing) {
        const existingImportance = Number(existing.importance) || 1
        const existingConfidence = Number(existing.confidence) || 0.7
        const updates = {
          content: memory.content.length >= String(existing.content || '').length ? memory.content : existing.content,
          importance: Math.max(existingImportance, memory.importance),
          confidence: Math.min(1, Math.max(existingConfidence, memory.confidence)),
          primary_pillar: memory.primary_pillar || existing.primary_pillar || null,
          secondary_pillars: memory.secondary_pillars.length ? memory.secondary_pillars : existing.secondary_pillars || [],
          pillar_confidence: Math.max(Number(existing.pillar_confidence) || 0, memory.pillar_confidence || 0.7),
          embedding,
          updated_at: new Date(clock.now()).toISOString(),
        }

        const { data, error } = await supabaseAdmin
          .from('personal_memories')
          .update(updates)
          .eq('id', existing.id)
          .eq('user_id', req.user.id)
          .select()
          .single()

        if (error) throw error
        return res.json({ memory: data, action: 'updated' })
      }

      const { data, error } = await supabaseAdmin
        .from('personal_memories')
        .insert({
          session_id: sessionId,
          user_id: req.user.id,
          ...memory,
          embedding,
        })
        .select()
        .single()

      if (error) throw error
      return res.json({ memory: data, action: 'inserted' })
    } catch (error) {
      console.error('[Personal Memory] upsert failed', error)
      return res.status(500).json({ error: 'Failed to upsert personal memory' })
    }
  })

  app.get('/api/personal-memories', knowledgeWriteRateLimit, async (req, res) => {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Personal memory service not configured' })
    if (!hasAppServiceRoleKey) {
      return res.status(503).json({
        error: 'Personal memory service role key is invalid',
        hint: 'Set SUPABASE_SERVICE_ROLE_KEY to the main app Supabase service_role key in Railway.',
      })
    }

    const limit = Math.min(25, Math.max(1, Number(req.query?.limit) || 10))

    try {
      const { data, error } = await supabaseAdmin
        .from('personal_memories')
        .select('id,type,content,importance,confidence,primary_pillar,secondary_pillars,pillar_confidence,updated_at,use_count')
        .eq('user_id', req.user.id)
        .order('updated_at', { ascending: false })
        .limit(limit)

      if (error) throw error
      return res.json({ memories: data || [] })
    } catch (error) {
      console.error('[Personal Memory] list failed', error)
      return res.status(500).json({ error: 'Failed to load personal memories' })
    }
  })

  app.post('/api/personal-memories/mark-used', knowledgeWriteRateLimit, async (req, res) => {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Personal memory service not configured' })
    if (!hasAppServiceRoleKey) {
      return res.status(503).json({
        error: 'Personal memory service role key is invalid',
        hint: 'Set SUPABASE_SERVICE_ROLE_KEY to the main app Supabase service_role key in Railway.',
      })
    }

    const memoryIds = cleanUuidList(req.body?.memory_ids)
    if (memoryIds.length === 0) return res.status(400).json({ error: 'No valid memory ids' })

    try {
      const { data: memories, error: selectError } = await supabaseAdmin
        .from('personal_memories')
        .select('id,use_count')
        .eq('user_id', req.user.id)
        .in('id', memoryIds)

      if (selectError) throw selectError
      const now = new Date(clock.now()).toISOString()
      await Promise.all((memories || []).map((memory) =>
        supabaseAdmin
          .from('personal_memories')
          .update({
            use_count: Number(memory.use_count || 0) + 1,
            last_used_at: now,
          })
          .eq('id', memory.id)
          .eq('user_id', req.user.id)
      ))

      return res.json({ updated: memories?.length || 0 })
    } catch (error) {
      console.error('[Personal Memory] mark used failed', error)
      return res.status(500).json({ error: 'Failed to mark personal memories used' })
    }
  })

  const USAGE_PAGE_SIZE = 1000
  const USAGE_ROW_CAP = 50000

  // Pages through every usage row in the window, up to a hard cap.
  async function loadUsageWindow(since) {
    const rows = []
    while (rows.length < USAGE_ROW_CAP) {
      const { data, error } = await supabaseAdmin
        .from('model_usage_logs')
        .select('call_type,total_tokens,estimated_cost_usd,latency_ms,error,created_at')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(rows.length, rows.length + USAGE_PAGE_SIZE - 1)
      if (error) return { error }
      rows.push(...(data || []))
      if (!data || data.length < USAGE_PAGE_SIZE) return { data: rows, truncated: false }
    }
    return { data: rows, truncated: true }
  }

  app.get('/api/admin/diagnostics', async (req, res) => {
    if (!isAdminUser(req.user)) return res.status(403).json({ error: 'Forbidden' })
    if (!supabaseAdmin) return res.status(503).json({ error: 'Admin diagnostics not configured' })

    const since = new Date(clock.now() - 24 * 60 * 60 * 1000).toISOString()

    try {
      const [
        sessions24h,
        messages24h,
        experimentsActive,
        usageRows,
        knowledge,
      ] = await Promise.all([
        countRows(supabaseAdmin, 'sessions', (q) => q.gte('created_at', since)),
        countRows(supabaseAdmin, 'messages', (q) => q.gte('created_at', since)),
        countRows(supabaseAdmin, 'experiments', (q) => q.eq('status', 'active')),
        loadUsageWindow(since),
        getKnowledgeIntegrity(),
      ])

      const usage = usageRows.error ? [] : (usageRows.data || [])
      const usageSummary = summarizeUsage(usage)
      if (usageRows.truncated) usageSummary.truncated = true

      return res.json({
        window_hours: 24,
        app: {
          sessions_created: sessions24h,
          messages_created: messages24h,
          active_experiments: experimentsActive,
        },
        usage: usageSummary,
        knowledge,
        recent_errors: usage
          .filter((row) => row.error)
          .slice(0, 20)
          .map((row) => ({
            call_type: row.call_type,
            created_at: row.created_at,
            latency_ms: row.latency_ms,
          })),
      })
    } catch (error) {
      console.error('[Admin Diagnostics] failed', error)
      return res.status(500).json({ error: 'Failed to load diagnostics' })
    }
  })

  app.post('/api/experiments', experimentWriteRateLimit, async (req, res) => {
    if (!supabaseAdmin) {
      return res.status(503).json({ error: 'Experiment service not configured' })
    }

    const sessionId = String(req.body?.session_id || '').trim()
    const experiment = cleanExperimentPayload(req.body?.experiment)
    if (!sessionId || !experiment.description) {
      return res.status(400).json({ error: 'Missing experiment session or description' })
    }

    try {
      const { data: session, error: sessionError } = await supabaseAdmin
        .from('sessions')
        .select('id,user_id')
        .eq('id', sessionId)
        .single()

      if (sessionError || !session) {
        return res.status(404).json({ error: 'Session not found' })
      }
      if (session.user_id !== req.user.id) {
        return res.status(403).json({ error: 'Forbidden' })
      }

      const { data: existingExperiments, error: existingError } = await supabaseAdmin
        .from('experiments')
        .select('id,status')
        .eq('session_id', sessionId)
        .eq('user_id', req.user.id)

      if (existingError) throw existingError

      const activeExperiments = (existingExperiments || []).filter((item) => item.status === 'active')
      if (activeExperiments.length >= 2) {
        return res.status(409).json({ error: 'Active experiment limit reached' })
      }

      const quality = validateExperimentQuality(experiment)
      if (!quality.ok) {
        return res.status(400).json({
          rejected: true,
          reason: quality.reason,
          hint: quality.hint,
          details: quality.details || {},
        })
      }

      const assignedAt = new Date(clock.now())
      const dueAt = new Date(assignedAt.getTime() + experiment.window_hours * 3600 * 1000)

      const { data, error } = await supabaseAdmin
        .from('experiments')
        .insert({
          session_id: sessionId,
          user_id: req.user.id,
          title: experiment.title,
          description: experiment.description,
          status: 'active',
          pillar: experiment.pillar,
          topic: experiment.topic,
          window_hours: experiment.window_hours,
          reference_count: 0,
          how_to_do_it: experiment.how_to_do_it,
          real_world_example: experiment.real_world_example,
          what_to_notice: experiment.what_to_notice,
          success_condition: experiment.success_condition,
          assigned_at: assignedAt.toISOString(),
          due_at: dueAt.toISOString(),
          metadata: capExperimentMetadata(experiment.original, {
            hypothesis: experiment.hypothesis,
            quality_checked_at: assignedAt.toISOString(),
          }),
        })
        .select('*')
        .single()

      if (error) throw error

      const eventProperties = {
        experiment_id: data.id,
        session_id: data.session_id,
        pillar: data.pillar || null,
        window_hours: data.window_hours,
      }
      void trackEvent(req.user.id, 'experiment_created', eventProperties)
      void trackEvent(req.user.id, 'experiment_committed', {
        ...eventProperties,
        commit_mode: 'automatic_on_create',
      })

      return res.json({ experiment: data, session_updates: {} })
    } catch (error) {
      console.error('[Experiments] assignment failed', error)
      return res.status(500).json({ error: 'Failed to assign experiment' })
    }
  })

  app.get('/api/experiments', experimentWriteRateLimit, async (req, res) => {
    if (!supabaseAdmin) {
      return res.status(503).json({ error: 'Experiment service not configured' })
    }

    const sessionId = String(req.query?.session_id || '').trim()
    if (!sessionId) return res.status(400).json({ error: 'Missing session_id' })

    try {
      const ownership = await assertSessionOwner(sessionId, req.user.id)
      if (!ownership.ok) return res.status(ownership.status).json({ error: ownership.error })

      const limit = Math.min(50, Math.max(1, Number(req.query?.limit) || 50))
      const loadExperiments = () => supabaseAdmin
        .from('experiments')
        .select('*')
        .eq('session_id', sessionId)
        .eq('user_id', req.user.id)
        .order('assigned_at', { ascending: true })
        .limit(limit)

      let { data, error } = await loadExperiments()
      if (error) throw error

      // Lazily ghost this caller's expired active experiments (same rule and
      // fields the browser used to write). The caller can skip this while a
      // report is being clarified. No warnings, strikes or events.
      if (req.query?.skip_ghosting !== '1') {
        const nowMs = clock.now()
        const expired = (data || []).filter((item) => item.id && isExperimentExpired(item, nowMs))
        if (expired.length > 0) {
          const ghostedAt = new Date(clock.now()).toISOString()
          await Promise.all(expired.map(async ({ id }) => {
            const { error: ghostError } = await supabaseAdmin
              .from('experiments')
              .update({ status: 'ghosted', outcome_reason: 'ghosted', ghosted_at: ghostedAt })
              .eq('id', id)
              .eq('user_id', req.user.id)
              .eq('status', 'active')
            if (ghostError) console.error('[Experiments] ghosting update failed', { experiment_id: id, error: ghostError })
          }))
          const refreshed = await loadExperiments()
          if (refreshed.error) throw refreshed.error
          data = refreshed.data
        }
      }

      return res.json({ experiments: data || [] })
    } catch (error) {
      console.error('[Experiments] list failed', error)
      return res.status(500).json({ error: 'Failed to load experiments' })
    }
  })

  app.post('/api/experiments/:id/status', experimentWriteRateLimit, async (req, res) => {
    if (!supabaseAdmin) {
      return res.status(503).json({ error: 'Experiment service not configured' })
    }

    const experimentId = String(req.params.id || '').trim()
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(experimentId)) {
      return res.status(400).json({ error: 'Invalid experiment id' })
    }

    const payload = cleanExperimentStatusPayload(req.body)
    const allowedStatuses = new Set(['completed', 'cancelled', 'ghosted', 'reset', 'replaced'])
    if (!allowedStatuses.has(payload.status)) {
      return res.status(400).json({ error: 'Invalid experiment status' })
    }

    try {
      const { data: existing, error: existingError } = await supabaseAdmin
        .from('experiments')
        .select('id,session_id,user_id,status,outcome_reason')
        .eq('id', experimentId)
        .single()

      if (existingError || !existing) {
        return res.status(404).json({ error: 'Experiment not found' })
      }
      if (existing.user_id !== req.user.id) {
        return res.status(403).json({ error: 'Forbidden' })
      }

      const now = new Date(clock.now()).toISOString()
      const updates = { status: payload.status }
      if (payload.outcome_reason) updates.outcome_reason = payload.outcome_reason
      if (payload.status === 'completed') {
        updates.completed_at = now
        if (payload.outcome) updates.outcome = payload.outcome
      }
      if (payload.status === 'cancelled') {
        updates.cancelled_at = now
        if (payload.outcome) updates.outcome = payload.outcome
      }
      if (payload.status === 'ghosted') updates.ghosted_at = now

      const { data, error } = await supabaseAdmin
        .from('experiments')
        .update(updates)
        .eq('id', experimentId)
        .eq('user_id', req.user.id)
        .select('*')
        .single()

      if (error) throw error

      // New outcome comes from the request payload, so a cancel without an explicit
      // couldnt/didnt reason never emits (an old stored reason cannot leak in).
      const reportedOutcome = toReportedOutcome(payload.status, payload.outcome_reason)

      if (shouldEmitExperimentReported(existing, { status: payload.status, outcome_reason: payload.outcome_reason })) {
        void trackEvent(req.user.id, 'experiment_reported', {
          experiment_id: data.id,
          session_id: data.session_id,
          outcome: reportedOutcome,
        })
      }

      return res.json({ experiment: data, session_updates: {} })
    } catch (error) {
      console.error('[Experiments] status update failed', error)
      return res.status(500).json({ error: 'Failed to update experiment' })
    }
  })

  app.post('/api/openai/embeddings', embeddingsRateLimit, async (req, res) => {
    const startedAt = clock.now()
    const { usage_context } = req.body || {}
    const usageContext = {
      ...(usage_context && typeof usage_context === 'object' ? usage_context : {}),
      call_type: 'embedding',
    }

    try {
      const { input, model } = req.body || {}
      if (!validateEmbeddingInput(input) || (model && model !== MODELS.embedding)) {
        return res.status(400).json({ error: 'Invalid embedding request' })
      }

      const capped = await getDailyCapResponse(req.user.id)
      if (capped) return res.status(200).json(capped)

      const response = await openai.embeddings.create({
        model: MODELS.embedding,
        input,
      })
      res.json(response)
      queueModelUsageLog({
        userId: req.user.id,
        usageContext,
        model: MODELS.embedding,
        usage: response.usage,
        latencyMs: clock.now() - startedAt,
      })
    } catch (err) {
      console.error('[Embeddings]', err)
      queueModelUsageLog({
        userId: req.user?.id,
        usageContext,
        model: MODELS.embedding,
        latencyMs: clock.now() - startedAt,
        error: true,
        errorDetails: err.message || 'Embedding request failed',
      })
      res.status(upstreamErrorStatus(err)).json({ error: 'Embedding request failed' })
    }
  })

  app.post('/api/openai/chat', chatRateLimit, care.careGate(lastUserMessage), async (req, res) => {
    const {
      messages,
      stream,
      max_completion_tokens,
      model,
      response_format,
      session_id,
      thread_id,
      message_id,
      usage_context,
    } = req.body

    if (!validateChatMessages(messages)) {
      return res.status(400).json({ error: 'Invalid messages' })
    }

    if (!isAllowedResponseFormat(response_format)) {
      return res.status(400).json({ error: 'Invalid response_format' })
    }

    if (!ALLOWED_CLIENT_MODELS.includes(model)) {
      return res.status(400).json({ error: 'Invalid model' })
    }

    const safePayload = {
      model,
      messages,
      stream: stream === true,
      max_completion_tokens: Math.min(Number(max_completion_tokens) || 1000, CHAT_MAX_COMPLETION_TOKENS),
      ...(response_format ? { response_format: { type: 'json_object' } } : {}),
    }
    if (safePayload.stream) {
      safePayload.stream_options = { include_usage: true }
    }

    const capped = await getDailyCapResponse(req.user.id)
    if (capped) return res.status(200).json(capped)

    const startedAt = clock.now()
    const rawUsageContext = usage_context && typeof usage_context === 'object'
      ? usage_context
      : {}
    const usageContext = {
      ...rawUsageContext,
      session_id: rawUsageContext.session_id || rawUsageContext.sessionId || session_id || null,
      thread_id: rawUsageContext.thread_id || rawUsageContext.threadId || thread_id || null,
      message_id: rawUsageContext.message_id || rawUsageContext.messageId || message_id || null,
    }

    // Exactly one usage row per request, whatever path ends it.
    let usageLogged = false
    let loggedUsage = null
    let loggedError = null
    let clientAborted = false
    let streamStarted = false
    const logUsageOnce = () => {
      if (usageLogged) return
      usageLogged = true
      queueModelUsageLog({
        userId: req.user?.id,
        usageContext,
        model,
        usage: loggedUsage,
        latencyMs: clock.now() - startedAt,
        ...(loggedError ? { error: true, errorDetails: loggedError } : {}),
      })
    }

    try {
      if (!safePayload.stream) {
        const nonStreamAbort = new AbortController()
        res.on('close', () => {
          if (!res.writableEnded) {
            clientAborted = true
            nonStreamAbort.abort()
          }
        })
        const response = await openai.chat.completions.create(safePayload, { signal: nonStreamAbort.signal })
        loggedUsage = response.usage || null
        res.json(response)
        return
      }

      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
      res.setHeader('Cache-Control', 'no-cache, no-transform')
      res.setHeader('Connection', 'keep-alive')
      res.flushHeaders?.()

      // Stop paying for tokens nobody will read once the client goes away. The
      // controller exists before the request so a disconnect during the initial
      // wait aborts too.
      const upstreamAbort = new AbortController()
      const abortUpstream = () => {
        if (!res.writableEnded) {
          clientAborted = true
          upstreamAbort.abort()
        }
      }
      // res 'close' fires on client disconnect; req 'close' can fire early once the body is read.
      res.on('close', abortUpstream)
      const streamResp = await openai.chat.completions.create(safePayload, { signal: upstreamAbort.signal })
      let finalUsage = null

      for await (const chunk of streamResp) {
        if (chunk.usage) {
          finalUsage = chunk.usage
          loggedUsage = finalUsage
        }
        streamStarted = true
        res.write(`${JSON.stringify({ type: 'chunk', data: chunk })}\n`)
      }

      if (clientAborted) {
        loggedError = CLIENT_ABORTED_MARKER
        return
      }

      res.write(`${JSON.stringify({ type: 'done' })}\n`)
      res.end()
    } catch (err) {
      console.error('[Chat]', err)

      // Fixed markers so aborted/interrupted streams (null tokens/cost) are charged.
      // Failures before any token was sent keep their message and are charged 0.
      loggedError = clientAborted
        ? CLIENT_ABORTED_MARKER
        : (streamStarted ? STREAM_INTERRUPTED_MARKER : (err.message || 'Chat request failed'))

      if (res.headersSent) {
        res.write(`${JSON.stringify({ type: 'error', error: 'Chat request failed' })}\n`)
        res.end()
        return
      }

      res.status(upstreamErrorStatus(err)).json({ error: 'Chat request failed' })
    } finally {
      logUsageOnce()
    }
  })


  // ─── Browser writes moved behind the API ─────────────────────────────────────

  app.post('/api/onboarding/complete', onboardingRateLimit, care.careGate(onboardingAnswers), async (req, res) => {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Service not configured' })

    const payload = cleanOnboardingPayload(req.body)
    if (!payload) return res.status(400).json({ error: 'Invalid onboarding data' })
    const email = typeof req.user.email === 'string' ? req.user.email.trim() : ''
    if (!email) return res.status(400).json({ error: 'Account has no email' })

    try {
      const { error: userError } = await supabaseAdmin
        .from('users')
        .upsert({ id: req.user.id, email, first_name: payload.first_name }, { onConflict: 'id' })
      if (userError) throw userError

      const loadExisting = () => supabaseAdmin
        .from('sessions')
        .select('*')
        .eq('user_id', req.user.id)
        .maybeSingle()

      // One session per user: a retry returns the stored session untouched.
      const existing = await loadExisting()
      if (existing.error) throw existing.error
      if (existing.data) return res.json({ session: existing.data, created: false })

      const { data, error } = await supabaseAdmin
        .from('sessions')
        .insert({
          session_token: payload.session_token,
          user_id: req.user.id,
          onboarding_answers: payload.onboarding_answers,
          pillar_weights: payload.pillar_weights,
          axiom_profile: payload.axiom_profile,
        })
        .select('*')
        .single()

      if (error) {
        if (error.code === '23505') {
          const raced = await loadExisting()
          if (!raced.error && raced.data) return res.json({ session: raced.data, created: false })
        }
        throw error
      }
      return res.json({ session: data, created: true })
    } catch (error) {
      console.error('[Onboarding] complete failed', error)
      return res.status(500).json({ error: 'Failed to complete onboarding' })
    }
  })

  // Postgres returns time columns as HH:MM:SS; the client sends HH:MM.
  function normalizeProfileRow(row) {
    return row && row.report_time_local
      ? { ...row, report_time_local: normalizeReportTime(row.report_time_local) || row.report_time_local }
      : row
  }

  app.get('/api/founder-profile', founderProfileRateLimit, async (req, res) => {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Service not configured' })
    try {
      const { data, error } = await supabaseAdmin
        .from('founder_profiles')
        .select('*')
        .eq('user_id', req.user.id)
        .maybeSingle()
      if (error) throw error
      return res.json({ profile: data ? normalizeProfileRow(data) : null })
    } catch (error) {
      console.error('[FounderProfile] read failed', error)
      return res.status(500).json({ error: 'Failed to load profile' })
    }
  })

  app.put('/api/founder-profile', founderProfileRateLimit, care.careGate(profileFreeText), async (req, res) => {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Service not configured' })
    const cleaned = cleanFounderProfilePayload(req.body)
    if (!cleaned.ok) return res.status(400).json({ error: 'Invalid profile data' })

    try {
      const { data, error } = await supabaseAdmin
        .from('founder_profiles')
        .upsert(
          { ...cleaned.value, user_id: req.user.id, updated_at: new Date(clock.now()).toISOString() },
          { onConflict: 'user_id' },
        )
        .select('*')
        .single()
      if (error) throw error
      return res.json({ profile: normalizeProfileRow(data) })
    } catch (error) {
      console.error('[FounderProfile] save failed', error)
      return res.status(500).json({ error: 'Failed to save profile' })
    }
  })

  mountJourneyRoutes(app, {
    supabase: supabaseAdmin,
    knowledgeSupabase: knowledgeSupabaseAdmin,
    embed: createEmbedder({ openai, logModelUsage, clock }),
    care,
    callStructured: callStructuredForApp,
    clock,
  })

  app.post('/api/app-sessions', sessionWriteRateLimit, async (req, res) => {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Service not configured' })
    const start = cleanAppSessionStart(req.body)
    if (!start) return res.status(400).json({ error: 'Invalid app session data' })

    try {
      const { data, error } = await supabaseAdmin
        .from('app_sessions')
        .insert({
          user_id: req.user.id,
          entry_point: start.entry_point,
          last_ping_at: new Date(clock.now()).toISOString(),
          device: start.device,
        })
        .select('id, started_at')
        .single()
      if (error) throw error
      return res.json({ id: data.id, started_at: data.started_at })
    } catch (error) {
      console.error('[AppSessions] start failed', error)
      return res.status(500).json({ error: 'Failed to start app session' })
    }
  })

  app.post('/api/app-sessions/:id/ping', sessionWriteRateLimit, async (req, res) => {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Service not configured' })
    if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Invalid app session id' })

    try {
      const { error } = await supabaseAdmin
        .from('app_sessions')
        .update({ last_ping_at: new Date(clock.now()).toISOString() })
        .eq('id', req.params.id)
        .eq('user_id', req.user.id)
      if (error) throw error
      return res.json({ ok: true })
    } catch (error) {
      console.error('[AppSessions] ping failed', error)
      return res.status(500).json({ error: 'Failed to update app session' })
    }
  })

  app.post('/api/app-sessions/:id/close', sessionWriteRateLimit, async (req, res) => {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Service not configured' })
    if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Invalid app session id' })

    try {
      const { data: row, error: fetchError } = await supabaseAdmin
        .from('app_sessions')
        .select('id, started_at, ended_at')
        .eq('id', req.params.id)
        .eq('user_id', req.user.id)
        .maybeSingle()
      if (fetchError) throw fetchError
      if (!row) return res.status(404).json({ error: 'App session not found' })
      if (row.ended_at) return res.json({ ok: true })

      const endedAt = new Date(clock.now())
      const updates = { ended_at: endedAt.toISOString(), last_ping_at: endedAt.toISOString() }
      const startedMs = new Date(row.started_at).getTime()
      if (Number.isFinite(startedMs)) {
        updates.duration_seconds = Math.max(0, Math.round((endedAt.getTime() - startedMs) / 1000))
      }

      const { error } = await supabaseAdmin
        .from('app_sessions')
        .update(updates)
        .eq('id', row.id)
        .eq('user_id', req.user.id)
        .is('ended_at', null)
      if (error) throw error
      return res.json({ ok: true })
    } catch (error) {
      console.error('[AppSessions] close failed', error)
      return res.status(500).json({ error: 'Failed to close app session' })
    }
  })

  // No increment RPC exists and migrations are out of scope, so the increment is
  // a compare-and-swap on the current value, retried on contention.
  app.post('/api/app-sessions/:id/messages-sent', sessionWriteRateLimit, async (req, res) => {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Service not configured' })
    if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Invalid app session id' })
    const amount = cleanMessagesSentAmount(req.body)
    if (amount === null) return res.status(400).json({ error: 'Invalid amount' })

    try {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const { data: row, error: fetchError } = await supabaseAdmin
          .from('app_sessions')
          .select('messages_sent')
          .eq('id', req.params.id)
          .eq('user_id', req.user.id)
          .maybeSingle()
        if (fetchError) throw fetchError
        if (!row) return res.status(404).json({ error: 'App session not found' })

        const current = Number(row.messages_sent || 0)
        const { data: updated, error } = await supabaseAdmin
          .from('app_sessions')
          .update({ messages_sent: current + amount, last_ping_at: new Date(clock.now()).toISOString() })
          .eq('id', req.params.id)
          .eq('user_id', req.user.id)
          .eq('messages_sent', current)
          .select('messages_sent')
        if (error) throw error
        if (updated?.length) return res.json({ messages_sent: updated[0].messages_sent })
      }
      return res.status(409).json({ error: 'Please retry' })
    } catch (error) {
      console.error('[AppSessions] messages-sent failed', error)
      return res.status(500).json({ error: 'Failed to update app session' })
    }
  })

  app.post('/api/session/:id/touch', sessionWriteRateLimit, async (req, res) => {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Service not configured' })
    if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Invalid session id' })

    try {
      const { data, error } = await supabaseAdmin
        .from('sessions')
        .update({ last_active: new Date(clock.now()).toISOString() })
        .eq('id', req.params.id)
        .eq('user_id', req.user.id)
        .select('id')
      if (error) throw error
      if (!data?.length) return res.status(404).json({ error: 'Session not found' })
      return res.json({ ok: true })
    } catch (error) {
      console.error('[Session] touch failed', error)
      return res.status(500).json({ error: 'Failed to update session' })
    }
  })

  app.post('/api/session/:id/memory', sessionWriteRateLimit, async (req, res) => {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Service not configured' })
    if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Invalid session id' })
    const updates = cleanSessionMemoryPayload(req.body)
    if (!updates) return res.status(400).json({ error: 'Invalid session memory data' })

    try {
      const { data, error } = await supabaseAdmin
        .from('sessions')
        .update(updates)
        .eq('id', req.params.id)
        .eq('user_id', req.user.id)
        .select('id')
      if (error) throw error
      if (!data?.length) return res.status(404).json({ error: 'Session not found' })
      return res.json({ ok: true })
    } catch (error) {
      console.error('[Session] memory update failed', error)
      return res.status(500).json({ error: 'Failed to update session' })
    }
  })

  // ─── Threads and messages (browser writes moved behind the API) ─────────────

  async function ownsSession(userId, sessionId) {
    const { data, error } = await supabaseAdmin
      .from('sessions')
      .select('id')
      .eq('id', sessionId)
      .eq('user_id', userId)
      .maybeSingle()
    if (error) throw error
    return Boolean(data)
  }

  // Idempotent on id: an existing thread owned by the caller is returned as is.
  app.post('/api/threads', messageWriteRateLimit, care.careGate(bodyFields('title')), async (req, res) => {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Service not configured' })
    const payload = cleanThreadPayload(req.body)
    if (!payload) return res.status(400).json({ error: 'Invalid thread data' })

    try {
      if (!(await ownsSession(req.user.id, payload.session_id))) {
        return res.status(404).json({ error: 'Session not found' })
      }

      if (payload.id) {
        const { data: existing, error: existingError } = await supabaseAdmin
          .from('conversation_threads')
          .select('id, user_id, session_id')
          .eq('id', payload.id)
          .maybeSingle()
        if (existingError) throw existingError
        if (existing) {
          if (!isThreadOwnedBy(existing, req.user.id, payload.session_id)) {
            return res.status(404).json({ error: 'Thread not found' })
          }
          return res.json({ id: existing.id })
        }
      }

      const now = new Date(clock.now()).toISOString()
      const row = {
        user_id: req.user.id,
        session_id: payload.session_id,
        title: payload.title,
        primary_pillar: payload.primary_pillar,
        started_at: now,
        last_message_at: now,
        status: 'active',
        updated_at: now,
      }
      if (payload.id) row.id = payload.id
      const { data, error } = await supabaseAdmin
        .from('conversation_threads')
        .insert(row)
        .select('id')
        .single()
      if (error) throw error
      return res.json({ id: data.id })
    } catch (error) {
      console.error('[Threads] create failed', error)
      return res.status(500).json({ error: 'Failed to create thread' })
    }
  })

  // Server inserts still hit the table, so sync_conversation_thread_from_message fires.
  app.post('/api/messages', messageWriteRateLimit, care.careGate(founderMessageContent), async (req, res) => {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Service not configured' })
    const payload = cleanMessageCreate(req.body)
    if (!payload) return res.status(400).json({ error: 'Invalid message data' })

    try {
      if (!(await ownsSession(req.user.id, payload.session_id))) {
        return res.status(404).json({ error: 'Session not found' })
      }
      if (payload.thread_id) {
        const { data: thread, error: threadError } = await supabaseAdmin
          .from('conversation_threads')
          .select('id')
          .eq('id', payload.thread_id)
          .eq('session_id', payload.session_id)
          .eq('user_id', req.user.id)
          .maybeSingle()
        if (threadError) throw threadError
        if (!thread) return res.status(404).json({ error: 'Thread not found' })
      }

      const { data, error } = await supabaseAdmin
        .from('messages')
        .insert(payload)
        .select('id, created_at')
        .single()
      if (error) throw error
      return res.json(data)
    } catch (error) {
      console.error('[Messages] create failed', error)
      return res.status(500).json({ error: 'Failed to save message' })
    }
  })

  // Loads a message and its session, then lets the pure decision rule answer.
  async function loadMessageAccess(userId, messageId, action) {
    const { data: message, error } = await supabaseAdmin
      .from('messages')
      .select('id, role, session_id')
      .eq('id', messageId)
      .maybeSingle()
    if (error) throw error
    let session = null
    if (message?.session_id) {
      const { data, error: sessionError } = await supabaseAdmin
        .from('sessions')
        .select('id, user_id')
        .eq('id', message.session_id)
        .maybeSingle()
      if (sessionError) throw sessionError
      session = data
    }
    return { message, decision: decideMessageAccess({ message, session, userId, action }) }
  }

  app.patch('/api/messages/:id', messageWriteRateLimit, care.careGate(founderMessageContent), async (req, res) => {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Service not configured' })
    if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Invalid message id' })

    try {
      const { message, decision } = await loadMessageAccess(req.user.id, req.params.id, 'update')
      if (!decision.allowed) return res.status(decision.status).json({ error: 'Message not found' })
      const updates = cleanMessageUpdate(req.body, message.role)
      if (!updates) return res.status(400).json({ error: 'Invalid message update' })

      const { error } = await supabaseAdmin
        .from('messages')
        .update(updates)
        .eq('id', message.id)
      if (error) throw error
      return res.json({ ok: true })
    } catch (error) {
      console.error('[Messages] update failed', error)
      return res.status(500).json({ error: 'Failed to update message' })
    }
  })

  // The browser only deletes assistant replies (regenerate and edit).
  app.delete('/api/messages/:id', messageWriteRateLimit, async (req, res) => {
    if (!supabaseAdmin) return res.status(503).json({ error: 'Service not configured' })
    if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Invalid message id' })

    try {
      const { message, decision } = await loadMessageAccess(req.user.id, req.params.id, 'delete')
      if (!decision.allowed) {
        return res.status(decision.status).json({
          error: decision.status === 403 ? 'Message cannot be deleted' : 'Message not found',
        })
      }

      const { error } = await supabaseAdmin.from('messages').delete().eq('id', message.id)
      if (error) throw error
      return res.json({ ok: true })
    } catch (error) {
      console.error('[Messages] delete failed', error)
      return res.status(500).json({ error: 'Failed to delete message' })
    }
  })

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
