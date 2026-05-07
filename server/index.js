import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
dotenv.config({ path: resolve(__dirname, '../.env') })

import express from 'express'
import cors from 'cors'
import Exa from 'exa-js'
import OpenAI from 'openai'
import { createClient } from '@supabase/supabase-js'
import rateLimit from 'express-rate-limit'

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
])

function corsOrigin(origin, callback) {
  // Allow non-browser requests like Railway health checks or server-to-server probes.
  if (!origin) return callback(null, true)

  const normalizedOrigin = origin.trim().replace(/\/$/, '')
  if (allowedOrigins.has(normalizedOrigin)) return callback(null, true)

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

const exaApiKey = process.env.EXA_API_KEY

if (!exaApiKey) {
  console.warn('[Axiom API] Missing EXA_API_KEY — live search will not function')
}

const exa = exaApiKey ? new Exa(exaApiKey) : null
const liveSearchCache = new Map()
const LIVE_SEARCH_CACHE_TTL_MS = Math.max(
  60 * 1000,
  Number(process.env.LIVE_SEARCH_CACHE_TTL_MS) || 6 * 60 * 60 * 1000
)
const LIVE_SEARCH_MAX_RESULTS = Math.min(
  8,
  Math.max(1, Number(process.env.LIVE_SEARCH_MAX_RESULTS) || 5)
)

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn('[Axiom API] Missing Supabase credentials — auth and jailbreak endpoints will not function')
}

const supabaseAdmin = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null

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
  // One user message can fan out into query expansion, artifact generation,
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

const liveSearchRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many live searches, please slow down.' },
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
app.use('/api/live-search', requireAuth)

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ ok: true })
})

function cleanDomainList(value) {
  if (!Array.isArray(value)) return []
  return value
    .map((domain) => String(domain || '').trim().toLowerCase())
    .filter((domain) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain))
    .slice(0, 12)
}

function cleanHighlight(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String).join('\n').slice(0, 900)
  return String(value || '').trim().slice(0, 900)
}

function pruneLiveSearchCache() {
  const now = Date.now()
  for (const [key, entry] of liveSearchCache.entries()) {
    if (!entry || now - entry.createdAt > LIVE_SEARCH_CACHE_TTL_MS) {
      liveSearchCache.delete(key)
    }
  }
}

function makeLiveSearchCacheKey({ query, includeDomains, excludeDomains, numResults, maxAgeHours }) {
  return JSON.stringify({
    query: String(query || '').trim().toLowerCase(),
    includeDomains,
    excludeDomains,
    numResults,
    maxAgeHours: Number.isFinite(maxAgeHours) ? maxAgeHours : null,
  })
}

app.post('/api/live-search', liveSearchRateLimit, async (req, res) => {
  if (!exa) {
    return res.status(503).json({ error: 'Live search not configured' })
  }

  const body = req.body || {}
  const query = String(body.query || '').trim().slice(0, 500)
  if (query.length < 3) {
    return res.status(400).json({ error: 'Invalid search query' })
  }

  const includeDomains = cleanDomainList(body.includeDomains || body.allowedDomains)
  const excludeDomains = cleanDomainList(body.excludeDomains)
  const requestedResults = Number(body.numResults ?? body.num_results)
  const numResults = Math.min(
    LIVE_SEARCH_MAX_RESULTS,
    Math.max(1, Number.isFinite(requestedResults) ? requestedResults : LIVE_SEARCH_MAX_RESULTS)
  )
  const requestedMaxAgeHours = Number(body.maxAgeHours)
  const maxAgeHours = Number.isFinite(requestedMaxAgeHours)
    ? Math.min(168, Math.max(-1, requestedMaxAgeHours))
    : null

  pruneLiveSearchCache()
  const cacheKey = makeLiveSearchCacheKey({ query, includeDomains, excludeDomains, numResults, maxAgeHours })
  const cached = liveSearchCache.get(cacheKey)
  if (cached && Date.now() - cached.createdAt <= LIVE_SEARCH_CACHE_TTL_MS) {
    return res.json({ ...cached.payload, cached: true })
  }

  try {
    const options = {
      type: 'auto',
      numResults,
      contents: {
        highlights: true,
        ...(maxAgeHours === null ? {} : { maxAgeHours }),
      },
      ...(includeDomains.length > 0 ? { includeDomains } : {}),
      ...(excludeDomains.length > 0 ? { excludeDomains } : {}),
    }

    const response = await exa.search(query, options)
    const results = (response.results || [])
      .map((result) => ({
        title: String(result.title || 'Untitled').trim().slice(0, 180),
        url: result.url,
        publishedDate: result.publishedDate || result.published_date || null,
        author: result.author || null,
        highlight: cleanHighlight(result.highlights || result.highlight || result.summary),
      }))
      .filter((result) => result.url)

    const payload = {
      query,
      results,
      cached: false,
      fetchedAt: new Date().toISOString(),
    }

    liveSearchCache.set(cacheKey, { createdAt: Date.now(), payload })
    res.json(payload)
  } catch (err) {
    console.error('[Live Search]', err)
    res.status(err.status || 500).json({ error: err.message || 'Live search failed' })
  }
})

app.post('/api/openai/embeddings', embeddingsRateLimit, async (req, res) => {
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
  } catch (err) {
    console.error('[Embeddings]', err)
    res.status(err.status || 500).json({ error: err.message || 'Embedding request failed' })
  }
})

app.post('/api/openai/chat', chatRateLimit, async (req, res) => {
  const { messages, stream, max_completion_tokens, model, response_format, session_id } = req.body

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

  try {
    if (!safePayload.stream) {
      const response = await openai.chat.completions.create(safePayload)
      res.json(response)
      return
    }

    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders?.()

    const streamResp = await openai.chat.completions.create(safePayload)
    let streamedContent = ''

    for await (const chunk of streamResp) {
      const delta = chunk.choices?.[0]?.delta?.content || ''
      streamedContent += delta
      res.write(`${JSON.stringify({ type: 'chunk', data: chunk })}\n`)
    }

    res.write(`${JSON.stringify({ type: 'done' })}\n`)
    res.end()

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
