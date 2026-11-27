import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import OpenAI from 'openai'
import { createClient } from '@supabase/supabase-js'
import { createApp, systemClock } from './app.js'
import { createExpoSender } from './push/expoSender.js'
import { createAccount, startDeletionLoop } from './journey/home/accountService.js'
import { createConnectors } from './connectors/composio.js'
import { startActionClearing } from './connectors/connectorService.js'
import { createIngestion, startConnectorIngestion } from './connectors/ingest.js'
import { createSignalHandler } from './connectors/signal.js'
import { createNameLookup, startPushScheduler } from './push/scheduler.js'

dotenv.config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../.env') })

const env = process.env
const port = env.PORT || 3001

if (!env.FRONTEND_URL?.trim()) {
  console.error('FATAL: FRONTEND_URL environment variable is not set')
  process.exit(1)
}

if (!env.OPENAI_API_KEY) console.warn('[Axiom API] Missing OPENAI_API_KEY')

const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY, timeout: 60_000, maxRetries: 1 })

const supabaseUrl = env.VITE_SUPABASE_URL
const supabaseServiceKey = env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !supabaseServiceKey) {
  console.warn('[Axiom API] Missing Supabase credentials — auth endpoints will not function')
}
const supabase = supabaseUrl && supabaseServiceKey ? createClient(supabaseUrl, supabaseServiceKey) : null

const knowledgeUrl = env.VITE_KNOWLEDGE_SUPABASE_URL
const knowledgeKey = env.KNOWLEDGE_SUPABASE_SERVICE_ROLE_KEY
if (!knowledgeUrl || !knowledgeKey) {
  console.warn('[Axiom API] Missing knowledge Supabase service credentials — knowledge writes will not function')
}
const knowledgeSupabase = knowledgeUrl && knowledgeKey ? createClient(knowledgeUrl, knowledgeKey) : null

// The Composio client exists whenever the key is set, so account deletion always revokes a founder's connections,
// even with CONNECTORS off. The routes and the clearing timer stay behind CONNECTORS=on.
const connectors = env.COMPOSIO_API_KEY ? createConnectors() : null
const connectorsOn = env.CONNECTORS === 'on'

// One ingestion (one circuit breaker) for the timers and for the backfill the routes start. It skips founders with a
// deletion request or an open care event; `app` is read at call time, after it exists.
const pendingDeletion = supabase && createAccount({ supabase, clock: systemClock, deleteOn: env.ACCOUNT_DELETE === 'on' }).pending
const blocked = async (id) => (await app.locals.isCareOpen(id)) || (await pendingDeletion(id))
// The signal step needs the app's capped model call, so it is built on first use.
let signalHandler = (...args) => {
  signalHandler = createSignalHandler({ supabase, callStructured: app.locals.callStructured, clock: systemClock, blocked, isCapped: app.locals.isOverCap })
  return signalHandler(...args)
}
const ingestion = connectorsOn && connectors && supabase
  ? createIngestion({ supabase, connectors, clock: systemClock, blocked, handleItem: (...args) => signalHandler(...args) })
  : undefined
const app = createApp({ supabase, knowledgeSupabase, openai, env, connectors: connectorsOn ? connectors : null, ingestion })

// Real pushes only when EXPO_PUSH=on and the database is configured.
if (env.EXPO_PUSH === 'on' && supabase) {
  startPushScheduler({
    supabase,
    sender: createExpoSender({ accessToken: env.EXPO_ACCESS_TOKEN || null }),
    clock: systemClock,
    isCareOpen: app.locals.isCareOpen,
    nameOf: createNameLookup(supabase),
  })
  console.log('[Axiom API] Push scheduler started')
} else {
  console.log('[Axiom API] Push scheduler off (EXPO_PUSH is not on)')
}

if (connectorsOn && connectors && supabase) {
  startActionClearing({ supabase, clock: systemClock })
  startConnectorIngestion({ ingestion })
  console.log('[Axiom API] Connectors on; connectors are polled and queued; action content is cleared daily after 30 days')
} else {
  console.log('[Axiom API] Connectors off (CONNECTORS is not on)')
}

// Real deletions only when ACCOUNT_DELETE=on and the database is configured.
// Off: delete requests are recorded and nothing is removed.
if (env.ACCOUNT_DELETE === 'on' && supabase) {
  // Checks once now, so a restart never delays a deletion that is already due.
  startDeletionLoop({ account: createAccount({ supabase, clock: systemClock, deleteOn: true, revokeConnections: connectors && ((id) => connectors.revokeAll(id)), log: (what, err) => console.error(`[Account] ${what}`, err?.message || '') }) }).run()
  console.log('[Axiom API] Account deletion on')
} else {
  console.log('[Axiom API] Account deletion off (ACCOUNT_DELETE is not on)')
}

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
