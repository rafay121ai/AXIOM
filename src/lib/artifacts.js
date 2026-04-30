import { generateStructuredArtifact, streamStructuredArtifact } from './openai'

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
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

  if (type === 'signal_map') {
    return Boolean(
      data.core_shift &&
      data.trend_state &&
      Array.isArray(data.what_is_happening_now) && data.what_is_happening_now.length > 0 &&
      Array.isArray(data.observed_moves) && data.observed_moves.length > 0 &&
      Array.isArray(data.sections) && data.sections.length >= 4 &&
      data.forecast &&
      Array.isArray(data.frameworks) && data.frameworks.length > 0 &&
      Array.isArray(data.watch_points) && data.watch_points.length > 0 &&
      data.for_this_user
    )
  }

  if (type === 'comparison_table') {
    return Array.isArray(data.headers) && data.headers.length >= 2 && Array.isArray(data.rows) && data.rows.length > 0
  }

  if (type === 'behavior_loop' || type === 'reasoning_cycle') {
    return Array.isArray(data.steps) && data.steps.length >= 3
  }

  if (type === 'reasoning_stack' || type === 'reasoning_pyramid') {
    return Array.isArray(data.layers) && data.layers.length >= 3
  }

  if (type === 'reasoning_curve') {
    return Array.isArray(data.stages) && data.stages.length >= 3
  }

  if (type === 'reasoning_wave') {
    return Array.isArray(data.drivers) && data.drivers.length >= 3
  }

  return true
}

export function getRequiredArtifactType(route) {
  return route?.artifactStrategy && route.artifactStrategy !== 'none'
    ? route.artifactStrategy
    : null
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

  return progressiveData && Object.keys(progressiveData).length > 0
    ? { type: artifactType, data: progressiveData }
    : null
}
