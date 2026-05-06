import { generateStructuredArtifact, requestJsonObject, streamStructuredArtifact } from './openai'
import { getArtifactBuildSteps, getArtifactProfile, humanizeArtifactType } from './artifactRegistry'
export { getArtifactBuildSteps, humanizeArtifactType } from './artifactRegistry'

const ARTIFACT_CACHE_TTL_MS = 5 * 60 * 1000
const MAX_ARTIFACT_CACHE_ENTRIES = 60
const artifactBuildCache = new Map()

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
}

function trimArtifactCache() {
  while (artifactBuildCache.size > MAX_ARTIFACT_CACHE_ENTRIES) {
    const oldestKey = artifactBuildCache.keys().next().value
    artifactBuildCache.delete(oldestKey)
  }
}

async function cachedArtifact(key, loader) {
  const now = Date.now()
  const cached = artifactBuildCache.get(key)
  if (cached && now - cached.time < ARTIFACT_CACHE_TTL_MS) {
    return cached.value
  }

  const promise = Promise.resolve()
    .then(loader)
    .catch((error) => {
      artifactBuildCache.delete(key)
      throw error
    })

  artifactBuildCache.set(key, { time: now, value: promise })
  trimArtifactCache()
  return promise
}

export function deepMergeArtifactData(base, patch) {
  if (Array.isArray(patch)) return patch
  if (!isPlainObject(base) || !isPlainObject(patch)) return patch

  const next = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    if (isPlainObject(value) && isPlainObject(next[key])) {
      next[key] = deepMergeArtifactData(next[key], value)
    } else {
      next[key] = value
    }
  }
  return next
}

export function artifactLooksComplete(type, data) {
  if (!data || typeof data !== 'object') return false
  const profile = getArtifactProfile(type)
  if (profile?.isComplete) return profile.isComplete(data)
  return true
}

function cleanText(value, fallback = '') {
  if (value === null || value === undefined) return fallback
  return String(value).replace(/\s+/g, ' ').trim() || fallback
}

function cleanArray(value, limit = 3) {
  return Array.isArray(value) ? value.filter(Boolean).slice(0, limit) : []
}

function boundedValue(value, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(1, Math.min(100, Math.round(number)))
}

function normalizeSignalMap(data) {
  if (!isPlainObject(data)) return null

  const whatIsHappeningNow = cleanArray(data.what_is_happening_now, 2)
    .map((item, index) => ({
      label: cleanText(item?.label, `Signal ${index + 1}`),
      detail: cleanText(item?.detail),
      evidence: cleanText(item?.evidence),
    }))
    .filter(item => item.detail || item.evidence)

  const observedMoves = cleanArray(data.observed_moves, 3)
    .map((item, index) => ({
      actor: cleanText(item?.actor, `Actor ${index + 1}`),
      action: cleanText(item?.action),
      implication: cleanText(item?.implication),
    }))
    .filter(item => item.action || item.implication)

  const sections = cleanArray(data.sections, 4)
    .map((item, index) => ({
      id: cleanText(item?.id, `section_${index + 1}`),
      label: cleanText(item?.label, `Section ${index + 1}`),
      pillar: cleanText(item?.pillar, 'think_sharper'),
      signal: cleanText(item?.signal),
      tension: cleanText(item?.tension),
    }))
    .filter(item => item.signal)

  const forecast = isPlainObject(data.forecast) ? data.forecast : {}
  const normalized = {
    ...data,
    title: cleanText(data.title, 'Signal Map'),
    topic: cleanText(data.topic, 'live terrain'),
    core_shift: cleanText(data.core_shift),
    trend_state: {
      current_phase: cleanText(data.trend_state?.current_phase, 'unclear'),
      current_read: cleanText(data.trend_state?.current_read),
      signal_strength: cleanText(data.trend_state?.signal_strength, 'medium'),
      estimate_note: cleanText(data.trend_state?.estimate_note),
    },
    what_is_happening_now: whatIsHappeningNow,
    observed_moves: observedMoves,
    sections,
    forecast: {
      now: {
        label: cleanText(forecast.now?.label, 'Now'),
        value: boundedValue(forecast.now?.value, 28),
        note: cleanText(forecast.now?.note),
      },
      next_12_months: {
        label: cleanText(forecast.next_12_months?.label, '12 months'),
        value: boundedValue(forecast.next_12_months?.value, 54),
        note: cleanText(forecast.next_12_months?.note),
      },
      next_3_years: {
        label: cleanText(forecast.next_3_years?.label, '3 years'),
        value: boundedValue(forecast.next_3_years?.value, 78),
        note: cleanText(forecast.next_3_years?.note),
      },
    },
    frameworks: cleanArray(data.frameworks, 1),
    watch_points: cleanArray(data.watch_points, 3).map(item => cleanText(item)).filter(Boolean),
  }

  return artifactLooksComplete('signal_map', normalized) ? normalized : null
}

function normalizeArtifactData(type, data) {
  if (type === 'comparison_table') return normalizeComparisonTable(data)
  if (type === 'signal_map') return normalizeSignalMap(data)
  return data
}

function normalizeComparisonTable(data) {
  if (!isPlainObject(data)) return null

  const headers = cleanArray(data.headers, 5)
    .map(header => cleanText(header))
    .filter(Boolean)

  if (headers.length < 2) return null

  const rows = Array.isArray(data.rows) ? data.rows : []
  const normalizedRows = rows
    .map((row) => {
      if (Array.isArray(row)) return row.map(cell => cleanText(cell))
      if (isPlainObject(row)) {
        return headers.map((header) => {
          const exact = row[header]
          const snake = row[header.toLowerCase().replace(/\W+/g, '_')]
          const looseKey = Object.keys(row).find(key => cleanText(key).toLowerCase() === header.toLowerCase())
          return cleanText(exact ?? snake ?? (looseKey ? row[looseKey] : ''))
        })
      }
      return []
    })
    .map(row => row.slice(0, headers.length))
    .filter(row => row.length >= 2 && row.some(cell => cell && cell.toLowerCase() !== 'true' && cell.toLowerCase() !== 'false'))
    .filter(row => row.filter(Boolean).length >= Math.min(2, headers.length))

  if (normalizedRows.length === 0) return null

  return {
    title: cleanText(data.title),
    headers,
    rows: normalizedRows,
    animate: data.animate !== false,
    interactive: data.interactive === true,
  }
}

export function getRequiredArtifactType(route) {
  return route?.artifactStrategy && route.artifactStrategy !== 'none'
    ? route.artifactStrategy
    : null
}

async function buildSignalMapProgressively({
  profile,
  query,
  session,
  routeContext = '',
  wikiContext = '',
  personalMemoryContext = '',
  namedPatternsContext = '',
  answerDraft = '',
  onProgress,
}) {
  let progressiveData = {}

  await Promise.all(
    (profile.progressiveSections || []).map(async (section) => {
      const partial = await requestJsonObject({
        label: `signal_map ${section.key}`,
        maxCompletionTokens: 220,
        messages: [
          {
            role: 'system',
            content: `You generate one section of Axiom's signal_map artifact.

Return valid JSON only.

Rules:
- Return only the fields requested in the schema below.
- Keep this section compact and specific.
- Prefer factual observations over abstraction.
- Do not add extra sections or wrapper keys.
- Keep this artifact to terrain, framework, or signal structure only.
- Do not include an experiment task, operational steps, watch-fors, reporting instructions, or success conditions.

Full signal_map rules:
${profile.rules.map((rule) => `- ${rule}`).join('\n')}

This section schema:
${section.schema}`,
          },
          {
            role: 'user',
            content: `Question: ${query}

Route context:
${routeContext || 'None'}

Private theory:
${session?.axiom_profile || 'None'}

Session notes:
${session?.session_notes || 'None'}

Named patterns:
${namedPatternsContext || 'None'}

Personal context:
${personalMemoryContext || 'None'}

Wiki context:
${wikiContext || 'None'}

Draft answer:
${answerDraft || 'None'}`,
          },
        ],
      })

      progressiveData = deepMergeArtifactData(progressiveData, partial)
      onProgress?.(progressiveData)
    })
  )

  return progressiveData
}

export async function buildArtifactForResponse({
  artifactType,
  query,
  session,
  routeContext = '',
  wikiContext = '',
  personalMemoryContext = '',
  namedPatternsContext = '',
  answerDraft = '',
  signal,
  onProgress,
}) {
  if (!artifactType) return null
  const profile = getArtifactProfile(artifactType)
  if (!profile) return null

  const cacheKey = stableStringify({
    artifactType,
    query,
    routeContext,
    wikiContext,
    personalMemoryContext,
    namedPatternsContext,
    answerDraft,
    session: {
      id: session?.id,
      profile: session?.axiom_profile || '',
      notes: session?.session_notes || '',
      experiments: session?.active_experiments || [],
    },
  })

  if (artifactType === 'signal_map') {
    const artifactData = await cachedArtifact(cacheKey, () =>
      generateStructuredArtifact({
        artifactType,
        query,
        session,
        routeContext,
        wikiContext,
        personalMemoryContext,
        namedPatternsContext,
        answerDraft,
      })
    )
    const normalizedArtifactData = normalizeArtifactData(artifactType, artifactData)

    if (normalizedArtifactData && Object.keys(normalizedArtifactData).length > 0) {
      onProgress?.(normalizedArtifactData)
      return { type: artifactType, data: normalizedArtifactData }
    }
    return null
  }

  let progressiveData = null

  try {
    for await (const merge of streamStructuredArtifact({
      artifactType,
      query,
      session,
      routeContext,
      wikiContext,
      personalMemoryContext,
      namedPatternsContext,
      answerDraft,
      signal,
    })) {
      progressiveData = deepMergeArtifactData(progressiveData || {}, merge)
      onProgress?.(progressiveData)
    }
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    console.warn(`Artifact stream failed for ${artifactType}:`, error?.message || error)
  }

  if (!progressiveData || Object.keys(progressiveData).length === 0 || !artifactLooksComplete(artifactType, progressiveData)) {
    const finalizedArtifactData = await generateStructuredArtifact({
      artifactType,
      query,
      session,
      routeContext,
      wikiContext,
      personalMemoryContext,
      namedPatternsContext,
      answerDraft,
    })

    if (finalizedArtifactData && Object.keys(finalizedArtifactData).length > 0) {
      progressiveData = progressiveData
        ? deepMergeArtifactData(progressiveData, finalizedArtifactData)
        : finalizedArtifactData
      onProgress?.(progressiveData)
    }
  }

  const normalizedData = normalizeArtifactData(artifactType, progressiveData)

  return normalizedData && Object.keys(normalizedData).length > 0
    ? { type: artifactType, data: normalizedData }
    : null
}
