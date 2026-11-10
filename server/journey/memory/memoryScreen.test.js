import assert from 'node:assert/strict'
import test from 'node:test'
import { createApp } from '../../app.js'
import { createFakeClock, createFakeOpenAI, createFakeSupabase } from '../../testing/fakes.js'
import { TRAIT_DIMENSIONS } from './beliefRules.js'
import { applyExtraction } from './extractBeliefs.js'
import { buildBriefText } from './brief.js'
import { createMemoryStore } from './memoryStore.js'
import { GROUP_MAX, TRAIT_TEXT, createMemoryScreen, toSecondPerson } from './memoryScreen.js'
import { seedFromSignup, seedRows } from './signupSeed.js'
import { FULL_ANSWERS } from '../fixtures.js'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const NOW = Date.parse('2026-11-09T09:00:00.000Z')
const at = (n) => new Date(NOW - n * 3600000).toISOString()
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const base = (userId, n, extra) => ({ id: uuid(n), user_id: userId, status: 'active', created_at: at(n), updated_at: at(n), ...extra })
const belief = (userId, n, text, extra = {}) => base(userId, n, { belief: text, kind: 'fact', confidence: 0.6, source: 'conversation', ...extra })

const setup = (tables = {}) => {
  const supabase = createFakeSupabase({ tables })
  const clock = createFakeClock(NOW)
  return { supabase, clock, screen: createMemoryScreen({ supabase, clock }), store: createMemoryStore({ supabase, clock }) }
}

test('toSecondPerson: every sign-up sentence reads naturally', () => {
  const rows = seedRows({ ...FULL_ANSWERS, drop_plan: { value: 'Nobody was checking on me' }, hard_truth: { value: 'Blunt, no padding' } }, NOW)
  assert.ok(rows.length >= 6)
  for (const r of rows) assert.doesNotMatch(toSecondPerson(r.text), /\b(they|them|their|Says|Wants)\b/, r.text)
  const t = (text) => toSecondPerson(text)
  assert.equal(t('Their goal is ten clinics.'), 'Your goal is ten clinics.')
  assert.equal(t('Why they are doing it: to prove it.'), 'Why you are doing it: to prove it.')
  assert.equal(t('Based in Pakistan.'), 'You are based in Pakistan.')
  assert.equal(t('Says they are better than most at selling.'), 'You say you are better than most at selling.')
  assert.equal(t('Says they avoid cold calls.'), 'You say you avoid cold calls.')
  assert.equal(t('Says they drop plans when nobody is checking on them.'), 'You say you drop plans when nobody is checking on you.')
  assert.equal(t('Says they drop plans when a better idea shows up.'), 'You say you drop plans when a better idea shows up.')
  assert.equal(t('Wants hard things said bluntly, with no padding.'), 'You want hard things said bluntly, with no padding.')
  assert.equal(t('Your goal: 10 clinics, by 30 November.'), 'Your goal: 10 clinics, by 30 November.')
})

test('toSecondPerson never says something false', () => {
  for (const s of ['Their customers say they want monthly billing.', 'They sell to clinics and they pay late.', 'Plans for Q1 slipped twice.', 'Runs a team of four.', 'The founder sells to clinics and they pay late.', 'Says they drop plans when customers ask for discounts.']) {
    assert.equal(toSecondPerson(s), s)
  }
  assert.equal(toSecondPerson('The founder sells to clinics.'), 'You sell to clinics.')
  assert.equal(toSecondPerson('In their words: Everyone says plans beat speed.'), 'You said: "Everyone says plans beat speed."')
})

test('toSecondPerson: model-style sentences convert, unsafe ones stay as written', () => {
  assert.equal(toSecondPerson('Sells to clinics in Karachi.'), 'You sell to clinics in Karachi.')
  assert.equal(toSecondPerson('Is based in Karachi.'), 'You are based in Karachi.')
  assert.equal(toSecondPerson('Has two paying clinics.'), 'You have two paying clinics.')
  // "they" could be the clinics: leave it exactly as written
  for (const s of ['Sells to clinics that say they are busy.', 'Says they sell to clinics because they pay late.', 'Clinics go quiet and they never reply.', 'Most startups fail because they run out of focus.', 'Pricing is unclear.', 'Goal: 10 clinics.']) {
    assert.equal(toSecondPerson(s), s)
  }
})

test('trait text: every dimension and value has one plain sentence', () => {
  for (const [d, values] of Object.entries(TRAIT_DIMENSIONS)) {
    assert.deepEqual(Object.keys(TRAIT_TEXT[d]).sort(), [...values].sort())
    for (const v of values) assert.match(TRAIT_TEXT[d][v], /^(You|When something|Your)[^_]*\.$/)
  }
  assert.equal(TRAIT_TEXT.decision_speed.fast, 'You decide fast and adjust later.')
})

test('empty founder: no items', async () => {
  const { screen } = setup()
  assert.deepEqual(await screen.list(A), { items: [] })
})

test('each group, in order, in the second person, with the newest receipt', async () => {
  const { screen } = setup({
    founder_beliefs: [
      belief(A, 1, 'Says they drop plans when a better idea shows up.', { kind: 'pattern', confidence: 0.45 }),
      belief(A, 2, 'Wants hard things said straight.', { kind: 'preference', confidence: 0.5 }),
      belief(A, 3, 'Sells to clinics in Karachi.'),
    ],
    founder_traits: [base(A, 4, { dimension: 'decision_speed', value: 'fast', confidence: 0.5, origin: 'self_report' })],
    founder_world: [base(A, 5, { name: 'Sam', kind: 'person', role: 'cofounder', mention_count: 3, last_mentioned_at: at(1) })],
    founder_vocabulary: [base(A, 6, { term: 'the clinics', meaning: 'the two clinics you are pitching', confidence: 0.6, mention_count: 2 })],
    founder_threads: [base(A, 7, { title: 'Get the first clinic to sign', kind: 'goal', status: 'open' })],
    memory_evidence: [
      { id: uuid(80), user_id: A, item_table: 'founder_beliefs', item_id: uuid(3), snippet: 'old words', created_at: at(50), source_kind: 'report' },
      { id: uuid(81), user_id: A, item_table: 'founder_beliefs', item_id: uuid(3), snippet: 'I sell to clinics', created_at: at(2), source_kind: 'report' },
    ],
  })
  const { items } = await screen.list(A)
  assert.deepEqual(items.map((i) => [i.group, i.text]), [
    ['decide', 'You decide fast and adjust later.'],
    ['work', 'You say you drop plans when a better idea shows up.'],
    ['work', 'You want hard things said straight.'],
    ['business', 'You sell to clinics in Karachi.'],
    ['people', 'Sam: cofounder. You have mentioned Sam 3 times.'],
    ['people', '"the clinics" means the two clinics you are pitching.'],
    ['open', 'Get the first clinic to sign'],
  ])
  assert.deepEqual(items.find((i) => i.text.startsWith('You sell')).receipt, { text: '"I sell to clinics"', at: at(2) })
  assert.equal(items[0].receipt, null)
})

test('nothing internal leaks: only id, table, group, text and receipt', async () => {
  const { screen } = setup({
    founder_beliefs: [belief(A, 1, 'Sells candles.', { source: 'signup' })],
    memory_evidence: [{ id: uuid(80), user_id: A, item_table: 'founder_beliefs', item_id: uuid(1), snippet: 'candles', created_at: at(2), source_id: uuid(9), source_key: 'stage', source_kind: 'signup' }],
  })
  const [item] = (await screen.list(A)).items
  assert.deepEqual(Object.keys(item).sort(), ['group', 'id', 'receipt', 'table', 'text'])
  assert.deepEqual(Object.keys(item.receipt).sort(), ['at', 'text'])
  assert.doesNotMatch(JSON.stringify(item), /confidence|user_id|source|11111111/)
})

test('hidden: superseded, low confidence, dropped threads, another founder', async () => {
  const { screen } = setup({
    founder_beliefs: [belief(A, 1, 'Sells candles.', { status: 'superseded' }), belief(A, 2, 'Sells soap.', { confidence: 0.39 }), belief(B, 3, 'Sells to the other founder.')],
    founder_traits: [base(A, 4, { dimension: 'move_size', value: 'small_steps', confidence: 0.3, origin: 'observed' }), base(A, 5, { dimension: 'move_size', value: 'big_swings', confidence: 0.9, origin: 'observed', status: 'superseded' })],
    founder_world: [base(A, 6, { name: 'Old Sam', kind: 'person', mention_count: 1, last_mentioned_at: at(1), status: 'superseded' }), base(B, 7, { name: 'Zed', kind: 'person', mention_count: 1, last_mentioned_at: at(1) })],
    founder_threads: [base(A, 8, { title: 'Dropped thread', kind: 'goal', status: 'dropped' })],
  })
  assert.deepEqual(await screen.list(A), { items: [] })
})

test('each group is capped at 12, newest first', async () => {
  const many = (n, f) => Array.from({ length: n }, (_, i) => f(i + 1))
  const { screen } = setup({
    founder_beliefs: many(15, (i) => belief(A, i, `Pattern number ${i}.`.replace(/\d+/, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o'][i - 1]), { kind: 'pattern', confidence: 0.4 + i / 100 })),
    founder_world: many(14, (i) => base(A, 100 + i, { name: `Name${i}`, kind: 'person', mention_count: 1, last_mentioned_at: at(i) })),
  })
  const { items } = await screen.list(A)
  const group = (g) => items.filter((i) => i.group === g)
  assert.equal(group('work').length, GROUP_MAX)
  assert.match(group('work')[0].text, /Pattern number a/)
  assert.equal(group('people').length, GROUP_MAX)
  assert.match(group('people')[0].text, /^Name1\./)
})

test('people and shorthand are capped separately, so shorthand is never hidden', async () => {
  const many = (n, f) => Array.from({ length: n }, (_, i) => f(i + 1))
  const { screen } = setup({
    founder_world: many(14, (i) => base(A, 100 + i, { name: `Name${i}`, kind: 'person', mention_count: 2, last_mentioned_at: at(i) })),
    founder_vocabulary: many(14, (i) => base(A, 200 + i, { term: `term${i}`, meaning: 'something', confidence: 0.6, mention_count: 2 })),
  })
  const people = (await screen.list(A)).items.filter((i) => i.group === 'people')
  assert.equal(people.length, 2 * GROUP_MAX)
  assert.equal(people.filter((i) => i.table === 'founder_vocabulary').length, GROUP_MAX)
  assert.match(people[0].text, /^Name1\. You have mentioned Name1 2 times\.$/)
})

test('a move-only receipt reads "Your move", a contrarian answer reads "You said"', async () => {
  const { screen } = setup({
    founder_beliefs: [belief(A, 1, 'In their words: Plans beat speed.'), belief(A, 2, 'Sells to clinics.')],
    moves: [{ id: uuid(60), user_id: A, title: 'Email both clinics' }],
    memory_evidence: [{ id: uuid(80), user_id: A, item_table: 'founder_beliefs', item_id: uuid(2), snippet: 'Email both clinics today', created_at: at(1), source_kind: 'move', source_id: uuid(60) }],
  })
  const { items } = await screen.list(A)
  assert.equal(items.find((i) => i.text === 'You said: "Plans beat speed."')?.group, 'business')
  assert.equal(items.find((i) => i.text === 'You sell to clinics.').receipt.text, 'Your move: Email both clinics')
})

// ── Marking wrong ────────────────────────────────────────────────────────────

const seedAll = () => ({
  founder_beliefs: [belief(A, 1, 'Says they avoid cold calls.', { kind: 'pattern' }), belief(B, 2, 'Sells to the other founder.')],
  founder_traits: [base(A, 3, { dimension: 'decision_speed', value: 'fast', confidence: 0.5, origin: 'self_report' })],
  founder_world: [base(A, 4, { name: 'Sam', kind: 'person', role: 'cofounder', mention_count: 3, last_mentioned_at: at(1) })],
  founder_vocabulary: [base(A, 5, { term: 'the clinics', meaning: 'the two clinics', confidence: 0.6, mention_count: 2 })],
  founder_threads: [base(A, 6, { title: 'Get the first clinic to sign', kind: 'goal', status: 'open' })],
})

test('marking wrong writes one correction, retires the row, and is idempotent for every table', async () => {
  const { screen, supabase } = setup(seedAll())
  const cases = [['founder_beliefs', 1, 'superseded', 'Says they avoid cold calls.'], ['founder_traits', 3, 'superseded', 'decision_speed: fast'], ['founder_world', 4, 'superseded', 'Sam'],
    ['founder_vocabulary', 5, 'superseded', 'the clinics'], ['founder_threads', 6, 'dropped', 'Get the first clinic to sign']]
  for (const [table, n, status, text] of cases) {
    assert.deepEqual(await screen.markWrong({ userId: A, table, id: uuid(n), reason: 'outdated' }), { ok: true })
    assert.deepEqual(await screen.markWrong({ userId: A, table, id: uuid(n), reason: 'wrong' }), { ok: true })
    assert.equal(supabase.rows(table).find((r) => r.id === uuid(n)).status, status)
    assert.deepEqual(supabase.rows('founder_corrections').filter((c) => c.item_text === text).map((c) => [c.user_id, c.item_table, c.reason]), [[A, table, 'outdated']])
  }
  assert.equal(supabase.rows('founder_corrections').length, 5)
  assert.deepEqual(await screen.list(A), { items: [] })
  assert.equal(supabase.rows('founder_beliefs').find((r) => r.id === uuid(2)).status, 'active')
})

test('marking wrong: bad table, reason, id and another founder fail', async () => {
  const { screen, supabase } = setup(seedAll())
  const code = async (args) => screen.markWrong({ userId: A, reason: 'wrong', ...args }).then(() => 200, (e) => e.status)
  assert.equal(await code({ table: 'founder_corrections', id: uuid(1) }), 404)
  assert.equal(await code({ table: 'users', id: uuid(1) }), 404)
  assert.equal(await code({ table: 'founder_beliefs', id: uuid(1), reason: 'because' }), 400)
  assert.equal(await code({ table: 'founder_beliefs', id: uuid(2) }), 404) // B's row
  assert.equal(await code({ table: 'founder_beliefs', id: uuid(999) }), 404)
  assert.equal(supabase.rows('founder_corrections').length, 0)
  assert.equal(supabase.rows('founder_beliefs').find((r) => r.id === uuid(2)).status, 'active')
})

test('the routes: auth, shapes, 404 for a bad uuid, 400 for a bad reason', async () => {
  const supabase = createFakeSupabase({ users: { tok: { id: A, email: 'a@example.com' } }, tables: seedAll() })
  const app = createApp({ env: { FRONTEND_URL: 'https://app.example.com' }, supabase, openai: createFakeOpenAI([]), clock: createFakeClock(NOW) })
  const server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  const call = async (method, path, body, token = 'tok') => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, body: body && JSON.stringify(body) })
    return { status: res.status, body: await res.json() }
  }
  try {
    assert.equal((await call('GET', '/api/memory', undefined, null)).status, 401)
    assert.equal((await call('POST', `/api/memory/founder_beliefs/${uuid(1)}/wrong`, { reason: 'wrong' }, null)).status, 401)
    const got = await call('GET', '/api/memory')
    assert.equal(got.status, 200)
    assert.deepEqual(Object.keys(got.body), ['items'])
    assert.equal((await call('POST', '/api/memory/founder_beliefs/not-a-uuid/wrong', { reason: 'wrong' })).status, 404)
    assert.equal((await call('POST', `/api/memory/founder_beliefs/${uuid(1)}/wrong`, { reason: 'x' })).status, 400)
    assert.equal((await call('POST', `/api/memory/founder_beliefs/${uuid(1)}/wrong`)).status, 400)
    assert.equal((await call('POST', `/api/memory/founder_beliefs/${uuid(2)}/wrong`, { reason: 'wrong' })).status, 404)
    assert.deepEqual(await call('POST', `/api/memory/founder_beliefs/${uuid(1)}/wrong`, { reason: 'wrong' }), { status: 200, body: { ok: true } })
  } finally { await new Promise((r) => server.close(r)) }
})

// ── A corrected item does not come back ──────────────────────────────────────

test('a corrected item is not recreated by an extraction, for every table, and the brief drops it', async () => {
  const { screen, supabase, store, clock } = setup(seedAll())
  for (const [table, n] of [['founder_beliefs', 1], ['founder_traits', 3], ['founder_world', 4], ['founder_vocabulary', 5], ['founder_threads', 6]]) {
    await screen.markWrong({ userId: A, table, id: uuid(n), reason: 'wrong' })
  }
  const said = 'Sam and I pitch the clinics. I avoid cold calls. I decide fast. Get the first clinic to sign.'
  const snippet = (s) => s
  const data = {
    new_beliefs: [{ belief: 'Avoids cold calls.', kind: 'pattern', snippet: 'I avoid cold calls' }],
    traits: [{ dimension: 'decision_speed', value: 'fast', snippet: 'I decide fast' }],
    world: [{ name: 'Sam', kind: 'person', role: 'cofounder', snippet: 'Sam and I pitch' }],
    vocabulary: [{ term: 'the clinics', meaning: 'the two clinics', snippet: snippet('pitch the clinics') }],
    threads: [{ title: 'Get the first clinic to sign', kind: 'goal' }],
    reinforce: [], weaken: [], supersede: [],
  }
  const before = ['founder_beliefs', 'founder_traits', 'founder_world', 'founder_vocabulary', 'founder_threads'].map((t) => supabase.rows(t).length)
  await applyExtraction({ store, userId: A, data, mode: 'full', founderTexts: [said], receipt: () => ({ sourceKind: 'report', sourceId: uuid(900) }), beliefSource: 'report', nowMs: NOW, corrections: await store.corrections(A) })
  assert.deepEqual(['founder_beliefs', 'founder_traits', 'founder_world', 'founder_vocabulary', 'founder_threads'].map((t) => supabase.rows(t).length), before)
  assert.deepEqual(await screen.list(A), { items: [] })
  const brief = buildBriefText({
    beliefs: await store.activeBeliefs(A), traits: await store.activeTraits(A), world: await store.activeWorld(A),
    vocabulary: await store.activeVocabulary(A), threads: await store.openThreads(A), currentText: said, nowMs: clock.now(),
  })
  assert.equal(brief, '')
})

test('the sign-up seed does not recreate a corrected belief or trait', async () => {
  const answers = { ...FULL_ANSWERS, decision: { value: 'Decide now and adjust later' }, hard_truth: { value: 'Straight' } }
  const control = setup().supabase
  await seedFromSignup({ supabase: control, callStructured: async () => { throw new Error('no model') }, userId: A, answers, clock: createFakeClock(NOW) })
  assert.equal(control.rows('founder_traits').length, 1) // without a correction the trait is seeded
  const { supabase } = setup()
  const corrections = [
    { id: uuid(1), user_id: A, item_table: 'founder_beliefs', item_text: 'Wants hard things said straight.', reason: 'wrong', created_at: at(1) },
    { id: uuid(2), user_id: A, item_table: 'founder_traits', item_text: 'decision_speed: fast', reason: 'wrong', created_at: at(1) },
  ]
  for (const c of corrections) await supabase.from('founder_corrections').insert(c)
  await seedFromSignup({ supabase, callStructured: async () => { throw new Error('no model') }, userId: A, answers, clock: createFakeClock(NOW) })
  assert.ok(supabase.rows('founder_beliefs').length > 0)
  assert.equal(supabase.rows('founder_beliefs').some((b) => b.belief === 'Wants hard things said straight.'), false)
  assert.equal(supabase.rows('founder_traits').length, 0)
})

test('corrections: same table only, whole text for names, terms and traits, reason decides rewording', async () => {
  const { isCorrected } = await import('./extractBeliefs.js')
  const c = (item_table, item_text, reason = 'wrong') => [{ item_table, item_text, reason }]
  const B = 'founder_beliefs'
  assert.equal(isCorrected(c(B, 'Says they avoid cold calls.'), B, 'Avoids cold calls.'), true)
  assert.equal(isCorrected(c(B, 'Says they avoid cold calls.'), B, 'Sells to clinics in Karachi.'), false)
  assert.equal(isCorrected(c(B, 'Says they avoid cold calls.'), B, 'Avoids long emails.'), false)
  // other tables never block
  assert.equal(isCorrected(c('founder_world', 'Sam'), B, 'They want Sam to run sales.'), false)
  assert.equal(isCorrected(c(B, 'They want Ali to run sales.'), 'founder_world', 'Ali'), false)
  assert.equal(isCorrected(c('founder_vocabulary', 'MRR'), 'founder_threads', 'Get MRR to 10k by March'), false)
  // outdated blocks only the same text
  const old = 'They sell to dental clinics.'
  assert.equal(isCorrected(c(B, old, 'outdated'), B, 'They sell to dental clinics in Karachi and Dubai.'), false)
  assert.equal(isCorrected(c(B, old, 'outdated'), B, 'They sell to dental clinics.'), true)
  assert.equal(isCorrected(c(B, old, 'wrong'), B, 'Sells to dental clinics.'), true)
  // names, terms, traits: whole text only
  assert.equal(isCorrected(c('founder_world', 'Sam'), 'founder_world', 'Sam Lee'), false)
  assert.equal(isCorrected(c('founder_vocabulary', 'MRR'), 'founder_vocabulary', 'MRR'), true)
  assert.equal(isCorrected(c('founder_traits', 'decision_speed: fast'), 'founder_traits', 'decision speed fast'), true)
  // the exact item in every table is refused
  for (const [t, text] of [[B, 'Sells candles.'], ['founder_traits', 'move_size: small_steps'], ['founder_world', 'Sam'], ['founder_vocabulary', 'the clinics'], ['founder_threads', 'Get the first clinic to sign']]) {
    for (const reason of ['wrong', 'outdated']) assert.equal(isCorrected(c(t, text, reason), t, text.replace(/_/g, ' ')), true, `${t} ${reason}`)
  }
})

test('receipt wording: quoted words, your move, you picked', async () => {
  const ev = (n, item, extra) => ({ id: uuid(n), user_id: A, item_table: 'founder_beliefs', item_id: uuid(item), created_at: at(1), ...extra })
  const { screen } = setup({
    founder_beliefs: [belief(A, 1, 'Wants hard things said straight.', { kind: 'preference' }), belief(A, 2, 'Avoids cold calls.', { kind: 'pattern' }), belief(A, 3, 'Sells candles.'), belief(A, 4, 'Sells soap.'), belief(A, 5, 'Sells tea.')],
    moves: [{ id: uuid(60), user_id: A, title: 'Email both clinics' }, { id: uuid(61), user_id: B, title: 'Other founders move' }],
    memory_evidence: [
      ev(80, 1, { source_kind: 'signup', source_key: 'hard_truth', snippet: 'Straight' }),
      ev(81, 2, { source_kind: 'move', source_id: uuid(60), snippet: 'skipped the call' }),
      ev(82, 3, { source_kind: 'signup', source_key: 'building', snippet: 'I make candles' }),
      ev(83, 4, { source_kind: 'move', source_id: uuid(61), snippet: 'x' }),
    ],
  })
  const r = Object.fromEntries((await screen.list(A)).items.map((i) => [i.text, i.receipt?.text ?? null]))
  assert.equal(r['You want hard things said straight.'], 'You picked: Straight')
  assert.equal(r['You avoid cold calls.'] ?? r['Avoids cold calls.'], 'Your move: Email both clinics')
  assert.equal(r['You sell candles.'], '"I make candles"')
  assert.equal(r['You sell soap.'], '"x"') // another founder's move title is never read
  assert.equal(r['You sell tea.'], null)
})
