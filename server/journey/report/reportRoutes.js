// Report routes. Auth comes from app.js; the founder's note is free text and
// goes through the care gate first. Another founder's move or report is a
// plain 404. Errors are generic. There is no route that deletes a report or
// penalises a founder.
import rateLimit from 'express-rate-limit'
import { bodyFields } from '../../care/middleware.js'
import { isUuid } from '../../writeValidation.js'
import { HttpError, TEXT_MAX } from '../situations.js'
import { createReports } from './reportService.js'
import { CONSENT_WORDINGS, OUTCOMES } from './wording.js'

export function mountReportRoutes(app, { supabase, care, callStructured, clock }) {
  const limiter = (max) => rateLimit({
    windowMs: 60 * 1000,
    max,
    keyGenerator: (req) => req.user.id,
    message: { error: 'Too many requests, please slow down.' },
    standardHeaders: true,
    legacyHeaders: false,
  })
  const log = (what, detail) => console.error(`[Report] ${what}`, detail?.message || detail?.problems || '')
  const service = createReports({ supabase, callStructured, clock, log })

  const handle = (fn) => async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'Service not configured' })
    try {
      return res.json(await fn(req))
    } catch (err) {
      if (err instanceof HttpError) return res.status(err.status).json(err.body)
      console.error('[Report] failed', err?.message || err)
      return res.status(500).json({ error: 'Something went wrong. Try again.' })
    }
  }
  const bad = (message) => { throw new HttpError(400, { error: message }) }
  const idParam = (req) => {
    if (!isUuid(req.params.id)) throw new HttpError(404, { error: 'Not found' })
    return req.params.id
  }

  app.get('/api/reports/due', limiter(60),
    handle((req) => service.due({ userId: req.user.id })))

  app.post('/api/moves/:id/report', limiter(10), care.careGate(bodyFields('note')),
    handle((req) => {
      const { outcome, note, client_turn_id: clientTurnId } = req.body ?? {}
      if (!OUTCOMES.includes(outcome)) bad(`outcome must be one of ${OUTCOMES.join(', ')}`)
      if (!isUuid(clientTurnId)) bad('client_turn_id must be a uuid')
      if (note !== undefined && note !== null && typeof note !== 'string') bad('note must be text')
      const text = typeof note === 'string' ? note.trim() : ''
      if (text.length > TEXT_MAX) bad(`note is longer than ${TEXT_MAX} characters`)
      return service.report({ userId: req.user.id, moveId: idParam(req), outcome, note: text || null, clientTurnId })
    }))

  app.get('/api/reports/:id', limiter(60),
    handle((req) => service.get({ userId: req.user.id, reportId: idParam(req) })))

  app.get('/api/reports/:id/story', limiter(30),
    handle((req) => service.story({ userId: req.user.id, reportId: idParam(req) })))

  app.post('/api/reports/:id/consent', limiter(20),
    handle((req) => {
      const { share, wording_version: version } = req.body ?? {}
      if (typeof share !== 'boolean') bad('share must be true or false')
      if (version !== undefined && version !== null && !Object.hasOwn(CONSENT_WORDINGS, version)) bad('wording_version is not known')
      return service.consent({ userId: req.user.id, reportId: idParam(req), share, wordingVersion: version ?? null })
    }))

  app.post('/api/reports/:id/withdraw', limiter(20),
    handle((req) => service.withdraw({ userId: req.user.id, reportId: idParam(req) })))
}
