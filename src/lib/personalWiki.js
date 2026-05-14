import { getApiJson, postApiJson } from './api'

const DISPLAY_PILLARS = [
  'human_mind',
  'money_game',
  'how_companies_win',
  'whats_coming',
  'think_sharper',
  'move_people',
]

const LEGACY_TO_DISPLAY_PILLAR = {
  psychology: 'human_mind',
  economics: 'money_game',
}

const DISPLAY_ROOT_NODES = [
  {
    id: 'virtual-pillar-human_mind',
    label: 'The Human Mind',
    type: 'pillar',
    pillar: 'human_mind',
    summary: 'Identity, fear, behavior, avoidance, resilience, and the inner mechanics of action.',
    status: 'seed',
    importance: 5,
    confidence: 0.9,
  },
  {
    id: 'virtual-pillar-money_game',
    label: 'The Money Game',
    type: 'pillar',
    pillar: 'money_game',
    summary: 'Incentives, value capture, capital, buyers, pricing, and economic reality.',
    status: 'seed',
    importance: 5,
    confidence: 0.9,
  },
  {
    id: 'virtual-pillar-how_companies_win',
    label: 'How Companies Win',
    type: 'pillar',
    pillar: 'how_companies_win',
    summary: 'Strategy, distribution, moats, product leverage, management, and execution.',
    status: 'seed',
    importance: 5,
    confidence: 0.9,
  },
  {
    id: 'virtual-pillar-whats_coming',
    label: "What's Coming",
    type: 'pillar',
    pillar: 'whats_coming',
    summary: 'Technology shifts, macro change, geopolitics, energy, and future-facing pressure.',
    status: 'seed',
    importance: 5,
    confidence: 0.9,
  },
  {
    id: 'virtual-pillar-think_sharper',
    label: 'Think Sharper',
    type: 'pillar',
    pillar: 'think_sharper',
    summary: 'Reasoning quality, mental models, uncertainty, truth-seeking, and decision clarity.',
    status: 'seed',
    importance: 5,
    confidence: 0.9,
  },
  {
    id: 'virtual-pillar-move_people',
    label: 'Move People',
    type: 'pillar',
    pillar: 'move_people',
    summary: 'Persuasion, writing, narrative, negotiation, speaking, and influence.',
    status: 'seed',
    importance: 5,
    confidence: 0.9,
  },
]

const CONCEPT_NODES = [
  {
    label: 'Choice Architecture',
    type: 'concept',
    pillar: 'human_mind',
    summary: 'How framing, defaults, and visible options shape the next decision.',
    status: 'dim',
    importance: 3,
    confidence: 0.8,
  },
  {
    label: 'Identity Protection',
    type: 'concept',
    pillar: 'human_mind',
    summary: 'The ways a person protects self-image from market feedback, rejection, or visible failure.',
    status: 'dim',
    importance: 4,
    confidence: 0.8,
  },
  {
    label: 'Rejection Avoidance',
    type: 'concept',
    pillar: 'human_mind',
    summary: 'Avoiding contact with buyers or peers because the answer may expose a weak assumption.',
    status: 'dim',
    importance: 4,
    confidence: 0.8,
  },
  {
    label: 'Procrastination',
    type: 'concept',
    pillar: 'human_mind',
    summary: 'Delay that hides inside preparation, refinement, and standards.',
    status: 'dim',
    importance: 4,
    confidence: 0.8,
  },
  {
    label: 'Status Anxiety',
    type: 'concept',
    pillar: 'human_mind',
    summary: 'Fear that a visible attempt will lower how others rank or interpret you.',
    status: 'dim',
    importance: 3,
    confidence: 0.75,
  },
  {
    label: 'Self-Deception',
    type: 'concept',
    pillar: 'human_mind',
    summary: 'A private story that makes avoidance feel intelligent or principled.',
    status: 'dim',
    importance: 4,
    confidence: 0.8,
  },
  {
    label: 'Feedback Loops',
    type: 'concept',
    pillar: 'human_mind',
    summary: 'The cycle where action creates data, data changes behavior, and behavior changes outcomes.',
    status: 'dim',
    importance: 3,
    confidence: 0.8,
  },
  {
    label: 'Commitment',
    type: 'concept',
    pillar: 'human_mind',
    summary: 'A chosen constraint that forces behavior to become visible.',
    status: 'dim',
    importance: 3,
    confidence: 0.75,
  },
  {
    label: 'Offer Sharpness',
    type: 'concept',
    pillar: 'money_game',
    summary: 'How clearly a buyer understands the problem, promise, proof, and next step.',
    status: 'dim',
    importance: 4,
    confidence: 0.85,
  },
  {
    label: 'Market Demand',
    type: 'concept',
    pillar: 'money_game',
    summary: 'Evidence that a real buyer cares enough to spend attention, time, money, or reputation.',
    status: 'dim',
    importance: 4,
    confidence: 0.85,
  },
  {
    label: 'Opportunity Cost',
    type: 'concept',
    pillar: 'money_game',
    summary: 'The hidden price of spending effort on one path instead of the highest-leverage alternative.',
    status: 'dim',
    importance: 4,
    confidence: 0.8,
  },
  {
    label: 'Incentives',
    type: 'concept',
    pillar: 'money_game',
    summary: 'The rewards, penalties, and pressures that explain what people actually do.',
    status: 'dim',
    importance: 3,
    confidence: 0.8,
  },
  {
    label: 'Pricing',
    type: 'concept',
    pillar: 'money_game',
    summary: 'The signal that connects value, willingness to pay, positioning, and buyer seriousness.',
    status: 'dim',
    importance: 3,
    confidence: 0.75,
  },
  {
    label: 'Buyer Objections',
    type: 'concept',
    pillar: 'money_game',
    summary: 'The reasons buyers hesitate, delay, compare, or reject an offer.',
    status: 'dim',
    importance: 4,
    confidence: 0.8,
  },
  {
    label: 'Sales Friction',
    type: 'concept',
    pillar: 'money_game',
    summary: 'Anything that makes the buyer slower, less certain, or less willing to act.',
    status: 'dim',
    importance: 3,
    confidence: 0.75,
  },
  {
    label: 'Demand Testing',
    type: 'concept',
    pillar: 'money_game',
    summary: 'Putting an offer in front of buyers before polishing it in private.',
    status: 'dim',
    importance: 4,
    confidence: 0.85,
  },
]

const STATUS_RANK = { bright: 3, active: 2, ghosted: 1, dim: 0, seed: 0, resolved: 0 }

const MEMORY_TYPE_TO_NODE_TYPE = {
  goal: 'goal',
  pattern: 'pattern',
  belief: 'belief',
  experiment_result: 'experiment',
  preference: 'belief',
  decision: 'decision',
  fact: 'concept',
}

const DISPLAY_PILLAR_KEYWORDS = {
  human_mind: /\b(fear|avoid|identity|stress|confidence|rejection|procrastinat|anxiety|status|self|emotion|habit|motivation|discipline|shame|trauma|resilience)\b/g,
  money_game: /\b(money|price|pricing|buyer|market|revenue|cost|capital|profit|wealth|invest|valuation|incentive|demand|customer|cashflow|offer|sales|outreach)\b/g,
  how_companies_win: /\b(company|startup|distribution|moat|strategy|product|growth|retention|network|platform|management|culture|hiring|execution|competition|founder)\b/g,
  whats_coming: /\b(ai|automation|geopolitic|macro|future|energy|climate|demographic|population|technology|trend|china|war|currency|inflation|reshoring)\b/g,
  think_sharper: /\b(reason|reasoning|belief|model|models|bayes|forecast|prediction|disagree|evidence|truth|clarity|judgment|decision|think)\b/g,
  move_people: /\b(persuade|persuasion|write|writing|speak|speaking|narrative|story|influence|negotiat|audience|rhetoric|presentation|pitch)\b/g,
}

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
  'from',
  'have',
  'into',
  'need',
  'needs',
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

function titleCase(value = '') {
  return String(value || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\b[a-z]/g, (char) => char.toUpperCase())
}

function shortNodeLabel(label = '', summary = '') {
  const text = `${label || ''} ${summary || ''}`.replace(/\s+/g, ' ').trim()
  const lower = text.toLowerCase()

  if (/\baxiom\b/.test(lower) && /(different from chatgpt|better wrapper|mentor app|mvp stage)/.test(lower)) {
    return 'Axiom Differentiation Bet'
  }
  if (/(automation|automations|software)/.test(lower) && /(no sales|sales pipeline|cold outreach|buyer|revenue)/.test(lower)) {
    return 'Automation Sales Gap'
  }
  if (/(cold outreach|outreach)/.test(lower) && /(hate|avoid|resistance|sales)/.test(lower)) {
    return 'Cold Outreach Resistance'
  }
  if (/(\$?5,?000|5000|august 1|august)/.test(lower) && /(revenue|make|earn|sales|money)/.test(lower)) {
    return 'August Revenue Target'
  }
  if (/(workflow audit|free diagnostic|paid pilot|first version)/.test(lower)) {
    return 'Paid Pilot Path'
  }
  if (/(solo agency|agency owner|overwhelmed)/.test(lower)) {
    return 'Agency Buyer Test'
  }
  if (/(one buyer|buyer type|painful task|one offer)/.test(lower)) {
    return 'Buyer Offer Focus'
  }

  const clean = text
    .replace(/^onboarding signal:\s*/i, '')
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

  return titleCase(words.join(' ')) || 'Untitled Node'
}

function compactNodeSummary(summary = '') {
  const clean = String(summary || '')
    .replace(/^onboarding signal:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (clean.length <= 190) return clean
  return `${clean.slice(0, 187).trim()}...`
}

function countMatches(regex, text) {
  const matches = text.match(regex)
  return matches ? matches.length : 0
}

function inferDisplayPillar(text = '', fallback = null) {
  const lower = text.toLowerCase()
  let best = fallback
  let bestScore = 0

  for (const [pillar, regex] of Object.entries(DISPLAY_PILLAR_KEYWORDS)) {
    const score = countMatches(regex, lower)
    if (score > bestScore) {
      best = pillar
      bestScore = score
    }
  }

  return bestScore > 0 ? best : fallback
}

function inferStoragePillar(text = '', fallback = null) {
  if (DISPLAY_PILLARS.includes(fallback)) return fallback
  if (LEGACY_TO_DISPLAY_PILLAR[fallback]) return LEGACY_TO_DISPLAY_PILLAR[fallback]
  const display = inferDisplayPillar(text, null)
  if (display) return display
  return fallback
}

function nodePosition(index, pillar) {
  const side = ['money_game', 'how_companies_win', 'whats_coming', 'economics'].includes(pillar) ? 1 : -1
  const ring = 0.44 + (index % 4) * 0.11
  const angle = -1.2 + (index % 7) * 0.42
  return {
    x: side * ring * Math.cos(angle),
    y: ring * Math.sin(angle),
    z: 0.18 * Math.sin(index * 1.7),
  }
}

function normalizeNode(rawNode, index = 0) {
  const label = shortNodeLabel(rawNode?.label, rawNode?.summary)
  if (!label) return null

  const shouldInferPillar = rawNode.allowPillarInference !== false
  const pillar = rawNode.pillar ?? (shouldInferPillar ? inferStoragePillar(`${label} ${rawNode.summary || ''}`, null) : null)
  const pos = rawNode.x == null ? nodePosition(index, pillar) : rawNode

  return {
    label,
    type: rawNode.type || 'concept',
    pillar,
    summary: compactNodeSummary(rawNode.summary || ''),
    status: rawNode.status || 'dim',
    importance: Math.min(5, Math.max(1, rawNode.importance || 3)),
    confidence: Math.min(1, Math.max(0, rawNode.confidence ?? 0.7)),
    x: pos.x || 0,
    y: pos.y || 0,
    z: pos.z || 0,
  }
}

function buildDisplayRoots(sessionId = null) {
  return DISPLAY_ROOT_NODES.map((node) => ({
    ...node,
    session_id: sessionId,
  }))
}

function remapLegacyPillar(pillar) {
  return LEGACY_TO_DISPLAY_PILLAR[pillar] || null
}

function deriveDisplayPillar(node) {
  if (DISPLAY_PILLARS.includes(node?.pillar)) {
    return { pillar: node.pillar, pillar_source: 'user_confirmed' }
  }

  const inferred = inferDisplayPillar(`${node?.label || ''} ${node?.summary || ''}`, null)
  if (inferred) {
    return { pillar: inferred, pillar_source: 'inferred' }
  }

  const remapped = remapLegacyPillar(node?.pillar)
  if (remapped) {
    return { pillar: remapped, pillar_source: 'legacy_remapped' }
  }

  return { pillar: null, pillar_source: 'unclassified' }
}

function buildDisplayGraph(graph, sessionId = null) {
  const rawNodes = Array.isArray(graph?.nodes) ? graph.nodes : []
  const rawEdges = Array.isArray(graph?.edges) ? graph.edges : []
  const displayRoots = buildDisplayRoots(sessionId)

  const transformedNodes = rawNodes
    .filter((node) => node.type !== 'pillar')
    .map((node) => {
      const { pillar, pillar_source } = deriveDisplayPillar(node)
      return {
        ...node,
        label: shortNodeLabel(node.label, node.summary),
        summary: compactNodeSummary(node.summary),
        pillar,
        pillar_source,
      }
    })

  const rootByPillar = new Map(displayRoots.map((node) => [node.pillar, node]))
  const virtualBelongsToEdges = transformedNodes
    .filter((node) => node.pillar && rootByPillar.has(node.pillar))
    .map((node) => ({
      id: `virtual-edge-${node.id}-${node.pillar}`,
      session_id: sessionId,
      source_node_id: node.id,
      target_node_id: rootByPillar.get(node.pillar).id,
      relationship: 'belongs_to',
      weight: 0.5,
      confidence: node.confidence ?? 0.7,
    }))

  const preservedEdges = rawEdges.filter((edge) => edge.relationship !== 'belongs_to')

  return {
    nodes: [...displayRoots, ...transformedNodes],
    edges: [...preservedEdges, ...virtualBelongsToEdges],
  }
}

function seedNodesFromSession(session) {
  const nodes = [...CONCEPT_NODES]
  const answers = session?.onboarding_answers || []

  for (const qa of answers.slice(0, 4)) {
    const text = `${qa.question || ''} ${qa.answer || ''}`
    const pillar = inferStoragePillar(text, qa.pillar || null)
    nodes.push({
      label: shortNodeLabel(qa.answer || qa.question, text),
      type: 'concept',
      pillar,
      summary: qa.answer || qa.question || 'Onboarding signal',
      status: 'seed',
      importance: 2,
      confidence: 0.55,
    })
  }

  return nodes
}

export async function backfillNodeLabels(sessionId) {
  if (!sessionId) return
  // Label repair now happens naturally on the next server-owned node upsert.
  // Keep this function as a compatibility no-op so old callers do not write
  // personal wiki rows directly from the browser.
}

export async function syncPersonalWiki(session) {
  if (!session?.id) return { nodes: [], edges: [] }

  try {
    const payload = await postApiJson('/api/personal-wiki/sync', {
      session_id: session.id,
    })
    return buildDisplayGraph(payload?.graph || {}, session.id)
  } catch {
    return fallbackGraph(session)
  }
}

export async function markWikiNodeAccessed(nodeId) {
  if (!nodeId || String(nodeId).startsWith('fallback-') || String(nodeId).startsWith('virtual-pillar-')) return
  try {
    await postApiJson(`/api/personal-wiki/nodes/${nodeId}/accessed`, {})
  } catch {}
}

export async function getPersonalWikiGraph(sessionId) {
  if (!sessionId) return { nodes: [], edges: [] }

  try {
    const payload = await getApiJson(`/api/personal-wiki/graph?session_id=${encodeURIComponent(sessionId)}`)
    return buildDisplayGraph(payload?.graph || {}, sessionId)
  } catch {
    return { nodes: [], edges: [] }
  }
}

export function fallbackGraph(session) {
  const rawNodes = seedNodesFromSession(session).map((node, index) => ({
    id: `fallback-${index}`,
    session_id: session?.id,
    ...normalizeNode(node, index),
  }))
  return buildDisplayGraph({ nodes: rawNodes, edges: [] }, session?.id)
}
