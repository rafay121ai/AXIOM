import { modelForStep } from './config.js'

export class StructuredOutputError extends Error {
  constructor(message, { step, problems }) {
    super(message)
    this.name = 'StructuredOutputError'
    this.step = step
    this.problems = problems
  }
}

const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v)
const matchesType = (v, t) => (t === 'number' ? typeof v === 'number' && Number.isFinite(v) : typeOf(v) === t)

// The schema sent to the model, without string lengths. Strict mode enforces
// them while decoding, so a long answer was cut mid-sentence or squeezed with
// foreign characters (a live Read, Nov 9). validateAgainstSchema still checks
// them, and a reply that breaks them is asked for again.
export function withoutLengths(schema) {
  if (Array.isArray(schema)) return schema.map(withoutLengths)
  if (!schema || typeof schema !== 'object') return schema
  const out = {}
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'minLength' || key === 'maxLength') continue
    out[key] = key === 'enum' || key === 'required' ? value : withoutLengths(value)
  }
  return out
}

// Checks a value against the JSON Schema subset used for model output:
// type, enum, properties/required/additionalProperties, items, minLength,
// maxLength, minItems, maxItems, minimum, maximum. Returns a list of problems.
export function validateAgainstSchema(value, schema, path = '$') {
  const problems = []
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type]
    if (!types.some((t) => matchesType(value, t))) {
      return [`${path}: expected ${types.join('|')}, got ${typeOf(value)}`]
    }
  }
  if (schema.enum && !schema.enum.includes(value)) problems.push(`${path}: not an allowed value`)
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) problems.push(`${path}: too short`)
    if (schema.maxLength !== undefined && value.length > schema.maxLength) problems.push(`${path}: too long`)
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) problems.push(`${path}: below minimum`)
    if (schema.maximum !== undefined && value > schema.maximum) problems.push(`${path}: above maximum`)
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) problems.push(`${path}: too few items`)
    if (schema.maxItems !== undefined && value.length > schema.maxItems) problems.push(`${path}: too many items`)
    if (schema.items) value.forEach((item, i) => problems.push(...validateAgainstSchema(item, schema.items, `${path}[${i}]`)))
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const props = schema.properties || {}
    for (const key of schema.required || []) {
      if (!Object.hasOwn(value, key)) problems.push(`${path}.${key}: missing`)
    }
    for (const [key, v] of Object.entries(value)) {
      if (Object.hasOwn(props, key)) problems.push(...validateAgainstSchema(v, props[key], `${path}.${key}`))
      else if (schema.additionalProperties === false) problems.push(`${path}.${key}: not allowed`)
    }
  }
  return problems
}

// One structured model call for a journey step. The model comes from config
// (by step), never from the caller's input. Output must parse as JSON and pass
// the schema; otherwise it retries once, then throws StructuredOutputError.
// Every attempt writes a usage row, because every attempt costs tokens.
export async function callStructured({
  openai,
  logModelUsage,
  step,
  schema,
  schemaName = `${step}_output`,
  messages,
  userId = null,
  usageContext = {},
  maxCompletionTokens = 1500,
  env = process.env,
  clock = { now: () => Date.now() },
}) {
  const model = modelForStep(step, env)
  // Cost rows name the journey step (read, learn, move...), not "chat".
  const stepUsage = { ...usageContext, call_type: step }
  let problems = []

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const startedAt = clock.now()
    const attemptMessages = attempt === 1
      ? messages
      : [...messages, { role: 'system', content: `Your last reply was invalid (${problems.slice(0, 5).join('; ')}). Reply again with valid JSON that matches the schema.` }]
    let response
    try {
      response = await openai.chat.completions.create({
        model,
        messages: attemptMessages,
        max_completion_tokens: maxCompletionTokens,
        response_format: { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema: withoutLengths(schema) } },
      })
    } catch (err) {
      await logModelUsage({
        userId, usageContext: stepUsage, model, latencyMs: clock.now() - startedAt,
        error: true, errorDetails: err?.message || 'LLM call failed',
      })
      throw err
    }

    await logModelUsage({
      userId, usageContext: stepUsage, model, usage: response.usage || null, latencyMs: clock.now() - startedAt,
    })

    let parsed
    try {
      parsed = JSON.parse(response.choices?.[0]?.message?.content ?? '')
      problems = validateAgainstSchema(parsed, schema)
    } catch {
      problems = ['reply was not valid JSON']
    }
    if (problems.length === 0) return { data: parsed, model, attempts: attempt }
  }

  throw new StructuredOutputError(`Step "${step}" returned invalid output twice`, { step, problems })
}
