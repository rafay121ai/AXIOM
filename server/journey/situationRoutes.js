// GET /api/situations/:id (also how the app resumes a situation) returns:
//   { situation: { id, title, status, follow_up_count, created_at },
//     turns: [{ role: 'founder' | 'axiom', text, created_at }],  // oldest first, filler turns left out
//     read: null | { headline, body, closing_question, answered, skipped } }
// Another founder's situation, or a bad id, is a 404 { error: 'Not found' }.
//
// Situation and Read routes. Auth comes from app.js; every founder text goes
// through the care gate first. Another founder's situation is a plain 404.
import rateLimit from 'express-rate-limit'
import { bodyFields } from '../care/middleware.js'
import { createRecentContext } from '../care/recentContext.js'
import { isUuid } from '../writeValidation.js'
import { createSituations, HttpError, TEXT_MAX } from './situations.js'

export function mountSituationRoutes(app, { supabase, care, cap, stored, callStructured, clock, noDailyLimit = () => false }) {
  const limiter = (max) => rateLimit({
    windowMs: 60 * 1000,
    max,
    keyGenerator: (req) => req.user.id,
    message: { error: 'That is too many at once. Wait a minute.' },
    standardHeaders: true,
    legacyHeaders: false,
  })
  const log = (what, detail) => console.error(`[Situations] ${what}`, detail?.message || detail?.problems || '')
  const service = createSituations({ supabase, callStructured, clock, log })
  const earlier = createRecentContext({ supabase, log }).forSituation

  // Wraps a handler: 503 without a database, HttpError as its own status.
  const handle = (fn) => async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'Service not configured' })
    try {
      return res.json(await fn(req))
    } catch (err) {
      if (err instanceof HttpError) return res.status(err.status).json(err.body)
      console.error('[Situations] failed', err?.message || err)
      return res.status(500).json({ error: 'Something went wrong. Try again.' })
    }
  }
  const bad = (message) => { throw new HttpError(400, { error: message }) }
  const idParam = (req) => {
    if (!isUuid(req.params.id)) throw new HttpError(404, { error: 'Not found' })
    return req.params.id
  }
  const textOf = (req) => {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : ''
    if (!text) bad('text is required')
    if (text.length > TEXT_MAX) bad(`text is longer than ${TEXT_MAX} characters`)
    return text
  }
  const clientTurnId = (req) => (isUuid(req.body?.client_turn_id) ? req.body.client_turn_id : bad('client_turn_id must be a uuid'))

  app.get('/api/situations/open', limiter(60), handle((req) => service.list(req.user.id)))

  app.post('/api/situations', limiter(10), care.careHold, care.careGate(bodyFields('text')), cap(stored.situationStart),
    handle((req) => service.create({ userId: req.user.id, text: textOf(req), clientTurnId: clientTurnId(req), unlimited: noDailyLimit(req.user) })))

  app.get('/api/situations/:id', limiter(60), handle((req) => service.get(req.user.id, idParam(req))))

  app.post('/api/situations/:id/turn', limiter(30), care.careHold, care.careGate(bodyFields('text'), earlier), cap(stored.situationTurn),
    handle((req) => service.turn({ userId: req.user.id, situationId: idParam(req), text: textOf(req), clientTurnId: clientTurnId(req) })))

  // Reads the stored situation; the founder sends no text here.
  app.post('/api/situations/:id/read', limiter(5), care.careHold, cap(stored.read),
    handle((req) => service.read({ userId: req.user.id, situationId: idParam(req) })))

  // Never blocked by the cost cap (it saves what the founder wrote); at the cap only the talk's question is skipped.
  app.post('/api/situations/:id/read/answer', limiter(20), care.careHold, care.careGate(bodyFields('text'), earlier), cap.mark ?? ((_req, _res, next) => next()),
    handle((req) => {
      const skip = req.body?.skip === true
      if (skip) return service.answerRead({ userId: req.user.id, situationId: idParam(req), skip: true })
      return service.answerRead({ userId: req.user.id, situationId: idParam(req), text: textOf(req), overCap: req.overCap === true })
    }))
}
