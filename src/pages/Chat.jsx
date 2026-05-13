import { useState, useEffect, useRef, useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import MessageBubble from '../components/MessageBubble'
import ExperimentCard from '../components/ExperimentCard'
import ArtifactRenderer from '../components/ArtifactRenderer'
import { clearStoredSessionToken, getStoredSessionToken, supabase } from '../lib/supabase'
import { openai, CHAT_MODEL, generateEmbedding, generateOpeningMessage, generateNodeOpeningMessage, buildSystemPrompt, getLastPromptDiagnostics } from '../lib/openai'
import { buildArtifactForResponse, getArtifactBuildSteps, getRequiredArtifactType, humanizeArtifactType } from '../lib/artifacts'
import {
  routeQuestionMode,
  searchWikiForRoute,
  formatRouteContext,
  formatWikiContext,
  formatLearningStateContext,
  updateConceptStatesAfterResponse,
} from '../lib/rag'
import { searchPersonalMemory, formatNamedPatternsContext, formatPersonalMemoryContext, recordExperimentAvoidancePattern, recordExperimentResistancePattern, updatePersonalMemory } from '../lib/personalMemory'
import { formatLiveSearchContext, liveSearch, shouldUseLiveSearch } from '../lib/liveSearch'
import { getCachedTurnContext, setCachedTurnContext } from '../lib/sessionTurnContext'
import { syncPersonalWiki } from '../lib/personalWiki'
import { ensureConversationThread } from '../lib/conversationThreads'
import { incrementAppSessionMessagesSent } from '../lib/appSessionTracker'
import { postApiJson } from '../lib/api'

// ─── Message Tag Parsing ─────────────────────────────────────────────────────
const ARTIFACT_JSON_KEY_RE = /"(title|topic|core_shift|trend_state|what_is_happening_now|observed_moves|sections|forecast|frameworks|watch_points|source_weighting|confidence|counterforces|for_this_user)"\s*:/
const SIGNAL_MAP_HEADING_RE = /^(WHAT[’']?S COMING|HOW COMPANIES WIN|THE MONEY GAME|THINK SHARPER)\s*$/gim
const MAX_SIGNAL_MAP_PROSE_CHARS = 760
const EXPERIMENT_OUTCOME_CLARIFICATION =
  'What got in the way, was it something outside your control, or did you just not get to it?'
const EXPERIMENT_CANCEL_REASON_QUESTION = "What's making this one not work?"

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

function normalizeExperimentPillarForStorage(pillar) {
  const normalized = String(pillar || '')
    .trim()
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

  const aliases = {
    the_human_mind: 'human_mind',
    human_mind: 'human_mind',
    money_game: 'money_game',
    the_money_game: 'money_game',
    how_companies_win: 'how_companies_win',
    whats_coming: 'whats_coming',
    what_s_coming: 'whats_coming',
    think_sharper: 'think_sharper',
    move_people: 'move_people',
  }

  return aliases[normalized] || null
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

  if (!data || typeof data !== 'object') return { cleanText, artifact: null }

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
  const clean = stripArtifactHandoffQuestions(text, artifactType)
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

function stripArtifactHandoffQuestions(text = '', artifactType = null) {
  const clean = String(text || '').trim()
  if (!artifactType || !clean) return clean

  return clean
    .replace(/\bI can (?:turn|make|convert|build) (?:that|this|it) into (?:a |an )?[^.!?]*[.!?](?=\s|$)/gi, '')
    .replace(/\bI can (?:turn|make|convert|build) (?:a |an )?[^.!?]*(?:but|if)[^.!?]*[.!?](?=\s|$)/gi, '')
    .replace(/\bDo you want (?:the|this|that)?\s*(?:map|artifact|visual|diagram|table|chart)[^?]*\?/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
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
    '- Your visible response must be prose only. When you are assigning an experiment, your prose response ends normally, then on a new line you append the experiment tag. The experiment tag is not part of the visible response. It is a structured output appended after your prose. Never put JSON in your prose. Always put it in the tag.',
  ]

  if (artifactType) {
    lines.push(`- A separate ${artifactType} artifact is being built by the app. Do not write the artifact yourself.`)
    lines.push('- Do not duplicate artifact sections in prose. The prose should set up the artifact, not repeat it.')
    lines.push('- Do not ask whether to build the artifact, promise to build it later, or ask for a narrowing choice before it appears. Use the latest user message and conversation context as the scope.')
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
  return hasExplicitArtifactRequest(text) || suggestsVisualReasoningArtifact(text)
}

const EXPLICIT_ARTIFACT_REQUEST_RE =
  /\b(signal map|map this|artifact|visual|diagram|chart|graph|table|comparison table|compare in a table|matrix|watchlist|checklist|timeline|quadrant)\b/i

const EXPLICIT_SIGNAL_MAP_REQUEST_RE =
  /\b(signal map|map this|forecast|prediction|predict|what(?:'s| is) coming|future|2027|2028|2030|next \d+|opportunit(?:y|ies)|where .* moving|current signals|watch points|trend)\b/i

function hasExplicitArtifactRequest(text = '') {
  return EXPLICIT_ARTIFACT_REQUEST_RE.test(String(text || ''))
}

function isPracticalJudgmentTurn(text = '') {
  const clean = String(text || '').toLowerCase()
  const practicalContext =
    /\b(my|our|me|i|we|father|brother|family|business|company|customers?|buyers?|suppliers?|cash|collection|collect|credit|payment|accounts|production|selling|market|textile|wholesale)\b/.test(clean)
  const judgmentAsk =
    /\b(how long|how possible|possible|what should|how should|can i|can we|tell me|done before|people .* done|examples?|currently|right now|every week|every month|process works)\b/.test(clean)

  return practicalContext && judgmentAsk
}

function suggestsVisualReasoningArtifact(text = '') {
  const clean = String(text || '').toLowerCase()
  if (isPracticalJudgmentTurn(clean)) return false

  const asksToUnderstandStructure =
    /\b(i don'?t get|i still don'?t get|confused|help me understand|explain|teach me|how does .* work|how do .* relate|relationship between|moving parts|structure of|framework behind|mental model|break down the structure|map the sequence|sequence from|stages of|layers of)\b/.test(clean)
  const visualReasoningShape =
    /\b(relationship|relate|moving parts|structure|sequence|stages|layers|loop|cycle|stack|pyramid|curve|tradeoff|tension| vs |versus|system|mechanism)\b/.test(clean)

  return asksToUnderstandStructure && visualReasoningShape
}

function asksForExperimentOrApplication(text = '') {
  return /\b(experiment|practical|apply|application|next step|next move|what should i do|what do i do|do today|try today|test this|real[- ]world)\b/i.test(text)
}

function shouldAllowQueryExpansionForTurn(text = '', route = null) {
  const clean = String(text || '').toLowerCase()
  const explicitSourceDepth =
    /\b(sources?|cite|citation|book|essay|paper|study|case study|examples?|framework|mental model|teach|explain|what is|how does|why does|research|evidence|where did|current|latest|recent|news|forecast|prediction|what'?s coming|signals?)\b/.test(clean)
  const routeNeedsDepth =
    route?.mode === 'four_pillar_synthesis' ||
    route?.mode === 'all_pillar_synthesis' ||
    Boolean(getRequiredArtifactType(route))

  return explicitSourceDepth || routeNeedsDepth
}

function explicitArtifactTypeForText(text = '') {
  const clean = String(text || '').toLowerCase()
  if (EXPLICIT_SIGNAL_MAP_REQUEST_RE.test(clean)) return 'signal_map'
  if (/\b(table|comparison table|compare in a table|matrix)\b/.test(clean)) return 'comparison_table'
  if (/\b(loop|cycle)\b/.test(clean)) return 'reasoning_cycle'
  if (/\b(stack|layer|layers|ladder)\b/.test(clean)) return 'reasoning_stack'
  if (/\b(pyramid|hierarchy|hierarchical)\b/.test(clean)) return 'reasoning_pyramid'
  if (/\b(curve|s-curve|adoption curve|phase shift|inflection)\b/.test(clean)) return 'reasoning_curve'
  if (/\b(wave|hype cycle|swell|crest)\b/.test(clean)) return 'reasoning_wave'
  return null
}

function withRouteArtifactStrategy(route, artifactStrategy, reason) {
  const baseRoute = route || {
    mode: 'single_pillar',
    pillars: ['human_mind'],
    artifactStrategy: 'none',
    rationale: '',
  }

  return {
    ...baseRoute,
    artifactStrategy,
    rationale: [baseRoute.rationale, reason].filter(Boolean).join(' '),
  }
}

function resolveTurnResponsePlan({
  text = '',
  route = null,
  cachedTurnContext = null,
  groundedSourceCount = 0,
  activeExperimentCount = 0,
}) {
  const cacheHit = cachedTurnContext?.cacheHit || null
  const explicitArtifactRequest = hasExplicitArtifactRequest(text)
  const visualReasoningArtifact = suggestsVisualReasoningArtifact(text)
  const artifactAllowed = explicitArtifactRequest || visualReasoningArtifact
  const explicitSignalMapRequest = EXPLICIT_SIGNAL_MAP_REQUEST_RE.test(String(text || ''))
  const explicitArtifactType = explicitArtifactTypeForText(text)
  const shouldHoldExperiment = activeExperimentCount >= 2 && asksForExperimentOrApplication(text)

  let effectiveRoute = route
  let requiredArtifactType = getRequiredArtifactType(route)

  if (requiredArtifactType && !artifactAllowed) {
    effectiveRoute = withRouteArtifactStrategy(
      effectiveRoute,
      'none',
      'Artifacts require either an explicit request or a clear visual-reasoning need, so answer in prose.'
    )
    requiredArtifactType = null
  }

  if (cacheHit === 'follow_up' && artifactAllowed && explicitArtifactType && requiredArtifactType !== explicitArtifactType) {
    effectiveRoute = withRouteArtifactStrategy(
      effectiveRoute,
      explicitArtifactType,
      'Short follow-up explicitly requested a visual, so use the requested artifact instead of the inherited strategy.'
    )
    requiredArtifactType = explicitArtifactType
  }

  const inheritedSignalMapWithoutAsk =
    cacheHit === 'follow_up' &&
    requiredArtifactType === 'signal_map' &&
    !explicitSignalMapRequest

  const inheritedArtifactWithoutAsk =
    cacheHit === 'follow_up' &&
    requiredArtifactType &&
    !artifactAllowed

  if (inheritedSignalMapWithoutAsk || inheritedArtifactWithoutAsk) {
    effectiveRoute = withRouteArtifactStrategy(
      effectiveRoute,
      'none',
      'Short follow-up should preserve continuity in prose without inheriting the previous artifact.'
    )
    requiredArtifactType = null
  }

  if (
    requiredArtifactType === 'signal_map' &&
    needsCurrentSourceGrounding(text) &&
    groundedSourceCount === 0
  ) {
    effectiveRoute = withRouteArtifactStrategy(
      effectiveRoute,
      'none',
      'Source-thin current affairs should stay prose-first.'
    )
    requiredArtifactType = null
  }

  if (shouldHoldExperiment && requiredArtifactType) {
    effectiveRoute = withRouteArtifactStrategy(
      effectiveRoute,
      'none',
      'The active experiment limit is full, so this turn should not build an experiment-shaped artifact.'
    )
    requiredArtifactType = null
  }

  return {
    effectiveRoute,
    requiredArtifactType,
    shouldHoldExperiment,
  }
}

function classifyPromptResponseMode({
  text = '',
  session = {},
  activeExperimentCount = 0,
  inExperimentMode = false,
} = {}) {
  const userText = String(text || '').toLowerCase()
  const learningSignal =
    /\b(explain|teach me|how does|how do .* work|what is|take me from 0 to 1|game plan|where do i start|break this down|help me understand|walk me through|how do i learn|what should i know|framework|curriculum|roadmap|learn|concept)\b/.test(userText)
  const reportSignal =
    /\b(i did it|i tried|here'?s what happened|it worked|it didn'?t work|didn'?t do|did not do|couldn'?t|could not|missed it|skipped|forgot|reported back|outcome)\b/.test(userText)
  const cancelSignal =
    /\b(cancel|skip|drop|postpone|busy|later|not now|don'?t want to|i'?m not doing this)\b/.test(userText)
  const accountabilitySignal =
    /\b(i|we|my|our)\b[\s\S]{0,120}\b(stuck|avoid|avoiding|keep|can'?t|cannot|struggling|procrastinating|decision|should i|need to|problem|frustrated|not getting|failed|missed|scared|afraid|hesitating|still thinking|maybe next week|soon|not yet|figuring it out|need more time)\b/.test(userText)
  const applicationSignal = asksForExperimentOrApplication(userText)

  if (session?.unresolved_experiment || reportSignal) return 'report'
  if (inExperimentMode || cancelSignal) return 'experiment_negotiation'
  if (accountabilitySignal || applicationSignal || Number(session?.warning_level || 0) > 0) return 'accountability'
  if (learningSignal) return 'learning'
  if (activeExperimentCount > 0) return 'continuity'
  return 'terrain'
}

function resolvePromptControl({
  text = '',
  session = {},
  effectiveRoute = null,
  requiredArtifactType = null,
  shouldHoldExperiment = false,
  activeExperimentCount = 0,
  experimentAssignedInSession = false,
  concepts = [],
  historicalAbsorbedConceptCount = 0,
  hasLiveWebContext = false,
  inExperimentMode = false,
  retrievalConfidence = null,
} = {}) {
  const currentAbsorbedCount = concepts.filter((concept) => concept.state === 'absorbed').length
  const totalAbsorbedConceptCount = currentAbsorbedCount + Number(historicalAbsorbedConceptCount || 0)
  const responseMode = classifyPromptResponseMode({ text, session, activeExperimentCount, inExperimentMode })
  const wantsApplication = asksForExperimentOrApplication(text)
  const wantsCancellation = /\b(cancel|skip|drop|postpone|busy|later|not now|don'?t want to|i'?m not doing this)\b/i.test(text)
  const wantsSources = /\b(sources?|cite|citation|where did|where is this from|when were these released|how current|released|dated|date unknown|what data|knowledge base|retrieved|search)\b/i.test(text)
  const activeLimitReached = activeExperimentCount >= 2
  const experimentRelevant =
    wantsApplication ||
    ['accountability', 'report', 'experiment_negotiation'].includes(responseMode) ||
    experimentAssignedInSession
  let canAssignExperiment = experimentRelevant && !activeLimitReached && totalAbsorbedConceptCount > 0
  let experimentBlockReason = null

  if (experimentRelevant && activeLimitReached) {
    canAssignExperiment = false
    experimentBlockReason = 'active_experiment_limit'
  } else if (experimentRelevant && totalAbsorbedConceptCount <= 0) {
    canAssignExperiment = false
    experimentBlockReason = 'no_absorbed_concept'
  } else if (!experimentRelevant) {
    canAssignExperiment = false
    experimentBlockReason = 'not_application_turn'
  }

  const usefulResistanceSignal =
    ['accountability', 'experiment_negotiation'].includes(responseMode) ||
    wantsCancellation ||
    /\b(rag|maps?|prompt rewrites?|frameworks?|research|right people|audience|more sources?|more context|another build|build loop|tuning)\b/i.test(text)

  return {
    routeMode: effectiveRoute?.mode || 'single_pillar',
    responseMode,
    activeExperimentCount,
    currentAbsorbedConceptCount,
    historicalAbsorbedConceptCount: Number(historicalAbsorbedConceptCount || 0),
    totalAbsorbedConceptCount,
    canAssignExperiment,
    experimentBlockReason,
    shouldHoldExperiment,
    requiredArtifactType,
    includeArtifactRules: Boolean(requiredArtifactType),
    includeExperimentRules: canAssignExperiment,
    includeExperimentLimitRules: activeLimitReached,
    includeLearningGateRules: experimentBlockReason === 'no_absorbed_concept',
    includePostExperimentRules: Boolean(experimentAssignedInSession),
    includeLearningModeRules: responseMode === 'learning',
    includeAccountabilityModeRules: responseMode === 'accountability',
    includeReportModeRules: responseMode === 'report',
    includeReportRules: responseMode === 'report',
    includeCancellationRules: responseMode === 'experiment_negotiation',
    includeUsefulResistanceRules: usefulResistanceSignal,
    includeFullCitationRules: Boolean(wantsSources || hasLiveWebContext || retrievalConfidence >= 0.3),
    includeLiveCurrentRules: Boolean(hasLiveWebContext),
  }
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

function looksLikeSuccessfulExperimentReport(text = '') {
  return /\b(i did it|i completed|completed it|finished it|i finished|ran the experiment|did the experiment|i tested it|it worked|got it done)\b/i.test(text) &&
    !looksLikeExperimentFailureReport(text)
}

function looksLikeExperimentFailureReport(text = '') {
  return /\b(couldn'?t|could not|can'?t|cannot|wasn'?t able|unable|didn'?t do|did not do|didn'?t get to|did not get to|never got to|not done|didn'?t start|did not start|haven'?t started|missed it|skipped|put it off|procrastinated|forgot|avoided|too busy|got busy|cancel this experiment|cancel the experiment|drop this experiment|skip this experiment|i'?m not doing this)\b/i.test(text)
}

function looksLikeExperimentCancel(text = '') {
  return /\b(cancel this experiment|cancel the experiment|drop this experiment|skip this experiment|remove this experiment|i'?m not doing this)\b/i.test(text)
}

function looksLikeWeakExperimentResistance(text = '') {
  return /\b(i'?m busy|too busy|busy rn|not right now|maybe later|another time|some other time|i'?ll do it another time|i'?ll do it later|maybe next week|next week|not today|don'?t feel like|no time|later|soon)\b/i.test(text)
}

function looksLikeRealExperimentConstraint(text = '') {
  return /\b(outside my control|out of my control|couldn'?t|could not|can'?t|cannot|wasn'?t able|unable|blocked|customer didn'?t respond|client didn'?t respond|they didn'?t reply|no reply|sick|ill|emergency|family emergency|travel|flight|internet|power|server|access|account locked|someone else|dependency|supplier|bank|payment failed|waiting on|don'?t have access|resource constraint|genuine conflict|deadline conflict)\b/i.test(text)
}

function looksLikeCancelInsistence(text = '') {
  return /\b(cancel it|cancel this|still cancel|i still want to cancel|skip it|drop it|remove it|i'?m not doing it|not doing this|no, cancel|just cancel)\b/i.test(text)
}

function experimentLabel(experiment = {}) {
  return experiment.title || experiment.description || 'this experiment'
}

function buildExperimentNegotiation(experiment, stage = 'awaiting_reason') {
  if (!experiment?.id) return null
  return {
    experiment_id: experiment.id,
    experiment_title: experiment.title || '',
    experiment_description: experiment.description || '',
    stage,
    started_at: new Date().toISOString(),
  }
}

function buildCancellationPushback(experiment, reasonText = '') {
  const label = experimentLabel(experiment)
  const cost = experiment.success_condition
    ? `If you skip it, "${experiment.success_condition}" stays untested.`
    : `If you skip it, the question this experiment was supposed to answer stays open.`
  const reason = reasonText ? ` "${String(reasonText).trim()}" is not enough reason to lose that signal.` : ''
  return `${reason.trim()} ${cost} Keep "${label}" open and shrink the first move instead: what is the smallest version you can run today?`.trim()
}

function buildConstraintOffer(experiment) {
  return `That constraint is real, so I am not going to pretend the original shape still fits. I would shrink "${experimentLabel(experiment)}" or swap it for a version you can run under the constraint. Which one do you want?`
}

function isAwaitingExperimentOutcomeClarification(list = []) {
  const lastAssistant = [...list]
    .reverse()
    .find((message) => message.role === 'assistant' && !message.streaming && message.content)

  return String(lastAssistant?.content || '').trim() === EXPERIMENT_OUTCOME_CLARIFICATION
}

function isAwaitingExperimentCancelReason(list = []) {
  const lastAssistant = [...list]
    .reverse()
    .find((message) => message.role === 'assistant' && !message.streaming && message.content)

  return String(lastAssistant?.content || '').trim() === EXPERIMENT_CANCEL_REASON_QUESTION
}

function classifyExperimentOutcomeReason(text = '') {
  const clean = String(text || '').toLowerCase()
  if (/\b(outside my control|out of my control|couldn'?t|could not|can'?t|cannot|wasn'?t able|unable|blocked|customer didn'?t respond|client didn'?t respond|they didn'?t reply|no reply|sick|ill|emergency|family emergency|travel|flight|internet|power|server|access|account locked|someone else|dependency|supplier|bank|payment failed)\b/i.test(clean)) {
    return 'couldnt'
  }
  if (/\b(didn'?t|did not|just didn'?t|get to it|got to it|forgot|procrastinated|avoided|put it off|delayed|lazy|chose not|decided not|no reason|too busy|got busy|later|tomorrow|next week|kept thinking|overthinking)\b/i.test(clean)) {
    return 'didnt'
  }
  return 'didnt'
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

function isPracticalMemoryContinuation(userText = '') {
  return /\b(how do i|how should i|who should i|where do i|what should i|next|reach out|find|choose|decide)\b/i.test(String(userText || ''))
}

function shouldRunMemoryUpdate(userText = '', assistantText = '', options = {}) {
  if (isLowSignalMemoryTurn(userText, assistantText)) {
    return { run: false, reason: 'low_signal_turn' }
  }

  const user = String(userText || '').trim()
  const wordCount = user.split(/\s+/).filter(Boolean).length
  const importantTurn =
    Boolean(options.experiment) ||
    Boolean(options.nodeContext?.id) ||
    looksLikeExperimentCompletion(user) ||
    looksLikeExperimentCancel(user) ||
    /\b(i decided|we decided|decided to|my goal|new goal|i want to|i need to|we need to|i prefer|my preference|from now on|i'?m going to|i am going to)\b/i.test(user)
  const practicalContinuation = isPracticalMemoryContinuation(user)

  if (importantTurn) return { run: true, reason: 'important_turn' }
  if (practicalContinuation) return { run: true, reason: 'practical_continuation' }
  if (wordCount < 8) return { run: false, reason: 'short_non_important_turn' }

  if (Number(options.assistantTurnCount || 0) % 3 === 0) {
    return { run: true, reason: 'third_turn_cadence' }
  }

  return { run: false, reason: 'cadence_throttled' }
}

function artifactLooksLikeExperiment(artifact) {
  if (!artifact?.data) return false
  const title = String(artifact.data.title || artifact.data.label || '').toLowerCase()
  const serialized = JSON.stringify(artifact.data).toLowerCase()
  return /\b(today'?s experiment|experiment|real-world application|apply this today)\b/.test(title) ||
    /\b(today'?s experiment|window_hours|bring back|what to notice|success condition)\b/.test(serialized)
}

function hasConcreteIncident(text = '') {
  const clean = String(text || '').trim()
  const lower = clean.toLowerCase()
  const wordCount = clean.split(/\s+/).filter(Boolean).length
  const businessProcessDetails =
    /\b(founder|startup|product|users?|customers?|buyers?|supplier|suppliers|sales|revenue|cash|collection|collect|credit|payment|accounts|team|employee|operator|operations?|office|father|brother|family|business|company|market|textile|wholesale|manufactur|production|inventory|distribution|pricing|vendor|client|clients|interior sindh)\b/.test(lower) &&
    /\b(currently|right now|today|yesterday|this week|this month|every day|every week|weekly|every month|once or twice|most of the time|most times|process works|goes to|come with|has to go|handles|recorded|tried|launched|sold|shipped|built|posted|talked to|called|met|hired|fired|paid|collected|owes|delivered)\b/.test(lower)

  if (businessProcessDetails) return true
  if (wordCount >= 35 && /\b(i|we|my|our)\b/.test(lower) && /\b(because|but|when|after|before|currently|every|most|usually|process|problem|customer|user|buyer|team|business|product|market)\b/.test(lower)) return true

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
  if (/\b(i just told|i already told|already told|as i said|like i said)\b/i.test(text)) return null
  return 'That still is not the actual event. Name the concrete win, choice, or moment first, then I can work with it.'
}

function firstPersonIncidentQuestion(text = '') {
  const lower = text.toLowerCase()
  const hasFirstPersonPattern = /\b(i keep|i always|i tend to|i feel like|i feel|i can't|i cannot|i struggle|i avoid|i procrastinate|i overthink|why do i|how do i)\b/.test(lower)
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

  return null
}

function auditArtifact(userText, assistantText, artifact) {
  if (!import.meta.env.DEV) return
  if (!shouldHaveArtifact(userText)) return
  if (!artifact) return
}

// Strip tag blocks from streaming display — tags are invisible while generating,
// then resolved into rendered components once the stream ends.
// The two-regex pattern per tag type handles both cases:
//   1. Complete tag already in the buffer (lazy match to avoid over-consuming)
//   2. Partial tag still arriving — catches from <tag to end of string before > lands
function stripForDisplay(text, artifactType = null) {
  return sanitizeVisibleAssistantText(text, artifactType)
    .replace(/<artifact[^>]*>[\s\S]*?<\/artifact>/g, '')
    .replace(/<artifact[\s\S]*$/, '')
    .replace(/<book_ref>[\s\S]*?<\/book_ref>/g, '')
    .replace(/<book_ref[\s\S]*$/, '')
    .replace(/<experiment>[\s\S]*?<\/experiment>/g, '')
    .replace(/<experiment[\s\S]*$/, '')
    .replace(/\[JAILBREAK_REDIRECT\]\s*$/g, '')
    .trim()
}

function warningLevelForCounts(ghostCount = 0, consecutiveMissCount = 0, currentLevel = 0) {
  if (ghostCount >= 4 || consecutiveMissCount >= 5) return Math.max(currentLevel, 2)
  if (ghostCount >= 2 || consecutiveMissCount >= 3) return Math.max(currentLevel, 1)
  return currentLevel
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
    outcome_reason: row.outcome_reason,
    assignment_error: row.assignment_error || false,
    error_message: row.error_message || '',
  }
}

async function fetchSessionExperiments(sessionId) {
  const { data, error } = await supabase
    .from('experiments')
    .select('*')
    .eq('session_id', sessionId)
    .order('assigned_at', { ascending: true })

  if (error) return null

  return (data || []).map(normalizeExperiment)
}

function getUnresolvedExperiment(experiments, messages) {
  const now = Date.now()
  const active = (experiments || []).filter((e) => e.status === 'active')

  // Primary: due_at has passed
  const overdue = active.filter((e) => e.due_at && new Date(e.due_at).getTime() < now)
  if (overdue.length > 0) {
    return overdue.sort((a, b) => new Date(a.due_at) - new Date(b.due_at))[0]
  }

  // Secondary: user indicated completion in messages but outcome was never captured
  const COMPLETION_RE = /\b(i did it|i completed|completed it|finished it|i finished|ran the experiment|did the experiment|reporting back|here'?s what happened|i tested it)\b/i
  const userMsgs = (messages || []).filter((m) => m.role === 'user').slice(-15)
  if (userMsgs.some((m) => COMPLETION_RE.test(m.content || ''))) {
    const unresolved = active.filter((e) => !e.outcome)
    if (unresolved.length > 0) return unresolved[unresolved.length - 1]
  }

  return null
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

    const dueAt = exp.due_at
      ? new Date(exp.due_at).getTime()
      : new Date(exp.assigned_at).getTime() + exp.window_hours * 3600 * 1000
    const expired = now > dueAt

    if (!expired) return exp

    ghost_count++           // lifetime total, kept for analytics
    consecutive_miss_count++ // consecutive streak, drives warning thresholds
    changed = true

    const ghostedAt = new Date().toISOString()
    const updated = { ...exp, status: 'ghosted', outcome_reason: 'ghosted', ghosted_at: ghostedAt }
    rowUpdates.push({ id: exp.id, status: updated.status, outcome_reason: 'ghosted', ghosted_at: ghostedAt })
    return updated

  })

  const thresholdWarningLevel = warningLevelForCounts(ghost_count, consecutive_miss_count, warning_level)
  if (thresholdWarningLevel !== warning_level) {
    warning_level = thresholdWarningLevel
    changed = true
  }

  if (!changed) return session

  await Promise.all(
    rowUpdates
      .filter((update) => update.id)
      .map(({ id, ...updates }) =>
        supabase
          .from('experiments')
          .update(updates)
          .eq('id', id)
          .then(({ error }) => {
            if (error) console.error('Failed to update ghosted experiment', { error, experiment_id: id })
          })
      )
  )

  const updates = {
    ghost_count,
    consecutive_miss_count,
    warning_level,
  }

  const { error: sessionUpdateError } = await supabase.from('sessions').update(updates).eq('id', session.id)
  if (sessionUpdateError) console.error('Failed to update session ghost counts', { error: sessionUpdateError, session_id: session.id })

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
  const pulseNodeEntry = Boolean(location.state?.pulseNodeEntry)

  const [session, setSession] = useState(null)
  const [messages, setMessages] = useState([])  // { id, role, content, streaming, experiment, artifactPendingType }
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [editingMessageId, setEditingMessageId] = useState(null)
  const [editText, setEditText] = useState('')
  const [loading, setLoading] = useState(true)
  const [aiMessageCount, setAiMessageCount] = useState(0) // assistant messages saved to DB this session
  const [sessionAiMessageCount, setSessionAiMessageCount] = useState(0) // AI messages this browser session only, resets on mount

  const bottomRef = useRef(null)
  const textareaRef = useRef(null)
  const sendingRef = useRef(false)        // sync guard against rapid double-submit
  const initCalledRef = useRef(false)     // guard against StrictMode double-invoke
  const abortControllerRef = useRef(null) // current active stream abort handle
  const initialInputAppliedRef = useRef(false)
  const initialInputSentRef = useRef(false)
  const postResponseQueueRef = useRef(Promise.resolve())
  const unresolvedExperimentRef = useRef(null)
  const experimentNegotiationRef = useRef(null)

  const releaseSending = useCallback(() => {
    sendingRef.current = false
    setSending(false)
  }, [])

  const enqueuePostResponseUpdate = useCallback((task) => {
    postResponseQueueRef.current = postResponseQueueRef.current
      .catch(() => {})
      .then(task)
      .catch(() => {})
  }, [])

  const clearTransientRouteState = useCallback(() => {
    const state = location.state || {}
    if (!('autoSend' in state) && !('initialInput' in state) && !('freshThread' in state) && !('skipOpening' in state) && !('pulseNodeEntry' in state)) {
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
        pulseNodeEntry: false,
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

	    if (threadId) {
	      await ensureConversationThread({
	        threadId,
	        userId: user.id,
	        sessionId: updatedSession.id,
	        title: initialInput || nodeContext?.label || 'Branch thread',
	        primaryPillar: nodeContext?.pillar || null,
	      })
	    }

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

    const { data: msgs } = await messagesQuery

    const existing = msgs || []
    const isNew = freshThread || existing.length === 0

    // Update last_active
    await supabase
      .from('sessions')
      .update({ last_active: new Date().toISOString() })
      .eq('id', updatedSession.id)

    const normalizedMsgs = existing.map(normalizeMsg)

    // Detect unresolved experiments before rendering so the opener and session
    // context are correct from the first frame.
    const unresolvedExperiment = getUnresolvedExperiment(tableExperiments || [], normalizedMsgs)
    unresolvedExperimentRef.current = unresolvedExperiment
    const sessionWithContext = unresolvedExperiment
      ? { ...updatedSession, unresolved_experiment: unresolvedExperiment }
      : updatedSession
    if (unresolvedExperiment) setSession(sessionWithContext)

    setLoading(false)
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
      await streamNodeOpeningMessage(sessionWithContext, nodeContext, pulseNodeEntry)
    } else if (isNew) {
      await streamOpeningMessage(sessionWithContext)
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
    setSessionAiMessageCount(1)
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
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId
            ? { ...m, content: 'Something went wrong connecting to Axiom.', streaming: false }
            : m
        )
      )
    }
  }

  async function streamNodeOpeningMessage(sess, node, isPulseEntry = false) {
    const msgId = crypto.randomUUID()
    setMessages((prev) => [
      ...prev,
      { id: msgId, role: 'assistant', content: '', streaming: true, experiment: null, artifactPendingType: null },
    ])

    try {
      const content = await generateNodeOpeningMessage(sess, node, isPulseEntry)
      await saveAssistantOpening(sess, msgId, content)
    } catch {
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
      retryAttempt = 0,
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
    let persistedUserMessage = reuseUserMessage
    const latencyEnabled = true
    const latencyStart = performance.now()
    const latencyMarks = []
    const latencyRunId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
    let latencySummaryPrinted = false
    const markLatency = (label, extra = {}) => {
      if (!latencyEnabled) return
      const totalMs = Math.round(performance.now() - latencyStart)
      const previousMs = latencyMarks.length ? latencyMarks[latencyMarks.length - 1].total_ms : 0
      const row = {
        step: label,
        total_ms: totalMs,
        delta_ms: totalMs - previousMs,
        ...extra,
      }
      latencyMarks.push(row)
      console.log(`[Axiom latency ${latencyRunId}] ${label}`, row)
    }
    const printLatencySummary = (status = 'complete') => {
      if (!latencyEnabled || latencySummaryPrinted) return
      latencySummaryPrinted = true
      console.groupCollapsed(`[Axiom latency ${latencyRunId}] ${status} in ${Math.round(performance.now() - latencyStart)}ms`)
      console.table(latencyMarks)
      console.groupEnd()
    }
    markLatency('send:start', {
      cached_thread_messages: baseMessages.length,
      retryAttempt,
      reuseUserMessage: Boolean(reuseUserMessage),
    })

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
    markLatency('ui:optimistic_messages_rendered')

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
        markLatency('supabase:user_message_saved')

	        if (savedUser?.id) {
	          const optimisticUserId = userMsgId
	          userMsgId = savedUser.id
	          incrementAppSessionMessagesSent()
	          persistedUserMessage = {
            id: savedUser.id,
            role: 'user',
            content: text,
            created_at: savedUser.created_at,
          }
          setMessages((prev) =>
            prev.map((m) =>
              m.id === optimisticUserId
                ? { ...m, id: savedUser.id, created_at: savedUser.created_at }
                : m
            )
          )
        }
      }

      const turnCacheScope = nodeContext?.id
        ? `node:${nodeContext.id}`
        : nodeContext?.pillar
          ? `pillar:${nodeContext.pillar}`
          : 'chat'
      const cachedTurnContext = getCachedTurnContext(session.id, text, turnCacheScope)
      let queryEmbeddingPromise = null
      const getQueryEmbedding = () => {
        if (!queryEmbeddingPromise) {
          markLatency('rag:embedding_started')
          queryEmbeddingPromise = generateEmbedding(text)
            .then((embedding) => {
              markLatency('rag:embedding_ready')
              return embedding
            })
            .catch((error) => {
              markLatency('rag:embedding_failed', {
                message: error?.message || 'unknown',
              })
              throw error
            })
        }
        return queryEmbeddingPromise
      }
      const ragTimingOptions = {
        queryEmbeddingText: text,
        getQueryEmbedding,
        userId: session.user_id,
        onTiming: (step, data = {}) => markLatency(`rag:${step}`, data),
      }
      const memoryTimingOptions = {
        queryEmbeddingText: text,
        getQueryEmbedding,
        onTiming: (step, data = {}) => markLatency(`memory:${step}`, data),
      }
      const routePromise = (cachedTurnContext?.route
        ? Promise.resolve(cachedTurnContext.route)
        : routeQuestionMode(text, {
            ...session,
            unresolved_experiment: unresolvedExperimentRef.current,
            experiment_negotiation: experimentNegotiationRef.current,
          }, nodeContext))
        .then((value) => ({ ok: true, value }))
        .catch((error) => ({ ok: false, error }))
      const personalMemoriesPromise = (Array.isArray(cachedTurnContext?.personalMemories)
        ? Promise.resolve(cachedTurnContext.personalMemories)
        : searchPersonalMemory(session.user_id, text, 5, memoryTimingOptions))
        .then((value) => ({ ok: true, value }))
        .catch((error) => ({ ok: false, error }))
      const latestExperimentsPromise = fetchSessionExperiments(session.id)
      markLatency('preflight:parallel_started', {
        cacheHit: Boolean(cachedTurnContext),
        routeCached: Boolean(cachedTurnContext?.route),
        memoryCached: Array.isArray(cachedTurnContext?.personalMemories),
      })

      const latestExperiments = await latestExperimentsPromise
      markLatency('supabase:experiments_fetched', {
        experimentCount: latestExperiments?.length || 0,
      })
      let sessionForTurn = {
        ...session,
        active_experiments: latestExperiments || session.active_experiments || [],
        unresolved_experiment: unresolvedExperimentRef.current,
        experiment_negotiation: experimentNegotiationRef.current,
      }
      if (!isAwaitingExperimentOutcomeClarification(baseMessages)) {
        sessionForTurn = await checkAndUpdateGhosting(sessionForTurn)
        markLatency('experiments:ghosting_checked')
      } else {
        markLatency('experiments:ghosting_skipped_outcome_clarification')
      }
      if (latestExperiments) setSession(sessionForTurn)

      const reportCapture = await maybeCaptureExperimentReport(text, sessionForTurn, baseMessages)
      sessionForTurn = reportCapture.session
      markLatency('experiments:report_flow_checked', {
        handled: Boolean(reportCapture.handled),
      })
      if (reportCapture.handled) {
        const immediateAssistantText = reportCapture.assistantText
        setSession(sessionForTurn)
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? { ...m, content: immediateAssistantText, streaming: false, artifact: null, experiment: null, artifactPendingType: null }
              : m
          )
        )

        const { data: savedReportAssistant, error: reportInsertError } = await supabase
          .from('messages')
          .insert({
            session_id: session.id,
            thread_id: threadId,
            role: 'assistant',
            content: immediateAssistantText,
          })
          .select('id, created_at')
          .single()

        if (reportInsertError) {
          console.error('Failed to save experiment outcome clarification message', reportInsertError)
          throw reportInsertError
        }
        markLatency('supabase:early_report_assistant_saved')

        if (savedReportAssistant?.id) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? { ...m, id: savedReportAssistant.id, created_at: savedReportAssistant.created_at }
                : m
            )
          )
        }

        setAiMessageCount((prev) => prev + 1)
        setSessionAiMessageCount((prev) => prev + 1)
        releaseSending()
        markLatency('turn:released_early_report')
        printLatencySummary('early-report-complete')
        return
      }

      const incidentQuestion = isAwaitingConcreteIncident(baseMessages)
        ? followUpIncidentQuestion(text)
        : firstPersonIncidentQuestion(text)
      markLatency('incident_gate:checked', {
        triggered: Boolean(incidentQuestion),
      })
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
        markLatency('supabase:incident_assistant_saved')

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
        setSessionAiMessageCount((prev) => prev + 1)
        releaseSending()
        markLatency('turn:released_incident_gate')
        printLatencySummary('incident-complete')
        return
      }

      let route = cachedTurnContext?.route || null
      let personalMemories = Array.isArray(cachedTurnContext?.personalMemories)
        ? cachedTurnContext.personalMemories
        : null
      let chunks = Array.isArray(cachedTurnContext?.chunks) ? cachedTurnContext.chunks : null
      let sources = Array.isArray(cachedTurnContext?.sources) ? cachedTurnContext.sources : null
      let concepts = Array.isArray(cachedTurnContext?.concepts) ? cachedTurnContext.concepts : null
      let learningStateContext = typeof cachedTurnContext?.learningStateContext === 'string'
        ? cachedTurnContext.learningStateContext
        : null
      let retrievalConfidence = Number.isFinite(cachedTurnContext?.retrievalConfidence)
        ? cachedTurnContext.retrievalConfidence
        : null
      let historicalAbsorbedConceptCount = Number.isFinite(cachedTurnContext?.historicalAbsorbedConceptCount)
        ? cachedTurnContext.historicalAbsorbedConceptCount
        : 0
      let pillarResults = cachedTurnContext?.pillarResults || null
      let wikiContext = typeof cachedTurnContext?.wikiContext === 'string'
        ? cachedTurnContext.wikiContext
        : null
      let liveSearchContext = typeof cachedTurnContext?.liveSearchContext === 'string'
        ? cachedTurnContext.liveSearchContext
        : ''

      if (!route || !personalMemories) {
        const [freshRouteResult, freshPersonalMemoriesResult] = await Promise.all([
          routePromise,
          personalMemoriesPromise,
        ])
        if (!freshRouteResult.ok) throw freshRouteResult.error
        if (!freshPersonalMemoriesResult.ok) throw freshPersonalMemoriesResult.error
        const freshRoute = freshRouteResult.value
        const freshPersonalMemories = freshPersonalMemoriesResult.value
        route = route || freshRoute
        personalMemories = personalMemories || freshPersonalMemories
      }
      markLatency('preflight:route_and_memory_ready', {
        routeMode: route?.mode,
        artifactStrategy: route?.artifactStrategy || route?.artifact_strategy,
        memoryCount: personalMemories?.length || 0,
      })
      ragTimingOptions.allowQueryExpansion = shouldAllowQueryExpansionForTurn(text, route)
      markLatency('rag:query_expansion_policy', {
        allowed: ragTimingOptions.allowQueryExpansion,
        routeMode: route?.mode,
        artifactStrategy: route?.artifactStrategy || route?.artifact_strategy,
      })

      if (!chunks || !sources || !concepts || retrievalConfidence === null || !pillarResults || wikiContext === null || learningStateContext === null) {
        const wikiResult = await searchWikiForRoute(text, route, 3, ragTimingOptions)
        chunks = wikiResult.chunks
        sources = wikiResult.sources
        concepts = wikiResult.concepts || []
        historicalAbsorbedConceptCount = Number(wikiResult.historicalAbsorbedConceptCount || 0)
        retrievalConfidence = wikiResult.confidence
        pillarResults = wikiResult.pillarResults
        wikiContext = await formatWikiContext(chunks, sources, ragTimingOptions)
        learningStateContext = formatLearningStateContext(concepts)
        markLatency('rag:wiki_ready', {
          chunks: chunks.length,
          sources: sources.length,
          concepts: concepts.length,
          absorbedConcepts: concepts.filter((concept) => concept.state === 'absorbed').length,
          historicalAbsorbedConcepts: historicalAbsorbedConceptCount,
          totalAbsorbedConcepts: concepts.filter((concept) => concept.state === 'absorbed').length + historicalAbsorbedConceptCount,
          partialConcepts: concepts.filter((concept) => concept.state === 'partial').length,
          encounteredConcepts: concepts.filter((concept) => concept.state === 'encountered').length,
          retrievalConfidence,
        })
      } else {
        markLatency('rag:wiki_cache_ready', {
          chunks: chunks.length,
          sources: sources.length,
          concepts: concepts.length,
          absorbedConcepts: concepts.filter((concept) => concept.state === 'absorbed').length,
          historicalAbsorbedConcepts: historicalAbsorbedConceptCount,
          totalAbsorbedConcepts: concepts.filter((concept) => concept.state === 'absorbed').length + historicalAbsorbedConceptCount,
          partialConcepts: concepts.filter((concept) => concept.state === 'partial').length,
          encounteredConcepts: concepts.filter((concept) => concept.state === 'encountered').length,
          retrievalConfidence,
        })
      }

      const routedArtifactType = getRequiredArtifactType(route)
      let liveSearchAttempted = false
      if (!liveSearchContext && shouldUseLiveSearch({
        text,
        retrievalConfidence,
        sourceCount: sources.length,
        requiredArtifactType: routedArtifactType,
      })) {
        liveSearchAttempted = true
        try {
          const livePayload = await liveSearch(text, { numResults: 5 })
          liveSearchContext = formatLiveSearchContext(livePayload)
          markLatency('live_search:ready', {
            hasContext: Boolean(liveSearchContext),
          })
        } catch (error) {
          markLatency('live_search:failed', {
            message: error?.message || 'unknown',
          })
        }
      }
      if (!liveSearchAttempted) {
        markLatency('live_search:skipped', {
          retrievalConfidence,
          sourceCount: sources.length,
          requiredArtifactType: routedArtifactType,
        })
      }

      if (!cachedTurnContext) {
        setCachedTurnContext(sessionForTurn.id, text, {
          route,
          personalMemories,
          chunks,
          sources,
          concepts,
          retrievalConfidence,
          historicalAbsorbedConceptCount,
          pillarResults,
          wikiContext,
          learningStateContext,
          liveSearchContext,
        }, turnCacheScope)
      }
      const combinedWikiContext = [wikiContext, liveSearchContext].filter(Boolean).join('\n\n')
      const groundedSourceCount = sources.length + (liveSearchContext ? 1 : 0)
      const activeExperimentCount = (sessionForTurn.active_experiments || []).filter((e) => e.status === 'active').length
      const {
        effectiveRoute,
        requiredArtifactType,
        shouldHoldExperiment,
      } = resolveTurnResponsePlan({
        text,
        route,
        cachedTurnContext,
        groundedSourceCount,
        activeExperimentCount,
      })
      markLatency('response_plan:resolved', {
        requiredArtifactType,
        shouldHoldExperiment,
        activeExperimentCount,
      })
      const artifactRouteContext = formatRouteContext(effectiveRoute, pillarResults)
      const continuityContext = cachedTurnContext?.cacheHit
        ? `Conversation continuity: this turn is reusing ${cachedTurnContext.cacheHit === 'follow_up' ? 'the previous turn context for a short follow-up' : 'cached context for the same query'}. Treat it as the same terrain unless the user clearly changed topic. Do not restart from first principles. Signal continuity through smooth prose only, not labels or meta-language.`
        : ''
      const activeExpsForCheckin = (sessionForTurn.active_experiments || []).filter((e) => e.status === 'active')
      const inExperimentMode =
        experimentNegotiationRef.current !== null ||
        isAwaitingExperimentOutcomeClarification(baseMessages) ||
        isAwaitingExperimentCancelReason(baseMessages)
      const isCheckinTurn =
        sessionAiMessageCount > 0 &&
        sessionAiMessageCount % 3 === 0 &&
        activeExpsForCheckin.length > 0 &&
        !inExperimentMode
      const checkinContext = isCheckinTurn
        ? `EXPERIMENT CHECK-IN: This is a scheduled check-in turn. Before responding to the user's message, open with one direct sentence asking how their active experiment${activeExpsForCheckin.length > 1 ? 's are' : ' is'} going: ${activeExpsForCheckin.map((e) => e.title || e.description).filter(Boolean).join('; ')}. Make it feel like Axiom noticing naturally — not a system prompt, not a separate paragraph. One sentence, then respond to what they brought.`
        : ''
      const experimentAssignedInSession = baseMessages.some((m) => m.experiment != null)
      const promptControl = resolvePromptControl({
        text,
        session: sessionForTurn,
        effectiveRoute,
        requiredArtifactType,
        shouldHoldExperiment,
        activeExperimentCount,
        experimentAssignedInSession,
        concepts,
        historicalAbsorbedConceptCount,
        hasLiveWebContext: Boolean(liveSearchContext),
        inExperimentMode,
        retrievalConfidence,
      })

      const routeContext = [
        checkinContext,
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
        routeContext,
        experimentAssignedInSession,
        {
          latestUserMessage: text,
          learningStateContext,
          learningConcepts: concepts,
          promptControl,
        }
      )
      markLatency('prompt:built', {
        systemPromptChars: systemPrompt.length,
        historyMessages: history.length,
        combinedWikiContextChars: combinedWikiContext.length,
        personalMemoryContextChars: personalMemoryContext.length,
        learningStateContextChars: learningStateContext.length,
        learningConcepts: concepts.length,
        absorbedLearningConcepts: concepts.filter((concept) => concept.state === 'absorbed').length,
        promptControl,
        promptDiagnostics: getLastPromptDiagnostics(),
      })
      const promptDiagnostics = getLastPromptDiagnostics()
      if (promptDiagnostics?.overBudget) {
        console.warn('[Axiom prompt budget]', {
          totalChars: promptDiagnostics.totalChars,
          budget: promptDiagnostics.budget,
          flags: promptDiagnostics.flags,
          moduleChars: promptDiagnostics.moduleChars,
        })
      }

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
      if (requiredArtifactType) {
        markLatency('artifact:build_started', { requiredArtifactType })
      }

      // Stream response
      const stream = await openai.chat.completions.create({
        model: CHAT_MODEL,
        messages: [{ role: 'system', content: systemPrompt }, ...history],
        stream: true,
        session_id: sessionForTurn.id,
        usage_context: {
          call_type: 'chat',
          session_id: sessionForTurn.id,
          thread_id: threadId,
          message_id: userMsgId,
          rag_chunks_used: chunks.length,
        },
      }, { signal: runAbort.signal })
      markLatency('openai:stream_created')

      let streamDone = false
      let firstTokenSeen = false

      for await (const chunk of stream) {
        if (streamDone) break
        const choice = chunk.choices[0]
        const delta = choice?.delta?.content || ''
        if (delta && !firstTokenSeen) {
          firstTokenSeen = true
          markLatency('openai:first_token')
        }
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
      markLatency('openai:stream_done', {
        responseChars: fullContent.length,
      })

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
      markLatency('response:parsed', {
        hasArtifact: Boolean(artifact || latestArtifact),
        hasExperiment: Boolean(experiment),
        cleanTextChars: cleanText.length,
      })

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
          markLatency('artifact:build_done', {
            hasArtifact: Boolean(artifact?.data),
          })
        } catch {
          fullContent = cleanText
          markLatency('artifact:build_failed')
        }
      } else {
        artifact = parsed.artifact
        if (!artifact && parsed.cleanText !== cleanText) {
          fullContent = cleanText
        }
      }

      if (shouldHoldExperiment && artifactLooksLikeExperiment(artifact)) {
        artifact = null
        fullContent = cleanText
      }

      if (experiment && activeExperimentCount >= 2) {
        experiment = null
      }

      if (experiment && concepts.filter((concept) => concept.state === 'absorbed').length + historicalAbsorbedConceptCount <= 0) {
        console.info('[Axiom learning state] experiment blocked after parse: no absorbed in-scope concepts', {
          conceptCount: concepts.length,
          historicalAbsorbedConceptCount,
        })
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
      markLatency('supabase:assistant_message_saved')

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
      setSessionAiMessageCount((prev) => prev + 1)

      releaseSending()
      markLatency('turn:released_main')
      printLatencySummary('stream-complete')

      enqueuePostResponseUpdate(async () => {
        const postStart = performance.now()
        let sessionForMemory = sessionForTurn

        try {
          if (experiment) {
            sessionForMemory = await assignExperiment(experiment, sessionForTurn)
            console.log(`[Axiom latency ${latencyRunId}] post:experiment_assigned`, {
              elapsed_ms: Math.round(performance.now() - postStart),
            })
            const assigned = findMatchingExperiment(sessionForMemory.active_experiments, experiment)
            if (assigned) {
              const enrichedContent = `${cleanText}\n\n<experiment>\n${JSON.stringify(assigned)}\n</experiment>`
              supabase
                .from('messages')
                .update({ content: enrichedContent })
                .eq('id', assistantMsgId)
                .then(({ error }) => {
                  if (error) console.error('Failed to persist enriched experiment message', error)
                })

              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId
                    ? { ...m, experiment: assigned }
                    : m
                )
              )
            }
          }

          updateConceptStatesAfterResponse({
            userId: sessionForTurn.user_id,
            concepts,
            userMessage: text,
            assistantMessage: cleanText,
            sessionId: sessionForTurn.id,
          }).then((result) => {
            console.log(`[Axiom latency ${latencyRunId}] post:concept_state_updated`, {
              elapsed_ms: Math.round(performance.now() - postStart),
              updated: result?.updated || 0,
              skipped: Boolean(result?.skipped),
              transitions: result?.transitions || [],
            })
          }).catch((error) => {
            console.error('[Axiom learning state] update failed', error)
          })

          const assistantTurnCount = baseMessages.filter((message) =>
            message.role === 'assistant' && !message.streaming
          ).length + 1
          const memoryDecision = shouldRunMemoryUpdate(text, cleanText, {
            assistantTurnCount,
            nodeContext,
            experiment,
          })

          if (!memoryDecision.run) {
            setSession(sessionForMemory)
            console.log(`[Axiom latency ${latencyRunId}] post:memory_skipped`, {
              elapsed_ms: Math.round(performance.now() - postStart),
              reason: memoryDecision.reason,
              assistant_turn_count: assistantTurnCount,
            })
          } else {
            const updatedSession = await updatePersonalMemory(sessionForMemory, baseMessages, text, cleanText)
            setSession(updatedSession)
            console.log(`[Axiom latency ${latencyRunId}] post:memory_updated`, {
              elapsed_ms: Math.round(performance.now() - postStart),
              reason: memoryDecision.reason,
            })
            const token = getStoredSessionToken()
            if (token) {
              syncPersonalWiki(updatedSession).then((synced) => {
                if (synced?.nodes?.length) {
                  const key = `axiom_brain_graph:${token}`
                  try {
                    localStorage.setItem(key, JSON.stringify(synced))
                  } catch {}
                }
              }).catch(() => {})
            }
          }
        } catch {
          setSession(sessionForMemory)
          console.log(`[Axiom latency ${latencyRunId}] post:failed`, {
            elapsed_ms: Math.round(performance.now() - postStart),
          })
        }
      })
    } catch (err) {
      markLatency('turn:error', {
        name: err?.name,
        message: err?.message,
      })
      // AbortError is intentional (pagehide or component unmount) — don't show an error
      if (err.name === 'AbortError') {
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
        if (retryAttempt < 1 && persistedUserMessage && !fullContent.trim()) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? { ...m, content: '', streaming: true, status: null, artifact: null, experiment: null, artifactPendingType: null }
                : m
            )
          )
          abortControllerRef.current = null
          releaseSending()
          await sendMessage(text, {
            reuseUserMessage: persistedUserMessage,
            historyMessages: baseMessages,
            replaceAssistantId: assistantMsgId,
            retryAttempt: retryAttempt + 1,
          })
          return
        }

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
      releaseSending()
      if (fullContent.trim()) {
        printLatencySummary('finalized')
      }
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
    const storagePillar = normalizeExperimentPillarForStorage(experiment.pillar)
    const newExp = {
      ...experiment,
      pillar: storagePillar || experiment.pillar || null,
      window_hours: windowHours,
      assigned_at: assignedAt.toISOString(),
      due_at: dueAt.toISOString(),
      status: 'active',
      reference_count: 0,
    }

    let result
    try {
      result = await postApiJson('/api/experiments', {
        session_id: baseSession.id,
        experiment: {
          ...experiment,
          pillar: storagePillar || experiment.pillar || null,
          window_hours: windowHours,
        },
      })
    } catch (error) {
      console.error('Failed to assign experiment', {
        error: error?.message || error,
        experiment,
        session_id: baseSession.id,
        user_id: baseSession.user_id,
      })

      const failedExperiment = {
        ...newExp,
        status: 'error',
        assignment_error: true,
        error_message: error.message || 'This experiment was generated, but it was not saved.',
      }
      const updatedSession = { ...baseSession, active_experiments: [...activeExps, failedExperiment] }
      setSession(updatedSession)
      return updatedSession
    }

    const updated = [...activeExps, normalizeExperiment(result?.experiment || newExp)]
    const sessionUpdates = result?.session_updates || (shouldResetMissStreak ? { consecutive_miss_count: 0 } : {})

    const updatedSession = { ...baseSession, ...sessionUpdates, active_experiments: updated }
    setSession(updatedSession)
    return updatedSession
  }

  function findMatchingExperiment(experiments = [], experiment = {}) {
    if (!experiment) return null
    return [...experiments]
      .reverse()
      .find((item) =>
        (item.status === 'active' || item.assignment_error) &&
        item.description === experiment.description &&
        Number(item.window_hours) === Number(experiment.window_hours || 48)
      ) || null
  }

  async function updateExperimentStatus(experimentId, status, outcome = '', outcomeReason = null) {
    if (!session || !experimentId) return null

    let result
    try {
      result = await postApiJson(`/api/experiments/${experimentId}/status`, {
        status,
        outcome,
        outcome_reason: outcomeReason,
      })
    } catch (error) {
      console.error('Failed to update experiment status', {
        error: error?.message || error,
        experiment_id: experimentId,
        status,
        outcome_reason: outcomeReason,
      })
      return null
    }

    const normalized = normalizeExperiment(result?.experiment)
    const sessionUpdates = result?.session_updates || (status === 'completed' ? { consecutive_miss_count: 0 } : {})

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

  async function recordResistanceAndSync(baseSession, experiment, text, reasonStrength) {
    const memoryRecorded = await recordExperimentResistancePattern(baseSession, experiment, text, reasonStrength)
    if (memoryRecorded) {
      syncPersonalWiki(baseSession).then((synced) => {
        if (synced) window.dispatchEvent(new CustomEvent('axiom-wiki-updated'))
      }).catch((error) => {
        console.error('Failed to sync wiki after experiment resistance pattern', error)
      })
    }
  }

  async function maybeCaptureExperimentReport(text, baseSession, historyMessages = []) {
    const activeExperiments = (baseSession.active_experiments || []).filter((exp) => exp.status === 'active')
    if (activeExperiments.length === 0) return { session: baseSession, handled: false }

    const target = activeExperiments[0]
    let negotiation = experimentNegotiationRef.current
    if (!negotiation && isAwaitingExperimentCancelReason(historyMessages)) {
      negotiation = buildExperimentNegotiation(target, 'awaiting_reason')
      experimentNegotiationRef.current = negotiation
    }
    const negotiationTarget = negotiation?.experiment_id
      ? activeExperiments.find((exp) => exp.id === negotiation.experiment_id) || target
      : target

    if (negotiation?.stage === 'awaiting_reason') {
      const hasRealConstraint = looksLikeRealExperimentConstraint(text)
      const reasonStrength = hasRealConstraint ? 'real' : 'weak'
      await recordResistanceAndSync(baseSession, negotiationTarget, text, reasonStrength)

      if (hasRealConstraint) {
        experimentNegotiationRef.current = buildExperimentNegotiation(negotiationTarget, 'real_reason_offer')
        return {
          session: { ...baseSession, experiment_negotiation: experimentNegotiationRef.current },
          handled: true,
          assistantText: buildConstraintOffer(negotiationTarget),
        }
      }

      experimentNegotiationRef.current = buildExperimentNegotiation(negotiationTarget, 'pushed_back')
      return {
        session: { ...baseSession, experiment_negotiation: experimentNegotiationRef.current },
        handled: true,
        assistantText: buildCancellationPushback(negotiationTarget, text),
      }
    }

    if (negotiation?.stage === 'pushed_back') {
      const hasRealConstraint = looksLikeRealExperimentConstraint(text)

      if (hasRealConstraint) {
        await recordResistanceAndSync(baseSession, negotiationTarget, text, 'real')
        experimentNegotiationRef.current = buildExperimentNegotiation(negotiationTarget, 'real_reason_offer')
        return {
          session: { ...baseSession, experiment_negotiation: experimentNegotiationRef.current },
          handled: true,
          assistantText: buildConstraintOffer(negotiationTarget),
        }
      }

      if (looksLikeCancelInsistence(text) || looksLikeWeakExperimentResistance(text) || looksLikeExperimentCancel(text)) {
        await recordResistanceAndSync(baseSession, negotiationTarget, text, 'weak')
        const updatedExperiment = await updateExperimentStatus(negotiationTarget.id, 'cancelled', text, 'didnt')
        if (!updatedExperiment) {
          return {
            session: baseSession,
            handled: true,
            assistantText: 'I could not save that cancellation. Try once more before we move on.',
          }
        }

        await recordExperimentAvoidancePattern(baseSession, negotiationTarget, text)
        experimentNegotiationRef.current = null
        const updatedExperiments = (baseSession.active_experiments || []).map((exp) =>
          exp.id === negotiationTarget.id ? updatedExperiment : exp
        )

        return {
          session: { ...baseSession, active_experiments: updatedExperiments, experiment_negotiation: null },
          handled: true,
          assistantText: 'I marked that as a choice not to do it, not a constraint. That matters because this is exactly where the pattern shows up.',
        }
      }
    }

    if (negotiation?.stage === 'real_reason_offer' && looksLikeCancelInsistence(text)) {
      return {
        session: { ...baseSession, experiment_negotiation: negotiation },
        handled: true,
        assistantText: buildConstraintOffer(negotiationTarget),
      }
    }

    const awaitingClarification = isAwaitingExperimentOutcomeClarification(historyMessages)

    if (awaitingClarification) {
      const outcomeReason = classifyExperimentOutcomeReason(text)
      const updatedExperiment = await updateExperimentStatus(target.id, 'cancelled', text, outcomeReason)
      if (!updatedExperiment) {
        return {
          session: baseSession,
          handled: true,
          assistantText: 'I could not save that experiment outcome. Try once more before we move on.',
        }
      }
      const updatedExperiments = (baseSession.active_experiments || []).map((exp) =>
        exp.id === target.id ? updatedExperiment : exp
      )
      const updatedSession = { ...baseSession, active_experiments: updatedExperiments }

      if (outcomeReason === 'didnt') {
        const memoryRecorded = await recordExperimentAvoidancePattern(baseSession, target, text)
        if (memoryRecorded) {
          syncPersonalWiki(updatedSession).then((synced) => {
            if (synced) window.dispatchEvent(new CustomEvent('axiom-wiki-updated'))
          }).catch((error) => {
            console.error('Failed to sync wiki after experiment avoidance pattern', error)
          })
        }
      }

      const assistantText = outcomeReason === 'couldnt'
        ? 'That is not a strike. The experiment was blocked, so I marked it as cancelled. We can either reset the same test or replace it with one that fits the constraint.'
        : 'That one counts. I marked it as a choice, not a constraint. The useful part is that we now know what your avoidance reaches for when the work gets real.'

      return { session: updatedSession, handled: true, assistantText }
    }

    if (looksLikeSuccessfulExperimentReport(text)) {
      const updatedExperiment = await updateExperimentStatus(target.id, 'completed', text)
      if (!updatedExperiment) return { session: baseSession, handled: false }

      return {
        session: {
          ...baseSession,
          consecutive_miss_count: 0,
          active_experiments: (baseSession.active_experiments || []).map((exp) =>
            exp.id === target.id ? updatedExperiment : exp
          ),
        },
        handled: false,
      }
    }

    if (looksLikeExperimentCancel(text) || looksLikeExperimentFailureReport(text)) {
      if (looksLikeExperimentCancel(text)) {
        experimentNegotiationRef.current = buildExperimentNegotiation(target, 'awaiting_reason')
        return {
          session: { ...baseSession, experiment_negotiation: experimentNegotiationRef.current },
          handled: true,
          assistantText: EXPERIMENT_CANCEL_REASON_QUESTION,
        }
      }

      return {
        session: baseSession,
        handled: true,
        assistantText: EXPERIMENT_OUTCOME_CLARIFICATION,
      }
    }

    return { session: baseSession, handled: false }
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

    if (error) return

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
    if (!experiment) return
    if (sendingRef.current) return

    const negotiation = buildExperimentNegotiation(experiment, 'awaiting_reason')
    experimentNegotiationRef.current = negotiation
    setSession((prev) => prev ? { ...prev, experiment_negotiation: negotiation } : prev)

    const optimisticId = `cancel-question-${Date.now()}`
    setMessages((prev) => [
      ...prev,
      {
        id: optimisticId,
        role: 'assistant',
        content: EXPERIMENT_CANCEL_REASON_QUESTION,
        streaming: false,
        artifact: null,
        experiment: null,
        artifactPendingType: null,
      },
    ])

    const { data, error } = await supabase
      .from('messages')
      .insert({
        session_id: session.id,
        thread_id: threadId,
        role: 'assistant',
        content: EXPERIMENT_CANCEL_REASON_QUESTION,
      })
      .select('id, created_at')
      .single()

    if (error) {
      console.error('Failed to save experiment cancellation negotiation question', error)
      return
    }

    setMessages((prev) =>
      prev.map((message) =>
        message.id === optimisticId
          ? { ...message, id: data.id, created_at: data.created_at }
          : message
      )
    )
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
    canEdit && { label: 'Edit', ariaLabel: 'Edit message', icon: 'edit', onClick: () => onStartEdit(msg) },
    canRegenerate && { label: 'Regenerate', ariaLabel: 'Regenerate response', icon: 'regenerate', onClick: onRegenerate },
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
          title={msg.experiment.title}
          description={msg.experiment.description}
          windowHours={msg.experiment.window_hours}
          dueAt={msg.experiment.due_at}
          howToDoIt={msg.experiment.how_to_do_it}
          realWorldExample={msg.experiment.real_world_example}
          whatToNotice={msg.experiment.what_to_notice}
          successCondition={msg.experiment.success_condition}
          status={msg.experiment.status}
          assignmentError={msg.experiment.assignment_error}
          errorMessage={msg.experiment.error_message}
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
