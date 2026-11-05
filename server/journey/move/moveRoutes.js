// Move routes. Auth comes from app.js; the swap reason is founder text and goes
// through the care gate first. Another founder's move or conversation is a
// plain 404. Errors are generic. There is no route that deletes, removes or
// penalises a move.
import rateLimit from 'express-rate-limit'
import { bodyFields } from '../../care/middleware.js'
import { isUuid } from '../../writeValidation.js'
import { HttpError, TEXT_MAX } from '../situations.js'
import { createMoves } from './moveService.js'
import { validTimeZone } from './schedule.js'

export function mountMoveRoutes(app, { supabase, care, cap, stored, callStructured, clock }) {
  const limiter = (max) => rateLimit({
    windowMs: 60 * 1000,
    max,
    keyGenerator: (req) => req.user.id,
    message: { error: 'That is too many at once. Wait a minute.' },
    standardHeaders: true,
    legacyHeaders: false,
  })
  const log = (what, detail) => console.error(`[Move] ${what}`, detail?.message || detail?.problems || '')
  const service = createMoves({ supabase, callStructured, clock, log })

  const handle = (fn) => async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'Service not configured' })
    try {
      return res.json(await fn(req))
    } catch (err) {
      if (err instanceof HttpError) return res.status(err.status).json(err.body)
      console.error('[Move] failed', err?.message || err)
      return res.status(500).json({ error: 'Something went wrong. Try again.' })
    }
  }
  const bad = (message) => { throw new HttpError(400, { error: message }) }
  const idParam = (req) => {
    if (!isUuid(req.params.id)) throw new HttpError(404, { error: 'Not found' })
    return req.params.id
  }

  // Builds the move behind Learn's card; the founder sends no text here.
  app.post('/api/learn/:id/move', limiter(5), care.careHold, cap(stored.moveCreate),
    handle((req) => service.create({ userId: req.user.id, learnId: idParam(req) })))

  app.get('/api/moves/active', limiter(60),
    handle((req) => service.listActive({ userId: req.user.id })))

  app.get('/api/moves/:id', limiter(60),
    handle((req) => service.get({ userId: req.user.id, moveId: idParam(req) })))

  app.post('/api/moves/:id/commit', limiter(20), care.careHold,
    handle((req) => {
      const timeZone = req.body?.timezone
      if (timeZone !== undefined && timeZone !== null && !validTimeZone(timeZone)) bad('timezone is not valid')
      return service.commit({ userId: req.user.id, moveId: idParam(req), timeZone: timeZone ?? null })
    }))

  app.post('/api/moves/:id/swap', limiter(5), care.careHold, care.careGate(bodyFields('reason')), cap(stored.swapReplay),
    handle((req) => {
      const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : ''
      if (!reason) bad('reason is required')
      if (reason.length > TEXT_MAX) bad(`reason is longer than ${TEXT_MAX} characters`)
      return service.swap({ userId: req.user.id, moveId: idParam(req), reason })
    }))
}
