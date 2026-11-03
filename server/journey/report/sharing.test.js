// Regression tests for the three sharing findings of the audit: share and
// withdraw cannot race into "shared after withdrawn", every consent decision
// is logged (and a share never exists without its log row), and a check-in the
// care check touched is never shared. Fakes only.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createFakeClock, createFakeSupabase } from '../../testing/fakes.js'
import { createSharing } from './sharing.js'

const USER = '11111111-1111-4111-8111-111111111111'
const SIT = '00000000-0000-4000-8000-000000000100'
const REPORT = '00000000-0000-4000-8000-000000000500'
const NOW = Date.parse('2026-10-26T16:00:00.000Z')
const at = (ms) => new Date(ms).toISOString()

const reportRow = (over = {}) => ({
  id: REPORT, user_id: USER, situation_id: SIT, move_id: 'm1', outcome: 'done', note: 'One clinic replied.',
  prediction: 'At least one will not reply.', prediction_check: 'right', share_state: 'asked', share_automatic: false, share_decided_at: null, ...over,
})
const move = { title: 'Ask both clinics', mission: 'Email the 2 clinics.', success_condition: 'Both reply.' }

function world({ situation = {}, care = [], reportOver = {}, wrap = (s) => s } = {}) {
  const base = createFakeSupabase({
    tables: {
      reports: [reportRow(reportOver)],
      situations: [{ id: SIT, user_id: USER, created_at: at(NOW - 10 * 3600e3), care_flag: false, ...situation }],
      care_events: care,
      founder_profiles: [{ user_id: USER, stage: 'building', business_model: 'b2b', signup_answers: {} }],
    },
  })
  const sharing = createSharing({ supabase: wrap(base), clock: createFakeClock(NOW) })
  const state = () => base.rows('reports')[0].share_state
  const live = () => base.rows('peer_outcomes').filter((p) => p.status !== 'withdrawn')
  const log = () => base.rows('consent_log').map((l) => l.action)
  return { base, sharing, state, live, log }
}
const stored = (w) => w.base.rows('reports')[0]

test('share and withdraw racing never leave a live share on a report that is not shared', async () => {
  const orders = [
    (w) => [w.sharing.share({ userId: USER, report: stored(w), move, automatic: false, wordingVersion: 'v' }),
      w.sharing.unshare({ userId: USER, report: stored(w), to: 'withdrawn', wordingVersion: 'v' })],
    (w) => [w.sharing.unshare({ userId: USER, report: stored(w), to: 'withdrawn', wordingVersion: 'v' }),
      w.sharing.share({ userId: USER, report: stored(w), move, automatic: false, wordingVersion: 'v' })],
    (w) => [w.sharing.share({ userId: USER, report: stored(w), move, automatic: false, wordingVersion: 'v' }),
      w.sharing.share({ userId: USER, report: stored(w), move, automatic: false, wordingVersion: 'v' }),
      w.sharing.unshare({ userId: USER, report: stored(w), to: 'private', wordingVersion: 'v' })],
  ]
  for (const start of orders) {
    const w = world()
    await Promise.all(start(w))
    if (w.state() === 'shared') assert.equal(w.live().length, 1, 'shared means exactly one live outcome')
    else assert.equal(w.live().length, 0, `state ${w.state()} must hold no live outcome`)
    for (const link of w.base.rows('outcome_author_links')) {
      const peer = w.base.rows('peer_outcomes').find((p) => p.id === link.peer_outcome_id)
      assert.equal(Boolean(link.withdrawn_at), peer.status === 'withdrawn', 'link and outcome agree')
    }
  }
})

test('a stale share after a withdraw loses: nothing stays published', async () => {
  const w = world()
  const stale = stored(w) // read while still "asked"
  await w.sharing.unshare({ userId: USER, report: stale, to: 'withdrawn', wordingVersion: 'v' })
  const result = await w.sharing.share({ userId: USER, report: stale, move, automatic: false, wordingVersion: 'v' })
  assert.equal(result, null)
  assert.equal(w.state(), 'withdrawn')
  assert.equal(w.live().length, 0)
})

test('every consent decision is logged, and a share never exists without its log row', async () => {
  const w = world()
  const run = async (fn) => fn(stored(w))
  await run((r) => w.sharing.share({ userId: USER, report: r, move, automatic: false, wordingVersion: 'v1' }))
  await run((r) => w.sharing.unshare({ userId: USER, report: r, to: 'withdrawn', wordingVersion: 'v2' }))
  await run((r) => w.sharing.share({ userId: USER, report: r, move, automatic: true, wordingVersion: 'v3' }))
  await run((r) => w.sharing.unshare({ userId: USER, report: r, to: 'private', wordingVersion: 'v4' }))
  assert.deepEqual(w.log(), ['share', 'withdraw', 'auto_share', 'keep_private'])
  assert.deepEqual(w.base.rows('consent_log').map((l) => l.wording_version), ['v1', 'v2', 'v3', 'v4'])
  assert.ok(w.base.rows('consent_log').every((l) => l.decided_at && l.report_id === REPORT))

  // The log row cannot be written: nothing is published.
  const broken = world({
    wrap: (base) => ({
      ...base,
      from: (t) => {
        const b = base.from(t)
        if (t !== 'consent_log') return b
        b.insert = () => { const e = { then: (res) => res({ data: null, error: { message: 'log down' } }), select: () => e }; return e }
        return b
      },
    }),
  })
  await assert.rejects(() => broken.sharing.share({ userId: USER, report: stored(broken), move, automatic: false, wordingVersion: 'v' }), (e) => e.message === 'log down')
  assert.equal(broken.base.rows('peer_outcomes').length, 0)
  assert.equal(broken.state(), 'asked')
})

test('peer outcome rows never hold a user id; only the private link does', async () => {
  const w = world()
  await w.sharing.share({ userId: USER, report: stored(w), move, automatic: false, wordingVersion: 'v' })
  assert.ok(!JSON.stringify(w.base.rows('peer_outcomes')).includes(USER))
  assert.ok(!Object.keys(w.base.rows('peer_outcomes')[0]).some((k) => /user|author|report_id/.test(k)))
  assert.equal(w.base.rows('outcome_author_links')[0].user_id, USER)
})

test('a check-in care touched is never shared, by any path, even if care came after the question', async () => {
  const careEvent = { id: 'c1', user_id: USER, level: 'unclear', scope_id: null, created_at: at(NOW - 3600e3), resolved_at: null }
  for (const opts of [{ care: [careEvent] }, { situation: { care_flag: true } }, { care: [{ ...careEvent, level: 'clear', created_at: at(NOW - 99 * 3600e3) }] }]) {
    for (const automatic of [false, true]) {
      const w = world(opts)
      await assert.rejects(() => w.sharing.share({ userId: USER, report: stored(w), move, automatic, wordingVersion: 'v' }), (e) => e.status === 409)
      assert.equal(w.state(), 'not_offered')
      assert.equal(w.base.rows('peer_outcomes').length, 0)
      assert.equal(w.base.rows('consent_log').length, 0)
    }
  }
  // A missing situation counts as touched.
  const w = world()
  assert.equal(await w.sharing.careTouched(USER, null), true)
})

test('care that arrives after a withdraw stops a later share', async () => {
  const w = world()
  await w.sharing.share({ userId: USER, report: stored(w), move, automatic: false, wordingVersion: 'v' })
  await w.sharing.unshare({ userId: USER, report: stored(w), to: 'withdrawn', wordingVersion: 'v' })
  await w.base.from('care_events').insert({ user_id: USER, level: 'unclear', scope_id: SIT, created_at: at(NOW + 1000), resolved_at: null })
  await assert.rejects(() => w.sharing.share({ userId: USER, report: stored(w), move, automatic: false, wordingVersion: 'v' }), (e) => e.status === 409)
  assert.equal(w.live().length, 0)
  assert.equal(w.state(), 'not_offered')
})

// ── Interleaved taps with random delays, on both paths ───────────────────────

// Every query waits a random few milliseconds, so share, keep private and
// withdraw interleave at every step.
function delayed(base, rand) {
  return {
    ...base,
    from(table) {
      const b = base.from(table)
      const then = b.then
      b.then = (resolve, reject) => new Promise((r) => setTimeout(r, Math.floor(rand() * 4))).then(() => then(resolve, reject))
      return b
    },
  }
}

// The SQL functions of schema_needs.md, in memory: each call runs with no
// await inside, so it is one transaction.
function withFunctions(client, base, { idFactory }) {
  const exec = (q) => q.then(() => {})
  const report = (userId, reportId) => base.rows('reports').find((r) => r.id === reportId && r.user_id === userId)
  const set = (reportId, fields) => exec(base.from('reports').update(fields).eq('id', reportId))
  const log = (p, action) => exec(base.from('consent_log').insert({ user_id: p.p_user_id, report_id: p.p_report_id, action, wording_version: p.p_wording_version, decided_at: p.p_now }))
  const fns = {
    share_outcome(p) {
      const r = report(p.p_user_id, p.p_report_id)
      if (!r || r.share_state !== p.p_from || ['shared', 'not_offered'].includes(p.p_from)) return []
      log(p, p.p_action)
      const id = idFactory()
      exec(base.from('peer_outcomes').insert({ id, ...p.p_peer, withdrawn_at: null, created_at: p.p_now }))
      exec(base.from('outcome_author_links').insert({ peer_outcome_id: id, user_id: p.p_user_id, report_id: p.p_report_id, created_at: p.p_now, withdrawn_at: null }))
      set(p.p_report_id, { share_state: 'shared', share_automatic: p.p_automatic, share_decided_at: p.p_now })
      return [report(p.p_user_id, p.p_report_id)]
    },
    unshare_outcome(p) {
      const r = report(p.p_user_id, p.p_report_id)
      if (!r || r.share_state !== p.p_from) return []
      for (const l of base.rows('outcome_author_links').filter((x) => x.report_id === p.p_report_id && x.user_id === p.p_user_id && !x.withdrawn_at)) {
        exec(base.from('peer_outcomes').update({ status: 'withdrawn', draft: null, story: null, lesson: null, withdrawn_at: p.p_now }).eq('id', l.peer_outcome_id))
        exec(base.from('outcome_author_links').update({ withdrawn_at: p.p_now }).eq('peer_outcome_id', l.peer_outcome_id))
      }
      if (p.p_action) log(p, p.p_action)
      set(p.p_report_id, { share_state: p.p_to, share_automatic: false, share_decided_at: p.p_now })
      return [report(p.p_user_id, p.p_report_id)]
    },
  }
  return { ...client, rpc: async (name, params) => ({ data: fns[name](params), error: null }) }
}

const seeded = (seed) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }

for (const path of ['steps', 'functions']) {
  test(`${path}: random interleavings of share, keep private and withdraw never leave a live share on a report that is not shared`, async () => {
    for (let trial = 0; trial < 40; trial += 1) {
      const rand = seeded(trial + 1)
      let n = 0
      const w = world({
        reportOver: { share_state: ['asked', 'shared', 'withdrawn', 'private'][trial % 4] },
        wrap: (base) => {
          const slow = delayed(base, rand)
          return path === 'functions' ? withFunctions(slow, base, { idFactory: () => `00000000-0000-4000-8000-${String(9000 + (n += 1)).padStart(12, '0')}` }) : slow
        },
      })
      if (stored(w).share_state === 'shared') {
        // A share already live for the 'shared' start.
        await w.base.from('peer_outcomes').insert({ id: 'p0', status: 'pending_review', outcome: 'done', draft: {} })
        await w.base.from('outcome_author_links').insert({ peer_outcome_id: 'p0', user_id: USER, report_id: REPORT, withdrawn_at: null })
      }
      const ops = Array.from({ length: 4 }, (_, i) => async () => {
        await new Promise((r) => setTimeout(r, Math.floor(rand() * 6)))
        const r = stored(w)
        const pick = (trial + i) % 3
        if (pick === 0) return w.sharing.share({ userId: USER, report: r, move, automatic: false, wordingVersion: 'v' })
        return w.sharing.unshare({ userId: USER, report: r, to: pick === 1 ? 'private' : 'withdrawn', wordingVersion: 'v' })
      })
      await Promise.allSettled(ops.map((op) => op()))
      const live = w.live()
      if (w.state() === 'shared') assert.ok(live.length <= 1, `trial ${trial}: ${live.length} live shares`)
      else assert.equal(live.length, 0, `trial ${trial}: state ${w.state()} with a live outcome`)
      for (const peer of w.base.rows('peer_outcomes')) {
        assert.ok(w.base.rows('outcome_author_links').some((l) => l.peer_outcome_id === peer.id), `trial ${trial}: an outcome with no link`)
      }
      const shares = w.base.rows('consent_log').filter((l) => l.action === 'share').length
      assert.ok(w.base.rows('peer_outcomes').filter((p) => p.id !== 'p0').length <= shares, `trial ${trial}: a share with no consent row`)
    }
  })
}

test('an author link that cannot be written leaves no live outcome, even when removing it fails too', async () => {
  for (const deleteFails of [false, true]) {
    const w = world({
      wrap: (base) => ({
        ...base,
        from: (t) => {
          const b = base.from(t)
          const failing = () => { const e = { then: (res) => res({ data: null, error: { message: `${t} down` } }), select: () => e, eq: () => e }; return e }
          if (t === 'outcome_author_links') b.insert = failing
          if (t === 'peer_outcomes' && deleteFails) b.delete = failing
          return b
        },
      }),
    })
    await assert.rejects(() => w.sharing.share({ userId: USER, report: stored(w), move, automatic: false, wordingVersion: 'v' }), (e) => e.message === 'outcome_author_links down')
    assert.equal(w.live().length, 0, `delete fails: ${deleteFails}`)
    assert.equal(w.state(), 'asked')
  }
})

// ── Errors after the publish (re-audit) ──────────────────────────────────────

// rule({ table, action, n }) => 'fail' (nothing written), 'after' (written,
// then an error) or nothing. n counts that table and action from 1.
function failAt(rule) {
  return (base) => {
    const seen = {}
    return {
      ...base,
      from(table) {
        const b = base.from(table)
        let action = 'select'
        const { insert, update, then } = b
        const del = b.delete
        b.insert = (p) => { action = 'insert'; insert(p); return b }
        b.update = (p) => { action = 'update'; update(p); return b }
        b.delete = () => { action = 'delete'; del(); return b }
        b.then = (resolve, reject) => {
          const key = `${table} ${action}`
          seen[key] = (seen[key] ?? 0) + 1
          const verdict = rule({ table, action, n: seen[key] })
          const error = { data: null, error: { message: `${key} failed` } }
          if (verdict === 'fail') return Promise.resolve(error).then(resolve, reject)
          if (verdict === 'after') return then(() => resolve(error), reject)
          return then(resolve, reject)
        }
        return b
      },
    }
  }
}

test('steps: any error after the publish takes the outcome down and fails closed (asked again)', async () => {
  const is = (table, action, n) => (op) => op.table === table && op.action === action && op.n === n
  const any = (...rules) => (op) => rules.map((r) => r(op)).find(Boolean)
  const tag = (verdict, rule) => (op) => (rule(op) ? verdict : null)
  const claimFails = tag('fail', is('reports', 'update', 1))
  const claimWritesThenFails = tag('after', is('reports', 'update', 1))
  const recheckFails = tag('fail', is('reports', 'select', 1))
  const linkReadFails = tag('fail', is('outcome_author_links', 'select', 1))
  const takeDownFails = tag('fail', is('peer_outcomes', 'update', 1))
  const cases = {
    'claim fails': claimFails,
    'claim writes, then fails': claimWritesThenFails,
    're-read fails': recheckFails,
    'claim fails, the take-down link read fails': any(claimFails, linkReadFails),
    'claim fails, the take-down write fails': any(claimFails, takeDownFails),
    'claim writes then fails, the take-down write fails': any(claimWritesThenFails, takeDownFails),
    're-read fails, the take-down write fails': any(recheckFails, takeDownFails),
  }
  for (const [name, rule] of Object.entries(cases)) {
    const w = world({ wrap: failAt(rule) })
    await assert.rejects(() => w.sharing.share({ userId: USER, report: stored(w), move, automatic: false, wordingVersion: 'v' }), undefined, name)
    assert.equal(w.state(), 'asked', `${name}: the founder is asked again`)
    assert.equal(w.live().length, 0, `${name}: no outcome stays live`)
  }

  // A lost claim whose take-down write fails: the outcome is removed instead.
  const lost = world({ reportOver: { share_state: 'private' }, wrap: failAt(takeDownFails) })
  assert.equal(await lost.sharing.share({ userId: USER, report: { ...stored(lost), share_state: 'asked' }, move, automatic: false, wordingVersion: 'v' }), null)
  assert.equal(lost.state(), 'private')
  assert.equal(lost.live().length, 0)

  // An automatic share (from no state yet) goes back to no state, so the
  // report can still ask.
  const auto = world({ reportOver: { share_state: null }, wrap: failAt(claimWritesThenFails) })
  await assert.rejects(() => auto.sharing.share({ userId: USER, report: stored(auto), move, automatic: true, wordingVersion: 'v' }))
  assert.equal(auto.state(), null)
  assert.equal(auto.live().length, 0)
})

test('care that begins after a share takes every share of the founder down, with no consent row', async () => {
  const w = world()
  await w.sharing.share({ userId: USER, report: stored(w), move, automatic: false, wordingVersion: 'v' })
  assert.equal(w.live().length, 1)
  await w.sharing.takeDownForCare(USER)
  assert.equal(w.state(), 'not_offered')
  assert.equal(w.live().length, 0)
  assert.deepEqual(w.log(), ['share'])
})

test('withdraw whose take-down removes a racing re-share does not leave "shared" with nothing live', async () => {
  const w = world()
  await w.sharing.share({ userId: USER, report: stored(w), move, automatic: false, wordingVersion: 'v' })
  let injected = false
  const racing = {
    ...w.base,
    from(table) {
      const b = w.base.from(table)
      if (table !== 'outcome_author_links' || injected || w.state() !== 'withdrawn') return b
      injected = true
      const then = b.then.bind(b)
      // The founder re-shares between the withdraw's claim and its take-down read.
      b.then = (resolve, reject) => w.sharing.share({ userId: USER, report: { ...stored(w), share_state: 'withdrawn' }, move, automatic: false, wordingVersion: 'v' })
        .then(() => then(resolve, reject), reject)
      return b
    },
  }
  const sharing = createSharing({ supabase: racing, clock: createFakeClock(NOW) })
  await sharing.unshare({ userId: USER, report: stored(w), to: 'withdrawn', wordingVersion: 'v' })
  assert.ok(injected)
  assert.equal(w.live().length, 0)
  assert.equal(w.state(), 'withdrawn', 'state matches what is live')
})

test('a missing or mismatched SQL function (PGRST202) is an error, not a silent step-by-step fallback', async () => {
  const w = world()
  const supabase = { ...w.base, rpc: async () => ({ data: null, error: { code: 'PGRST202', message: 'no function' } }) }
  const sharing = createSharing({ supabase, clock: createFakeClock(NOW) })
  await assert.rejects(() => sharing.share({ userId: USER, report: stored(w), move, automatic: false, wordingVersion: 'v' }), (e) => e.code === 'PGRST202')
  await assert.rejects(() => sharing.unshare({ userId: USER, report: stored(w), to: 'private', wordingVersion: 'v' }), (e) => e.code === 'PGRST202')
  assert.equal(w.state(), 'asked')
  assert.equal(w.live().length, 0)
  assert.equal(w.base.rows('consent_log').length, 0)
})
