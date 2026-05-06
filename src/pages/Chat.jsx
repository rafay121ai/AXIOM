import { useState, useEffect, useRef, useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import MessageBubble from '../components/MessageBubble'
import ExperimentCard from '../components/ExperimentCard'
import WarningCard from '../components/WarningCard'
import ArtifactRenderer from '../components/ArtifactRenderer'
import { clearStoredSessionToken, getStoredSessionToken, supabase } from '../lib/supabase'
import { openai, CHAT_MODEL, generateOpeningMessage, generateNodeOpeningMessage, buildSystemPrompt } from '../lib/openai'
import { buildArtifactForResponse, getArtifactBuildSteps, getRequiredArtifactType, humanizeArtifactType } from '../lib/artifacts'
import { routeQuestionMode, searchWikiForRoute, formatRouteContext, formatWikiContext } from '../lib/rag'
import { searchPersonalMemory, formatNamedPatternsContext, formatPersonalMemoryContext, updatePersonalMemory } from '../lib/personalMemory'
import { formatLiveSearchContext, liveSearch, shouldUseLiveSearch } from '../lib/liveSearch'
import { getCachedTurnContext, setCachedTurnContext } from '../lib/sessionTurnContext'

// ─── Message Tag Parsing ─────────────────────────────────────────────────────
const ARTIFACT_JSON_KEY_RE = /"(title|topic|core_shift|trend_state|what_is_happening_now|observed_moves|sections|forecast|frameworks|watch_points|source_weighting|confidence|counterforces|for_this_user)"\s*:/
const SIGNAL_MAP_HEADING_RE = /^(WHAT[’']?S COMING|HOW COMPANIES WIN|THE MONEY GAME|THINK SHARPER)\s*$/gim
const MAX_SIGNAL_MAP_PROSE_CHARS = 760

function extractJsonCandidate(text = '') {
  const raw = String(text || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')

  const firstBrace = raw.indexOf('{')
  const lastBrace = raw.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return raw.slice(firstBrace, lastBrace + 1)
  }
  return raw
}

function safeParseJsonText(text) {
  try {
    return JSON.parse(extractJsonCandidate(text))
  } catch {
    return null
  }
}

function inferArtifactTypeFromData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  if (
    data.core_shift ||
    data.trend_state ||
    data.what_is_happening_now ||
    data.observed_moves ||
    data.forecast ||
    data.watch_points
  ) return 'signal_map'
  if (Array.isArray(data.headers) && Array.isArray(data.rows)) return 'comparison_table'
  if (Array.isArray(data.steps)) return 'reasoning_cycle'
  if (Array.isArray(data.layers)) return 'reasoning_stack'
  if (Array.isArray(data.quadrants)) return 'quadrant'
  return null
}

function looksLikeArtifactJson(text = '') {
  const clean = String(text || '').trim()
  if (!clean.startsWith('{')) return false
  return ARTIFACT_JSON_KEY_RE.test(clean)
}

function findArtifactJsonStart(text = '') {
  const source = String(text || '')
  const keyMatch = source.match(ARTIFACT_JSON_KEY_RE)
  if (!keyMatch || keyMatch.index == null) return -1
  return source.slice(0, keyMatch.index).lastIndexOf('{')
}

function parseArtifact(text) {
  const match = text.match(/<artifact[^>]*type="([^"]+)"[^>]*>([\s\S]*?)<\/artifact>/)
  if (!match) {
    const standalone = safeParseJsonText(text)
    const inferredType = inferArtifactTypeFromData(standalone)
    if (inferredType) {
      return { cleanText: '', artifact: { type: inferredType, data: standalone } }
    }

    return {
      cleanText: text.replace(/<book_ref>[\s\S]*?<\/book_ref>/g, '').trim(),
      artifact: null,
    }
  }

  const type = match[1]
  const data = safeParseJsonText(match[2])
  const cleanText = text.replace(/<artifact[^>]*>[\s\S]*?<\/artifact>/, '').trim()

  if (!data || typeof data !== 'object') {
    if (import.meta.env.DEV) {
      console.warn('[parseArtifact] JSON parse failed or returned non-object', { type, raw: match[2]?.slice(0, 200) })
    }
    return { cleanText, artifact: null }
  }

  return { cleanText, artifact: { type, data } }
}

function parseExperiment(text) {
  const match = text.match(/<experiment>([\s\S]*?)<\/experiment>/)
  if (!match) return { cleanText: text, experiment: null }

  const experiment = safeParseJsonText(match[1])
  const cleanText = text.replace(/<experiment>[\s\S]*?<\/experiment>/, '').trim()

  if (!experiment || typeof experiment !== 'object') {
    return { cleanText: text, experiment: null }
  }

  return { cleanText, experiment }
}

function parseMessage(text) {
  const { cleanText: afterArtifact, artifact } = parseArtifact(text)
  const { cleanText, experiment } = parseExperiment(afterArtifact)
  return { cleanText, artifact, experiment }
}

function stripLeakedStructuredPayload(text = '') {
  const clean = String(text || '').trim()
  if (!clean) return ''

  const fencedJson = clean
    .replace(/```json[\s\S]*?```/gi, '')
    .replace(/<artifact[^>]*>[\s\S]*/gi, '')
    .trim()

  if (looksLikeArtifactJson(fencedJson)) {
    const parsed = safeParseJsonText(fencedJson)
    const inferredType = inferArtifactTypeFromData(parsed)
    if (inferredType || !parsed) return ''
  }

  const artifactJsonStart = findArtifactJsonStart(fencedJson)
  if (artifactJsonStart >= 0) {
    const before = fencedJson.slice(0, artifactJsonStart).trim()
    const candidate = fencedJson.slice(artifactJsonStart).trim()
    const parsed = safeParseJsonText(candidate)
    const inferredType = inferArtifactTypeFromData(parsed)
    if (inferredType || !parsed) {
      return before
    }
  }

  const jsonStart = fencedJson.indexOf('{')
  const jsonEnd = fencedJson.lastIndexOf('}')

  if (jsonStart !== -1 && jsonEnd > jsonStart) {
    const before = fencedJson.slice(0, jsonStart).trim()
    const after = fencedJson.slice(jsonEnd + 1).trim()
    const candidate = fencedJson.slice(jsonStart, jsonEnd + 1)
    const parsed = safeParseJsonText(candidate)
    if (parsed && typeof parsed === 'object') {
      return [before, after].filter(Boolean).join('\n\n').trim()
    }
  }

  return fencedJson
}

function tidyProseForArtifact(text = '', artifactType = null) {
  const clean = String(text || '').trim()
  if (artifactType !== 'signal_map' || !clean) return clean

  const hadSignalMapHeadings = SIGNAL_MAP_HEADING_RE.test(clean)
  SIGNAL_MAP_HEADING_RE.lastIndex = 0

  const withoutHeadings = clean
    .replace(SIGNAL_MAP_HEADING_RE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  if (!hadSignalMapHeadings && withoutHeadings.length <= MAX_SIGNAL_MAP_PROSE_CHARS) {
    return withoutHeadings
  }

  const paragraphs = withoutHeadings
    .split(/\n{2,}/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean)

  const compact = paragraphs.slice(0, 2).join('\n\n')
  return completeSentenceExcerpt(compact, MAX_SIGNAL_MAP_PROSE_CHARS)
}

function completeSentenceExcerpt(text = '', maxChars = MAX_SIGNAL_MAP_PROSE_CHARS) {
  const clean = String(text || '').trim()
  if (clean.length <= maxChars) return clean

  const boundaryMatches = [...clean.matchAll(/[.!?](?=\s|$)/g)]
  const lastSafeBoundary = boundaryMatches
    .map(match => match.index + 1)
    .filter(index => index <= maxChars)
    .pop()

  if (lastSafeBoundary && lastSafeBoundary >= Math.min(220, maxChars * 0.45)) {
    return clean.slice(0, lastSafeBoundary).trim()
  }

  const firstSentence = boundaryMatches[0]
  if (firstSentence) return clean.slice(0, firstSentence.index + 1).trim()

  return clean.slice(0, maxChars).replace(/\s+\S*$/, '').trim()
}

function sanitizeVisibleAssistantText(text = '', artifactType = null) {
  return tidyProseForArtifact(stripLeakedStructuredPayload(text), artifactType)
}

function visibleResponseContract(route, artifactType = null, shouldHoldExperiment = false) {
  const lines = [
    'VISIBLE RESPONSE CONTRACT:',
    '- The visible chat answer must be prose only. Never output raw JSON, schemas, artifact payloads, or internal route labels.',
  ]

  if (artifactType) {
    lines.push(`- A separate ${artifactType} artifact is being built by the app. Do not write the artifact yourself.`)
    lines.push('- Do not duplicate artifact sections in prose. The prose should set up the artifact, not repeat it.')
  } else {
    lines.push('- No artifact is being built for this turn. Do not output artifact tags, markdown tables, JSON, or a structured visual block.')
  }

  if (artifactType === 'signal_map') {
    lines.push('- For signal_map turns, write 1-2 compact paragraphs only.')
    lines.push('- Do not print the headings WHAT\'S COMING, HOW COMPANIES WIN, THE MONEY GAME, or THINK SHARPER in the visible answer.')
    lines.push('- Do not list the forecast, framework, watch points, observed moves, or pillar cards in prose.')
  }

  if (shouldHoldExperiment) {
    lines.push('- The user already has two active experiments. Do not assign another experiment or experiment-shaped checklist.')
  }

  return lines.join('\n')
}

function shouldHaveArtifact(text) {
  return /\b(example|examples|framework|steps|process|compare|comparison|breakdown|checklist|matrix|timeline|how does|how do|how should|what should be in|walk me through)\b/i.test(text)
}

function asksForExperimentOrApplication(text = '') {
  return /\b(experiment|practical|apply|application|next step|next move|what should i do|what do i do|do today|try today|test this|real[- ]world)\b/i.test(text)
}

function needsCurrentSourceGrounding(text = '') {
  const lower = String(text || '').toLowerCase()
  const currentAffairs = /\b(geopolitics|geopolitical|us[- ]china|china|united states|america|beijing|washington|tariff|sanction|export control|semiconductor controls|taiwan|war|military|election|policy|regulation|diplomacy)\b/.test(lower)
  const liveFrame = /\b(doing|now|today|current|currently|recent|recently|latest|this year|next 12 months|next year)\b/.test(lower)
  return currentAffairs && liveFrame
}

function looksLikeExperimentCompletion(text = '') {
  return /\b(i did it|i completed|completed it|finished it|i finished|ran the experiment|did the experiment|reporting back|here'?s what happened|i tested it)\b/i.test(text)
}

function looksLikeExperimentCancel(text = '') {
  return /\b(cancel this experiment|cancel the experiment|drop this experiment|skip this experiment|remove this experiment|i'?m not doing this)\b/i.test(text)
}

function isLowSignalMemoryTurn(userText = '', assistantText = '') {
  const user = String(userText || '').trim().toLowerCase()
  const assistant = String(assistantText || '').trim()
  if (!user || !assistant) return true

  if (user.length <= 4 && /^(ok|k|yes|yeah|yep|no|nah|hm|hmm|lol|cool|nice|fine|sure)$/.test(user)) {
    return true
  }

  if (/^(ok|okay|yes|yeah|yep|no|nah|continue|go on|keep going|next|more|again|regenerate|give another|another one|try again|make it shorter|make it longer|explain more|elaborate)$/i.test(user)) {
    return true
  }

  return user.length < 18 && !/\b(i|me|my|we|our|did|tried|built|launched|sold|failed|decided|feel|think|want|need)\b/i.test(user)
}

function artifactLooksLikeExperiment(artifact) {
  if (!artifact?.data) return false
  const title = String(artifact.data.title || artifact.data.label || '').toLowerCase()
  const serialized = JSON.stringify(artifact.data).toLowerCase()
  return /\b(today'?s experiment|experiment|real-world application|apply this today)\b/.test(title) ||
    /\b(today'?s experiment|window_hours|bring back|what to notice|success condition)\b/.test(serialized)
}

function hasConcreteIncident(text = '') {
  const lower = text.toLowerCase()
  return /\b(yesterday|last night|last week|this week|this month|after i|because i|i did|i tried|i launched|i sold|i posted|i shipped|i invested|i traded|i spent|i lost|i made \$|we did|we tried|we launched|we sold|we shipped)\b/.test(lower) ||
    /\b\d+[%$]?\b/.test(lower)
}

function isAwaitingConcreteIncident(messages = []) {
  const lastAssistant = [...messages].reverse().find((message) => message.role === 'assistant' && message.content && !message.streaming)
  if (!lastAssistant) return false
  return /\b(actual win first|actual situation first|actual moment|actual decision|actual situation|actual scene|what was the choice|what happened recently|name one recent choice)\b/i.test(lastAssistant.content)
}

function followUpIncidentQuestion(text = '') {
  if (hasConcreteIncident(text)) return null
  return 'That still is not the actual event. Name the concrete win, choice, or moment first, then I can work with it.'
}

function firstPersonIncidentQuestion(text = '') {
  const lower = text.toLowerCase()
  const hasFirstPersonPattern = /\b(i keep|i always|i tend to|i feel like|i feel|i'm|i am|i can't|i cannot|i struggle|i avoid|i procrastinate|i overthink|why do i|how do i)\b/.test(lower)
  if (!hasFirstPersonPattern) return null

  if (hasConcreteIncident(text)) return null

  if (/\b(short[- ]term win|short[- ]term wins|edge|luck|lucky|proof that i'?m good|proof i'?m good|good at the game)\b/.test(lower)) {
    return 'What happened recently that made you suspect you are overreading a short-term win? Give me the actual win first, not the lesson yet.'
  }

  if (/\b(identity|who i am|smaller|protecting|defending|outgrow|outgrown)\b/.test(lower)) {
    return 'Where did this identity show up most recently? Give me the actual moment, not the theory of it yet.'
  }

  if (/\b(safe option|safe choice|playing safe|play it safe|comfort zone|smaller|shrinking|shrink)\b/.test(lower)) {
    return 'Name one recent choice where you picked safe and then watched your life get smaller. What was the choice?'
  }

  if (/\b(decision|decide|choice|choose|high[- ]stakes|incomplete information)\b/.test(lower)) {
    return 'What is the actual decision in front of you, and what makes it high-stakes right now?'
  }

  if (/\b(stuck|avoid|avoiding|procrastinat|resistance|repeat|same pattern)\b/.test(lower)) {
    return 'What is the most recent moment where this pattern showed up? Give me the scene, not the diagnosis yet.'
  }

  return 'What happened recently that made you ask this? Give me the actual situation first.'
}

function auditArtifact(userText, assistantText, artifact) {
  if (!import.meta.env.DEV) return
  if (!shouldHaveArtifact(userText)) return

  if (!artifact) {
    console.warn('[artifact-audit] Expected an artifact for structured request, but none was parsed.', {
      userText,
      assistantPreview: assistantText.slice(0, 500),
    })
    return
  }

  console.info('[artifact-audit] Parsed artifact:', artifact.type)
}

function estimateNodeContextLevel(node) {
  if (!node) return 0

  const summaryLength = (node.summary || '').trim().length
  const confidence = Number(node.confidence ?? 0.35)
  const importance = Number(node.importance || 3)
  const status = node.status || 'dim'

  let score = 0
  score += Math.min(0.3, Math.max(0, confidence) * 0.3)
  if (summaryLength > 240) score += 0.25
  else if (summaryLength > 120) score += 0.18
  else if (summaryLength > 40) score += 0.1
  if (['active', 'bright', 'ghosted', 'resolved'].includes(status)) score += 0.18
  if (node.last_activated_at) score += 0.08
  if (['pattern', 'goal', 'experiment'].includes(node.type)) score += 0.08
  score += Math.min(0.11, Math.max(0, importance - 1) * 0.0275)

  return Math.max(0, Math.min(1, score))
}

// Strip tag blocks from streaming display — tags are invisible while generating,
// then resolved into rendered components once the stream ends.
function stripForDisplay(text, artifactType = null) {
  return sanitizeVisibleAssistantText(text, artifactType)
    .replace(/<artifact[^>]*>[\s\S]*?<\/artifact>/g, '')
    .replace(/<artifact[^>]*>[\s\S]*/g, '')   // partial opening tag mid-stream
    .replace(/<book_ref>[\s\S]*?<\/book_ref>/g, '')
    .replace(/<book_ref>[\s\S]*/g, '')         // legacy partial citation tag mid-stream
    .replace(/<experiment>[\s\S]*?<\/experiment>/g, '')
    .replace(/<experiment>[\s\S]*/g, '')        // partial opening tag mid-stream
    .replace(/\[JAILBREAK_REDIRECT\]\s*$/g, '')
    .trim()
}

// ─── Ghosting Check ──────────────────────────────────────────────────────────
// Returns updated session if warning_level needs to change, otherwise null.
function normalizeExperiment(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    pillar: row.pillar,
    topic: row.topic,
    window_hours: row.window_hours,
    reference_count: row.reference_count || 0,
    how_to_do_it: row.how_to_do_it,
    real_world_example: row.real_world_example,
    what_to_notice: row.what_to_notice,
    success_condition: row.success_condition,
    assigned_at: row.assigned_at,
    due_at: row.due_at,
    completed_at: row.completed_at,
    cancelled_at: row.cancelled_at,
    ghosted_at: row.ghosted_at,
    outcome: row.outcome,
  }
}

async function fetchSessionExperiments(sessionId) {
  const { data, error } = await supabase
    .from('experiments')
    .select('*')
    .eq('session_id', sessionId)
    .order('assigned_at', { ascending: true })

  if (error) {
    console.warn('[experiments] Fetch failed, falling back to session JSON:', error.message)
    return null
  }

  return (data || []).map(normalizeExperiment)
}

async function checkAndUpdateGhosting(session) {
  const now = Date.now()
  const experiments = session.active_experiments || []
  let ghost_count = session.ghost_count || 0
  let consecutive_miss_count = session.consecutive_miss_count || 0
  let warning_level = session.warning_level || 0
  let changed = false
  const rowUpdates = []

  const updatedExperiments = experiments.map((exp) => {
    if (exp.status !== 'active') return exp

    const assignedAt = new Date(exp.assigned_at).getTime()
    const windowMs = exp.window_hours * 3600 * 1000
    const expired = now - assignedAt > windowMs
    const refs = exp.reference_count || 0

    if (!expired) return exp

    if (refs < 2) {
      // Increment reference count (this session is a reference)
      changed = true
      const updated = { ...exp, reference_count: refs + 1 }
      rowUpdates.push({ id: exp.id, reference_count: updated.reference_count })
      return updated
    }

    if (refs >= 2 && exp.status === 'active') {
      // Ghost — no response after 2 references
      ghost_count++           // lifetime total, kept for analytics
      consecutive_miss_count++ // consecutive streak, drives warning thresholds
      changed = true

      if (consecutive_miss_count >= 4 && warning_level < 2) { warning_level = 2; changed = true }
      else if (consecutive_miss_count >= 2 && warning_level < 1) { warning_level = 1; changed = true }

      const updated = { ...exp, status: 'ghosted' }
      rowUpdates.push({ id: exp.id, status: updated.status })
      return updated
    }

    return exp
  })

  if (!changed) return session

  await Promise.all(
    rowUpdates
      .filter((update) => update.id)
      .map(({ id, ...updates }) =>
        supabase
          .from('experiments')
          .update(updates)
          .eq('id', id)
      )
  )

  const updates = {
    ghost_count,
    consecutive_miss_count,
    warning_level,
  }

  await supabase.from('sessions').update(updates).eq('id', session.id)

  return { ...session, ...updates, active_experiments: updatedExperiments }
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function Chat() {
  const navigate = useNavigate()
  const location = useLocation()
  const nodeContext = location.state?.nodeContext || null
  const initialInput = location.state?.initialInput || ''
  const threadId = location.state?.threadId || null
  const isTouchDevice = window.matchMedia('(pointer: coarse)').matches
  const freshThread = Boolean(location.state?.freshThread)
  const autoSend = Boolean(location.state?.autoSend)
  const skipOpening = Boolean(location.state?.skipOpening)

  const [session, setSession] = useState(null)
  const [messages, setMessages] = useState([])  // { id, role, content, streaming, experiment, artifactPendingType }
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [editingMessageId, setEditingMessageId] = useState(null)
  const [editText, setEditText] = useState('')
  const [loading, setLoading] = useState(true)
  const [aiMessageCount, setAiMessageCount] = useState(0) // assistant messages saved to DB this session

  const bottomRef = useRef(null)
  const textareaRef = useRef(null)
  const sendingRef = useRef(false)        // sync guard against rapid double-submit
  const initCalledRef = useRef(false)     // guard against StrictMode double-invoke
  const abortControllerRef = useRef(null) // current active stream abort handle
  const initialInputAppliedRef = useRef(false)
  const initialInputSentRef = useRef(false)

  const clearTransientRouteState = useCallback(() => {
    const state = location.state || {}
    if (!('autoSend' in state) && !('initialInput' in state) && !('freshThread' in state) && !('skipOpening' in state)) {
      return
    }

    navigate(location.pathname, {
      replace: true,
      state: {
        ...state,
        autoSend: false,
        initialInput: '',
        freshThread: false,
        skipOpening: false,
      },
    })
  }, [location.pathname, location.state, navigate])

  // ── Init ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (initCalledRef.current) return
    initCalledRef.current = true
    initChat()

    // Abort any in-flight stream when the page is hidden (laptop lid close,
    // tab switch, or browser minimize). Prevents the stream from continuing
    // in the background and writing unexpected content to DB after the user leaves.
    function handlePageHide() {
      abortControllerRef.current?.abort()
    }

    // When the browser restores the page from bfcache (back/forward cache),
    // React state is stale. Force a fresh load from DB so the user sees the
    // saved final state, not the mid-stream snapshot.
    function handlePageShow(e) {
      if (!e.persisted) return
      abortControllerRef.current?.abort()
      setLoading(true)
      setMessages([])
      initCalledRef.current = true
      initChat()
    }

    window.addEventListener('pagehide', handlePageHide)
    window.addEventListener('pageshow', handlePageShow)

    return () => {
      abortControllerRef.current?.abort()
      window.removeEventListener('pagehide', handlePageHide)
      window.removeEventListener('pageshow', handlePageShow)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function initChat() {
    const sessionToken = getStoredSessionToken()
    if (!sessionToken) { navigate('/'); return }

    const { data: userData, error: userError } = await supabase.auth.getUser()
    const user = userData.user
    if (userError || !user) {
      clearStoredSessionToken()
      navigate('/')
      return
    }

    const { data: sessionData, error: sessionError } = await supabase
      .from('sessions')
      .select('*')
      .eq('session_token', sessionToken)
      .single()

    if (sessionError || !sessionData) { navigate('/'); return }
    if (sessionData.user_id && sessionData.user_id !== user.id) {
      clearStoredSessionToken()
      navigate('/', { replace: true })
      return
    }

    const tableExperiments = await fetchSessionExperiments(sessionData.id)
    const hydratedSession = {
      ...sessionData,
      active_experiments: tableExperiments || sessionData.active_experiments || [],
    }

    // Check and update ghosting state
    const updatedSession = await checkAndUpdateGhosting(hydratedSession)
    setSession(updatedSession)

    // Fetch only the active thread. Default chat uses null thread_id; node taps
    // create their own thread_id so they do not inherit the old transcript.
    let messagesQuery = supabase
      .from('messages')
      .select('*')
      .eq('session_id', updatedSession.id)
      .order('created_at', { ascending: true })

    messagesQuery = threadId
      ? messagesQuery.eq('thread_id', threadId)
      : messagesQuery.is('thread_id', null)

    const { data: msgs, error: msgsError } = await messagesQuery
    if (msgsError) {
      console.error('Messages fetch error:', msgsError)
    }

    const existing = msgs || []
    const isNew = freshThread || existing.length === 0

    // Update last_active
    await supabase
      .from('sessions')
      .update({ last_active: new Date().toISOString() })
      .eq('id', updatedSession.id)

    setLoading(false)
    const normalizedMsgs = existing.map(normalizeMsg)
    setMessages(normalizedMsgs)

    // Seed the counter from DB so the pacing rule stays accurate across reconnects.
    // New sessions start at 0; the opener will increment it to 1 after saving.
    const savedAssistantCount = existing.filter((m) => m.role === 'assistant').length
    setAiMessageCount(isNew ? 0 : savedAssistantCount)

    // Axiom speaks first only for brand-new sessions. Reloads should be passive:
    // load the saved conversation from the first personalized message without
    // generating another assistant response.
    if (isNew && skipOpening) {
      // Brain input is a fresh intent. Let the user's first message lead.
    } else if (isNew && nodeContext) {
      await streamNodeOpeningMessage(updatedSession, nodeContext)
    } else if (isNew) {
      await streamOpeningMessage(updatedSession)
    }

    if (!initialInput) {
      clearTransientRouteState()
    }
  }

  useEffect(() => {
    if (loading || initialInputAppliedRef.current || !initialInput) return
    initialInputAppliedRef.current = true
    setInput(initialInput)
    if (!autoSend) clearTransientRouteState()
  }, [autoSend, clearTransientRouteState, loading, initialInput])

  useEffect(() => {
    if (
      loading ||
      !session ||
      !autoSend ||
      !initialInput ||
      initialInputSentRef.current ||
      messages.length > 0
    ) {
      return
    }

    initialInputSentRef.current = true
    sendMessage(initialInput)
    clearTransientRouteState()
  }, [autoSend, clearTransientRouteState, initialInput, loading, messages.length, session])

  function normalizeMsg(m) {
    const { cleanText, artifact, experiment } = parseMessage(m.content || '')
    return { ...m, content: cleanText, artifact: artifact || null, experiment: experiment || null }
  }

  // ── Opening Message (new sessions only) ──────────────────────────────────
  // Saved to DB — becomes part of permanent conversation history.
  async function saveAssistantOpening(sess, msgId, content) {
    await supabase.from('messages').insert({
      session_id: sess.id,
      thread_id: threadId,
      role: 'assistant',
      content,
    })

    setAiMessageCount(1)
    setMessages((prev) =>
      prev.map((m) => (m.id === msgId ? { ...m, content, streaming: false } : m))
    )
  }

  async function streamOpeningMessage(sess) {
    const msgId = crypto.randomUUID()
    setMessages((prev) => [
      ...prev,
      { id: msgId, role: 'assistant', content: '', streaming: true, experiment: null, artifactPendingType: null },
    ])

    try {
      const content = await generateOpeningMessage(sess, true)
      await saveAssistantOpening(sess, msgId, content)
    } catch (err) {
      console.error('Opening message error:', err)
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId
            ? { ...m, content: 'Something went wrong connecting to Axiom.', streaming: false }
            : m
        )
      )
    }
  }

  async function streamNodeOpeningMessage(sess, node) {
    const msgId = crypto.randomUUID()
    setMessages((prev) => [
      ...prev,
      { id: msgId, role: 'assistant', content: '', streaming: true, experiment: null, artifactPendingType: null },
    ])

    try {
      const contextLevel = estimateNodeContextLevel(node)
      const content = await generateNodeOpeningMessage(sess, node, contextLevel)
      await saveAssistantOpening(sess, msgId, content)
    } catch (err) {
      console.error('Node opening message error:', err)
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId
            ? { ...m, content: 'This node needs one clean input from you before Axiom can work it properly.', streaming: false }
            : m
        )
      )
    }
  }

  // ── Scroll to bottom ──────────────────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])


  // ── Send Message ──────────────────────────────────────────────────────────
  async function sendMessage(overrideText = null, options = {}) {
    const text = (overrideText ?? input).trim()
    if (!text || sendingRef.current || !session) return
    const {
      reuseUserMessage = null,
      historyMessages = null,
      replaceAssistantId = null,
    } = options

    sendingRef.current = true
    setInput('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
    setSending(true)

    let userMsgId = reuseUserMessage?.id || crypto.randomUUID()
    let assistantMsgId = replaceAssistantId || crypto.randomUUID()
    const baseMessages = historyMessages || messages
    let fullContent = ''

    setMessages((prev) => {
      const withoutReplacement = replaceAssistantId
        ? prev.filter((m) => m.id !== replaceAssistantId)
        : prev
      const assistantPlaceholder = {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        streaming: true,
        status: null,
        artifact: null,
        experiment: null,
        artifactPendingType: null,
      }

      if (reuseUserMessage) return [...withoutReplacement, assistantPlaceholder]

      return [
        ...withoutReplacement,
        { id: userMsgId, role: 'user', content: text, artifact: null, experiment: null },
        assistantPlaceholder,
      ]
    })

    try {
      if (!reuseUserMessage) {
        const { data: savedUser, error: userInsertError } = await supabase
          .from('messages')
          .insert({
            session_id: session.id,
            thread_id: threadId,
            role: 'user',
            content: text,
          })
          .select('id, created_at')
          .single()

        if (userInsertError) throw userInsertError

        if (savedUser?.id) {
          const optimisticUserId = userMsgId
          userMsgId = savedUser.id
          setMessages((prev) =>
            prev.map((m) =>
              m.id === optimisticUserId
                ? { ...m, id: savedUser.id, created_at: savedUser.created_at }
                : m
            )
          )
        }
      }

      const latestExperiments = await fetchSessionExperiments(session.id)
      let sessionForTurn = {
        ...session,
        active_experiments: latestExperiments || session.active_experiments || [],
      }
      if (latestExperiments) setSession(sessionForTurn)

      sessionForTurn = await maybeCaptureExperimentReport(text, sessionForTurn)

      const incidentQuestion = isAwaitingConcreteIncident(baseMessages)
        ? followUpIncidentQuestion(text)
        : firstPersonIncidentQuestion(text)
      if (incidentQuestion) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? { ...m, content: incidentQuestion, streaming: false, artifact: null, experiment: null, artifactPendingType: null }
              : m
          )
        )

        const { data: savedIncidentAssistant, error: incidentInsertError } = await supabase
          .from('messages')
          .insert({
            session_id: session.id,
            thread_id: threadId,
            role: 'assistant',
            content: incidentQuestion,
          })
          .select('id, created_at')
          .single()

        if (incidentInsertError) throw incidentInsertError

        if (savedIncidentAssistant?.id) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? { ...m, id: savedIncidentAssistant.id, created_at: savedIncidentAssistant.created_at }
                : m
            )
          )
        }

        setAiMessageCount((prev) => prev + 1)
        sendingRef.current = false
        setSending(false)
        return
      }

      // RAG: retrieve source knowledge and personal memory for this turn.
      // Current-session cache avoids re-embedding / re-searching the same topic
      // during short follow-ups. It clears naturally when the browser session ends.
      const turnCacheScope = nodeContext?.id
        ? `node:${nodeContext.id}`
        : nodeContext?.pillar
          ? `pillar:${nodeContext.pillar}`
          : 'chat'
      const cachedTurnContext = getCachedTurnContext(sessionForTurn.id, text, turnCacheScope)
      let route = cachedTurnContext?.route || null
      let personalMemories = Array.isArray(cachedTurnContext?.personalMemories)
        ? cachedTurnContext.personalMemories
        : null
      let chunks = Array.isArray(cachedTurnContext?.chunks) ? cachedTurnContext.chunks : null
      let sources = Array.isArray(cachedTurnContext?.sources) ? cachedTurnContext.sources : null
      let retrievalConfidence = Number.isFinite(cachedTurnContext?.retrievalConfidence)
        ? cachedTurnContext.retrievalConfidence
        : null
      let pillarResults = cachedTurnContext?.pillarResults || null
      let wikiContext = typeof cachedTurnContext?.wikiContext === 'string'
        ? cachedTurnContext.wikiContext
        : null
      let liveSearchContext = typeof cachedTurnContext?.liveSearchContext === 'string'
        ? cachedTurnContext.liveSearchContext
        : ''

      if (!route || !personalMemories) {
        const [freshRoute, freshPersonalMemories] = await Promise.all([
          routeQuestionMode(text, sessionForTurn, nodeContext),
          searchPersonalMemory(sessionForTurn.user_id, text, 5),
        ])
        route = route || freshRoute
        personalMemories = personalMemories || freshPersonalMemories
      }

      if (!chunks || !sources || retrievalConfidence === null || !pillarResults || wikiContext === null) {
        const wikiResult = await searchWikiForRoute(text, route, 3)
        chunks = wikiResult.chunks
        sources = wikiResult.sources
        retrievalConfidence = wikiResult.confidence
        pillarResults = wikiResult.pillarResults
        wikiContext = await formatWikiContext(chunks, sources)
      }

      const routedArtifactType = getRequiredArtifactType(route)
      if (!liveSearchContext && shouldUseLiveSearch({
        text,
        retrievalConfidence,
        sourceCount: sources.length,
        requiredArtifactType: routedArtifactType,
      })) {
        try {
          const livePayload = await liveSearch(text, { numResults: 5 })
          liveSearchContext = formatLiveSearchContext(livePayload)
        } catch (error) {
          console.warn('[Live Search] fallback skipped:', error?.message || error)
        }
      }

      if (!cachedTurnContext) {
        setCachedTurnContext(sessionForTurn.id, text, {
          route,
          personalMemories,
          chunks,
          sources,
          retrievalConfidence,
          pillarResults,
          wikiContext,
          liveSearchContext,
        }, turnCacheScope)
      }
      const combinedWikiContext = [wikiContext, liveSearchContext].filter(Boolean).join('\n\n')
      const groundedSourceCount = sources.length + (liveSearchContext ? 1 : 0)
      const suppressUngroundedSignalMap =
        routedArtifactType === 'signal_map' &&
        needsCurrentSourceGrounding(text) &&
        groundedSourceCount === 0
      const effectiveRoute = suppressUngroundedSignalMap
        ? {
            ...route,
            artifactStrategy: 'none',
            rationale: `${route.rationale || 'Current-affairs query.'} Source-thin current affairs should stay prose-first.`,
          }
        : route
      const activeExperimentCount = (sessionForTurn.active_experiments || []).filter((e) => e.status === 'active').length
      const shouldHoldExperiment = activeExperimentCount >= 2 && asksForExperimentOrApplication(text)
      const requiredArtifactType = shouldHoldExperiment ? null : getRequiredArtifactType(effectiveRoute)
      const artifactRouteContext = formatRouteContext(effectiveRoute, pillarResults)
      const continuityContext = cachedTurnContext?.cacheHit
        ? `Conversation continuity: this turn is reusing ${cachedTurnContext.cacheHit === 'follow_up' ? 'the previous turn context for a short follow-up' : 'cached context for the same query'}. Treat it as the same terrain unless the user clearly changed topic. Do not restart from first principles. Signal continuity through smooth prose only, not labels or meta-language.`
        : ''
      const routeContext = [
        artifactRouteContext,
        continuityContext,
        visibleResponseContract(effectiveRoute, requiredArtifactType, shouldHoldExperiment),
      ].filter(Boolean).join('\n\n')
      const graphContext = nodeContext
        ? `Selected Founder Brain node: ${nodeContext.label} | type: ${nodeContext.type} | pillar: ${nodeContext.pillar || 'unmapped'} | read: ${nodeContext.summary || 'No node summary yet.'}`
        : ''
      const personalMemoryContext = [graphContext, formatPersonalMemoryContext(personalMemories)]
        .filter(Boolean)
        .join('\n')
      const namedPatternsContext = formatNamedPatternsContext(personalMemories)

      // Build conversation history for OpenAI (last 10 msgs, exclude the placeholder).
      // Session notes carry the longer memory, so this keeps routine turns cheaper.
      const history = baseMessages
        .filter((m) => !m.streaming && m.content && m.id !== userMsgId)
        .slice(-10)
        .map((m) => ({ role: m.role, content: m.content }))

      history.push({ role: 'user', content: text })

      const systemPrompt = buildSystemPrompt(
        sessionForTurn,
        combinedWikiContext,
        personalMemoryContext,
        aiMessageCount + 1,
        retrievalConfidence,
        namedPatternsContext,
        routeContext
      )

      const runAbort = new AbortController()
      abortControllerRef.current = runAbort

      let artifact = null
      let cleanText = ''
      let experiment = null
      let textDone = false
      let latestArtifact = null

      const artifactBuildPromise = requiredArtifactType
        ? buildArtifactForResponse({
            artifactType: requiredArtifactType,
            query: text,
            session: sessionForTurn,
            routeContext: artifactRouteContext,
            wikiContext: combinedWikiContext,
            personalMemoryContext,
            namedPatternsContext,
            answerDraft: text,
            signal: runAbort.signal,
            onProgress: (progressiveData) => {
              latestArtifact = { type: requiredArtifactType, data: progressiveData }
              if (!textDone) return

              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId
                    ? {
                        ...m,
                        content: cleanText,
                        streaming: false,
                        artifact: latestArtifact,
                        experiment: null,
                        artifactPendingType: null,
                      }
                    : m
                )
              )
            },
          }).then((result) => {
            latestArtifact = result || latestArtifact
            return latestArtifact
          })
        : Promise.resolve(null)

      // Stream response
      const stream = await openai.chat.completions.create({
        model: CHAT_MODEL,
        messages: [{ role: 'system', content: systemPrompt }, ...history],
        stream: true,
        session_id: sessionForTurn.id,
      }, { signal: runAbort.signal })

      let streamDone = false

      for await (const chunk of stream) {
        if (streamDone) break
        const choice = chunk.choices[0]
        const delta = choice?.delta?.content || ''
        fullContent += delta

        if (choice?.finish_reason === 'stop' || choice?.finish_reason === 'length') {
          streamDone = true
        }

        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId ? { ...m, content: stripForDisplay(fullContent, requiredArtifactType) } : m
          )
        )

        if (streamDone) break
      }

      abortControllerRef.current = null

      // Jailbreak: termination — server auto-increments via session_id in the request
      if (fullContent.trim() === 'AXIOM_SESSION_TERMINATED') {
        setMessages((prev) => prev.filter((m) => m.id !== assistantMsgId))
        navigate('/brain')
        return
      }

      // Jailbreak: redirect (attempts 1 & 2) — server auto-increments; update local state optimistically
      const isJailbreakRedirect = fullContent.includes('[JAILBREAK_REDIRECT]')
      if (isJailbreakRedirect) {
        fullContent = fullContent.replace(/\[JAILBREAK_REDIRECT\]\s*$/, '').trimEnd()
        setSession((prev) => ({ ...prev, jailbreak_attempts: (prev.jailbreak_attempts || 0) + 1 }))
      }

      // Parse artifact and experiment tags — done exactly once after stream ends
      const parsed = parseMessage(fullContent)
      artifact = parsed.artifact
      cleanText = sanitizeVisibleAssistantText(parsed.cleanText, requiredArtifactType)
      if (!cleanText && requiredArtifactType && !artifact && !latestArtifact) {
        cleanText = 'The structured map did not build cleanly. Try again in a moment.'
      }
      experiment = parsed.experiment
      textDone = true

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? {
                ...m,
                content: cleanText,
                streaming: false,
                artifact: latestArtifact,
                experiment: null,
                artifactPendingType: requiredArtifactType && !latestArtifact ? requiredArtifactType : null,
              }
            : m
        )
      )

      if (requiredArtifactType) {
        try {
          const builtArtifact = await artifactBuildPromise
          artifact = builtArtifact || artifact || latestArtifact
          if (artifact?.data) {
            fullContent = `${cleanText}\n\n<artifact type="${requiredArtifactType}">\n${JSON.stringify(artifact.data)}\n</artifact>`
          } else {
            fullContent = cleanText
          }
        } catch (artifactErr) {
          console.warn(`Structured artifact generation failed for ${requiredArtifactType}:`, artifactErr?.message || artifactErr)
          fullContent = cleanText
        }
      } else {
        artifact = parsed.artifact
        if (!artifact && parsed.cleanText !== cleanText) {
          fullContent = cleanText
        }
      }

      if (shouldHoldExperiment && artifactLooksLikeExperiment(artifact)) {
        console.warn('[experiments] Suppressed experiment-shaped artifact because two are already active.')
        artifact = null
        fullContent = cleanText
      }

      if (experiment && activeExperimentCount >= 2) {
        console.warn('[experiments] Suppressed experiment because two are already active.')
        experiment = null
      }

      if (experiment) {
        fullContent = `${fullContent}\n\n<experiment>\n${JSON.stringify(experiment)}\n</experiment>`
      }

      auditArtifact(text, fullContent, artifact)

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? { ...m, content: cleanText, streaming: false, artifact, experiment, artifactPendingType: null }
            : m
        )
      )

      // Save assistant message (raw content with experiment tag intact for audit)
      const { data: savedAssistant, error: assistantInsertError } = await supabase
        .from('messages')
        .insert({
          session_id: sessionForTurn.id,
          thread_id: threadId,
          role: 'assistant',
          content: fullContent,
        })
        .select('id, created_at')
        .single()

      if (assistantInsertError) throw assistantInsertError

      if (savedAssistant?.id) {
        const optimisticAssistantId = assistantMsgId
        assistantMsgId = savedAssistant.id
        setMessages((prev) =>
          prev.map((m) =>
            m.id === optimisticAssistantId
              ? { ...m, id: savedAssistant.id, created_at: savedAssistant.created_at }
              : m
          )
        )
      }

      setAiMessageCount((prev) => prev + 1)

      // Handle experiment assignment
      let sessionForMemory = sessionForTurn
      if (experiment) {
        sessionForMemory = await assignExperiment(experiment, sessionForTurn)
        const assigned = findMatchingExperiment(sessionForMemory.active_experiments, experiment)
        if (assigned) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? { ...m, experiment: assigned }
                : m
            )
          )
        }
      }

      if (isLowSignalMemoryTurn(text, cleanText)) {
        setSession(sessionForMemory)
      } else {
        const updatedSession = await updatePersonalMemory(sessionForMemory, baseMessages, text, cleanText)
        setSession(updatedSession)
      }
    } catch (err) {
      // AbortError is intentional (pagehide or component unmount) — don't show an error
      if (err.name === 'AbortError') {
        console.log('Stream aborted.')
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? {
                  ...m,
                  content: m.content || stripForDisplay(fullContent) || 'Response stopped.',
                  streaming: false,
                  status: 'interrupted',
                  artifact: null,
                  experiment: null,
                  artifactPendingType: null,
                }
              : m
          )
        )
      } else {
        console.error('Send error:', err)
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? { ...m, content: 'Something went wrong. Try again.', streaming: false, artifactPendingType: null }
              : m
          )
        )
      }
    } finally {
      abortControllerRef.current = null
      sendingRef.current = false
      setSending(false)
    }
  }

  // ── Experiment Assignment ─────────────────────────────────────────────────
  async function assignExperiment(experiment, baseSession = session) {
    if (!baseSession) return baseSession
    const activeExps = baseSession.active_experiments || []

    if (activeExps.filter((e) => e.status === 'active').length >= 2) return baseSession
    const shouldResetMissStreak = activeExps.some((e) => e.status === 'ghosted')

    const assignedAt = new Date()
    const windowHours = Number(experiment.window_hours) > 0 ? Number(experiment.window_hours) : 48
    const dueAt = new Date(assignedAt.getTime() + windowHours * 3600 * 1000)
    const newExp = {
      ...experiment,
      window_hours: windowHours,
      assigned_at: assignedAt.toISOString(),
      due_at: dueAt.toISOString(),
      status: 'active',
      reference_count: 0,
    }

    const { data, error } = await supabase
      .from('experiments')
      .insert({
        session_id: baseSession.id,
        user_id: baseSession.user_id,
        title: experiment.title || null,
        description: experiment.description,
        status: 'active',
        pillar: experiment.pillar || null,
        topic: experiment.topic || null,
        window_hours: windowHours,
        reference_count: 0,
        how_to_do_it: experiment.how_to_do_it || null,
        real_world_example: experiment.real_world_example || null,
        what_to_notice: experiment.what_to_notice || null,
        success_condition: experiment.success_condition || null,
        assigned_at: assignedAt.toISOString(),
        due_at: dueAt.toISOString(),
        metadata: experiment,
      })
      .select('*')
      .single()

    if (error) {
      console.warn('[experiments] Insert failed:', error.message)
      return baseSession
    }

    const updated = [...activeExps, normalizeExperiment(data || newExp)]
    const sessionUpdates = shouldResetMissStreak ? { consecutive_miss_count: 0 } : {}

    if (Object.keys(sessionUpdates).length > 0) {
      await supabase
        .from('sessions')
        .update(sessionUpdates)
        .eq('id', baseSession.id)
    }

    const updatedSession = { ...baseSession, ...sessionUpdates, active_experiments: updated }
    setSession(updatedSession)
    return updatedSession
  }

  function findMatchingExperiment(experiments = [], experiment = {}) {
    if (!experiment) return null
    return [...experiments]
      .reverse()
      .find((item) =>
        item.status === 'active' &&
        item.description === experiment.description &&
        Number(item.window_hours) === Number(experiment.window_hours || 48)
      ) || null
  }

  async function updateExperimentStatus(experimentId, status, outcome = '') {
    if (!session || !experimentId) return null

    const now = new Date().toISOString()
    const updates = { status }
    if (status === 'completed') {
      updates.completed_at = now
      if (outcome) updates.outcome = outcome
    }
    if (status === 'cancelled') updates.cancelled_at = now
    if (status === 'ghosted') updates.ghosted_at = now

    const { data, error } = await supabase
      .from('experiments')
      .update(updates)
      .eq('id', experimentId)
      .select('*')
      .single()

    if (error) {
      console.warn('[experiments] Status update failed:', error.message)
      return null
    }

    const normalized = normalizeExperiment(data)
    const sessionUpdates = status === 'completed' ? { consecutive_miss_count: 0 } : {}
    if (Object.keys(sessionUpdates).length > 0) {
      await supabase
        .from('sessions')
        .update(sessionUpdates)
        .eq('id', session.id)
    }

    setSession((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        ...sessionUpdates,
        active_experiments: (prev.active_experiments || []).map((exp) =>
          exp.id === experimentId ? normalized : exp
        ),
      }
    })

    setMessages((prev) =>
      prev.map((msg) =>
        msg.experiment?.id === experimentId
          ? { ...msg, experiment: normalized }
          : msg
      )
    )

    return normalized
  }

  async function maybeCaptureExperimentReport(text, baseSession) {
    const activeExperiments = (baseSession.active_experiments || []).filter((exp) => exp.status === 'active')
    if (activeExperiments.length === 0) return baseSession

    const target = activeExperiments[0]
    const nextStatus = looksLikeExperimentCancel(text)
      ? 'cancelled'
      : looksLikeExperimentCompletion(text)
        ? 'completed'
        : null

    if (!nextStatus) return baseSession

    const updatedExperiment = await updateExperimentStatus(target.id, nextStatus, text)
    if (!updatedExperiment) return baseSession

    return {
      ...baseSession,
      ...(nextStatus === 'completed' ? { consecutive_miss_count: 0 } : {}),
      active_experiments: (baseSession.active_experiments || []).map((exp) =>
        exp.id === target.id ? updatedExperiment : exp
      ),
    }
  }

  function stopGeneration() {
    abortControllerRef.current?.abort()
  }

  function followingAssistantFor(userMessage, list = messages) {
    const index = list.findIndex((msg) => msg.id === userMessage?.id)
    if (index === -1) return null
    return list.slice(index + 1).find((msg) => msg.role === 'assistant') || null
  }

  async function retireAssistantExperiment(assistantMessage, reason) {
    const experiment = assistantMessage?.experiment
    if (!experiment?.id || experiment.status !== 'active') return
    await updateExperimentStatus(experiment.id, 'cancelled', reason)
  }

  async function regenerateAssistant(userMessage, assistantMessage = null) {
    if (!userMessage || sendingRef.current) return
    const targetAssistant = assistantMessage || followingAssistantFor(userMessage)

    abortControllerRef.current?.abort()
    const historyMessages = messages.filter((msg) =>
      msg.id !== targetAssistant?.id &&
      !msg.streaming &&
      (!userMessage.created_at || !msg.created_at || msg.created_at <= userMessage.created_at)
    )

    await retireAssistantExperiment(targetAssistant, 'Cancelled by assistant regeneration.')

    if (targetAssistant?.id) {
      await supabase.from('messages').delete().eq('id', targetAssistant.id)
    }

    setMessages((prev) => prev.filter((msg) => msg.id !== targetAssistant?.id))
    sendMessage(userMessage.content, {
      reuseUserMessage: userMessage,
      historyMessages,
    })
  }

  function startEditingMessage(message) {
    if (!message || sendingRef.current) return
    setEditingMessageId(message.id)
    setEditText(message.content || '')
  }

  function cancelEditingMessage() {
    setEditingMessageId(null)
    setEditText('')
  }

  async function saveEditedMessage(message) {
    const text = editText.trim()
    if (!message || !text || text === message.content || sendingRef.current) {
      cancelEditingMessage()
      return
    }

    const targetAssistant = followingAssistantFor(message)
    abortControllerRef.current?.abort()

    const { error } = await supabase
      .from('messages')
      .update({ content: text })
      .eq('id', message.id)

    if (error) {
      console.warn('[messages] Edit failed:', error.message)
      return
    }

    await retireAssistantExperiment(targetAssistant, 'Cancelled by user message edit.')

    if (targetAssistant?.id) {
      await supabase.from('messages').delete().eq('id', targetAssistant.id)
    }

    const editedMessage = { ...message, content: text }
    const historyMessages = messages
      .map((msg) => (msg.id === message.id ? editedMessage : msg))
      .filter((msg) =>
        msg.id !== targetAssistant?.id &&
        !msg.streaming &&
        (!message.created_at || !msg.created_at || msg.created_at <= message.created_at)
      )

    setMessages((prev) =>
      prev
        .map((msg) => (msg.id === message.id ? editedMessage : msg))
        .filter((msg) => msg.id !== targetAssistant?.id)
    )
    cancelEditingMessage()
    sendMessage(text, {
      reuseUserMessage: editedMessage,
      historyMessages,
    })
  }

  function reportExperiment(experiment) {
    if (!experiment) return
    setInput(`Reporting back on "${experiment.description}": `)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  async function completeExperiment(experiment) {
    await updateExperimentStatus(experiment.id, 'completed', 'Marked done from experiment card.')
  }

  async function cancelExperiment(experiment) {
    await updateExperimentStatus(experiment.id, 'cancelled', 'Cancelled from experiment card.')
  }

  // ── Textarea auto-grow ────────────────────────────────────────────────────
  function handleTextareaInput(e) {
    setInput(e.target.value)
    e.target.style.height = 'auto'
    e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px'
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey && !isTouchDevice) {
      e.preventDefault()
      sendMessage()
    }
  }

  function handleUserPlot(artifactType, value) {
    const message = `[I placed myself at ${JSON.stringify(value)} on the ${artifactType}]`
    sendMessage(message)
  }

  function handleAnswer(selectedLabel, isCorrect) {
    const message = `[I selected: "${selectedLabel}"]`
    sendMessage(message)
  }

  function handleArtifactSubmit(values) {
    const message = `[I submitted: ${JSON.stringify(values)}]`
    sendMessage(message)
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="chat" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div className="pulse-dot" />
      </div>
    )
  }

  const latestUserMessage = [...messages]
    .reverse()
    .find((msg) => msg.role === 'user' && !msg.streaming)
  const latestAssistantMessage = [...messages]
    .reverse()
    .find((msg) => msg.role === 'assistant')

  return (
    <div className="chat">
      {/* Header */}
      <header className="chat__header">
        <span className="chat__wordmark">Axiom</span>
        <button className="chat__brain-link" onClick={() => navigate('/brain')}>
          Brain
        </button>
      </header>

      {/* Messages */}
      <div className="chat__messages">
        <div className="chat__messages-inner">
          {messages.map((msg) => (
            <MessageGroup
              key={msg.id}
              msg={msg}
              isLatestUser={msg.id === latestUserMessage?.id}
              isLatestAssistant={msg.id === latestAssistantMessage?.id}
              editingMessageId={editingMessageId}
              editText={editText}
              setEditText={setEditText}
              onStartEdit={startEditingMessage}
              onCancelEdit={cancelEditingMessage}
              onSaveEdit={saveEditedMessage}
              onRegenerate={latestUserMessage ? () => regenerateAssistant(latestUserMessage, msg) : null}
              onExperimentReport={reportExperiment}
              onExperimentDone={completeExperiment}
              onExperimentCancel={cancelExperiment}
              sending={sending}
              onAnswer={handleAnswer}
              onSubmit={handleArtifactSubmit}
              onUserPlot={handleUserPlot}
            />
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input */}
      <div className="chat__input-wrap">
        <div className="chat__input-inner">
          <textarea
            ref={textareaRef}
            className="chat__textarea"
            placeholder="Something on your mind?"
            value={input}
            rows={1}
            onChange={handleTextareaInput}
            onKeyDown={handleKeyDown}
          />
          <button
            className={`chat__send${sending ? ' chat__send--stop' : ''}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => (sending ? stopGeneration() : sendMessage())}
            disabled={!sending && !input.trim()}
            aria-label={sending ? 'Stop response' : 'Send'}
          >
            {sending ? (
              <span className="chat__stop-icon" />
            ) : (
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M2 8L14 8M14 8L9 3M14 8L9 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Message Group ─────────────────────────────────────────────────────────────
// Renders a message + optional experiment/warning card below it
function MessageGroup({
  msg,
  isLatestUser,
  isLatestAssistant,
  editingMessageId,
  editText,
  setEditText,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onRegenerate,
  onExperimentReport,
  onExperimentDone,
  onExperimentCancel,
  sending,
  onAnswer,
  onSubmit,
  onUserPlot,
}) {
  const showArtifact   = msg.role === 'assistant' && msg.artifact && !msg.streaming
  const showExperiment = msg.role === 'assistant' && msg.experiment && !msg.streaming
  const showArtifactPending = false
  const isEditing = msg.role === 'user' && editingMessageId === msg.id
  const canEdit = msg.role === 'user' && isLatestUser && !sending && !isEditing
  const canRegenerate = msg.role === 'assistant' && isLatestAssistant && !sending && !msg.streaming && typeof onRegenerate === 'function'
  const messageActions = [
    canEdit && { label: 'Edit', onClick: () => onStartEdit(msg) },
    canRegenerate && { label: 'Regenerate', onClick: onRegenerate },
  ]

  // If Axiom placed <artifact_here/> inside the text, inject the artifact inline
  // at that position instead of appending it below the bubble.
  const inlineArtifact = showArtifact && /<artifact_here\s*\/>/i.test(msg.content || '')

  const artifactElement = showArtifact ? (
    <ArtifactRenderer
      type={msg.artifact.type}
      data={msg.artifact.data}
      onAnswer={onAnswer}
      onSubmit={onSubmit}
      onUserPlot={onUserPlot}
    />
  ) : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {isEditing ? (
        <div className="msg-group msg-group--user">
          <div className="msg-edit">
            <textarea
              className="msg-edit__textarea"
              value={editText}
              rows={3}
              onChange={(e) => setEditText(e.target.value)}
              autoFocus
            />
            <div className="msg-edit__actions">
              <button type="button" className="msg__action" onClick={onCancelEdit}>
                Cancel
              </button>
              <button type="button" className="msg__action msg__action--primary" onClick={() => onSaveEdit(msg)}>
                Save
              </button>
            </div>
          </div>
        </div>
      ) : (
        <MessageBubble
          role={msg.role}
          content={msg.content}
          streaming={msg.streaming}
          status={msg.status}
          actions={messageActions}
          artifactNode={inlineArtifact ? artifactElement : null}
        />
      )}
      {showArtifactPending && (
        <ArtifactLoadingPreview artifactType={msg.artifactPendingType} />
      )}
      {showArtifact && !inlineArtifact && artifactElement}
      {showExperiment && (
        <ExperimentCard
          description={msg.experiment.description}
          windowHours={msg.experiment.window_hours}
          howToDoIt={msg.experiment.how_to_do_it}
          realWorldExample={msg.experiment.real_world_example}
          whatToNotice={msg.experiment.what_to_notice}
          successCondition={msg.experiment.success_condition}
          status={msg.experiment.status}
          onReport={msg.experiment.id && msg.experiment.status === 'active' ? () => onExperimentReport(msg.experiment) : null}
          onDone={msg.experiment.id && msg.experiment.status === 'active' ? () => onExperimentDone(msg.experiment) : null}
          onCancel={msg.experiment.id && msg.experiment.status === 'active' ? () => onExperimentCancel(msg.experiment) : null}
        />
      )}
    </div>
  )
}

function ArtifactLoadingPreview({ artifactType }) {
  const [stepIndex, setStepIndex] = useState(0)
  const steps = getArtifactBuildSteps(artifactType)

  useEffect(() => {
    setStepIndex(0)
    if (steps.length <= 1) return

    let current = 0
    const interval = window.setInterval(() => {
      current += 1
      setStepIndex((prev) => (prev < steps.length - 1 ? prev + 1 : prev))
      if (current >= steps.length - 1) {
        window.clearInterval(interval)
      }
    }, 380)

    return () => window.clearInterval(interval)
  }, [artifactType, steps.length])

  const currentStep = steps[Math.min(stepIndex, steps.length - 1)] || 'Sketching the shape'

  return (
    <div className="artifact-loading axiom-animate-fade">
      <div className="artifact-loading__canvas">
        <div className="artifact-loading__scanline" />
        <div className={`artifact-loading__shape artifact-loading__shape--${artifactType}`} />
      </div>
      <div className="artifact-loading__whisper">
        <span className="artifact-loading__dot artifact-loading__dot--live" />
        <span className="artifact-loading__whisper-text">{currentStep}</span>
        <span className="artifact-loading__type">{humanizeArtifactType(artifactType)}</span>
      </div>
    </div>
  )
}
