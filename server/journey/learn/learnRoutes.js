// Learn routes and the loading hint. Auth comes from app.js; founder text goes
// through the care gate first. Another founder's situation or conversation is
// a plain 404. Errors are generic.
import rateLimit from 'express-rate-limit'
import { bodyFields } from '../../care/middleware.js'
import { isUuid } from '../../writeValidation.js'
import { HttpError, TEXT_MAX } from '../situations.js'
import { createLearn } from './learn.js'
import { pickLoadingHint } from './loadingHint.js'

const SEED_MAX = 100
const NAME_MAX = 30

// An in-memory lesson provider for the loading hint. Empty until the verified
// lesson library is loaded; then every hint is null and the app shows only the
// logo and the faint lines.
export const createMemoryHintProvider = (lessons = []) => ({ lessons: () => lessons })

// The first name from the Google account, for the second move card and pushes.
export function firstNameOf(user) {
  const meta = user?.user_metadata ?? {}
  const name = String(meta.given_name || meta.full_name || meta.name || '').trim().split(/\s+/)[0] ?? ''
  return /^[\p{L}][\p{L}'’-]*$/u.test(name) && name.length <= NAME_MAX ? name : null
}

export function mountLearnRoutes(app, { supabase, knowledgeSupabase = null, embed = null, care, cap, stored, callStructured, clock, hintProvider = createMemoryHintProvider() }) {
  const limiter = (max) => rateLimit({
    windowMs: 60 * 1000,
    max,
    keyGenerator: (req) => req.user.id,
    message: { error: 'That is too many at once. Wait a minute.' },
    standardHeaders: true,
    legacyHeaders: false,
  })
  const log = (what, detail) => console.error(`[Learn] ${what}`, detail?.message || detail?.problems || '')
  const service = createLearn({ supabase, knowledgeSupabase, embed, callStructured, clock, log })

  const handle = (fn) => async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'Service not configured' })
    try {
      return res.json(await fn(req))
    } catch (err) {
      if (err instanceof HttpError) return res.status(err.status).json(err.body)
      console.error('[Learn] failed', err?.message || err)
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

  // Reads the stored situation and Read answer; the founder sends no text here.
  app.post('/api/situations/:id/learn', limiter(5), care.careHold, cap(stored.learnStart),
    handle((req) => service.start({ userId: req.user.id, situationId: idParam(req) })))

  app.get('/api/learn/:id', limiter(60),
    handle((req) => service.get({ userId: req.user.id, learnId: idParam(req) })))

  app.post('/api/learn/:id/turn', limiter(30), care.careHold, care.careGate(bodyFields('text')), cap(stored.learnTurn),
    handle((req) => service.turn({
      userId: req.user.id, learnId: idParam(req), text: textOf(req), clientTurnId: clientTurnId(req), name: firstNameOf(req.user),
    })))

  // The tapped suggestion is Axiom's own text, stored on the server: no care gate.
  app.post('/api/learn/:id/followup/:n', limiter(20), care.careHold, cap(stored.followUp),
    handle((req) => {
      const index = /^\d$/.test(req.params.n) ? Number(req.params.n) : null
      if (index === null) throw new HttpError(404, { error: 'Not found' })
      const turnId = req.body?.turn_id
      if (turnId !== undefined && !isUuid(turnId)) bad('turn_id must be a uuid')
      return service.followUp({ userId: req.user.id, learnId: idParam(req), index, turnId: turnId ?? null })
    }))

  // No model call: one verified quote with the book name only, or null.
  app.get('/api/loading-hint', limiter(60), (req, res) => {
    try {
      const seed = typeof req.query?.seed === 'string' && req.query.seed.length <= SEED_MAX ? req.query.seed : req.user.id
      const hint = pickLoadingHint({ provider: hintProvider, seed })
      return res.json({ hint: hint ? { book: hint.book, quote: hint.quote } : null })
    } catch (err) {
      console.error('[LoadingHint] failed', err?.message || err)
      return res.json({ hint: null })
    }
  })
}
