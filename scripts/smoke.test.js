import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { buildSystemPrompt } from '../src/lib/openai.js'
import { validateExperimentQuality } from '../src/lib/experimentQuality.js'

dotenv.config()

const TEST_PORT = Number(process.env.SMOKE_TEST_PORT || 3911)
const API_BASE = (process.env.SMOKE_API_URL || `http://localhost:${TEST_PORT}`).replace(/\/$/, '')
const SHOULD_SPAWN_API = !process.env.SMOKE_API_URL
const TEST_TIMEOUT_MS = Number(process.env.SMOKE_TEST_TIMEOUT_MS || 120000)

const requiredEnv = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'VITE_KNOWLEDGE_SUPABASE_URL',
  'KNOWLEDGE_SUPABASE_SERVICE_ROLE_KEY',
  'OPENAI_API_KEY',
]

assert.ok(
  !process.env.VITE_KNOWLEDGE_SUPABASE_SERVICE_ROLE_KEY,
  'Remove VITE_KNOWLEDGE_SUPABASE_SERVICE_ROLE_KEY from .env; rename it to KNOWLEDGE_SUPABASE_SERVICE_ROLE_KEY so the service key is server-only.'
)

for (const key of requiredEnv) {
  assert.ok(process.env[key], `Missing required smoke-test env var: ${key}`)
}

const mainAdmin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
)

const mainAuthed = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY,
  { auth: { persistSession: false } }
)

const otherAuthed = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY,
  { auth: { persistSession: false } }
)

const knowledgeAdmin = createClient(
  process.env.VITE_KNOWLEDGE_SUPABASE_URL,
  process.env.KNOWLEDGE_SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
)

const state = {
  apiProcess: null,
  accessToken: null,
  userId: null,
  otherUserId: null,
  sessionId: null,
  sessionToken: null,
  messageIds: [],
  experimentIds: [],
  conceptIds: [],
}

function smokeEmail(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomUUID()}@example.com`
}

async function waitForApi() {
  const deadline = Date.now() + 20000
  let lastError = null

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${API_BASE}/health`)
      if (response.ok) return
      lastError = new Error(`Health returned ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await delay(350)
  }

  throw lastError || new Error('API did not become healthy')
}

async function startApiIfNeeded() {
  if (!SHOULD_SPAWN_API) {
    await waitForApi()
    return
  }

  state.apiProcess = spawn(process.execPath, ['server/index.js'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(TEST_PORT),
      FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:5173',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stderr = ''
  state.apiProcess.stderr.on('data', (chunk) => {
    stderr += chunk.toString()
  })

  state.apiProcess.on('exit', (code) => {
    if (code && code !== 0) {
      console.error(`[smoke] API exited with ${code}\n${stderr}`)
    }
  })

  await waitForApi()
}

async function createTestUser(client, prefix) {
  const email = smokeEmail(prefix)
  const password = `Smoke-${crypto.randomUUID()}-1a!`

  const { data: created, error: createError } = await mainAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { given_name: 'Smoke' },
  })
  assert.ifError(createError)
  assert.ok(created?.user?.id, 'created test auth user')

  const { data: signedIn, error: signInError } = await client.auth.signInWithPassword({
    email,
    password,
  })
  assert.ifError(signInError)
  assert.ok(signedIn?.user?.id, 'signed in test auth user')
  assert.ok(signedIn?.session?.access_token, 'received access token')

  return {
    id: signedIn.user.id,
    email,
    accessToken: signedIn.session.access_token,
  }
}

async function apiPost(path, body, token = state.accessToken) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  const json = text ? JSON.parse(text) : null
  return { response, json }
}

async function readNdjsonStream(response) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line) continue
      const event = JSON.parse(line)
      if (event.type === 'chunk') {
        content += event.data?.choices?.[0]?.delta?.content || ''
      }
      if (event.type === 'error') throw new Error(event.error)
    }
  }

  if (buffer.trim()) {
    const event = JSON.parse(buffer)
    if (event.type === 'chunk') {
      content += event.data?.choices?.[0]?.delta?.content || ''
    }
    if (event.type === 'error') throw new Error(event.error)
  }

  return content
}

async function cleanup() {
  if (state.sessionId) {
    await mainAdmin.from('personal_wiki_edges').delete().eq('session_id', state.sessionId)
    await mainAdmin.from('personal_wiki_nodes').delete().eq('session_id', state.sessionId)
    await mainAdmin.from('experiments').delete().eq('session_id', state.sessionId)
    await mainAdmin.from('messages').delete().eq('session_id', state.sessionId)
    await mainAdmin.from('weekly_reads').delete().eq('session_id', state.sessionId)
    await mainAdmin.from('conversation_threads').delete().eq('session_id', state.sessionId)
    await mainAdmin.from('sessions').delete().eq('id', state.sessionId)
  }

  if (state.userId) {
    await knowledgeAdmin.from('user_concept_states').delete().eq('user_id', state.userId)
    await mainAdmin.from('app_sessions').delete().eq('user_id', state.userId)
    await mainAdmin.from('personal_memories').delete().eq('user_id', state.userId)
    await mainAdmin.from('users').delete().eq('id', state.userId)
    await mainAdmin.auth.admin.deleteUser(state.userId)
  }

  if (state.otherUserId) {
    await mainAdmin.from('users').delete().eq('id', state.otherUserId)
    await mainAdmin.auth.admin.deleteUser(state.otherUserId)
  }

  if (state.apiProcess) {
    state.apiProcess.kill('SIGTERM')
    await delay(250)
  }
}

after(cleanup)

function validExperimentFixture(overrides = {}) {
  return {
    title: 'Zara Price Signal',
    pillar: 'Move People',
    description: 'Send Zara the $49 offer and ask if she would pay this week.',
    hypothesis: 'This test will reveal whether Zara sees the $49 offer as urgent enough to pay for this week.',
    window_hours: 48,
    how_to_do_it: 'Open WhatsApp and send Zara the $49 offer with one direct yes-or-no question.',
    real_world_example: 'A founder messages Zara on WhatsApp with a $49 offer and asks for a yes-or-no answer by Friday.',
    what_to_notice: 'Notice whether Zara answers the price directly or dodges the buying decision.',
    success_condition: 'Zara replies yes or no to the $49 offer on WhatsApp.',
    ...overrides,
  }
}

test('Experiment quality validator rejects vague behavior-change tests', () => {
  assert.equal(validateExperimentQuality(validExperimentFixture()).ok, true)

  assert.equal(
    validateExperimentQuality(validExperimentFixture({ hypothesis: '' })).reason,
    'missing_hypothesis'
  )
  assert.equal(
    validateExperimentQuality(validExperimentFixture({ hypothesis: 'This tests urgency.' })).reason,
    'invalid_hypothesis'
  )
  assert.equal(
    validateExperimentQuality(validExperimentFixture({ how_to_do_it: 'Reflect on the offer and think about why it matters.' })).reason,
    'missing_specific_action'
  )
  assert.equal(
    validateExperimentQuality(validExperimentFixture({ real_world_example: 'Imagine someone who asks a customer about an offer.' })).reason,
    'hypothetical_example'
  )
  assert.equal(
    validateExperimentQuality(validExperimentFixture({ success_condition: 'You feel clearer about the decision.' })).reason,
    'vague_success_condition'
  )
  assert.equal(
    validateExperimentQuality(validExperimentFixture({
      how_to_do_it: 'Send a message to someone in your network asking about the offer.',
      real_world_example: 'A founder messages someone in their network about an offer.',
      success_condition: 'Someone replies yes or no to the offer.',
    })).reason,
    'missing_real_world_target'
  )
  assert.equal(
    validateExperimentQuality(validExperimentFixture({
      hypothesis: 'This test will reveal whether Zara would pay for the offer this week.',
      success_condition: 'The note contains one pricing assumption and one disconfirming signal.',
    })).reason,
    'hypothesis_success_mismatch'
  )
})

function promptFixtureControl(overrides = {}) {
  return {
    routeMode: 'single_pillar',
    responseMode: 'terrain',
    activeExperimentCount: 0,
    currentAbsorbedConceptCount: 0,
    historicalAbsorbedConceptCount: 0,
    totalAbsorbedConceptCount: 0,
    canAssignExperiment: false,
    experimentBlockReason: 'not_application_turn',
    shouldHoldExperiment: false,
    requiredArtifactType: null,
    includeArtifactRules: false,
    includeExperimentRules: false,
    includeExperimentLimitRules: false,
    includeLearningGateRules: false,
    includePostExperimentRules: false,
    includeLearningModeRules: false,
    includeAccountabilityModeRules: false,
    includeReportModeRules: false,
    includeReportRules: false,
    includeCancellationRules: false,
    includeUsefulResistanceRules: false,
    includeFullCitationRules: false,
    includeLiveCurrentRules: false,
    ...overrides,
  }
}

function buildPromptFixture({ message, promptControl, learningStateContext = '', learningConcepts = [] }) {
  const session = {
    id: '00000000-0000-0000-0000-000000000001',
    user_id: '00000000-0000-0000-0000-000000000002',
    axiom_profile: 'User overbuilds to avoid committing.',
    session_notes: 'User keeps returning to infrastructure instead of one falsifiable customer/user bet.',
    active_experiments: [],
    warning_level: 0,
    ghost_count: 0,
    consecutive_miss_count: 0,
  }

  return buildSystemPrompt(
    session,
    '',
    '',
    1,
    0.5,
    '',
    'Mode: single_pillar\nSelected pillar: think_sharper\nArtifact strategy: none',
    false,
    {
      latestUserMessage: message,
      learningStateContext,
      learningConcepts,
      promptControl,
    }
  )
}

test('smoke: prompt budgets stay bounded', () => {
  const normalPrompt = buildPromptFixture({
    message: 'What should I think about this?',
    promptControl: promptFixtureControl(),
  })
  assert.ok(normalPrompt.length < 25000, `normal prompt too large: ${normalPrompt.length}`)

  const accountabilityPrompt = buildPromptFixture({
    message: 'I keep overbuilding instead of picking one user.',
    learningConcepts: [{ state: 'absorbed' }],
    promptControl: promptFixtureControl({
      responseMode: 'accountability',
      currentAbsorbedConceptCount: 1,
      totalAbsorbedConceptCount: 1,
      canAssignExperiment: true,
      experimentBlockReason: null,
      includeExperimentRules: true,
      includeAccountabilityModeRules: true,
      includeUsefulResistanceRules: true,
    }),
  })
  assert.ok(accountabilityPrompt.length < 25000, `accountability prompt too large: ${accountabilityPrompt.length}`)

  const learningPrompt = buildPromptFixture({
    message: 'Teach me decision making.',
    learningStateContext: 'Concept: Opportunity Cost\nState: encountered',
    promptControl: promptFixtureControl({
      responseMode: 'learning',
      includeLearningModeRules: true,
    }),
  })
  assert.ok(learningPrompt.length < 30000, `learning prompt too large: ${learningPrompt.length}`)
})

test('smoke: minimum deploy flows work end to end', { timeout: TEST_TIMEOUT_MS }, async (t) => {
  await startApiIfNeeded()

  await t.test('Auth and session', async () => {
    const testUser = await createTestUser(mainAuthed, 'axiom-smoke')
    state.userId = testUser.id
    state.accessToken = testUser.accessToken

    const { data: authData, error: authError } = await mainAuthed.auth.getUser()
    assert.ifError(authError)
    assert.equal(authData.user.id, state.userId)

    const { error: userError } = await mainAuthed.from('users').upsert(
      { id: state.userId, email: testUser.email, first_name: 'Smoke' },
      { onConflict: 'id' }
    )
    assert.ifError(userError)

    state.sessionToken = crypto.randomUUID()
    const sessionPayload = {
      session_token: state.sessionToken,
      user_id: state.userId,
      onboarding_answers: [{ question: 'Smoke question?', answer: 'Smoke answer.' }],
      pillar_weights: { think_sharper: 3, human_mind: 2 },
      axiom_profile: 'Smoke test profile.',
      active_experiments: [],
      ghost_count: 0,
      consecutive_miss_count: 0,
      warning_level: 0,
    }

    const { data: session, error: sessionError } = await mainAuthed
      .from('sessions')
      .insert(sessionPayload)
      .select('*')
      .single()
    assert.ifError(sessionError)
    assert.equal(session.user_id, state.userId)
    assert.equal(session.session_token, state.sessionToken)
    assert.equal(session.warning_level, 0)
    state.sessionId = session.id
  })

  await t.test('Chat', async () => {
    const { data: userMessage, error: userMessageError } = await mainAuthed
      .from('messages')
      .insert({
        session_id: state.sessionId,
        role: 'user',
        content: 'Smoke test user message.',
      })
      .select('*')
      .single()
    assert.ifError(userMessageError)
    assert.equal(userMessage.role, 'user')
    state.messageIds.push(userMessage.id)

    const streamResponse = await fetch(`${API_BASE}/api/openai/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${state.accessToken}`,
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        stream: true,
        max_completion_tokens: 16,
        usage_context: { call_type: 'chat', session_id: state.sessionId },
        messages: [
          { role: 'system', content: 'Reply with exactly SMOKE_OK.' },
          { role: 'user', content: 'Run smoke.' },
        ],
      }),
    })
    assert.equal(streamResponse.status, 200)
    const assistantContent = await readNdjsonStream(streamResponse)
    assert.match(assistantContent, /SMOKE_OK/)

    const { data: assistantMessage, error: assistantMessageError } = await mainAuthed
      .from('messages')
      .insert({
        session_id: state.sessionId,
        role: 'assistant',
        content: assistantContent,
      })
      .select('*')
      .single()
    assert.ifError(assistantMessageError)
    assert.equal(assistantMessage.role, 'assistant')
    assert.ok(assistantMessage.content.length > 0)
    state.messageIds.push(assistantMessage.id)
  })

  let embedding = null
  let retrievedChunk = null

  await t.test('RAG', async () => {
    const embeddingResult = await apiPost('/api/openai/embeddings', {
      model: 'text-embedding-3-small',
      input: 'decision making incentives startup strategy',
      usage_context: { call_type: 'embedding', session_id: state.sessionId },
    })
    assert.equal(embeddingResult.response.status, 200)
    embedding = embeddingResult.json.data?.[0]?.embedding
    assert.equal(Array.isArray(embedding), true)
    assert.equal(embedding.length, 1536)

    const { data: chunks, error: chunkError } = await knowledgeAdmin.rpc('match_wiki_chunks', {
      query_embedding: embedding,
      match_count: 3,
      filter_pillar: null,
    })
    assert.ifError(chunkError)
    assert.ok((chunks || []).length > 0, 'wiki chunk search returns results')
    retrievedChunk = chunks[0]

    const { data: chunkRows, error: chunkRowsError } = await knowledgeAdmin
      .from('wiki_chunks')
      .select('id,source_id,title,author')
      .eq('id', retrievedChunk.id)
    assert.ifError(chunkRowsError)
    assert.ok(chunkRows?.[0]?.source_id, 'retrieved chunk has source_id')

    const { data: source, error: sourceError } = await knowledgeAdmin
      .from('wiki_sources')
      .select('id,title,author,pillar,source_quality')
      .eq('id', chunkRows[0].source_id)
      .single()
    assert.ifError(sourceError)
    assert.ok(source.title, 'source metadata includes title')
  })

  await t.test('Personal memories', async () => {
    const inserted = await apiPost('/api/personal-memories', {
      session_id: state.sessionId,
      memory: {
        type: 'goal',
        content: `Smoke user wants to validate one pricing assumption ${crypto.randomUUID()}.`,
        primary_pillar: 'money_game',
        secondary_pillars: ['think_sharper'],
        pillar_confidence: 0.8,
        importance: 4,
        confidence: 0.85,
      },
      embedding,
    })
    assert.equal(inserted.response.status, 200)
    assert.ok(inserted.json.memory?.id)
    assert.equal(inserted.json.memory.user_id, state.userId)
    assert.equal(inserted.json.memory.session_id, state.sessionId)

    const marked = await apiPost('/api/personal-memories/mark-used', {
      memory_ids: [inserted.json.memory.id],
    })
    assert.equal(marked.response.status, 200)
    assert.equal(marked.json.updated, 1)

    const unauthorized = await apiPost('/api/personal-memories', {
      session_id: state.sessionId,
      memory: { type: 'goal', content: 'Should not write.' },
      embedding,
    }, null)
    assert.equal(unauthorized.response.status, 401)

    const invalid = await apiPost('/api/personal-memories', {
      session_id: state.sessionId,
      memory: { type: 'goal', content: '' },
      embedding: [1, 2, 3],
    })
    assert.equal(invalid.response.status, 400)
  })

  await t.test('Concept states', async () => {
    const { data: concept, error: conceptError } = await knowledgeAdmin
      .from('source_learning_maps')
      .select('id,concept_name')
      .limit(1)
      .single()
    assert.ifError(conceptError)
    assert.ok(concept?.id)
    state.conceptIds.push(concept.id)

    const valid = await apiPost('/api/knowledge/concept-states', {
      rows: [{ concept_id: concept.id, state: 'encountered' }],
    })
    assert.equal(valid.response.status, 200)
    assert.equal(valid.json.updated, 1)

    const unauthorized = await apiPost('/api/knowledge/concept-states', {
      rows: [{ concept_id: concept.id, state: 'encountered' }],
    }, null)
    assert.equal(unauthorized.response.status, 401)

    const invalid = await apiPost('/api/knowledge/concept-states', {
      rows: [{ concept_id: concept.id, state: 'not_a_state' }],
    })
    assert.equal(invalid.response.status, 400)
  })

  await t.test('Experiments', async () => {
    const created = await apiPost('/api/experiments', {
      session_id: state.sessionId,
      experiment: validExperimentFixture(),
    })
    assert.equal(created.response.status, 200)
    assert.ok(created.json.experiment?.id)
    assert.equal(created.json.experiment.user_id, state.userId)
    state.experimentIds.push(created.json.experiment.id)

    const completed = await apiPost(`/api/experiments/${created.json.experiment.id}/status`, {
      status: 'completed',
      outcome: 'Smoke completed.',
    })
    assert.equal(completed.response.status, 200)
    assert.equal(completed.json.experiment.status, 'completed')

    const otherUser = await createTestUser(otherAuthed, 'axiom-smoke-other')
    state.otherUserId = otherUser.id

    const forbidden = await apiPost(`/api/experiments/${created.json.experiment.id}/status`, {
      status: 'cancelled',
      outcome: 'Should not work.',
    }, otherUser.accessToken)
    assert.equal(forbidden.response.status, 403)
  })

  await t.test('Brain graph', async () => {
    const nodePayload = (label, summary) => ({
      label,
      type: 'goal',
      pillar: 'think_sharper',
      summary,
      status: 'active',
      importance: 3,
      confidence: 0.8,
      x: 0,
      y: 0,
      z: 0,
    })

    const nodeA = await apiPost('/api/personal-wiki/nodes', {
      session_id: state.sessionId,
      node: nodePayload('Smoke Node A', 'Smoke node A summary.'),
    })
    const nodeB = await apiPost('/api/personal-wiki/nodes', {
      session_id: state.sessionId,
      node: nodePayload('Smoke Node B', 'Smoke node B summary.'),
    })
    assert.equal(nodeA.response.status, 200)
    assert.equal(nodeB.response.status, 200)
    assert.ok(nodeA.json.node?.id)
    assert.ok(nodeB.json.node?.id)

    const edge = await apiPost('/api/personal-wiki/edges', {
      session_id: state.sessionId,
      source_node_id: nodeA.json.node.id,
      target_node_id: nodeB.json.node.id,
      relationship: 'related_to',
      weight: 0.7,
    })
    assert.equal(edge.response.status, 200)
    assert.equal(edge.json.edge.source_node_id, nodeA.json.node.id)
    assert.equal(edge.json.edge.target_node_id, nodeB.json.node.id)

    const accessed = await apiPost(`/api/personal-wiki/nodes/${nodeA.json.node.id}/accessed`, {})
    assert.equal(accessed.response.status, 200)
  })
})
