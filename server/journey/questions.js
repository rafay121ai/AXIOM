// The 14 sign-up questions (6 business, 7 personal, then the business question `stuck`) and their server-side validation. Wording and
// field names match app/src/api/fake.ts. The server owns the option lists:
// an answer that is not one of them is refused.

const single = (key, title, options, extra = {}) => ({ type: 'single', key, title, options, ...extra })

const GOAL_DATE_OPTION = 'Pick a date'
const COUNTRY_MAX = 80
export const TEXT_MAX = 2000
const OPTION_MAX = 5

export const QUESTIONS = Object.freeze([
  single('stage', 'Where are you with it right now?',
    ['Just an idea', "I'm talking to people about it", "I'm building it and nobody pays yet", 'Someone is paying me', "It's growing"],
    { sub: 'Pick what is true today, not where you hope to be.' }),
  single('commitment', 'How much of your week goes into it?',
    ['Full time', 'Part time, 15 hours or more', 'Evenings and weekends, under 15 hours', 'On and off']),
  single('business_model', 'Who pays you, or would?',
    ['Businesses', 'Consumers', 'Both sides of a marketplace', 'Clients, for services', 'No one yet']),
  {
    type: 'where', key: 'where', title: 'Where are you, and where are your customers?', sub: 'They are often not in the same place.',
    countryLabel: "I'm based in", countryPlaceholder: 'Start typing a country',
    countries: ['Pakistan', 'India', 'United States', 'United Kingdom', 'United Arab Emirates', 'Saudi Arabia', 'Canada', 'Nigeria', 'Kenya', 'Egypt', 'Bangladesh', 'Germany', 'Singapore', 'Australia', 'Brazil'],
    customerLabel: 'My customers are', customers: ['Mostly in my own country', 'Mostly abroad', 'Both'],
  },
  {
    type: 'goal', key: 'goal', title: 'What are you aiming for, and by when?',
    goals: ['My first customer', 'My first 10 customers', 'A revenue number', 'Raise money', 'Ship it'],
    whenLabel: 'By when?', whens: ['This month', 'In 3 months', 'In 6 months', GOAL_DATE_OPTION], dateOption: GOAL_DATE_OPTION,
  },
  {
    type: 'text', key: 'building', title: 'What are you building, and for whom?', sub: 'A sentence or two is enough.',
    placeholder: 'I am building…', minLength: 12, shortHint: 'A little more, so Axiom has something real to work with.',
  },
  single('why', 'Why are you doing this?',
    ["To get out of a job I don't want", "I've lived this problem myself", 'I see a big opportunity', 'To prove something', 'Freedom, money, or something that matters'],
    { sub: 'Pick the one that is most true, even if it is not flattering.' }),
  {
    type: 'two', key: 'strengths', title: 'Be honest about yourself.', sub: 'Pick as many as are true.',
    groups: [
      { label: 'Better than most people at', options: ['Building the product', 'Selling', 'Numbers and planning', 'Leading people', 'Not quitting'] },
      { label: 'What I avoid most', options: ['Talking to customers', 'Asking for money', 'Pricing', 'Hard talks with the team', 'Launching'] },
    ],
  },
  single('decision', 'You have a big decision and not enough information. What do you usually do?',
    ['Decide now and adjust later', 'Wait and collect more', 'Ask someone I trust', 'Put it off until I have to']),
  single('drop_plan', 'When you drop a plan halfway, it is usually because…',
    ['A better idea showed up', 'It got repetitive', 'Nobody was checking on me', 'It got uncomfortable', 'I rarely drop plans']),
  single('hard_truth', 'When someone tells you something hard about your work, you want it…',
    ['Gently', 'Straight', 'Blunt, no padding']),
  {
    type: 'text', key: 'contrarian', optional: true, title: 'What do you believe about this business that most people around you would argue with?',
    sub: 'Skip if nothing comes to mind.', placeholder: 'Most people think… but I think…', minLength: 3,
  },
  {
    type: 'text', key: 'people', optional: true, title: 'Who else is part of this? Names and what they do.',
    sub: 'A cofounder, first customers, an advisor. Skip if nobody yet.', placeholder: 'Sam, my cofounder, does sales…', minLength: 3,
  },
  {
    type: 'text', key: 'stuck', title: 'What are you most stuck on, or putting off? And what have you tried on it?', sub: 'Numbers help.',
    placeholder: 'The thing I keep avoiding is…', minLength: 20, shortHint: 'A little more, so Axiom has something real to work with.',
  },
])

export const QUESTION_KEYS = Object.freeze(QUESTIONS.map((q) => q.key))
export const questionByKey = (key) => QUESTIONS.find((q) => q.key === key) ?? null

// An optional question the founder skipped is stored as { skipped: true }.
export const SKIP = Object.freeze({ skipped: true })
export const isSkip = (v) => isObject(v) && v.skipped === true && Object.keys(v).length === 1
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const onlyKeys = (obj, allowed) => Object.keys(obj).every((k) => allowed.includes(k))
const cleanText = (v, max, min = 1) => {
  if (typeof v !== 'string') return null
  const t = v.trim().replace(/\r\n/g, '\n')
  return t.length >= min && t.length <= max ? t : null
}

function isoDateOk(value, now) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) return false
  // The founder's time zone is not known yet: accept today anywhere on Earth (UTC-12 is the last to change day).
  const today = new Date(now - 12 * 3_600_000).toISOString().slice(0, 10)
  const limit = new Date(now + 5 * 366 * 86_400_000).toISOString().slice(0, 10)
  return value >= today && value <= limit
}

function pickList(list, options) {
  if (!Array.isArray(list) || list.length > OPTION_MAX) return null
  if (!list.every((v) => typeof v === 'string' && options.includes(v))) return null
  if (new Set(list).size !== list.length) return null
  return list
}

// Returns { ok: true, value } with the stored shape, or { ok: false, error }.
export function validateAnswer(question, raw, { now = Date.now() } = {}) {
  const bad = (error) => ({ ok: false, error })
  switch (question.type) {
    case 'single': {
      if (!isObject(raw) || !onlyKeys(raw, ['value'])) return bad('Invalid answer')
      if (typeof raw.value !== 'string' || !question.options.includes(raw.value)) return bad('Pick one of the options')
      return { ok: true, value: { value: raw.value } }
    }
    case 'where': {
      if (!isObject(raw) || !onlyKeys(raw, ['country', 'customers'])) return bad('Invalid answer')
      const country = cleanText(raw.country, COUNTRY_MAX)
      if (!country) return bad('Invalid country')
      if (typeof raw.customers !== 'string' || !question.customers.includes(raw.customers)) return bad('Pick one of the options')
      return { ok: true, value: { country, customers: raw.customers } }
    }
    case 'goal': {
      if (!isObject(raw) || !onlyKeys(raw, ['goal', 'when', 'date'])) return bad('Invalid answer')
      if (typeof raw.goal !== 'string' || !question.goals.includes(raw.goal)) return bad('Pick one of the options')
      if (typeof raw.when !== 'string' || !question.whens.includes(raw.when)) return bad('Pick one of the options')
      if (raw.when === question.dateOption) {
        if (!isoDateOk(raw.date, now)) return bad('Invalid date')
        return { ok: true, value: { goal: raw.goal, when: raw.when, date: raw.date } }
      }
      if (raw.date !== undefined) return bad('Invalid answer')
      return { ok: true, value: { goal: raw.goal, when: raw.when } }
    }
    case 'two': {
      if (!isObject(raw) || !onlyKeys(raw, ['a', 'b'])) return bad('Invalid answer')
      const a = pickList(raw.a, question.groups[0].options)
      const b = pickList(raw.b, question.groups[1].options)
      if (!a || !b) return bad('Pick from the options')
      return { ok: true, value: { a, b } }
    }
    case 'text': {
      if (question.optional && isSkip(raw)) return { ok: true, value: SKIP }
      const text = cleanText(raw, TEXT_MAX, question.minLength)
      return text ? { ok: true, value: text } : bad(`Write at least ${question.minLength} characters, at most ${TEXT_MAX}`)
    }
    default:
      return bad('Invalid answer')
  }
}

// Every string the founder typed or chose, in question order, for the care
// gate and the first reading. Option labels count: they are their answers.
export function answerStrings(question, answer) {
  if (isSkip(answer)) return []
  switch (question.type) {
    case 'single': return [answer.value]
    case 'where': return [answer.country, answer.customers]
    case 'goal': return [answer.goal, answer.when, answer.date].filter(Boolean)
    case 'two': return [...answer.a, ...answer.b]
    default: return [answer]
  }
}

// Free text typed by the founder: what the care gate reads.
export function typedStrings(question, raw) {
  const text = (v) => (typeof v === 'string' ? [v] : [])
  switch (question.type) {
    case 'where': return isObject(raw) ? text(raw.country) : []
    case 'text': return text(raw)
    default: return []
  }
}
