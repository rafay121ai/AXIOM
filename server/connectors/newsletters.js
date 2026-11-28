// The newsletter picker (decision Nov 28). Lists newsletter-like mail of the last 30 days from Gmail headers only (no payload, no
// per-message fetch, nothing of the mail is stored), groups it by sender address, ranks it, and keeps what the founder chose to
// watch in watch_sources. Only watched senders are read later (filter.js, worker.js).
import { HttpError } from '../journey/situations.js'
import { emailOf, sensitive } from './filter.js'

export const COPY = { notConnected: 'Gmail is not connected. Connect it first.' }
const DAY = 86400000
const WINDOW_DAYS = 30
const QUERY = `newer_than:${WINDOW_DAYS}d (category:promotions OR category:updates OR unsubscribe)`
const PAGE = 100
const MAX_PAGES = 3
export const TOP = 8
export const MAX_WATCHING = 20
export const CACHE_MS = 6 * 60 * 60 * 1000
const ok = (r) => { if (r.error) throw r.error; return r.data }

const nameOf = (sender, address) => {
  const name = String(sender ?? '').replace(/<[^>]*>/g, '').replace(/["']/g, '').trim()
  return (name && !name.includes('@') ? name : address.split('@')[1]).slice(0, 120)
}

// messages -> Map(address -> { name, per_week, opens, score }). A message with an unreadable sender is skipped.
export function groupSenders(messages) {
  const groups = new Map()
  for (const m of messages) {
    const address = emailOf(m.sender)
    if (address.length < 3 || address.length > 320 || sensitive({ from: m.sender }) ) continue
    const g = groups.get(address) ?? { name: nameOf(m.sender, address), count: 0, read: 0 }
    g.count += 1
    if (!(m.labelIds ?? []).includes('UNREAD')) g.read += 1
    groups.set(address, g)
  }
  return new Map([...groups].map(([address, g]) => {
    const share = g.read / g.count
    const weekly = g.count / WINDOW_DAYS * 7
    return [address, {
      name: g.name, per_week: Math.max(1, Math.round(weekly)), opens: share >= 0.6 ? 'most' : share >= 0.2 ? 'some' : 'rarely',
      // Frequency (capped, so one noisy sender cannot own the list) weighted by how much of it the founder reads. numeric(6,3).
      score: Math.round(Math.min(weekly, 50) * (0.25 + share) * 1000) / 1000,
    }]
  }))
}

export function createNewsletters({ supabase, read, refuseIfBlocked, isConnected, clock }) {
  const iso = () => new Date(clock.now()).toISOString()
  // shortcut: the scan result is cached in memory per founder for 6 hours (a restart means one fresh scan). The table keeps only
  // status, name and rank_score; per_week and opens have no column and need none (no schema change).
  const cache = new Map()

  async function scan(userId) {
    const hit = cache.get(userId)
    if (hit && hit.at > clock.now() - CACHE_MS) return hit.senders
    const messages = []
    let token
    for (let pages = 0; pages < MAX_PAGES; pages += 1) {
      const d = await read(userId, 'GMAIL_FETCH_EMAILS', { query: QUERY, include_payload: false, max_results: PAGE, page_token: token })
      messages.push(...(d.messages ?? []))
      token = d.nextPageToken
      if (!token) break
    }
    const senders = groupSenders(messages)
    cache.set(userId, { at: clock.now(), senders })
    await suggest(userId, senders)
    return senders
  }

  const ranked = (senders) => [...senders].sort((a, b) => b[1].score - a[1].score).slice(0, TOP)
  const rows = async (userId) => ok(await supabase.from('watch_sources').select('id, identifier, display_name, status').eq('user_id', userId).eq('kind', 'newsletter'))

  // The top senders become 'suggested' rows. A row already watching or muted is the founder's choice and is never touched.
  async function suggest(userId, senders) {
    const have = new Map((await rows(userId)).map((r) => [r.identifier, r]))
    for (const [id, s] of ranked(senders)) {
      const row = have.get(id)
      if (!row) ok(await supabase.from('watch_sources').insert({ user_id: userId, kind: 'newsletter', identifier: id, display_name: s.name, status: 'suggested', rank_score: s.score }).select('id'))
      else if (row.status === 'suggested') ok(await supabase.from('watch_sources').update({ display_name: s.name, rank_score: s.score, updated_at: iso() }).eq('id', row.id).select('id'))
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
