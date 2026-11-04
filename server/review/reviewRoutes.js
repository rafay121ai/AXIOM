// Review queue for shared founder stories (peer_outcomes). Reviewers only
// (REVIEWER_USER_IDS); everyone else, and an empty list, gets 404. The model
// drafts, a person edits, and approve saves text + status in one update, so
// the peer_outcomes_guard trigger clears `draft` only after the story is stored.
// Never returns a user id, author link, report id or situation id.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import rateLimit from 'express-rate-limit'
import { isUuid } from '../writeValidation.js'
import {
  REVIEW_DRAFT_SCHEMA, REVIEW_STORY_MAX, REVIEW_LESSON_MAX, reviewDraftMessages,
} from '../journey/report/prompts/reviewDraft.js'

const PAGE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.html')
const FIELDS = 'id, stage, customer_market, business_model, outcome, draft, story, lesson, created_at'

export const reviewerIds = (env) =>
  new Set(String(env.REVIEWER_USER_IDS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean))

export function mountReviewRoutes(app, { supabase, callStructured, clock, env, requireAuth }) {
  const reviewers = reviewerIds(env)
  const off = (_req, res, next) => (reviewers.size ? next() : res.status(404).json({ error: 'Not found' }))
  const limiter = (max) => rateLimit({
    windowMs: 60 * 1000, max, keyGenerator: (req) => req.user.id,
    message: { error: 'That is too many at once. Wait a minute.' }, standardHeaders: true, legacyHeaders: false,
  })
  const reviewerOnly = (req, res, next) =>
    (reviewers.has(String(req.user.id).toLowerCase()) ? next() : res.status(404).json({ error: 'Not found' }))
  const guard = [off, requireAuth, reviewerOnly]
  const one = async (query) => {
    const { data, error } = await query
    if (error) throw error
    return data
  }
  const handle = (fn) => async (req, res) => {
    if (!supabase) return res.status(503).json({ error: 'Service not configured' })
    if (req.params.id && !isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' })
    try {
      return await fn(req, res)
    } catch (err) {
      console.error('[Review] failed', err?.message || err)
      return res.status(500).json({ error: 'Something went wrong. Try again.' })
    }
  }
  const pending = async (id) =>
    (await one(supabase.from('peer_outcomes').select(FIELDS).eq('id', id).eq('status', 'pending_review').maybeSingle())) ?? null

  // The page holds no data; it signs in with Supabase and calls the API.
  app.get('/review', off, (_req, res) => res.sendFile(PAGE))
  app.get('/review/config.js', off, (_req, res) => {
    res.type('application/javascript').send(
      `window.AXIOM_REVIEW = ${JSON.stringify({ url: env.VITE_SUPABASE_URL || '', anonKey: env.VITE_SUPABASE_ANON_KEY || '' })}`)
  })

  app.get('/api/review/outcomes', ...guard, limiter(60), handle(async (_req, res) => {
    const rows = await one(supabase.from('peer_outcomes').select(FIELDS).eq('status', 'pending_review').order('created_at', { ascending: true }))
    // Picks the fields itself, so nothing beyond FIELDS can leave even if the select changes.
    const pick = (r) => Object.fromEntries(FIELDS.split(', ').map((k) => [k, r[k] ?? null]))
    res.json({ outcomes: rows.map((r) => ({ ...pick(r), created_at: String(r.created_at).slice(0, 10) })) })
  }))

  app.post('/api/review/outcomes/:id/draft', ...guard, limiter(10), handle(async (req, res) => {
    const row = await pending(req.params.id)
    if (!row) return res.status(409).json({ error: 'This story is no longer waiting for review.' })
    try {
      const { data } = await callStructured({
        step: 'report', schema: REVIEW_DRAFT_SCHEMA, schemaName: 'review_draft', maxCompletionTokens: 900,
        userId: req.user.id, usageContext: { step: 'report' }, messages: reviewDraftMessages(row),
      })
      return res.json({ story: data.story, lesson: data.lesson })
    } catch (err) {
      console.error('[Review] draft failed', err?.message || err)
      return res.status(502).json({ error: 'The draft did not work. Write it yourself or try again.' })
    }
  }))

  app.post('/api/review/outcomes/:id', ...guard, limiter(60), handle(async (req, res) => {
    const { decision } = req.body ?? {}
    const text = (v) => (typeof v === 'string' ? v.trim() : '')
    const story = text(req.body?.story)
    const lesson = text(req.body?.lesson)
    let fields
    if (decision === 'approve') {
      if (!story || story.length > REVIEW_STORY_MAX || !lesson || lesson.length > REVIEW_LESSON_MAX) {
        return res.status(400).json({ error: `Approve needs a story (up to ${REVIEW_STORY_MAX} characters) and a lesson (up to ${REVIEW_LESSON_MAX}).` })
      }
      fields = { status: 'approved', story, lesson }
    } else if (decision === 'reject') fields = { status: 'rejected' }
    else return res.status(400).json({ error: 'decision must be approve or reject' })

    const won = await one(supabase.from('peer_outcomes')
      .update({ ...fields, reviewed_by: req.user.id, reviewed_at: new Date(clock.now()).toISOString() })
      .eq('id', req.params.id).eq('status', 'pending_review').select('id'))
    if (won.length === 0) return res.status(409).json({ error: 'This story is no longer waiting for review.' })
    return res.json({ id: req.params.id, status: fields.status })
  }))
}
