import { projectTo2D, type Point2D } from './project'
import { getDomainInfo, type DomainInfo } from './domain-enricher'
import { embedderLog } from './logger'
import type { LlmSettings } from './types'
import { getEmbeddingProvider } from './providers/factory'

import { setEmbedding, getEmbeddingsByDim, clearEmbeddings } from './db/embeddings-repo'
import { setProjection, getProjectionsByDim, clearProjections } from './db/projection-repo'


/** Load cached 2D projection coordinates from the embeddings DB. */
export async function loadCached2D(dim: number): Promise<Map<string, [number, number]>> {
  try {
    const rows = await getProjectionsByDim(dim)
    return new Map(rows.map(r => [r.url, [r.x, r.y] as [number, number]]))
  } catch (err) {
    embedderLog.warn('failed to load cached 2D projection', {
      dim,
      err: err instanceof Error ? err.message : String(err),
    })
    return new Map()
  }
}

/** Helper for UI: load projection for the currently configured embedding model. */
export async function loadProjectionForCurrentModel(settings: LlmSettings): Promise<Map<string, [number, number]>> {
  const providerId = settings.tasks.embedding.provider
  const provider = getEmbeddingProvider(providerId)
  const dim = await provider.getEmbeddingDim(settings)
  if (!dim) return new Map()
  return loadCached2D(dim)
}

/** Save 2D projection coordinates. Writes to tab-lab with dim. */
export async function saveCached2D(points: Point2D[], dim: number): Promise<void> {
  for (const p of points) {
    await setProjection({
      key: `${dim}:${p.url}`,
      dim,
      url: p.url,
      x: p.x,
      y: p.y,
      updatedAt: Date.now()
    })
  }
}

/** Clear all cached embeddings and 2D projections (both new and legacy). */
export async function clearEmbeddingCache(): Promise<void> {
  try {
    await clearEmbeddings()
    await clearProjections()
  } catch (err) {
    embedderLog.warn('failed to clear embedding cache', {
      err: err instanceof Error ? err.message : String(err),
    })
  }
}


/** Retrieve all cached embeddings for a specific dimension. */
export async function loadCachedEmbeddings(dim: number): Promise<Map<string, number[]>> {
  try {
    const newRows = await getEmbeddingsByDim(dim)
    const map = new Map<string, number[]>()
    for (const row of newRows) {
      if (!row.url || !row.vector) continue
      const vector = Array.isArray(row.vector) ? row.vector : Array.from(row.vector)
      map.set(row.url, vector)
    }
    return map
  } catch (err) {
    embedderLog.warn('failed to load cached embeddings', {
      dim,
      err: err instanceof Error ? err.message : String(err),
    })
    return new Map()
  }
}

/** Store a single embedding vector. Writes only to tab-lab. */
async function storeEmbedding(url: string, vector: number[]): Promise<void> {
  const dim = vector.length
  await setEmbedding({
    key: `${dim}:${url}`,
    dim,
    url,
    vector: new Float32Array(vector),
    updatedAt: Date.now()
  })
}


export async function fetchEmbedding(
  text: string,
  settings: LlmSettings,
  signal?: AbortSignal,
): Promise<number[]> {
  const providerId = settings.tasks.embedding.provider
  const provider = getEmbeddingProvider(providerId)
  return provider.embed(text, settings, signal)
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) return 0
  const len = Math.min(a.length, b.length)
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < len; i += 1) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1)
}

/**
 * Fetch embeddings for items that aren't already cached in IndexedDB.
 * Uses LM Studio /v1/embeddings.
 * Vectors are stored as Float32Array in IndexedDB (efficient binary).
 * Input text = "category: title" when category exists, otherwise title.
 */
export async function fetchEmbeddingsBatch(
  items: { url: string; title: string; domain: string; category?: string }[],
  settings: LlmSettings,
  onProgress: (updates: { url: string; embedding: number[] }[]) => void,
  signal?: AbortSignal,
): Promise<void> {
  await fetchAndCacheEmbeddings(items, settings, onProgress, undefined, signal)
}

function urlPathSnippet(url: string): string {
  try {
    const path = new URL(url).pathname.replace(/\/$/, '')
    return path.slice(0, 80)
  } catch (err) {
    embedderLog.debug('failed to parse url path snippet', {
      url,
      err: err instanceof Error ? err.message : String(err),
    })
    return ''
  }
}

export async function fetchAndCacheEmbeddings(
  items: { url: string; title: string; domain: string; category?: string }[],
  settings: LlmSettings,
  onProgress?: (updates: { url: string; embedding: number[] }[]) => void,
  domainMap?: Map<string, DomainInfo>,
  signal?: AbortSignal,
): Promise<Map<string, number[]>> {
  const providerId = settings.tasks.embedding.provider
  const provider = getEmbeddingProvider(providerId)
  const status = await provider.checkStatus(settings)
  if (!status.available) return new Map()

  const dim = await provider.getEmbeddingDim(settings)
  if (!dim) {
    embedderLog.warn('could not determine embedding dimension')
    return new Map()
  }

  const cachedEmbeddings = await loadCachedEmbeddings(dim)
  const result = new Map<string, number[]>()
  for (const item of items) {
    const cached = cachedEmbeddings.get(item.url)
    if (cached) result.set(item.url, cached)
  }

  const cachedUrls = new Set(result.keys())
  // Optimization: we don't need to check legacy again if loadCachedEmbeddings already did it.
  
  const uncached = items.filter(item => !cachedUrls.has(item.url))
  if (uncached.length === 0) return result

  for (const item of uncached) {
    try {
      const path = urlPathSnippet(item.url)
      const domainInfo = domainMap ? getDomainInfo(item.domain, domainMap) : undefined
      const domainLabel = domainInfo?.category && domainInfo?.description
        ? `${domainInfo.category}: ${domainInfo.description}`
        : (domainInfo?.description ?? domainInfo?.category)
      const baseText = `${item.title}\n${item.domain}${path ? `\n${path}` : ''}`
      const enrichedText = domainLabel ? `${domainLabel}\n${baseText}` : baseText
      const text = item.category ? `${item.category}\n${enrichedText}` : enrichedText
      if (signal?.aborted) throw new Error('Aborted')
      const embedding = await fetchEmbedding(text, settings, signal)
      await storeEmbedding(item.url, embedding)
      result.set(item.url, embedding)
      onProgress?.([{ url: item.url, embedding }])
    } catch (err) {
      embedderLog.error('embedding failed for item', {
        url: item.url,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return result
}

/**
 * Re-project all cached embeddings for the CURRENT dimension to 2D and update the projection cache.
 */
export async function reprojectAllEmbeddings(settings: LlmSettings): Promise<Map<string, [number, number]>> {
  const providerId = settings.tasks.embedding.provider
  const provider = getEmbeddingProvider(providerId)
  const dim = await provider.getEmbeddingDim(settings)
  if (!dim) return new Map()

  const embeddings = await loadCachedEmbeddings(dim)
  if (embeddings.size < 2) return new Map()

  const items = Array.from(embeddings.entries()).map(([url, embedding]) => ({ url, embedding }))
  const points = projectTo2D(items)
  await saveCached2D(points, dim)
  return new Map(points.map(p => [p.url, [p.x, p.y] as [number, number]]))
}

/** Helper for UI: load embeddings for the currently configured model. */
export async function loadEmbeddingsForCurrentModel(settings: LlmSettings): Promise<Map<string, number[]>> {
  const providerId = settings.tasks.embedding.provider
  const provider = getEmbeddingProvider(providerId)
  const dim = await provider.getEmbeddingDim(settings)
  if (!dim) return new Map()
  return loadCachedEmbeddings(dim)
}
