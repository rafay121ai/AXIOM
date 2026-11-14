import assert from 'node:assert/strict'
import test from 'node:test'
import { retrieveEvidence, evidenceFromRows, createEmbedder, POOL_MAX, MAX_EVIDENCE, MIN_LESSON_SIMILARITY } from './retrieve.js'
import { validateCitations } from './citations.js'
import { composeReply } from './reply.js'
import { learnMessages, LEARN_PROMPT } from './prompts/learn.js'
import { createFakeOpenAI } from '../../testing/fakes.js'

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const chunk = (n, book, sim = 0.5) => ({ id: uuid(n), pillar: 'p', author: `Author ${book}`, title: `Book ${book}`, key_frameworks: `Passage ${n} about the book ${book}.`, similarity: sim })
const src = (book) => uuid(9000 + String(book).charCodeAt(0))
const lesson = (id, book, sim, extra = {}) => ({
  lesson_id: id, wiki_source_id: src(book), author: `Author ${book}`, source_title: `Book ${book}`, chapter: 'Chapter 4', page_start: 61, page_end: 63,
  principle: 'Ask about the past.', applies_when: 'Before you pitch.', paragraphs: ['Facts about the past beat opinions about the future.', { id: 'p2', text: 'Never pitch before you listen.' }, '  '],
  similarity: sim, ...extra,
})
// chunk id -> source id: the book letter of "Book X" unless `sources` overrides it.
const fakeKnowledge = ({ chunks, lessons, lessonError = null, lessonThrows = false, sources = null, chunkReadError = null }) => {
  const calls = []
  return {
    calls,
    from(table) {
      calls.push({ name: `from:${table}` })
      return { select: () => ({ async in(col, ids) {
        if (chunkReadError) return { data: null, error: chunkReadError }
        const map = sources ?? Object.fromEntries(chunks.map((c) => [c.id, src(c.title.slice(-1))]))
        return { data: ids.filter((id) => map[id]).map((id) => ({ id, source_id: map[id] })), error: null }
      } }) }
    },
    async rpc(name, args) {
      calls.push({ name, args })
      if (name === 'match_wiki_chunks') return { data: chunks, error: null }
      if (lessonThrows) throw new Error('boom')
      return { data: lessons ?? null, error: lessonError }
    },
  }
}
const embed = async (input, opts) => { embed.seen.push(opts); return [0.1, 0.2] }
embed.seen = []
const run = (k, lessonCites = true, log = () => {}) => retrieveEvidence({ knowledgeSupabase: k, embed, query: 'need', lessonCites, log })

test('flag off: same rows as today, no lesson call, no dimensions', async () => {
  const chunks = Array.from({ length: 9 }, (_, i) => chunk(i + 1, String.fromCharCode(65 + i)))
  const k = fakeKnowledge({ chunks, lessons: [lesson('L1', 'A', 0.9)] })
  embed.seen = []
  const out = await run(k, false)
  assert.deepEqual(out, evidenceFromRows(chunks))
  assert.equal(out.length, MAX_EVIDENCE)
  assert.deepEqual(k.calls.map((c) => c.name), ['match_wiki_chunks'])
  assert.equal(embed.seen[0].dimensions, undefined)
})

test('flag off: prompt and shown rows carry no lesson text', () => {
  const rows = evidenceFromRows([chunk(1, 'A')])
  const m = learnMessages({ mode: 'lesson', situation: [], read: {}, learn: [], evidence: rows.map((e) => ({ handle: e.handle, text: e.text })) })
  assert.equal(m[0].content, LEARN_PROMPT)
  assert.ok(!m.some((x) => /lesson/i.test(x.content) && x !== m.find((y) => y.content.startsWith('This turn'))))
})

test('pool is up to POOL_MAX with at most 2 per book', async () => {
  const chunks = [...Array.from({ length: 5 }, (_, i) => chunk(i + 1, 'A', 0.6 - i * 0.01)), ...Array.from({ length: 14 }, (_, i) => chunk(i + 10, String.fromCharCode(66 + i), 0.5 - i * 0.01))]
  const out = await run(fakeKnowledge({ chunks, lessons: [] }))
  assert.equal(out.length, POOL_MAX)
  assert.equal(out.filter((e) => e.author === 'Author A').length, 2)
})

test('lessons attach per book, in 512 dimensions, filtered to the pool source ids', async () => {
  const k = fakeKnowledge({ chunks: [chunk(1, 'A'), chunk(2, 'B')], lessons: [lesson('LA', 'A', 0.6), lesson('LB', 'B', 0.5)] })
  embed.seen = []
  const out = await run(k)
  assert.equal(out[0].lesson.lesson_id, 'LA')
  assert.equal(out[1].lesson.lesson_id, 'LB')
  assert.deepEqual(out[0].lesson.paragraphs, ['Facts about the past beat opinions about the future.', 'Never pitch before you listen.'])
  assert.equal(embed.seen[0].dimensions, undefined)
  assert.equal(embed.seen[1].dimensions, 512)
  const args = k.calls.find((c) => c.name === 'match_lessons').args
  assert.deepEqual(args.filter_sources, [src('A'), src('B')])
  assert.equal('filter_books' in args, false)
  assert.equal(args.match_count, 50)
})

test('a lesson of another book is never attached', async () => {
  const out = await run(fakeKnowledge({ chunks: [chunk(1, 'A')], lessons: [lesson('LZ', 'Z', 0.95)] }))
  assert.equal('lesson' in out[0], false)
})

test('a lesson spelled differently still attaches when the source ids match', async () => {
  const odd = lesson('LA', 'A', 0.6, { author: 'A. Author (ed.)', source_title: 'Book A: The Second Edition' })
  const out = await run(fakeKnowledge({ chunks: [chunk(1, 'A')], lessons: [odd] }))
  assert.equal(out[0].lesson.lesson_id, 'LA')
})

test('a lesson of another source id never attaches, even with identical spelling', async () => {
  const out = await run(fakeKnowledge({ chunks: [chunk(1, 'A')], lessons: [lesson('LA', 'A', 0.9, { wiki_source_id: src('Z') })] }))
  assert.equal('lesson' in out[0], false)
})

test('a row with an unknown source id gets no lesson', async () => {
  const k = fakeKnowledge({ chunks: [chunk(1, 'A'), chunk(2, 'B')], lessons: [lesson('LA', 'A', 0.9), lesson('LB', 'B', 0.9)], sources: { [uuid(2)]: src('B') } })
  const out = await run(k)
  assert.equal('lesson' in out[0], false)
  assert.equal(out[1].lesson.lesson_id, 'LB')
})

test('a failed wiki_chunks read gives chunk-only rows, no throw', async () => {
  const k = fakeKnowledge({ chunks: [chunk(1, 'A')], lessons: [lesson('LA', 'A', 0.9)], chunkReadError: { message: 'down' } })
  assert.deepEqual(await run(k), evidenceFromRows([chunk(1, 'A')], POOL_MAX))
})

test('a lesson below MIN_LESSON_SIMILARITY is not attached', async () => {
  const out = await run(fakeKnowledge({ chunks: [chunk(1, 'A')], lessons: [lesson('LA', 'A', MIN_LESSON_SIMILARITY - 0.01)] }))
  assert.equal('lesson' in out[0], false)
})

test('rpc error, throw, bad shape: chunk-only rows, no throw', async () => {
  for (const k of [
    fakeKnowledge({ chunks: [chunk(1, 'A')], lessonError: { message: 'relation "lessons" does not exist' } }),
    fakeKnowledge({ chunks: [chunk(1, 'A')], lessonThrows: true }),
    fakeKnowledge({ chunks: [chunk(1, 'A')], lessons: { nope: 1 } }),
    fakeKnowledge({ chunks: [chunk(1, 'A')], lessons: [lesson('LA', 'A', 0.9, { paragraphs: 'text' })] }),
  ]) {
    const out = await run(k)
    assert.deepEqual(out, evidenceFromRows([chunk(1, 'A')], POOL_MAX))
  }
})

test('the log line carries counts only', async () => {
  const logs = []
  await run(fakeKnowledge({ chunks: [chunk(1, 'A'), chunk(2, 'B')], lessons: [lesson('LA', 'A', 0.6)] }), true, (...a) => logs.push(a))
  assert.deepEqual(logs, [['learn evidence pool', { rows: 2, with_lesson: 1 }]])
})

test('createEmbedder passes dimensions only when given', async () => {
  const openai = createFakeOpenAI()
  const e = createEmbedder({ openai, logModelUsage: async () => {} })
  await e('x')
  await e('x', { dimensions: 512 })
  const payloads = openai.calls.filter((c) => c.payload.input).map((c) => c.payload)
  assert.equal('dimensions' in payloads[0], false)
  assert.equal(payloads[1].dimensions, 512)
})

// ── Citations ────────────────────────────────────────────────────────────────
const ROW = {
  handle: 'E1', author: 'Author A', source_title: 'Book A', text: 'Chunk text says always keep it casual and push for commitment.',
  lesson: { lesson_id: 'LA', chapter: 'Chapter 4', page_start: 61, page_end: 63, principle: 'x', applies_when: 'y', paragraphs: ['Facts about the past beat opinions about the future.'] },
}
const cite = (c, evidence = [ROW]) => validateCitations({ answer: { text: 'Hear it. [E1]', citations: [c] }, evidence })

test('quote in the lesson gets chapter and pages from the lesson', () => {
  const r = cite({ handle: 'E1', quote: 'facts about the past beat opinions' })
  assert.equal(r.sources[0].chapter, 'Chapter 4')
  assert.equal(r.sources[0].page_start, 61)
  assert.equal(r.sources[0].page_end, 63)
})

test('quote only in the chunk gets no chapter or page', () => {
  const r = cite({ handle: 'E1', quote: 'keep it casual and push for commitment' })
  assert.ok(r.sources[0].quote)
  assert.equal('chapter' in r.sources[0], false)
  assert.equal('page_start' in r.sources[0], false)
})

test('quote in neither is flagged; no quote means no chapter or page', () => {
  assert.ok(cite({ handle: 'E1', quote: 'never said any of this' }).flags.some((f) => f.type === 'unverified_quote'))
  const r = cite({ handle: 'E1' })
  assert.equal('chapter' in r.sources[0], false)
})

test('a model-claimed chapter or page is never used', () => {
  const r = cite({ handle: 'E1', quote: 'keep it casual and push for commitment', chapter: 'Chapter 9', page: 62 })
  assert.equal('chapter' in r.sources[0], false)
  assert.equal('page_start' in r.sources[0], false)
  assert.ok(r.flags.some((f) => f.type === 'invented_chapter'))
})

test('a handle outside the pool is rejected', () => {
  const r = cite({ handle: 'E7', quote: 'facts about the past beat opinions' })
  assert.equal(r.status, 'no_source')
  assert.equal(r.flags[0].type, 'unknown_handle')
})

test('the model is shown lessons only on rows that have one', async () => {
  const sent = []
  const evidence = [ROW, { handle: 'E2', author: 'Author B', source_title: 'Book B', text: 'Plain.' }]
  await composeReply({
    mode: 'lesson', step: 'learn', evidence, founderTexts: ['I have 2 clinics'], usageContext: {}, context: { situation: [], read: {}, learn: [] },
    deps: { userId: 'u', callStructured: async ({ messages }) => { sent.push(messages); return { data: { reply: 'x', citations: [], picture_json: '', follow_ups: [], move_subject: '', move_fact: '' } } } },
  }).catch(() => {})
  const shown = JSON.parse(sent[0].at(-1).content).evidence
  assert.deepEqual(shown[0].lesson, { idea: 'x', when: 'y', text: 'Facts about the past beat opinions about the future.' })
  assert.deepEqual(Object.keys(shown[1]), ['handle', 'author', 'title', 'text'])
  assert.ok(sent[0].some((m) => m.role === 'system' && m.content.includes('lesson: idea')) || sent[0].some((m) => m.content.includes('idea (a short verified summary)')))
})
