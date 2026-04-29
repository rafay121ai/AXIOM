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

const app = express()
const port = process.env.PORT || 3001
const frontendUrl = process.env.FRONTEND_URL || '*'

const openaiApiKey = process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY

if (!openaiApiKey) {
  console.warn('[Axiom API] Missing OPENAI_API_KEY')
}

const openai = new OpenAI({
  apiKey: openaiApiKey,
})

const supabaseUrl = process.env.VITE_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn('[Axiom API] Missing Supabase credentials — jailbreak endpoint will not function')
}

const supabaseAdmin = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null

app.use(cors({
  origin: frontendUrl === '*' ? true : frontendUrl.split(',').map((url) => url.trim()),
}))
app.use(express.json({ limit: '1mb' }))

app.get('/health', (_req, res) => {
  res.json({ ok: true })
})

app.post('/api/openai/embeddings', async (req, res) => {
  try {
    const response = await openai.embeddings.create(req.body)
    res.json(response)
  } catch (err) {
    console.error('[Embeddings]', err)
    res.status(err.status || 500).json({ error: err.message || 'Embedding request failed' })
  }
})

app.post('/api/openai/chat', async (req, res) => {
  try {
    if (!req.body?.stream) {
      const response = await openai.chat.completions.create(req.body)
      res.json(response)
      return
    }

    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders?.()

    const stream = await openai.chat.completions.create(req.body)

    for await (const chunk of stream) {
      res.write(`${JSON.stringify({ type: 'chunk', data: chunk })}\n`)
    }

    res.write(`${JSON.stringify({ type: 'done' })}\n`)
    res.end()
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

  const { data, error: fetchError } = await supabaseAdmin
    .from('sessions')
    .select('jailbreak_attempts')
    .eq('id', id)
    .single()

  if (fetchError) {
    console.error('[Jailbreak] Fetch error:', fetchError)
    return res.status(500).json({ error: 'Failed to fetch session' })
  }

  const next = (data?.jailbreak_attempts || 0) + 1

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


app.listen(port, () => {
  console.log(`[Axiom API] Listening on :${port}`)
})
