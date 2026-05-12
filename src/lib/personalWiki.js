import { supabase } from './supabase'
import { requestJsonObject, UTILITY_MODEL } from './openai'

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
  const label = typeof rawNode?.label === 'string' ? rawNode.label.trim() : ''
  if (!label) return null

  const shouldInferPillar = rawNode.allowPillarInference !== false
  const pillar = rawNode.pillar ?? (shouldInferPillar ? inferStoragePillar(`${label} ${rawNode.summary || ''}`, null) : null)
  const pos = rawNode.x == null ? nodePosition(index, pillar) : rawNode

  return {
    label,
    type: rawNode.type || 'concept',
    pillar,
    summary: rawNode.summary || '',
    status: rawNode.status || 'dim',
    importance: Math.min(5, Math.max(1, rawNode.importance || 3)),
    confidence: Math.min(1, Math.max(0, rawNode.confidence ?? 0.7)),
    x: pos.x || 0,
    y: pos.y || 0,
    z: pos.z || 0,
  }
}

async function upsertNode(sessionId, rawNode, index = 0) {
  const node = normalizeNode(rawNode, index)
  if (!node) return null

  let existingQuery = supabase
    .from('personal_wiki_nodes')
    .select('*')
    .eq('session_id', sessionId)
    .eq('type', node.type)

  if (node.type === 'pillar') {
    existingQuery = existingQuery.eq('label', node.label)
  } else {
    existingQuery = existingQuery.eq('summary', node.summary)
  }

  const { data: existingMatches, error: selectError } = await existingQuery
    .order('updated_at', { ascending: false })
    .limit(1)

  if (selectError) return null

  const existing = existingMatches?.[0] || null

  if (existing) {
    let nextLabel = node.label || existing.label
    if (nextLabel && nextLabel !== existing.label) {
      const { data: labelMatches } = await supabase
        .from('personal_wiki_nodes')
        .select('id, label')
        .eq('session_id', sessionId)
        .eq('type', node.type)

      const existingLabels = new Set((labelMatches || [])
        .filter((match) => match.id !== existing.id)
        .map((match) => String(match.label || '').trim().toLowerCase()))
      nextLabel = uniqueLabelCandidate(nextLabel, existingLabels)
    }

    const updates = {
      label: nextLabel,
      pillar: node.pillar || existing.pillar,
      summary: node.summary || existing.summary,
      status: (STATUS_RANK[existing.status] ?? 0) >= (STATUS_RANK[node.status] ?? 0) ? existing.status : node.status,
      importance: Math.max(existing.importance || 1, node.importance),
      confidence: Math.max(existing.confidence || 0, node.confidence),
      updated_at: new Date().toISOString(),
      last_activated_at: node.status === 'active' ? new Date().toISOString() : existing.last_activated_at,
    }

    const { data, error } = await supabase
      .from('personal_wiki_nodes')
      .update(updates)
      .eq('id', existing.id)
      .select()
      .single()

    if (error) return existing
    return data
  }

  const { data, error } = await supabase
    .from('personal_wiki_nodes')
    .insert({ session_id: sessionId, ...node })
    .select()
    .single()

  if (error) return null
  return data
}

async function findExistingNodeBySummary(sessionId, summary, type) {
  if (!sessionId || !summary || !type) return null

  const { data, error } = await supabase
    .from('personal_wiki_nodes')
    .select('id, label, summary, type')
    .eq('session_id', sessionId)
    .eq('summary', summary)
    .eq('type', type)
    .order('updated_at', { ascending: false })
    .limit(1)

  if (error) return null
  return data?.[0] || null
}

async function upsertEdge(sessionId, source, target, relationship = 'related_to', weight = 0.5) {
  if (!source?.id || !target?.id || source.id === target.id) return

  const { data: existing, error: selectError } = await supabase
    .from('personal_wiki_edges')
    .select('*')
    .eq('session_id', sessionId)
    .eq('source_node_id', source.id)
    .eq('target_node_id', target.id)
    .eq('relationship', relationship)
    .maybeSingle()

  if (selectError) return

  if (existing) {
    const { error } = await supabase
      .from('personal_wiki_edges')
      .update({
        weight: Math.min(1, Math.max(existing.weight || 0, weight)),
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)

    return
  }

  const { error } = await supabase.from('personal_wiki_edges').insert({
    session_id: sessionId,
    source_node_id: source.id,
    target_node_id: target.id,
    relationship,
    weight,
  })

  if (error) return
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
      label: qa.answer || qa.question,
      type: 'concept',
      pillar,
      summary: qa.question ? `Onboarding signal: ${qa.question} ${qa.answer || ''}` : 'Onboarding signal',
      status: 'seed',
      importance: 2,
      confidence: 0.55,
    })
  }

  return nodes
}

const FALLBACK_LABEL_STOPWORDS = new Set([
  'about',
  'after',
  'again',
  'also',
  'appears',
  'around',
  'because',
  'before',
  'being',
  'building',
  'could',
  'find',
  'from',
  'have',
  'into',
  'need',
  'needs',
  'one',
  'pick',
  'single',
  'that',
  'their',
  'thing',
  'this',
  'toward',
  'trying',
  'user',
  'wants',
  'when',
  'with',
  'would',
])

function fallbackTitleCase(value = '') {
  return String(value)
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\b[a-z]/g, char => char.toUpperCase())
}

function fallbackMemoryLabel(memory = {}) {
  const content = String(memory.content || '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b\d+h\s*window\b/gi, ' ')
    .replace(/^the user\s+/i, '')
    .replace(/\b(the user|a pattern of|tendency to|wants to|needs to|is trying to|has been trying to)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (/\bhardest to copy|competitors.*copy|copy after\b/i.test(content)) {
    return 'Hardest-To-Copy Advantage'
  }
  if (/\bcompany\b/i.test(content) && /\badmire|building toward|competitor/i.test(content)) {
    return 'Company Advantage'
  }
  if (/\bfriendship|friend\b/i.test(content)) {
    return 'Friendship Practice'
  }
  if (/\bidentity|defend|defended\b/i.test(content)) {
    return 'Defended Identity'
  }

  const words = content
    .replace(/[^a-z0-9\s-]/gi, ' ')
    .split(/\s+/)
    .map(word => word.trim())
    .filter(word => word.length > 2 && !FALLBACK_LABEL_STOPWORDS.has(word.toLowerCase()))
    .slice(0, 4)

  return fallbackTitleCase(words.join(' ')) || 'Untitled Node'
}

function isBrokenNodeLabel(label = '', summary = '') {
  const clean = String(label || '').trim()
  return (
    !clean ||
    clean.endsWith('...') ||
    clean === summary ||
    clean.toLowerCase().startsWith('the user') ||
    clean.length > 40
  )
}

function uniqueLabelCandidate(label, existingLabels = new Set()) {
  const clean = String(label || '').trim()
  const candidates = [
    clean,
    `${clean} Signal`,
    `${clean} Context`,
    `${clean} Practice`,
    `${clean} Path`,
  ].filter(Boolean)

  return candidates.find((candidate) => !existingLabels.has(candidate.toLowerCase())) || clean
}

async function generateNodeLabel(memory) {
  const parsed = await requestJsonObject({
    label: 'node label',
    model: UTILITY_MODEL,
    maxCompletionTokens: 80,
    usageContext: { call_type: 'memory_update' },
    messages: [
      {
        role: 'system',
        content: 'You generate short, sharp titles for knowledge graph nodes. Return only valid JSON: { "label": "..." }. No markdown. No preamble.',
      },
      {
        role: 'user',
        content: `Generate a node label for this memory:
Type: ${memory.type}
Pillar: ${memory.primary_pillar || 'unknown'}
Content: ${memory.content}

Rules:
- 2 to 5 words maximum
- Title case
- Must be a noun phrase, not a sentence
- Capture the core concept, not the full detail
- No verbs like 'wants', 'is trying', 'has been'
- No filler words like 'the user', 'a pattern of', 'tendency to'
- Examples of good labels: 'Compounding Mindset', 'Fear of Market Feedback', 'Execution Over Planning', 'Recurring Pivot Impulse'`,
      },
    ],
  })

  const label = typeof parsed.label === 'string' ? parsed.label.trim() : ''
  if (!label) throw new Error('Empty generated node label')
  return label
}

async function nodeFromMemory(memory, index) {
  if (memory.type === 'pattern' && ((memory.confidence ?? 0) < 0.65 || (memory.importance ?? 0) < 3)) {
    return null
  }

  let label = fallbackMemoryLabel(memory)
  try {
    label = await generateNodeLabel(memory)
  } catch {}

  const pillarConfidence = Number(memory.pillar_confidence ?? 0.7)
  const hasConfidentPillar = memory.primary_pillar && pillarConfidence >= 0.55
  const pillar = hasConfidentPillar ? inferStoragePillar(memory.content, memory.primary_pillar) : null
  return normalizeNode({
    label,
    type: MEMORY_TYPE_TO_NODE_TYPE[memory.type] || 'concept',
    pillar,
    allowPillarInference: hasConfidentPillar,
    summary: memory.content,
    status: hasConfidentPillar ? 'active' : 'dim',
    importance: memory.importance || 3,
    confidence: memory.confidence ?? 0.7,
  }, index)
}

async function nodeFromExperiment(experiment, index, existingLabel = '') {
  const summary = `${experiment.description} (${experiment.window_hours}h window)`
  let label = fallbackMemoryLabel({
    type: 'experiment_result',
    primary_pillar: experiment.pillar || null,
    content: experiment.description,
  })
  if (existingLabel && !isBrokenNodeLabel(existingLabel, summary)) {
    label = existingLabel
  } else {
    try {
      label = await generateNodeLabel({
        type: 'experiment_result',
        primary_pillar: experiment.pillar || null,
        content: experiment.description,
      })
    } catch {}
  }

  return normalizeNode({
    label,
    type: 'experiment',
    pillar: inferStoragePillar(experiment.description, experiment.pillar || null),
    summary,
    status: experiment.status === 'ghosted' ? 'ghosted' : 'active',
    importance: 4,
    confidence: 0.8,
  }, index)
}

async function fetchSessionExperiments(sessionId) {
  const { data, error } = await supabase
    .from('experiments')
    .select('description, status, pillar, window_hours, assigned_at')
    .eq('session_id', sessionId)
    .order('assigned_at', { ascending: false })
    .limit(10)

  if (error) return null

  return data || []
}

export async function backfillNodeLabels(sessionId) {
  if (!sessionId) return

  const { data: nodes, error: nodesError } = await supabase
    .from('personal_wiki_nodes')
        .select('id, label, summary, type, pillar')
    .eq('session_id', sessionId)

  if (nodesError) return

  const brokenNodes = (nodes || []).filter((node) =>
    node?.summary && isBrokenNodeLabel(node.label, node.summary)
  )

  if (!brokenNodes.length) return

  const { data: sessionRow } = await supabase
    .from('sessions')
    .select('user_id')
    .eq('id', sessionId)
    .maybeSingle()

  const userId = sessionRow?.user_id
  if (!userId) return

  const { data: memories, error: memoriesError } = await supabase
    .from('personal_memories')
    .select('id, content, type, primary_pillar, importance, confidence')
    .eq('user_id', userId)

  if (memoriesError) return

  for (const node of brokenNodes) {
    const nodeLabel = String(node.label || '').replace('...', '').trim()
    const match = (memories || []).find(m =>
      m.content.startsWith(nodeLabel) ||
      nodeLabel.startsWith(m.content.slice(0, 30))
    ) || {
      type: node.type,
      primary_pillar: node.pillar || null,
      content: node.summary,
    }

    try {
      const label = await generateNodeLabel(match)
      const existingLabels = new Set((nodes || [])
        .filter((candidate) => candidate.id !== node.id && candidate.type === node.type)
        .map((candidate) => String(candidate.label || '').trim().toLowerCase()))
      const uniqueLabel = uniqueLabelCandidate(label, existingLabels)

      await supabase
        .from('personal_wiki_nodes')
        .update({ label: uniqueLabel, updated_at: new Date().toISOString() })
        .eq('id', node.id)
    } catch {
      const fallbackLabel = fallbackMemoryLabel(match)
      const existingLabels = new Set((nodes || [])
        .filter((candidate) => candidate.id !== node.id && candidate.type === node.type)
        .map((candidate) => String(candidate.label || '').trim().toLowerCase()))
      const uniqueLabel = uniqueLabelCandidate(fallbackLabel, existingLabels)

      await supabase
        .from('personal_wiki_nodes')
        .update({ label: uniqueLabel, updated_at: new Date().toISOString() })
        .eq('id', node.id)
    }
  }
}

export async function syncPersonalWiki(session) {
  if (!session?.id) return { nodes: [], edges: [] }

  try {
    const roots = []
    for (let i = 0; i < DISPLAY_ROOT_NODES.length; i++) {
      const root = await upsertNode(session.id, DISPLAY_ROOT_NODES[i], i)
      if (root) roots.push(root)
    }

    const seedNodes = seedNodesFromSession(session)
    for (let i = 0; i < seedNodes.length; i++) {
      const node = await upsertNode(session.id, seedNodes[i], i + 2)
      const root = roots.find((r) => r.pillar === node?.pillar)
      await upsertEdge(session.id, node, root, 'belongs_to', 0.45)
    }

    let { data: memories, error: memoriesError } = await supabase
      .from('personal_memories')
      .select('id, type, content, importance, confidence, primary_pillar, secondary_pillars, pillar_confidence, updated_at')
      .eq('user_id', session.user_id)
      .order('updated_at', { ascending: false })
      .limit(10)

    if (memoriesError && /primary_pillar|secondary_pillars|pillar_confidence/.test(memoriesError.message || '')) {
      const fallback = await supabase
        .from('personal_memories')
        .select('id, type, content, importance, confidence, updated_at')
        .eq('user_id', session.user_id)
        .order('updated_at', { ascending: false })
        .limit(10)
      memories = fallback.data
      memoriesError = fallback.error
    }

    if (!memoriesError) {
      for (let i = 0; i < (memories || []).length; i++) {
        const memory = memories[i]
        const memoryNode = await nodeFromMemory(memory, i + 8)
        if (!memoryNode) continue
        const node = await upsertNode(session.id, memoryNode, i + 8)
        const pillarKey = node?.pillar || memory.primary_pillar
        const root = roots.find((r) => r.pillar === pillarKey)
        if (node?.id && root?.id) {
          await upsertEdge(session.id, node, root, 'belongs_to', 0.55)
        }
      }
    }

    const tableExperiments = await fetchSessionExperiments(session.id)
    const experiments = tableExperiments || session.active_experiments || []
    for (let i = 0; i < experiments.length; i++) {
      const summary = `${experiments[i].description} (${experiments[i].window_hours}h window)`
      const existing = await findExistingNodeBySummary(session.id, summary, 'experiment')
      const node = await upsertNode(
        session.id,
        await nodeFromExperiment(experiments[i], i + 20, existing?.label || ''),
        i + 20
      )
      const root = roots.find((r) => r.pillar === node?.pillar)
      await upsertEdge(session.id, node, root, 'tested_by', 0.7)
    }

    return getPersonalWikiGraph(session.id)
  } catch {
    return fallbackGraph(session)
  }
}

export async function markWikiNodeAccessed(nodeId) {
  if (!nodeId || String(nodeId).startsWith('fallback-') || String(nodeId).startsWith('virtual-pillar-')) return

  const { error } = await supabase
    .from('personal_wiki_nodes')
    .update({
      status: 'bright',
      last_activated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', nodeId)

  if (error) return
}

export async function getPersonalWikiGraph(sessionId) {
  if (!sessionId) return { nodes: [], edges: [] }

  try {
    const { data, error } = await supabase.rpc('get_personal_wiki_graph', {
      match_session_id: sessionId,
    })

    if (error) {
      return { nodes: [], edges: [] }
    }

    return buildDisplayGraph({
      nodes: data?.nodes || [],
      edges: data?.edges || [],
    }, sessionId)
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
