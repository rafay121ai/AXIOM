import { generateStructuredArtifact, streamStructuredArtifact } from './openai'
import { getArtifactBuildSteps, getArtifactProfile, humanizeArtifactType } from './artifactRegistry'
export { getArtifactBuildSteps, humanizeArtifactType } from './artifactRegistry'

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
  const profile = getArtifactProfile(type)
  if (profile?.isComplete) return profile.isComplete(data)
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
  const profile = getArtifactProfile(artifactType)
  if (!profile) return null

  let progressiveData = null

  if (artifactType !== 'signal_map') {
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
