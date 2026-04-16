import { getChatProvider, getEmbeddingProvider } from '../ai/providers/factory'
import { getAllCached } from '../core/storage'
import type { LlmSettings } from '../core/types'

export function hasChatProviderConfig(settings: LlmSettings): boolean {
  const providerId = settings.tasks.chat.provider
  try {
    const provider = getChatProvider(providerId)
    return Boolean(provider.getChatModel(settings))
  } catch { return false }
}

export function hasDomainKnowledgeProviderConfig(settings: LlmSettings): boolean {
  const providerId = settings.tasks.chat.provider
  try {
    const provider = getChatProvider(providerId)
    return provider.supportsDomainEnrichment && Boolean(provider.getChatModel(settings))
  } catch { return false }
}

export function hasEmbeddingProviderConfig(settings: LlmSettings): boolean {
  const providerId = settings.tasks.embedding.provider
  try {
    const provider = getEmbeddingProvider(providerId)
    return Boolean(provider.getEmbeddingModel(settings))
  } catch { return false }
}

export async function getTaxonomyContext(): Promise<{ candidates: string[]; taxonomyCentroidsMap: Map<string, number[]> }> {
  const all = await getAllCached()
  const labels = new Set<string>()
  const labelEmbeddings = new Map<string, number[][]>()

  for (const entry of all.values()) {
    if (entry.category) {
      labels.add(entry.category)
      if (entry.embedding) {
        if (!labelEmbeddings.has(entry.category)) labelEmbeddings.set(entry.category, [])
        labelEmbeddings.get(entry.category)!.push(entry.embedding)
      }
    }
  }

  const taxonomyCentroidsMap = new Map<string, number[]>()
  for (const [label, embeddings] of labelEmbeddings.entries()) {
    if (embeddings.length === 0) continue
    const dim = embeddings[0].length
    const centroid = new Array(dim).fill(0)
    for (const emb of embeddings) {
      for (let i = 0; i < dim; i++) {
        centroid[i] += emb[i]
      }
    }
    for (let i = 0; i < dim; i++) {
      centroid[i] /= embeddings.length
    }
    taxonomyCentroidsMap.set(label, centroid)
  }

  return {
    candidates: [...labels].sort(),
    taxonomyCentroidsMap,
  }
}
