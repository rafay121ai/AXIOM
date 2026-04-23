import { supabase } from './supabase'

const ROOT_NODES = [
  {
    label: 'Psychology',
    type: 'pillar',
    pillar: 'psychology',
    summary: 'How the user protects identity, handles fear, avoids action, and reacts under pressure.',
    status: 'seed',
    importance: 5,
    confidence: 0.9,
    x: -0.7,
    y: 0,
    z: 0.15,
  },
  {
    label: 'Economics',
    type: 'pillar',
    pillar: 'economics',
    summary: 'How the user thinks about incentives, opportunity cost, demand, money, and market feedback.',
    status: 'seed',
    importance: 5,
    confidence: 0.9,
    x: 0.7,
    y: 0,
    z: 0.15,
  },
]

const CONCEPT_NODES = [
  {
    label: 'Choice Architecture',
    type: 'concept',
    pillar: 'psychology',
    summary: 'How framing, defaults, and visible options shape the next decision.',
    status: 'dim',
    importance: 3,
    confidence: 0.8,
  },
  {
    label: 'Identity Protection',
    type: 'concept',
    pillar: 'psychology',
    summary: 'The ways a person protects self-image from market feedback, rejection, or visible failure.',
    status: 'dim',
    importance: 4,
    confidence: 0.8,
  },
  {
    label: 'Rejection Avoidance',
    type: 'concept',
    pillar: 'psychology',
    summary: 'Avoiding contact with buyers or peers because the answer may expose a weak assumption.',
    status: 'dim',
    importance: 4,
    confidence: 0.8,
  },
  {
    label: 'Procrastination',
    type: 'concept',
    pillar: 'psychology',
    summary: 'Delay that hides inside preparation, refinement, and standards.',
    status: 'dim',
    importance: 4,
    confidence: 0.8,
  },
  {
    label: 'Status Anxiety',
    type: 'concept',
    pillar: 'psychology',
    summary: 'Fear that a visible attempt will lower how others rank or interpret you.',
    status: 'dim',
    importance: 3,
    confidence: 0.75,
  },
  {
    label: 'Self-Deception',
    type: 'concept',
    pillar: 'psychology',
    summary: 'A private story that makes avoidance feel intelligent or principled.',
    status: 'dim',
    importance: 4,
    confidence: 0.8,
  },
  {
    label: 'Feedback Loops',
    type: 'concept',
    pillar: 'psychology',
    summary: 'The cycle where action creates data, data changes behavior, and behavior changes outcomes.',
    status: 'dim',
    importance: 3,
    confidence: 0.8,
  },
  {
    label: 'Commitment',
    type: 'concept',
    pillar: 'psychology',
    summary: 'A chosen constraint that forces behavior to become visible.',
    status: 'dim',
    importance: 3,
    confidence: 0.75,
  },
  {
    label: 'Offer Sharpness',
    type: 'concept',
    pillar: 'economics',
    summary: 'How clearly a buyer understands the problem, promise, proof, and next step.',
    status: 'dim',
    importance: 4,
    confidence: 0.85,
  },
  {
    label: 'Market Demand',
    type: 'concept',
    pillar: 'economics',
    summary: 'Evidence that a real buyer cares enough to spend attention, time, money, or reputation.',
    status: 'dim',
    importance: 4,
    confidence: 0.85,
  },
  {
    label: 'Opportunity Cost',
    type: 'concept',
    pillar: 'economics',
    summary: 'The hidden price of spending effort on one path instead of the highest-leverage alternative.',
    status: 'dim',
    importance: 4,
    confidence: 0.8,
  },
  {
    label: 'Incentives',
    type: 'concept',
    pillar: 'economics',
    summary: 'The rewards, penalties, and pressures that explain what people actually do.',
    status: 'dim',
    importance: 3,
    confidence: 0.8,
  },
  {
    label: 'Pricing',
    type: 'concept',
    pillar: 'economics',
    summary: 'The signal that connects value, willingness to pay, positioning, and buyer seriousness.',
    status: 'dim',
    importance: 3,
    confidence: 0.75,
  },
  {
    label: 'Buyer Objections',
    type: 'concept',
    pillar: 'economics',
    summary: 'The reasons buyers hesitate, delay, compare, or reject an offer.',
    status: 'dim',
    importance: 4,
    confidence: 0.8,
  },
  {
    label: 'Sales Friction',
    type: 'concept',
    pillar: 'economics',
    summary: 'Anything that makes the buyer slower, less certain, or less willing to act.',
    status: 'dim',
    importance: 3,
    confidence: 0.75,
  },
  {
    label: 'Demand Testing',
    type: 'concept',
    pillar: 'economics',
    summary: 'Putting an offer in front of buyers before polishing it in private.',
    status: 'dim',
    importance: 4,
    confidence: 0.85,
  },
]

const MEMORY_TYPE_TO_NODE_TYPE = {
  goal: 'goal',
  pattern: 'pattern',
  belief: 'belief',
  experiment_result: 'experiment',
  preference: 'belief',
  decision: 'decision',
  fact: 'concept',
}

function inferPillar(text = '', fallback = null) {
  const lower = text.toLowerCase()
  if (/\b(money|price|pricing|buyer|market|offer|sales|revenue|cost|incentive|demand|outreach|customer)\b/.test(lower)) {
    return 'economics'
  }
  if (/\b(fear|avoid|identity|stress|confidence|rejection|procrastinat|anxiety|status|self|mind|emotion)\b/.test(lower)) {
    return 'psychology'
  }
  return fallback
}

function nodePosition(index, pillar) {
  const side = pillar === 'economics' ? 1 : -1
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

  const pillar = rawNode.pillar || inferPillar(`${label} ${rawNode.summary || ''}`, 'psychology')
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
      status: existing.status === 'bright' ? existing.status : node.status,
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

function seedNodesFromSession(session) {
  const nodes = [...ROOT_NODES, ...CONCEPT_NODES]
  const answers = session?.onboarding_answers || []
  const profile = session?.axiom_profile || ''

  const profilePillar = inferPillar(profile, 'psychology')
  if (profile) {
    nodes.push({
      label: profilePillar === 'economics' ? 'Market Behavior Pattern' : 'Identity Protection Pattern',
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
    const pillar = inferPillar(text, qa.pillar === 'money_game' ? 'economics' : 'psychology')
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
  const pillar = inferPillar(memory.content, null)
  return normalizeNode({
    label: memory.content.length > 54 ? `${memory.content.slice(0, 51)}...` : memory.content,
    type: MEMORY_TYPE_TO_NODE_TYPE[memory.type] || 'concept',
    pillar,
    summary: memory.content,
    status: 'active',
    importance: memory.importance || 3,
    confidence: memory.confidence ?? 0.7,
  }, index)
}

function nodeFromExperiment(experiment, index) {
  return normalizeNode({
    label: experiment.description.length > 54 ? `${experiment.description.slice(0, 51)}...` : experiment.description,
    type: 'experiment',
    pillar: inferPillar(experiment.description, 'psychology'),
    summary: `${experiment.description} (${experiment.window_hours}h window)`,
    status: experiment.status === 'ghosted' ? 'ghosted' : 'active',
    importance: 4,
    confidence: 0.8,
  }, index)
}

export async function syncPersonalWiki(session) {
  if (!session?.id) return { nodes: [], edges: [] }

  try {
    const roots = []
    for (let i = 0; i < ROOT_NODES.length; i++) {
      const root = await upsertNode(session.id, ROOT_NODES[i], i)
      if (root) roots.push(root)
    }

    const seedNodes = seedNodesFromSession(session).slice(ROOT_NODES.length)
    for (let i = 0; i < seedNodes.length; i++) {
      const node = await upsertNode(session.id, seedNodes[i], i + 2)
      const root = roots.find((r) => r.pillar === node?.pillar)
      await upsertEdge(session.id, node, root, 'belongs_to', 0.45)
    }

    const { data: memories, error: memoriesError } = await supabase
      .from('personal_memories')
      .select('type, content, importance, confidence, updated_at')
      .eq('session_id', session.id)
      .order('updated_at', { ascending: false })
      .limit(10)

    if (!memoriesError) {
      for (let i = 0; i < (memories || []).length; i++) {
        const node = await upsertNode(session.id, nodeFromMemory(memories[i], i + 8), i + 8)
        const root = roots.find((r) => r.pillar === node?.pillar)
        await upsertEdge(session.id, node, root, 'belongs_to', 0.55)
      }
    }

    const experiments = session.active_experiments || []
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
  if (!nodeId || String(nodeId).startsWith('fallback-')) return

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

    if (error) {
      console.warn('[Wiki] Graph fetch skipped:', error.message)
      return { nodes: [], edges: [] }
    }

    return {
      nodes: data?.nodes || [],
      edges: data?.edges || [],
    }
  } catch (err) {
    console.warn('[Wiki] Graph fetch failed:', err?.message || err)
    return { nodes: [], edges: [] }
  }
}

export function fallbackGraph(session) {
  const nodes = seedNodesFromSession(session).map((node, index) => ({
    id: `fallback-${index}`,
    session_id: session?.id,
    ...normalizeNode(node, index),
  }))

  const edges = nodes
    .filter((node) => node.type !== 'pillar')
    .map((node, index) => {
      const target = nodes.find((n) => n.type === 'pillar' && n.pillar === node.pillar)
      return target
        ? {
            id: `fallback-edge-${index}`,
            source_node_id: node.id,
            target_node_id: target.id,
            relationship: 'belongs_to',
            weight: 0.4,
          }
        : null
    })
    .filter(Boolean)

  return { nodes, edges }
}
