import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
dotenv.config({ path: resolve(__dirname, '../.env') })

import express from 'express'
import cors from 'cors'
import OpenAI from 'openai'
import { createClient } from '@supabase/supabase-js'
import rateLimit from 'express-rate-limit'
import { validateExperimentQuality } from './experimentQuality.js'
import { estimateModelCost, USAGE_CALL_TYPES } from './modelUsage.js'
import { createEventTracker, PRODUCT_EVENTS } from './productEvents.js'

const app = express()
const port = process.env.PORT || 3001

const frontendUrl = process.env.FRONTEND_URL?.trim().replace(/\/$/, '')
if (!frontendUrl) {
  console.error('FATAL: FRONTEND_URL environment variable is not set')
  process.exit(1)
}

const allowedOrigins = new Set([
  frontendUrl,
  'https://axiom-delta-pied.vercel.app',
  ...String(process.env.FRONTEND_URLS || '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean),
])

function corsOrigin(origin, callback) {
  // Allow non-browser requests like Railway health checks or server-to-server probes.
  if (!origin) return callback(null, true)

  const normalizedOrigin = origin.trim().replace(/\/$/, '')
  if (allowedOrigins.has(normalizedOrigin)) return callback(null, true)
  if (/^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(normalizedOrigin)) return callback(null, true)

  return callback(new Error(`CORS blocked origin: ${origin}`))
}

// Exact model IDs the client is allowed to request. Anything else is rejected.
const ALLOWED_MODELS = [
  'gpt-5.2-2025-12-11',
  'gpt-5.2',
  'gpt-5.4-mini-2026-03-17',
  'gpt-5.4-mini',
  'gpt-4.1-mini',
  'gpt-4.1-mini-2025-04-14',
]

const openaiApiKey = process.env.OPENAI_API_KEY

if (!openaiApiKey) {
  console.warn('[Axiom API] Missing OPENAI_API_KEY')
}

const openai = new OpenAI({
  apiKey: openaiApiKey,
})

const USAGE_CALL_TYPE_SET = new Set(USAGE_CALL_TYPES)
const BROWSER_TRACKABLE_EVENTS = new Set([
  'onboarding_completed',
  'chat_started',
  'message_sent',
  'thread_resumed',
])

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

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

const supabaseServiceKeyRole = getJwtRole(supabaseServiceKey)
const hasAppServiceRoleKey = supabaseServiceKeyRole === 'service_role'

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn('[Axiom API] Missing Supabase credentials — auth and jailbreak endpoints will not function')
} else if (!hasAppServiceRoleKey) {
  console.warn('[Axiom API] SUPABASE_SERVICE_ROLE_KEY is not a service_role key — server-owned writes may fail RLS')
}

const supabaseAdmin = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null
const trackEvent = createEventTracker({ supabase: supabaseAdmin })

const knowledgeSupabaseUrl = process.env.VITE_KNOWLEDGE_SUPABASE_URL
const knowledgeSupabaseServiceKey = process.env.KNOWLEDGE_SUPABASE_SERVICE_ROLE_KEY

if (!knowledgeSupabaseUrl || !knowledgeSupabaseServiceKey) {
  console.warn('[Axiom API] Missing knowledge Supabase service credentials — knowledge writes will not function')
}

const knowledgeSupabaseAdmin = knowledgeSupabaseUrl && knowledgeSupabaseServiceKey
  ? createClient(knowledgeSupabaseUrl, knowledgeSupabaseServiceKey)
  : null

function queueModelUsageLog(payload) {
  logModelUsage(payload).catch((err) => {
    console.error('[Usage Log]', err.message || err)
  })
}

async function logModelUsage({
  userId,
  usageContext = {},
  model,
  usage = {},
  latencyMs = null,
  error = false,
  errorDetails = null,
}) {
  if (!supabaseAdmin || !userId || !model) return

  const callType = USAGE_CALL_TYPE_SET.has(usageContext.call_type)
    ? usageContext.call_type
    : 'chat'
  const promptTokens = Number(usage.prompt_tokens || 0)
  const completionTokens = Number(usage.completion_tokens || 0)
  const totalTokens = Number(usage.total_tokens || promptTokens + completionTokens || 0)

  const { data, error: insertError } = await supabaseAdmin
    .from('model_usage_logs')
    .insert({
      user_id: userId,
      session_id: usageContext.session_id || null,
      thread_id: usageContext.thread_id || null,
      message_id: usageContext.message_id || null,
      model,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens,
      estimated_cost_usd: estimateModelCost(model, {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
      }),
      call_type: callType,
      rag_chunks_used: Number(usageContext.rag_chunks_used || 0),
      latency_ms: latencyMs,
      error,
      error_details: errorDetails ? String(errorDetails).slice(0, 1000) : null,
    })
    .select('id, user_id, session_id, thread_id, message_id, model, total_tokens, estimated_cost_usd, call_type, error, created_at')
    .single()

  if (insertError) {
    console.log('[Usage Log] insert error:', insertError)
    return
  }

  console.log('[Usage Log] inserted row:', data)
}

// ─── Auth middleware ──────────────────────────────────────────────────────────

async function requireAuth(req, res, next) {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Auth service not configured' })
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return res.status(401).json({ error: 'Unauthorized' })
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !user) return res.status(401).json({ error: 'Unauthorized' })
  req.user = user
  next()
}

// ─── Rate limiters ────────────────────────────────────────────────────────────

const chatRateLimit = rateLimit({
  windowMs: 60 * 1000,
  // One user message can fan out into query expansion, routing,
  // final answer streaming, and memory updates. Keep abuse protection without
  // throttling normal Axiom turns.
  max: 120,
  message: { error: 'Too many requests, please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
})

const embeddingsRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 180,
  message: { error: 'Too many requests, please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
})

const knowledgeWriteRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many knowledge updates, please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
})

const experimentWriteRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many experiment updates, please slow down.' },
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
app.use(express.json({ limit: '1mb' }))

app.use('/api/openai', requireAuth)
app.use('/api/session', requireAuth)
app.use('/api/knowledge', requireAuth)
app.use('/api/experiments', requireAuth)
app.use('/api/personal-memories', requireAuth)
app.use('/api/admin', requireAuth)
app.use('/api/events', requireAuth)

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ ok: true })
})

app.post('/api/events', async (req, res) => {
  const event = typeof req.body?.event === 'string' ? req.body.event.trim() : ''
  const properties = req.body?.properties

  if (!BROWSER_TRACKABLE_EVENTS.has(event) || !PRODUCT_EVENTS.includes(event)) {
    return res.status(400).json({ error: 'Invalid product event' })
  }

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
      updated_at: new Date().toISOString(),
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
  const allowed = String(process.env.ADMIN_USER_IDS || process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
  if (!allowed.length) return false
  return allowed.includes(String(user?.id || '').toLowerCase()) ||
    allowed.includes(String(user?.email || '').toLowerCase())
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
        updated_at: new Date().toISOString(),
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
    const now = new Date().toISOString()
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

app.get('/api/admin/diagnostics', async (req, res) => {
  if (!isAdminUser(req.user)) return res.status(403).json({ error: 'Forbidden' })
  if (!supabaseAdmin) return res.status(503).json({ error: 'Admin diagnostics not configured' })

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

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
      supabaseAdmin
        .from('model_usage_logs')
        .select('call_type,total_tokens,estimated_cost_usd,latency_ms,error,created_at')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(200),
      getKnowledgeIntegrity(),
    ])

    const usage = usageRows.error ? [] : (usageRows.data || [])
    const usageSummary = usage.reduce((summary, row) => {
      const key = row.call_type || 'unknown'
      summary.by_call_type[key] = summary.by_call_type[key] || {
        count: 0,
        total_tokens: 0,
        estimated_cost_usd: 0,
        errors: 0,
        avg_latency_ms: 0,
      }
      const bucket = summary.by_call_type[key]
      bucket.count += 1
      bucket.total_tokens += Number(row.total_tokens || 0)
      bucket.estimated_cost_usd += Number(row.estimated_cost_usd || 0)
      bucket.errors += row.error ? 1 : 0
      bucket.avg_latency_ms += Number(row.latency_ms || 0)
      summary.total_cost_usd += Number(row.estimated_cost_usd || 0)
      summary.total_tokens += Number(row.total_tokens || 0)
      summary.errors += row.error ? 1 : 0
      return summary
    }, {
      total_calls: usage.length,
      total_tokens: 0,
      total_cost_usd: 0,
      errors: 0,
      by_call_type: {},
    })

    for (const bucket of Object.values(usageSummary.by_call_type)) {
      bucket.avg_latency_ms = bucket.count ? Math.round(bucket.avg_latency_ms / bucket.count) : 0
      bucket.estimated_cost_usd = Number(bucket.estimated_cost_usd.toFixed(6))
    }
    usageSummary.total_cost_usd = Number(usageSummary.total_cost_usd.toFixed(6))

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

    const assignedAt = new Date()
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
        metadata: {
          ...experiment.original,
          hypothesis: experiment.hypothesis,
          quality_checked_at: assignedAt.toISOString(),
        },
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
    return res.status(500).json({ error: error.message || 'Failed to assign experiment' })
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
    const { data, error } = await supabaseAdmin
      .from('experiments')
      .select('*')
      .eq('session_id', sessionId)
      .eq('user_id', req.user.id)
      .order('assigned_at', { ascending: true })
      .limit(limit)

    if (error) throw error
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
      .select('id,session_id,user_id')
      .eq('id', experimentId)
      .single()

    if (existingError || !existing) {
      return res.status(404).json({ error: 'Experiment not found' })
    }
    if (existing.user_id !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' })
    }

    const now = new Date().toISOString()
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

    const reportedOutcome = payload.status === 'completed'
      ? 'done'
      : payload.status === 'cancelled' && ['couldnt', 'didnt'].includes(payload.outcome_reason)
        ? payload.outcome_reason
        : null

    if (reportedOutcome) {
      void trackEvent(req.user.id, 'experiment_reported', {
        experiment_id: data.id,
        session_id: data.session_id,
        outcome: reportedOutcome,
      })
    }

    return res.json({ experiment: data, session_updates: {} })
  } catch (error) {
    console.error('[Experiments] status update failed', error)
    return res.status(500).json({ error: error.message || 'Failed to update experiment' })
  }
})

app.post('/api/openai/embeddings', embeddingsRateLimit, async (req, res) => {
  const startedAt = Date.now()
  const { usage_context } = req.body || {}
  const usageContext = {
    ...(usage_context && typeof usage_context === 'object' ? usage_context : {}),
    call_type: 'embedding',
  }

  try {
    const { input, model } = req.body || {}
    const inputIsValid =
      typeof input === 'string' ||
      (Array.isArray(input) && input.length > 0 && input.every((item) => typeof item === 'string'))

    if (!inputIsValid || (model && model !== 'text-embedding-3-small')) {
      return res.status(400).json({ error: 'Invalid embedding request' })
    }

    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input,
    })
    res.json(response)
    queueModelUsageLog({
      userId: req.user.id,
      usageContext,
      model: 'text-embedding-3-small',
      usage: response.usage,
      latencyMs: Date.now() - startedAt,
    })
  } catch (err) {
    console.error('[Embeddings]', err)
    queueModelUsageLog({
      userId: req.user?.id,
      usageContext,
      model: 'text-embedding-3-small',
      latencyMs: Date.now() - startedAt,
      error: true,
      errorDetails: err.message || 'Embedding request failed',
    })
    res.status(err.status || 500).json({ error: err.message || 'Embedding request failed' })
  }
})

app.post('/api/openai/chat', chatRateLimit, async (req, res) => {
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

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Invalid messages' })
  }

  if (!ALLOWED_MODELS.includes(model)) {
    return res.status(400).json({ error: 'Invalid model' })
  }

  const safePayload = {
    model,
    messages,
    stream: stream === true,
    max_completion_tokens: Math.min(Number(max_completion_tokens) || 1000, 4000),
    ...(response_format ? { response_format } : {}),
  }
  if (safePayload.stream) {
    safePayload.stream_options = { include_usage: true }
  }

  const startedAt = Date.now()
  const rawUsageContext = usage_context && typeof usage_context === 'object'
    ? usage_context
    : {}
  const usageContext = {
    ...rawUsageContext,
    session_id: rawUsageContext.session_id || rawUsageContext.sessionId || session_id || null,
    thread_id: rawUsageContext.thread_id || rawUsageContext.threadId || thread_id || null,
    message_id: rawUsageContext.message_id || rawUsageContext.messageId || message_id || null,
  }

  try {
    if (!safePayload.stream) {
      const response = await openai.chat.completions.create(safePayload)
      res.json(response)
      queueModelUsageLog({
        userId: req.user.id,
        usageContext,
        model,
        usage: response.usage,
        latencyMs: Date.now() - startedAt,
      })
      return
    }

    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders?.()

    const streamResp = await openai.chat.completions.create(safePayload)
    let streamedContent = ''
    let finalUsage = null

    for await (const chunk of streamResp) {
      if (chunk.usage) finalUsage = chunk.usage
      const delta = chunk.choices?.[0]?.delta?.content || ''
      streamedContent += delta
      res.write(`${JSON.stringify({ type: 'chunk', data: chunk })}\n`)
    }

    res.write(`${JSON.stringify({ type: 'done' })}\n`)
    res.end()

    queueModelUsageLog({
      userId: req.user.id,
      usageContext,
      model,
      usage: finalUsage,
      latencyMs: Date.now() - startedAt,
    })

    // Auto-increment jailbreak counter when AI signals a jailbreak event.
    // session_id ownership is verified before updating.
    if (session_id && supabaseAdmin) {
      const isJailbreak =
        streamedContent.includes('[JAILBREAK_REDIRECT]') ||
        streamedContent.trim() === 'AXIOM_SESSION_TERMINATED'
      if (isJailbreak) {
        supabaseAdmin
          .from('sessions')
          .select('user_id, jailbreak_attempts')
          .eq('id', session_id)
          .single()
          .then(({ data }) => {
            if (!data || data.user_id !== req.user.id) return
            return supabaseAdmin
              .from('sessions')
              .update({ jailbreak_attempts: (data.jailbreak_attempts || 0) + 1 })
              .eq('id', session_id)
          })
          .catch((err) => console.error('[Chat] Jailbreak increment failed:', err))
      }
    }
  } catch (err) {
    console.error('[Chat]', err)

    queueModelUsageLog({
      userId: req.user?.id,
      usageContext,
      model,
      latencyMs: Date.now() - startedAt,
      error: true,
      errorDetails: err.message || 'Chat request failed',
    })

    if (res.headersSent) {
      res.write(`${JSON.stringify({ type: 'error', error: err.message || 'Chat request failed' })}\n`)
      res.end()
      return
    }

    res.status(err.status || 500).json({ error: err.message || 'Chat request failed' })
  }
})


app.post('/api/session/:id/jailbreak', async (req, res) => {
  if (!supabaseAdmin) {
    return res.status(503).json({ error: 'Supabase not configured' })
  }

  const { id } = req.params

  const { data: session, error: fetchError } = await supabaseAdmin
    .from('sessions')
    .select('user_id, jailbreak_attempts')
    .eq('id', id)
    .single()

  if (fetchError) {
    console.error('[Jailbreak] Fetch error:', fetchError)
    return res.status(500).json({ error: 'Failed to fetch session' })
  }

  if (!session || session.user_id !== req.user.id) {
    return res.status(403).json({ error: 'Forbidden' })
  }

  const next = (session.jailbreak_attempts || 0) + 1

  const { error: updateError } = await supabaseAdmin
    .from('sessions')
    .update({ jailbreak_attempts: next })
    .eq('id', id)

  if (updateError) {
    console.error('[Jailbreak] Update error:', updateError)
    return res.status(500).json({ error: 'Failed to update session' })
  }

  res.json({ jailbreak_attempts: next })
})


process.on('unhandledRejection', (reason) => {
  console.error('[Server] Unhandled rejection:', reason)
})

process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught exception:', err)
  process.exit(1)
})

app.listen(port, () => {
  console.log(`[Axiom API] Listening on :${port}`)
})
