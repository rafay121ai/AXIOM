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


app.listen(port, () => {
  console.log(`[Axiom API] Listening on :${port}`)
})
