// Home, History, Settings and Account routes. Auth comes from app.js
// (/api/home, /api/history, /api/settings, /api/account). The only founder
// text here is the answer to the care check-in, and it goes through the care
// gate first. Another founder's situation is a plain 404. Errors are generic.
import rateLimit from 'express-rate-limit'
import { bodyFields } from '../../care/middleware.js'
import { isUuid } from '../../writeValidation.js'
import { validTimeZone } from '../move/schedule.js'
import { HttpError, TEXT_MAX } from '../situations.js'
import { createHome } from './homeService.js'
import { SEARCH_MAX, createHistory } from './historyService.js'
import { createAccount } from './accountService.js'
import { createAccountExport } from './accountExport.js'
import { createMemoryScreen } from '../memory/memoryScreen.js'
import { cleanSettings, createSettings } from './settingsService.js'

export function mountHomeRoutes(app, { supabase, care, callStructured, clock, links = {}, deleteOn = false }) {
  const limiter = (max) => rateLimit({
    windowMs: 60 * 1000,
    max,
    keyGenerator: (req) => req.user.id,
    message: { error: 'That is too many at once. Wait a minute.' },
    standardHeaders: true,
    legacyHeaders: false,
  })
  const log = (what, detail) => console.error(`[Home] ${what}`, detail?.message || detail?.problems || '')
  const home = createHome({ supabase, care, callStructured, clock, log })
  const history = createHistory({ supabase, clock })
  const account = createAccount({ supabase, clock, deleteOn, log })
  const settings = createSettings({ supabase, clock, links, pendingDeletion: account.pending })
  const accountExport = createAccountExport({ supabase, clock })
  const memory = createMemoryScreen({ supabase, clock })

  const handle = (fn) => async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'Service not configured' })
    try {
      return res.json(await fn(req, res))
    } catch (err) {
      if (err instanceof HttpError) return res.status(err.status).json(err.body)
      console.error('[Home] failed', err?.message || err)
      return res.status(500).json({ error: 'Something went wrong. Try again.' })
    }
  }
  const bad = (message) => { throw new HttpError(400, { error: message }) }

  // time_zone: the phone's zone, used when the founder has none saved.
  app.get('/api/home', limiter(60),
    handle((req) => {
      const zone = req.query.time_zone
      if (zone !== undefined && (typeof zone !== 'string' || !validTimeZone(zone))) bad('time_zone must be a time zone name')
      return home.home({ user: req.user, timeZone: zone ?? null })
    }))

  // The answer to "How are you doing today?". It has been read by the care gate
  // and is not kept; this only closes the open care event.
  app.post('/api/home/checkin', limiter(10), care.careGate(bodyFields('text')),
    handle((req) => {
      const text = typeof req.body?.text === 'string' ? req.body.text.trim() : ''
      if (!text) bad('text is required')
      if (text.length > TEXT_MAX) bad(`text is longer than ${TEXT_MAX} characters`)
      return home.checkin(req.user.id)
    }))

  app.get('/api/history', limiter(60),
    handle((req) => {
      const q = req.query.q ?? ''
      if (typeof q !== 'string' || q.length > SEARCH_MAX) bad(`q must be text of at most ${SEARCH_MAX} characters`)
      return history.list({ userId: req.user.id, q })
    }))

  app.get('/api/history/:id', limiter(60),
    handle((req) => {
      if (!isUuid(req.params.id)) throw new HttpError(404, { error: 'Not found' })
      return history.detail({ userId: req.user.id, situationId: req.params.id })
    }))

  // What Axiom thinks: active memory in plain words, and "this is wrong". No model call.
  app.get('/api/memory', limiter(60), handle((req) => memory.list(req.user.id)))

  app.post('/api/memory/:table/:id/wrong', limiter(20),
    handle((req) => {
      if (!isUuid(req.params.id)) throw new HttpError(404, { error: 'Not found' })
      return memory.markWrong({ userId: req.user.id, table: req.params.table, id: req.params.id, reason: req.body?.reason })
    }))

  app.get('/api/settings', limiter(60),
    handle((req) => settings.get({ user: req.user })))

  app.put('/api/settings', limiter(20),
    handle(async (req) => {
      const cleaned = cleanSettings(req.body)
      if (cleaned.error) bad(cleaned.error)
      const out = await settings.update({ user: req.user, value: cleaned.value })
      if (out.error) throw new HttpError(400, out.code ? { error: out.error, code: out.code } : { error: out.error })
      return out.value
    }))

  // Everything stored about this founder, as a file. Reads only this founder's rows.
  app.post('/api/account/export', limiter(5), handle(async (req, res) => {
    const doc = await accountExport.build(req.user.id)
    res.set('Content-Disposition', 'attachment; filename="axiom-export.json"')
    res.set('Cache-Control', 'no-store')
    return doc
  }))

  // Body { confirm: 'DELETE' } asks; { cancel: true } cancels during the grace
  // period. Deleting runs only when ACCOUNT_DELETE is on (accountService.js).
  app.delete('/api/account', limiter(5), handle(async (req) =>
    account.requestDelete(req.user.id, req.body, await care.isCareOpen(req.user.id))))
}
