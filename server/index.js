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

if (!process.env.OPENAI_API_KEY) {
  console.warn('[Axiom API] Missing OPENAI_API_KEY')
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
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

app.post('/api/delete-account', async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '')
  if (!token) return res.status(401).json({ error: 'Unauthorized' })

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Server not configured for account deletion' })
  }

  try {
    const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

    // Verify the JWT to get the user ID
    const { data: { user }, error: verifyError } = await admin.auth.getUser(token)
    if (verifyError || !user) return res.status(401).json({ error: 'Invalid token' })

    const uid = user.id

    // Get all session IDs for this user
    const { data: userSessions } = await admin.from('sessions').select('id').eq('user_id', uid)
    const sessionIds = (userSessions || []).map((s) => s.id)

    if (sessionIds.length > 0) {
      // Delete in FK order — edges before nodes, all before sessions
      await admin.from('personal_wiki_edges').delete().in('session_id', sessionIds)
      await admin.from('personal_wiki_nodes').delete().in('session_id', sessionIds)
      await admin.from('personal_memories').delete().in('session_id', sessionIds)
      await admin.from('weekly_reads').delete().in('session_id', sessionIds)
      await admin.from('messages').delete().in('session_id', sessionIds)
    }

    await admin.from('sessions').delete().eq('user_id', uid)
    await admin.from('users').delete().eq('id', uid)

    // Finally remove the auth user
    const { error: deleteError } = await admin.auth.admin.deleteUser(uid)
    if (deleteError) throw deleteError

    res.json({ ok: true })
  } catch (err) {
    console.error('[delete-account]', err)
    res.status(500).json({ error: err.message || 'Delete failed' })
  }
})

app.listen(port, () => {
  console.log(`[Axiom API] Listening on :${port}`)
})
