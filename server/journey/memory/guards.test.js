// Static guards for the memory layer. They read the source, so a new call site cannot skip a rule unnoticed.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = new URL('../../', import.meta.url).pathname
const files = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n)
  if (n === 'node_modules' || n === 'testing') return []
  return statSync(p).isDirectory() ? files(p) : p.endsWith('.js') && !p.endsWith('.test.js') ? [p] : []
})
const src = files(ROOT).map((p) => [relative(ROOT, p), readFileSync(p, 'utf8')])

// Founder-facing routes are capped by the route gate (dailyCapRoutes.test.js). Model calls made in the
// background have no route, so each memory file that calls a model must itself see the daily cost cap.
const CAP_WORDS = /isCapped|overCap|isOverDailyCap/
test('every memory file that calls a model references the daily cost cap', () => {
  const bad = src.filter(([f, s]) => f.startsWith('journey/memory/') && /callStructured\(/.test(s) && !CAP_WORDS.test(s)).map(([f]) => f)
  assert.deepEqual(bad, [], 'background model call without the daily cap: take isCapped and skip the call when it is true')
})

// Founder text reaches the memory tables only through the two passes, and both must use the shared clean function.
const WRITES = /\.(insertBelief|upsertTrait|upsertWorld|upsertVocabulary|insertThread)\(/
test('only the memory passes write memory text, and each cleans it with cleanStoredText', () => {
  const writers = src.filter(([f, s]) => WRITES.test(s) && !f.endsWith('memoryStore.js')).map(([f]) => f).sort()
  assert.deepEqual(writers, ['journey/memory/extractBeliefs.js', 'journey/memory/signupSeed.js'])
  for (const [f, s] of src) if (writers.includes(f)) assert.match(s, /cleanStoredText/, `${f} stores text without cleanStoredText`)
})
