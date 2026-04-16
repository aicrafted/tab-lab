import { cosineSimilarity, fetchEmbedding } from './embedder'
import type { LlmSettings } from '../core/types'
import { createLogger } from '../core/logger'

const nliLog = createLogger('nli-engine')

const labelEmbeddingCache = new Map<string, Map<string, number[]>>()

/**
 * Generates or retrieves embeddings for all configured NLI category descriptors.
 */
export async function getCategoryLabelEmbeddings(
  settings: LlmSettings
): Promise<Map<string, number[]>> {
  const model = settings.providers.browserMl.embeddingModel
  if (labelEmbeddingCache.has(model)) return labelEmbeddingCache.get(model)!

  const map = new Map<string, number[]>()
  for (const cat of settings.nliCategories) {
    const vec = await fetchEmbedding(cat.descriptor, settings)
    map.set(cat.label, vec)
  }
  labelEmbeddingCache.set(model, map)
  return map
}

/**
 * Classifies a vector using NLI (cosine similarity against category descriptors).
 */
export async function classifyVectorNli(
  vector: number[],
  settings: LlmSettings
): Promise<{ label: string; score: number } | null> {
  const labelEmbeddings = await getCategoryLabelEmbeddings(settings)
  let bestLabel = 'Other'
  let bestScore = -1

  for (const [label, embedding] of labelEmbeddings.entries()) {
    const score = cosineSimilarity(vector, embedding)
    if (score > bestScore) {
      bestScore = score
      bestLabel = label
    }
  }

  if (bestScore < settings.nliConfidenceThreshold) {
    nliLog.debug('nli low confidence', { score: bestScore, label: bestLabel })
    return null
  }

  return { label: bestLabel, score: bestScore }
}
