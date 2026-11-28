// The newsletter picker (decision Nov 28). Lists newsletter-like mail of the last 30 days from Gmail headers only (no payload, no
// per-message fetch, nothing of the mail is stored), groups it by sender address, ranks it, and keeps what the founder chose to
// watch in watch_sources. Only watched senders are read later (filter.js, worker.js).
import { HttpError } from '../journey/situations.js'
import { emailOf, sensitive } from './filter.js'

export const COPY = { notConnected: 'Gmail is not connected. Connect it first.' }
const DAY = 86400000
const WINDOW_DAYS = 30
// Mail from these is a product talking to its user, never a newsletter, whatever the local part (slack.com, team@, billing@...).
// Matched on the sender's domain or any subdomain of it. Also used to shape the Gmail query, so the page cap covers the month.
export const NOTIFICATION_DOMAINS = ['slack.com', 'vercel.com', 'github.com', 'gitlab.com', 'google.com', 'notion.so', 'linear.app', 'figma.com', 'atlassian.com', 'atlassian.net', 'stripe.com', 'apple.com', 'zoom.us', 'dropbox.com', 'asana.com', 'trello.com', 'intercom.io', 'calendly.com', 'docusign.net', 'paypal.com', 'amazonaws.com']
// An automated sender by its address (before the @) or its display name.
const AUTOMATED_ADDRESS = /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|donotreply|notifications?|notify|alerts?|bot|mailer-daemon|postmaster|support|billing|security|invoices?|receipts?|orders?|accounts?|calendar-notification|system)([-_.+]|$)/i
const AUTOMATED_NAME = /\[bot\]|\bbot\b|\bnotifications?\b|\bno-?reply\b|\bcalendar\b|\binvitation\b/i
// Newsletter signals: a newsletter platform's domain, or a name that says what it is. These get a boost.
const NEWSLETTER_DOMAINS = ['substack.com', 'beehiiv.com', 'convertkit.com', 'kit.com', 'ck.page', 'mailchimp.com', 'mcsv.net', 'list-manage.com', 'ghost.io', 'buttondown.email', 'revue.email', 'medium.com', 'flodesk.com']
const NEWSLETTER_NAME = /newsletter|\bweekly\b|\bdigest\b|\bdaily\b|briefing|bulletin|\bnotes\b/i
const TRANSACTIONAL_SUBJECT = /receipt|invoice|your order|order #|payment|password|verify|verification|confirm|your account|shipped|delivery|statement|security code|sign-?in/i
const inDomain = (address, list) => list.some((d) => address.endsWith(`@${d}`) || address.endsWith(`.${d}`))
const QUERY = `newer_than:${WINDOW_DAYS}d (category:promotions OR category:updates OR unsubscribe) -category:social -from:(noreply OR no-reply OR donotreply OR notification OR notifications OR mailer-daemon OR ${NOTIFICATION_DOMAINS.join(' OR ')})`
const PAGE = 100
const MAX_PAGES = 5
export const TOP = 8
export const MAX_WATCHING = 20
export const CACHE_MS = 6 * 60 * 60 * 1000
const ok = (r) => { if (r.error) throw r.error; return r.data }

const nameOf = (sender, address) => {
  const name = String(sender ?? '').replace(/<[^>]*>/g, '').replace(/["']/g, '').trim()
  return (name && !name.includes('@') ? name : address.split('@')[1]).slice(0, 120)
}
const timeOf = (m) => { const t = Number(m.messageTimestamp); return Number.isFinite(t) && t > 0 ? t : Date.parse(m.messageTimestamp) }

// messages -> Map(address -> { name, per_week, opens, score }). days: how many days the messages cover (30, or fewer when the page cap
// stopped the scan early), so per_week is not diluted. Skipped: unreadable or sensitive senders, apps and bots, transactional mail.
// Senders with the same display name are one row (Slack from three addresses): the id is the address with the most mail.
// shortcut: the schema holds one address per row, so mail from the merged row's other addresses is not watched; upgrade with an aliases column.
export function groupSenders(messages, days = WINDOW_DAYS) {
  const groups = new Map()
  for (const m of messages) {
    const address = emailOf(m.sender)
    if (address.length < 3 || address.length > 320 || sensitive({ from: m.sender })) continue
    const name = nameOf(m.sender, address)
    if (AUTOMATED_ADDRESS.test(address.split('@')[0]) || AUTOMATED_NAME.test(name) || inDomain(address, NOTIFICATION_DOMAINS)) continue
    const labels = m.labelIds ?? []
    const g = groups.get(address) ?? { name, named: name !== address.split('@')[1], count: 0, read: 0, promo: 0, updates: 0, transactional: 0 }
    g.count += 1
    if (!labels.includes('UNREAD')) g.read += 1
    if (labels.includes('CATEGORY_PROMOTIONS')) g.promo += 1
    if (labels.includes('CATEGORY_UPDATES')) g.updates += 1
    if (TRANSACTIONAL_SUBJECT.test(m.subject ?? '')) g.transactional += 1
    groups.set(address, g)
  }
  const merged = new Map() // display name -> { address (most mail so far), ...totals }
  for (const [address, g] of groups) {
    const key = g.named ? g.name.toLowerCase() : address // a domain stand-in for a missing name never merges
    const m = merged.get(key)
    if (!m) { merged.set(key, { ...g, address, top: g.count }); continue }
    for (const f of ['count', 'read', 'promo', 'updates', 'transactional']) m[f] += g[f]
    if (g.count > m.top) { m.address = address; m.top = g.count }
  }
  const out = new Map()
  for (const g of merged.values()) {
    if (g.transactional / g.count > 0.5) continue
    const signal = inDomain(g.address, NEWSLETTER_DOMAINS) || NEWSLETTER_NAME.test(g.name)
    // Retail promotions may stay (the founder unticks) but rank below a real newsletter; updates-only mail is mostly service mail.
    const weight = signal ? 1.5 : g.promo / g.count > 0.5 ? 0.4 : g.updates / g.count > 0.5 ? 0.3 : 1
    const share = g.read / g.count
    const weekly = g.count / days * 7
    out.set(g.address, {
      name: g.name, per_week: Math.max(1, Math.round(weekly)), opens: share >= 0.6 ? 'most' : share >= 0.2 ? 'some' : 'rarely',
      // Frequency (capped, so one noisy sender cannot own the list) weighted by how much of it the founder reads and by what kind of mail it is. numeric(6,3).
      score: Math.round(Math.min(weekly, 50) * (0.25 + share) * weight * 1000) / 1000,
    })
  }
  return out
}

export function createNewsletters({ supabase, read, refuseIfBlocked, isConnected, clock }) {
  const iso = () => new Date(clock.now()).toISOString()
  // shortcut: the scan result is cached in memory per founder for 6 hours (a restart means one fresh scan). The table keeps only
  // status, name and rank_score; per_week and opens have no column and need none (no schema change).
  const cache = new Map() // userId -> { at, senders } or { at, failure } (a failed scan, kept FAIL_MS so retries do not spend Composio calls)
  const inFlight = new Map() // userId -> the scan running now; concurrent requests share it
  const FAIL_MS = 10 * 60 * 1000
  const MAX_CACHE = 500
  const remember = (userId, entry) => {
    for (const [id, e] of cache) if (e.at <= clock.now() - CACHE_MS) cache.delete(id)
    while (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value)
    cache.set(userId, entry)
  }

  async function fetchSenders(userId) {
    const messages = []
    let token
    for (let pages = 0; pages < MAX_PAGES; pages += 1) {
      const d = await read(userId, 'GMAIL_FETCH_EMAILS', { query: QUERY, include_payload: false, max_results: PAGE, page_token: token })
      messages.push(...(d.messages ?? []))
      token = d.nextPageToken
      if (!token) break
    }
    // The cap stopped us before 30 days: rates are over the days actually covered (newest first, so the oldest seen sets it).
    const oldest = Math.min(...messages.map(timeOf).filter(Number.isFinite))
    const days = token && Number.isFinite(oldest) ? Math.min(WINDOW_DAYS, Math.max(1, (clock.now() - oldest) / DAY)) : WINDOW_DAYS
    const senders = groupSenders(messages, days)
    await suggest(userId, senders)
    return senders
  }

  async function scan(userId) {
    const hit = cache.get(userId)
    if (hit && hit.at > clock.now() - (hit.failure ? FAIL_MS : CACHE_MS)) {
      if (hit.failure) throw hit.failure
      return hit.senders
    }
    if (inFlight.has(userId)) return inFlight.get(userId)
    const run = fetchSenders(userId).then(
      (senders) => { remember(userId, { at: clock.now(), senders }); return senders },
      (failure) => { if (failure?.code !== 'auth') remember(userId, { at: clock.now(), failure }); throw failure }, // a login problem is fixed by reconnecting: never held
    ).finally(() => inFlight.delete(userId))
    inFlight.set(userId, run)
    return run
  }

  const ranked = (senders) => [...senders].sort((a, b) => b[1].score - a[1].score).slice(0, TOP)
  const rows = async (userId) => ok(await supabase.from('watch_sources').select('id, identifier, display_name, status').eq('user_id', userId).eq('kind', 'newsletter'))

  // The top senders become 'suggested' rows. A row already watching or muted is the founder's choice and is never touched.
  async function suggest(userId, senders) {
    const have = new Map((await rows(userId)).map((r) => [r.identifier, r]))
    for (const [id, s] of ranked(senders)) {
      const row = have.get(id)
      if (!row) {
        const { error } = await supabase.from('watch_sources').insert({ user_id: userId, kind: 'newsletter', identifier: id, display_name: s.name, status: 'suggested', rank_score: s.score })
        if (error && error.code !== '23505') throw error // 23505: a parallel request wrote it first
      } else if (row.status === 'suggested') ok(await supabase.from('watch_sources').update({ display_name: s.name, rank_score: s.score, updated_at: iso() }).eq('id', row.id).eq('status', 'suggested').select('id'))
    }
  }

  async function view(userId) {
    if (!(await isConnected(userId))) throw new HttpError(409, { error: 'not_connected', line: COPY.notConnected })
    let senders
    try { senders = await scan(userId) } catch (err) {
      if (err?.code === 'auth') throw new HttpError(409, { error: 'not_connected', line: COPY.notConnected })
      throw err
    }
    const stored = new Map((await rows(userId)).map((r) => [r.identifier, r]))
    const watching = (id) => stored.get(id)?.status === 'watching'
    const out = ranked(senders).map(([id, s]) => ({ id, name: s.name, per_week: s.per_week, opens: s.opens, watching: watching(id) }))
    // A watched one outside the top 8 stays on the list (its numbers if seen this month; else the least it can say).
    for (const [id, r] of stored) {
      if (!watching(id) || out.some((o) => o.id === id)) continue
      const s = senders.get(id)
      out.push({ id, name: s?.name ?? r.display_name ?? id.split('@')[1], per_week: s?.per_week ?? 1, opens: s?.opens ?? 'some', watching: true })
    }
    return { newsletters: out }
  }

  return {
    async list(userId) {
      await refuseIfBlocked(userId)
      return view(userId)
    },
    // The ids ticked become 'watching'; the ones that were watching and are not listed become 'muted'. An id this founder has no row for is refused.
    async setWatching(userId, ids) {
      const bad = () => new HttpError(400, { error: 'bad_request', line: 'watching must be a list of up to 20 newsletter ids' })
      if (!Array.isArray(ids) || ids.length > MAX_WATCHING || ids.some((i) => typeof i !== 'string')) throw bad()
      const want = new Set(ids.map((i) => i.trim().toLowerCase()))
      await refuseIfBlocked(userId)
      const stored = await rows(userId)
      if ([...want].some((id) => !stored.some((r) => r.identifier === id))) throw new HttpError(400, { error: 'unknown_newsletter', line: 'That newsletter is not on your list.' })
      for (const r of stored) {
        const next = want.has(r.identifier) ? 'watching' : r.status === 'watching' ? 'muted' : null
        if (next && next !== r.status) ok(await supabase.from('watch_sources').update({ status: next, decided_at: iso(), updated_at: iso() }).eq('id', r.id).select('id'))
      }
      return view(userId)
    },
  }
}
