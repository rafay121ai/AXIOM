import 'dotenv/config'
import OpenAI from 'openai'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.VITE_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const openaiKey = process.env.OPENAI_API_KEY
const apply = process.argv.includes('--apply')

if (!supabaseUrl || !serviceKey) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceKey)
const openai = openaiKey ? new OpenAI({ apiKey: openaiKey }) : null

async function fetchAll(table, select) {
  const rows = []
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .range(from, from + pageSize - 1)

    if (error) throw error
    rows.push(...(data || []))
    if (!data || data.length < pageSize) break
  }
  return rows
}

function isBrokenLabel(node) {
  const label = String(node.label || '')
  return Boolean(
    node.summary &&
    (
      label.endsWith('...') ||
      label === node.summary ||
      label.toLowerCase().startsWith('the user') ||
      label.length > 40
    )
  )
}

function cleanLabelSeed(label = '') {
  return String(label).replace('...', '').trim()
}

function titleCase(value = '') {
  return String(value)
    .replace(/[_-]/g, ' ')
    .replace(/\b(the user|a pattern of|tendency to|wants to|is trying to|has been)\b/gi, '')
    .replace(/[^\w\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .slice(0, 5)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

function fallbackLabel(memory) {
  const text = String(memory.content || '')
  const beforeComma = text.split(/[,.]/)[0]
  const label = titleCase(beforeComma)
  return label || 'Personal Memory'
}

function uniqueLabelCandidate(label, existingLabels = new Map(), nodeId = null) {
  const clean = String(label || '').trim()
  const candidates = [
    clean,
    `${clean} Signal`,
    `${clean} Context`,
    `${clean} Practice`,
    `${clean} Path`,
  ].filter(Boolean)

  return candidates.find((candidate) => {
    const existingId = existingLabels.get(candidate.toLowerCase())
    return !existingId || existingId === nodeId
  }) || clean
}

async function generateNodeLabel(memory) {
  if (!openai) return fallbackLabel(memory)

  const response = await openai.chat.completions.create({
    model: process.env.WIKI_LABEL_MODEL || 'gpt-5.4-mini-2026-03-17',
    response_format: { type: 'json_object' },
    max_completion_tokens: 80,
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

  const raw = response.choices[0]?.message?.content || '{}'
  const parsed = JSON.parse(raw)
  return String(parsed.label || '').trim() || fallbackLabel(memory)
}

function findMemoryForNode(node, memoriesByUser) {
  const memories = memoriesByUser.get(node.user_id) || []
  const seed = cleanLabelSeed(node.label)
  return memories.find((memory) =>
    memory.content === node.summary ||
    memory.content.startsWith(seed) ||
    seed.startsWith(memory.content.slice(0, 30))
  ) || {
    type: node.type,
    primary_pillar: node.pillar || null,
    content: node.summary,
  }
}

function chooseCanonical(nodes) {
  return [...nodes].sort((a, b) => {
    const aClean = isBrokenLabel(a) ? 0 : 1
    const bClean = isBrokenLabel(b) ? 0 : 1
    if (aClean !== bClean) return bClean - aClean
    return new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0)
  })[0]
}

async function rewireAndDeleteDuplicate(duplicate, canonical, edges) {
  const touched = edges.filter((edge) =>
    edge.source_node_id === duplicate.id ||
    edge.target_node_id === duplicate.id
  )

  for (const edge of touched) {
    const nextSource = edge.source_node_id === duplicate.id ? canonical.id : edge.source_node_id
    const nextTarget = edge.target_node_id === duplicate.id ? canonical.id : edge.target_node_id

    if (nextSource === nextTarget) {
      if (apply) await supabase.from('personal_wiki_edges').delete().eq('id', edge.id)
      continue
    }

    const conflict = edges.find((candidate) =>
      candidate.id !== edge.id &&
      candidate.session_id === edge.session_id &&
      candidate.source_node_id === nextSource &&
      candidate.target_node_id === nextTarget &&
      candidate.relationship === edge.relationship
    )

    if (conflict) {
      if (apply) await supabase.from('personal_wiki_edges').delete().eq('id', edge.id)
      continue
    }

    if (apply) {
      await supabase
        .from('personal_wiki_edges')
        .update({
          source_node_id: nextSource,
          target_node_id: nextTarget,
          updated_at: new Date().toISOString(),
        })
        .eq('id', edge.id)
    }
  }

  if (apply) await supabase.from('personal_wiki_nodes').delete().eq('id', duplicate.id)
}

async function main() {
  const [sessions, nodes, edges, memories] = await Promise.all([
    fetchAll('sessions', 'id,user_id'),
    fetchAll('personal_wiki_nodes', 'id,session_id,label,type,pillar,summary,status,importance,confidence,created_at,updated_at'),
    fetchAll('personal_wiki_edges', 'id,session_id,source_node_id,target_node_id,relationship'),
    fetchAll('personal_memories', 'id,user_id,type,content,primary_pillar,importance,confidence'),
  ])

  const userBySession = new Map(sessions.map((session) => [session.id, session.user_id]))
  const nodesWithUser = nodes.map((node) => ({ ...node, user_id: userBySession.get(node.session_id) }))
  const memoriesByUser = memories.reduce((map, memory) => {
    if (!memory.user_id) return map
    if (!map.has(memory.user_id)) map.set(memory.user_id, [])
    map.get(memory.user_id).push(memory)
    return map
  }, new Map())

  const groups = nodesWithUser.reduce((map, node) => {
    if (!node.summary) return map
    const key = `${node.session_id}|${node.type}|${node.summary}`
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(node)
    return map
  }, new Map())

  let duplicateNodesDeleted = 0
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const canonical = chooseCanonical(group)
    for (const duplicate of group) {
      if (duplicate.id === canonical.id) continue
      await rewireAndDeleteDuplicate(duplicate, canonical, edges)
      duplicateNodesDeleted += 1
    }
  }

  const labelBySessionType = new Map()
  for (const node of nodesWithUser) {
    if (!labelBySessionType.has(`${node.session_id}|${node.type}`)) {
      labelBySessionType.set(`${node.session_id}|${node.type}`, new Map())
    }
    labelBySessionType.get(`${node.session_id}|${node.type}`).set(String(node.label || '').trim().toLowerCase(), node.id)
  }

  let labelsUpdated = 0
  let labelsSkipped = 0
  for (const node of nodesWithUser.filter(isBrokenLabel)) {
    const memory = findMemoryForNode(node, memoriesByUser)
    if (!memory) {
      labelsSkipped += 1
      continue
    }

    const label = await generateNodeLabel(memory)
    const peerLabels = labelBySessionType.get(`${node.session_id}|${node.type}`)
    const uniqueLabel = uniqueLabelCandidate(label, peerLabels, node.id)

    if (apply) {
      const { error } = await supabase
        .from('personal_wiki_nodes')
        .update({ label: uniqueLabel, updated_at: new Date().toISOString() })
        .eq('id', node.id)
      if (error) {
        labelsSkipped += 1
        continue
      }
    }

    peerLabels?.set(uniqueLabel.toLowerCase(), node.id)
    labelsUpdated += 1
  }

  console.log(JSON.stringify({
    mode: apply ? 'apply' : 'dry-run',
    nodes: nodes.length,
    memories: memories.length,
    duplicateNodesDeleted,
    brokenLabelsFound: nodesWithUser.filter(isBrokenLabel).length,
    labelsUpdated,
    labelsSkipped,
  }, null, 2))
}

main().catch((error) => {
  console.error(error?.message || error)
  process.exit(1)
})
