import { supabase } from './supabase'

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

  const { data: existing, error: selectError } = await supabase
    .from('personal_wiki_nodes')
    .select('*')
    .eq('session_id', sessionId)
    .eq('label', node.label)
    .eq('type', node.type)
    .maybeSingle()

  if (selectError) {
    console.warn('[Wiki] Node lookup skipped:', selectError.message)
    return null
  }

  if (existing) {
    const updates = {
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

    if (error) {
      console.warn('[Wiki] Node update skipped:', error.message)
      return existing
    }
    return data
  }

  const { data, error } = await supabase
    .from('personal_wiki_nodes')
    .insert({ session_id: sessionId, ...node })
    .select()
    .single()

  if (error) {
    console.warn('[Wiki] Node insert skipped:', error.message)
    return null
  }
  return data
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

  if (selectError) {
    console.warn('[Wiki] Edge lookup skipped:', selectError.message)
    return
  }

  if (existing) {
    const { error } = await supabase
      .from('personal_wiki_edges')
      .update({
        weight: Math.min(1, Math.max(existing.weight || 0, weight)),
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)

    if (error) console.warn('[Wiki] Edge update skipped:', error.message)
    return
  }

  const { error } = await supabase.from('personal_wiki_edges').insert({
    session_id: sessionId,
    source_node_id: source.id,
    target_node_id: target.id,
    relationship,
    weight,
  })

  if (error) console.warn('[Wiki] Edge insert skipped:', error.message)
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
  const profile = session?.axiom_profile || ''

  const profilePillar = inferStoragePillar(profile, null)
  if (profile) {
    nodes.push({
      label:
        profilePillar === 'money_game'
          ? 'Market Behavior Pattern'
          : profilePillar === 'human_mind'
            ? 'Identity Protection Pattern'
            : 'Emerging Pattern',
      type: 'pattern',
      pillar: profilePillar,
      summary: profile,
      status: 'dim',
      importance: 4,
      confidence: 0.7,
    })
  }

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

function nodeFromMemory(memory, index) {
  const pillarConfidence = Number(memory.pillar_confidence ?? 0.7)
  const hasConfidentPillar = memory.primary_pillar && pillarConfidence >= 0.55
  const pillar = hasConfidentPillar ? inferStoragePillar(memory.content, memory.primary_pillar) : null
  return normalizeNode({
    label: memory.content.length > 54 ? `${memory.content.slice(0, 51)}...` : memory.content,
    type: MEMORY_TYPE_TO_NODE_TYPE[memory.type] || 'concept',
    pillar,
    allowPillarInference: hasConfidentPillar,
    summary: memory.content,
    status: hasConfidentPillar ? 'active' : 'dim',
    importance: memory.importance || 3,
    confidence: memory.confidence ?? 0.7,
  }, index)
}

function nodeFromExperiment(experiment, index) {
  return normalizeNode({
    label: experiment.description.length > 54 ? `${experiment.description.slice(0, 51)}...` : experiment.description,
    type: 'experiment',
    pillar: inferStoragePillar(experiment.description, experiment.pillar || null),
    summary: `${experiment.description} (${experiment.window_hours}h window)`,
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

  if (error) {
    console.warn('[Wiki] Experiment fetch failed:', error.message)
    return null
  }

  return data || []
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
      .select('type, content, importance, confidence, primary_pillar, secondary_pillars, pillar_confidence, updated_at')
      .eq('user_id', session.user_id)
      .order('updated_at', { ascending: false })
      .limit(10)

    if (memoriesError && /primary_pillar|secondary_pillars|pillar_confidence/.test(memoriesError.message || '')) {
      const fallback = await supabase
        .from('personal_memories')
        .select('type, content, importance, confidence, updated_at')
        .eq('user_id', session.user_id)
        .order('updated_at', { ascending: false })
        .limit(10)
      memories = fallback.data
      memoriesError = fallback.error
    }

    if (!memoriesError) {
      for (let i = 0; i < (memories || []).length; i++) {
        const node = await upsertNode(session.id, nodeFromMemory(memories[i], i + 8), i + 8)
        const root = roots.find((r) => r.pillar === node?.pillar)
        await upsertEdge(session.id, node, root, 'belongs_to', 0.55)
      }
    }

    const tableExperiments = await fetchSessionExperiments(session.id)
    const experiments = tableExperiments || session.active_experiments || []
    for (let i = 0; i < experiments.length; i++) {
      const node = await upsertNode(session.id, nodeFromExperiment(experiments[i], i + 20), i + 20)
      const root = roots.find((r) => r.pillar === node?.pillar)
      await upsertEdge(session.id, node, root, 'tested_by', 0.7)
    }

    return getPersonalWikiGraph(session.id)
  } catch (err) {
    console.warn('[Wiki] Sync failed:', err?.message || err)
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

  if (error) console.warn('[Wiki] Node activation skipped:', error.message)
}

export async function getPersonalWikiGraph(sessionId) {
  if (!sessionId) return { nodes: [], edges: [] }

  try {
    const { data, error } = await supabase.rpc('get_personal_wiki_graph', {
      match_session_id: sessionId,
    })

    console.log('[wiki] getPersonalWikiGraph raw response:', JSON.stringify(data), 'error:', error)

    if (error) {
      console.warn('[Wiki] Graph fetch skipped:', error.message)
      return { nodes: [], edges: [] }
    }

    return buildDisplayGraph({
      nodes: data?.nodes || [],
      edges: data?.edges || [],
    }, sessionId)
  } catch (err) {
    console.warn('[Wiki] Graph fetch failed:', err?.message || err)
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
