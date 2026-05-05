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
]

const openaiApiKey = process.env.OPENAI_API_KEY

if (!openaiApiKey) {
  console.warn('[Axiom API] Missing OPENAI_API_KEY')
}

const openai = new OpenAI({
  apiKey: openaiApiKey,
})

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

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ ok: true })
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
