// Connector routes. Mounted by app.js only when CONNECTORS=on (otherwise the paths do not exist: 404).
// Auth (requireAuth) is applied by app.js on /api/connectors.
import rateLimit from 'express-rate-limit'
import { HttpError } from '../journey/situations.js'
import { createConnectorService } from './connectorService.js'

export function mountConnectorRoutes(app, { supabase, connectors, care, pendingDeletion, clock }) {
  const service = createConnectorService({ supabase, connectors, care, pendingDeletion, clock })
  const limiter = (max) => rateLimit({
    windowMs: 60 * 1000,
    max,
    keyGenerator: (req) => req.user.id,
    message: { error: 'That is too many at once. Wait a minute.' },
    standardHeaders: true,
    legacyHeaders: false,
  })
  const handle = (fn) => async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'Service not configured' })
    try {
      return res.json(await fn(req))
    } catch (err) {
      if (err instanceof HttpError) return res.status(err.status).json(err.body)
      console.error('[Connectors] failed', err?.name ?? 'Error', err?.code ?? err?.status ?? '')
      return res.status(500).json({ error: 'Something went wrong. Try again.' })
    }
  }

  app.get('/api/connectors', limiter(60), handle((req) => service.list(req.user.id)))
  app.post('/api/connectors/:toolkit/connect', limiter(20), handle((req) => service.connect(req.user.id, req.params.toolkit)))
  app.delete('/api/connectors/:toolkit', limiter(20), handle((req) => service.disconnect(req.user.id, req.params.toolkit)))
}
