export const BRAIN_NODE_THEMES = [
  {
    id: 'unfinished_build_loop',
    label: 'Unfinished Build Loop',
    pillar: 'human_mind',
    type: 'pattern',
    definition: 'Starting creates motion, but the live issue is finishing one bet long enough to be judged.',
    matches: [
      /starting things? and not finishing/,
      /started? .* not finish/,
      /habit of starting/,
      /still trying to figure out .* behind .* not finishing/,
    ],
  },
  {
    id: 'automation_sales_gap',
    label: 'Automation Sales Gap',
    pillar: 'money_game',
    type: 'goal',
    definition: 'The user can build AI automations, but the bottleneck is buyer contact and sales evidence.',
    matches: [
      /(automation|automations|software).*(no sales|sales pipeline|cold outreach|buyer|revenue)/,
      /(no sales|sales pipeline|cold outreach|buyer|revenue).*(automation|automations|software)/,
    ],
  },
  {
    id: 'market_contact',
    label: 'Market Contact',
    pillar: 'money_game',
    type: 'concept',
    definition: 'Buyer contact is the test: put the offer in front of someone before polishing it further in private.',
    matches: [
      /putting an offer in front of buyers before polishing it in private/,
      /offer .* front of buyers/,
      /buyer contact/,
      /market feedback/,
    ],
  },
  {
    id: 'creator_eguide_website',
    label: 'Creator E-Guide Website',
    pillar: 'money_game',
    type: 'fact',
    definition: 'A past build aimed at Pakistani female content creators, useful only if it produced buyer evidence.',
    matches: [
      /(e-guide|e guide|eguides|e-guides).*(pakistani|female content creator|content creators|website)/,
      /(pakistani|female content creator|content creators|website).*(e-guide|e guide|eguides|e-guides)/,
    ],
  },
  {
    id: 'axiom_differentiation_bet',
    label: 'Axiom Differentiation Bet',
    pillar: 'how_companies_win',
    type: 'goal',
    definition: 'The open question is whether Axiom changes founder behavior, not whether it merely sounds smarter than ChatGPT.',
    matches: [
      /axiom.*(different from chatgpt|better wrapper|mentor app|mvp stage)/,
      /(different from chatgpt|better wrapper|mentor app|mvp stage).*axiom/,
    ],
  },
  {
    id: 'cold_outreach_resistance',
    label: 'Cold Outreach Resistance',
    pillar: 'human_mind',
    type: 'pattern',
    definition: 'Sales resistance is the point where technical ability stops mattering until a real buyer is contacted.',
    matches: [
      /(cold outreach|outreach).*(hate|avoid|resistance|sales)/,
      /(hate|avoid|resistance).*(cold outreach|outreach|sales)/,
    ],
  },
  {
    id: 'august_revenue_target',
    label: 'August Revenue Target',
    pillar: 'money_game',
    type: 'goal',
    definition: 'The live constraint is turning skill into at least $5,000 before August 1 through paid demand, not more building.',
    matches: [
      /(\$?5,?000|5000|august 1|august).*(revenue|make|earn|sales|money)/,
      /(revenue|make|earn|sales|money).*(\$?5,?000|5000|august 1|august)/,
    ],
  },
  {
    id: 'paid_pilot_path',
    label: 'Paid Pilot Path',
    pillar: 'money_game',
    type: 'goal',
    definition: 'A free diagnostic becomes useful only if it exposes one workflow leak that can turn into a paid pilot.',
    matches: [
      /(workflow audit|free diagnostic|paid pilot|first version)/,
    ],
  },
  {
    id: 'agency_buyer_test',
    label: 'Agency Buyer Test',
    pillar: 'money_game',
    type: 'goal',
    definition: 'A solo agency owner with visible overload is a sharper first buyer than an abstract market segment.',
    matches: [
      /(solo agency|agency owner|overwhelmed)/,
    ],
  },
  {
    id: 'buyer_offer_focus',
    label: 'Buyer Offer Focus',
    pillar: 'money_game',
    type: 'decision',
    definition: 'One buyer type, one painful task, and one specific offer beats a broad pipeline right now.',
    matches: [
      /(one buyer|buyer type).*(painful task|one offer)/,
      /(painful task|one offer).*(one buyer|buyer type)/,
    ],
  },
]

const LABEL_STOP_WORDS = new Set([
  'about',
  'after',
  'again',
  'because',
  'before',
  'being',
  'build',
  'building',
  'could',
  'currently',
  'figure',
  'from',
  'have',
  'into',
  'need',
  'needs',
  'still',
  'that',
  'their',
  'this',
  'toward',
  'trying',
  'user',
  'wants',
  'when',
  'with',
  'would',
])

export function titleCaseBrainLabel(value = '') {
  return String(value || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\b[a-z]/g, (char) => char.toUpperCase())
    .replace(/\bAi\b/g, 'AI')
    .replace(/\bMvp\b/g, 'MVP')
    .replace(/\bGpt\b/g, 'GPT')
    .replace(/\bChatgpt\b/g, 'ChatGPT')
}

export function cleanBrainText(value = '') {
  return String(value || '')
    .replace(/^onboarding signal:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function stripInvalidBrainLabel(value = '') {
  const clean = cleanBrainText(value)
  if (/^untitled\s+node\b/i.test(clean)) return ''
  return clean
}

export function isUsableBrainLabel(label = '') {
  const clean = stripInvalidBrainLabel(label)
  if (!clean) return false
  if (/^(user|the user|onboarding signal)\b/i.test(clean)) return false
  if (/[.!?]/.test(clean)) return false
  return clean.split(/\s+/).filter(Boolean).length <= 6
}

export function resolveBrainTheme(input = {}) {
  const text = cleanBrainText(`${input.label || ''} ${input.summary || ''} ${input.content || ''}`).toLowerCase()
  return BRAIN_NODE_THEMES.find((theme) => theme.matches.some((regex) => regex.test(text))) || null
}

export function deriveBrainLabel(label = '', summary = '', fallback = 'Untitled Node') {
  const theme = resolveBrainTheme({ label, summary })
  if (theme) return theme.label

  const safeLabel = stripInvalidBrainLabel(label)
  if (isUsableBrainLabel(safeLabel)) return titleCaseBrainLabel(safeLabel)

  const clean = cleanBrainText(`${safeLabel} ${summary || ''}`)
    .replace(/^[^:?.!]{0,90}[:?.!]\s*/, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/^the user\s+/i, '')
    .replace(/\b(the user|a pattern of|tendency to|wants to|needs to|is trying to|has been trying to|can build|is working on)\b/gi, ' ')
    .replace(/[^a-z0-9\s-]/gi, ' ')

  const words = clean
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 2 && !LABEL_STOP_WORDS.has(word.toLowerCase()))
    .slice(0, 4)

  return titleCaseBrainLabel(words.join(' ')) || fallback
}

export function deriveBrainSummary(label = '', summary = '') {
  const theme = resolveBrainTheme({ label, summary })
  if (theme) return theme.definition

  const clean = cleanBrainText(summary)
    .replace(/^what are you working on right now\??\s*/i, '')
    .replace(/^the user\s+/i, 'You ')

  if (clean.length <= 190) return clean
  return `${clean.slice(0, 187).trim()}...`
}
