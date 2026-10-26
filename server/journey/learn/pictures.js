// The fixed picture library for Learn, and the server check on its numbers.
// A picture is plain data; the app draws it from a template. No AI artwork.
// Every number in a picture must be one the founder gave, one calculated from
// those by a stated rule (and recomputed here), or one from a verified passage.
// Pure: no model, no I/O.

export const PICTURE_TYPES = Object.freeze(['split_bar', 'before_after_bars', 'side_by_side_table', 'timeline', 'two_by_two'])
const MAX_TEXT = 60

// picture: { type, data, derived?, interactive? }
//   split_bar:          data { title?, unit?, parts: [{ label, value }] }          2 to 6 parts
//   before_after_bars:  data { title?, unit?, items: [{ label, before, after }] }  1 to 5 items
//   side_by_side_table: data { title?, columns: [label, label(, label)], rows: [{ label, cells: [text...] }] }  2 to 6 rows
//   timeline:           data { title?, events: [{ when, label }] }                 2 to 7 events
//   two_by_two:         data { title?, x: { low, high }, y: { low, high }, quadrants: [4 x { label }] }
//   derived: [{ rule, inputs: [number...], value }]  rule is one of DERIVE_RULES
// Returns { ok, problems, picture }; `picture` is the cleaned copy to store.

const round = (n) => Math.round(n * 100) / 100
export const DERIVE_RULES = Object.freeze({
  sum: (xs) => xs.reduce((a, b) => a + b, 0),
  difference: ([a, b]) => a - b,
  product: ([a, b]) => a * b,
  quotient: ([a, b]) => (b === 0 ? NaN : a / b),
  percent_of: ([part, whole]) => (whole === 0 ? NaN : (part / whole) * 100),
  percent_change: ([from, to]) => (from === 0 ? NaN : ((to - from) / from) * 100),
})
const RULE_ARITY = { difference: 2, product: 2, quotient: 2, percent_of: 2, percent_change: 2 }

const WORD_NUMBERS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  hundred: 100, thousand: 1000, million: 1000000, dozen: 12, half: 0.5, twice: 2, once: 1,
}
const SUFFIX = { k: 1e3, thousand: 1e3, m: 1e6, mm: 1e6, million: 1e6 }

// Numbers in a text: digits ("1,200", "5k", "20%") and number words.
export function numbersIn(text) {
  const t = String(text ?? '').normalize('NFKC').toLowerCase()
  const out = []
  for (const m of t.matchAll(/(?<![\p{L}\d.])(\d[\d,]*(?:\.\d+)?)\s?(thousand|million|mm|k|m)?(?![\p{L}\d])/gu)) {
    const base = Number(m[1].replace(/,/g, ''))
    if (Number.isFinite(base)) out.push(round(base * (m[2] ? SUFFIX[m[2]] : 1)))
  }
  for (const m of t.matchAll(/(?<![\p{L}])([a-z]+)(?![\p{L}])/g)) {
    if (Object.hasOwn(WORD_NUMBERS, m[1])) out.push(WORD_NUMBERS[m[1]])
  }
  return out
}

const isText = (s) => typeof s === 'string' && s.trim().length > 0 && s.length <= MAX_TEXT
const isCount = (arr, min, max) => Array.isArray(arr) && arr.length >= min && arr.length <= max
const isNum = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0

// Shape check per type. Returns the cleaned data or null, pushing problems.
const SHAPES = {
  split_bar(d, bad) {
    if (!isCount(d.parts, 2, 6) || !d.parts.every((p) => isText(p?.label) && isNum(p?.value))) return bad('split_bar needs 2 to 6 parts with a label and a value')
    return { parts: d.parts.map((p) => ({ label: p.label.trim(), value: p.value })), ...(d.unit ? { unit: String(d.unit).slice(0, 12) } : {}) }
  },
  before_after_bars(d, bad) {
    if (!isCount(d.items, 1, 5) || !d.items.every((i) => isText(i?.label) && isNum(i?.before) && isNum(i?.after))) return bad('before_after_bars needs 1 to 5 items with a label, before and after')
    return { items: d.items.map((i) => ({ label: i.label.trim(), before: i.before, after: i.after })), ...(d.unit ? { unit: String(d.unit).slice(0, 12) } : {}) }
  },
  side_by_side_table(d, bad) {
    if (!isCount(d.columns, 2, 3) || !d.columns.every(isText)) return bad('side_by_side_table needs 2 or 3 column labels')
    if (!isCount(d.rows, 2, 6) || !d.rows.every((r) => isText(r?.label) && Array.isArray(r.cells) && r.cells.length === d.columns.length && r.cells.every(isText))) {
      return bad('side_by_side_table needs 2 to 6 rows with a label and one short cell per column')
    }
    return { columns: d.columns.map((c) => c.trim()), rows: d.rows.map((r) => ({ label: r.label.trim(), cells: r.cells.map((c) => c.trim()) })) }
  },
  timeline(d, bad) {
    if (!isCount(d.events, 2, 7) || !d.events.every((e) => isText(e?.when) && isText(e?.label))) return bad('timeline needs 2 to 7 events with when and label')
    return { events: d.events.map((e) => ({ when: e.when.trim(), label: e.label.trim() })) }
  },
  two_by_two(d, bad) {
    const axis = (a) => isText(a?.low) && isText(a?.high)
    if (!axis(d.x) || !axis(d.y)) return bad('two_by_two needs low and high labels on both axes')
    if (!isCount(d.quadrants, 4, 4) || !d.quadrants.every((q) => isText(q?.label))) return bad('two_by_two needs exactly 4 quadrants with a label')
    return {
      x: { low: d.x.low.trim(), high: d.x.high.trim() },
      y: { low: d.y.low.trim(), high: d.y.high.trim() },
      quadrants: d.quadrants.map((q) => ({ label: q.label.trim() })),
    }
  },
}

// Every number written anywhere in the cleaned data (values and words).
function numbersInData(value) {
  if (typeof value === 'number') return [round(value)]
  if (typeof value === 'string') return numbersIn(value)
  if (Array.isArray(value)) return value.flatMap(numbersInData)
  if (value && typeof value === 'object') return Object.values(value).flatMap(numbersInData)
  return []
}

// founderTexts: every string the founder typed or chose (this situation).
// passageTexts: verified quotes that survived citation checking.
export function checkPicture({ picture, founderTexts = [], passageTexts = [] }) {
  const problems = []
  const bad = (msg) => { problems.push(msg); return null }

  if (!picture || typeof picture !== 'object') return { ok: false, problems: ['no picture'], picture: null }
  if (!PICTURE_TYPES.includes(picture.type)) return { ok: false, problems: [`unknown picture type: ${picture.type}`], picture: null }
  const data = picture.data && typeof picture.data === 'object' ? picture.data : {}
  const cleaned = SHAPES[picture.type](data, bad)
  if (!cleaned) return { ok: false, problems, picture: null }
  if (data.title != null) {
    if (isText(data.title)) cleaned.title = data.title.trim()
    else problems.push('title is empty or too long')
  }

  const allowed = new Set([...founderTexts, ...passageTexts].flatMap(numbersIn))
  const derived = []
  for (const d of Array.isArray(picture.derived) ? picture.derived : []) {
    const rule = DERIVE_RULES[d?.rule]
    const inputs = d?.inputs
    if (!rule) { problems.push(`unknown rule: ${d?.rule}`); continue }
    if (!Array.isArray(inputs) || inputs.length < 2 || (RULE_ARITY[d.rule] && inputs.length !== RULE_ARITY[d.rule]) || !inputs.every(Number.isFinite)) {
      problems.push(`rule ${d.rule} has the wrong inputs`); continue
    }
    const missing = inputs.find((n) => !allowed.has(round(n)))
    if (missing !== undefined) { problems.push(`rule input is not from the founder or a passage: ${missing}`); continue }
    const expected = round(rule(inputs))
    if (!Number.isFinite(expected) || round(Number(d.value)) !== expected) { problems.push(`rule ${d.rule} does not give ${d.value}`); continue }
    allowed.add(expected)
    derived.push({ rule: d.rule, inputs, value: expected })
  }

  for (const n of new Set(numbersInData(cleaned))) {
    if (!allowed.has(n)) problems.push(`number is not from the founder, a passage or a stated rule: ${n}`)
  }

  if (problems.length) return { ok: false, problems, picture: null }
  return { ok: true, problems: [], picture: { type: picture.type, data: cleaned, derived, interactive: picture.interactive === true } }
}
