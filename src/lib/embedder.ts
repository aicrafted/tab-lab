import { projectTo2D, type Point2D } from './project'
import { getDomainInfo, type DomainInfo } from './domain-enricher'
import { embedderLog } from './logger'
import { DEFAULT_TRANSFORMERS_EMBEDDING_MODEL, type LlmSettings } from './types'
import { webgpuEmbed } from './webgpu-provider'

const DB_NAME = 'tabmind-embeddings'
const EMBEDDINGS_STORE = 'embeddings'
const PROJECTION_STORE = 'projection2d'
const DB_VERSION = 2

/** Open (or create) the embeddings IndexedDB, returning a Promise<IDBDatabase>. */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result
      if (!db.objectStoreNames.contains(EMBEDDINGS_STORE)) {
        db.createObjectStore(EMBEDDINGS_STORE, { keyPath: 'url' })
      }
      if (!db.objectStoreNames.contains(PROJECTION_STORE)) {
        db.createObjectStore(PROJECTION_STORE, { keyPath: 'url' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** Load cached 2D projection coordinates from the embeddings DB. */
export async function loadCached2D(): Promise<Map<string, [number, number]>> {
  try {
    const db = await openDB()
    const points = await getAllFromStore<Point2DRow>(db, PROJECTION_STORE)
    if (!points?.length) return new Map()
    return new Map(points.map(p => [p.url, [p.x, p.y] as [number, number]]))
  } catch (err) {
    embedderLog.warn('failed to load cached 2D projection', {
      err: err instanceof Error ? err.message : String(err),
    })
    return new Map()
  }
}

/** Save 2D projection coordinates to the projection store (replaces all existing). */
export async function saveCached2D(points: Point2D[]): Promise<void> {
  const db = await openDB()
  const tx = db.transaction(PROJECTION_STORE, 'readwrite')
  const store = tx.objectStore(PROJECTION_STORE)
  store.clear()
  for (const p of points) {
    store.put({ url: p.url, x: p.x, y: p.y })
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** Clear all cached embeddings and 2D projections. */
export async function clearEmbeddingCache(): Promise<void> {
  try {
    const db = await openDB()
    const tx = db.transaction([EMBEDDINGS_STORE, PROJECTION_STORE], 'readwrite')
    tx.objectStore(EMBEDDINGS_STORE).clear()
    tx.objectStore(PROJECTION_STORE).clear()
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch (err) {
    embedderLog.warn('failed to clear embedding cache', {
      err: err instanceof Error ? err.message : String(err),
    })
  }
}

interface Point2DRow {
  url: string
  x: number
  y: number
}

interface EmbeddingRow {
  url: string
  vector?: Float32Array | number[]
}

/** Helper: get all rows from a store. */
function getAllFromStore<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(storeName)) {
      resolve([])
      return
    }
    const tx = db.transaction(storeName, 'readonly')
    const req = tx.objectStore(storeName).getAll()
    req.onsuccess = () => resolve(req.result as T[])
    req.onerror = () => reject(req.error)
  })
}

/** Retrieve all cached embeddings from IndexedDB as { url → number[] } map. */
export async function loadCachedEmbeddings(): Promise<Map<string, number[]>> {
  try {
    const db = await openDB()
    const rows = await getAllFromStore<EmbeddingRow>(db, EMBEDDINGS_STORE)
    const map = new Map<string, number[]>()
    for (const row of rows ?? []) {
      if (!row.url || !row.vector) continue
      const vector = Array.isArray(row.vector) ? row.vector : Array.from(row.vector)
      if (vector.length > 0) map.set(row.url, vector)
    }
    return map
  } catch (err) {
    embedderLog.warn('failed to load cached embeddings', {
      err: err instanceof Error ? err.message : String(err),
    })
    return new Map()
  }
}

/** Store a single embedding vector in IndexedDB. */
async function storeEmbedding(url: string, vector: number[]): Promise<void> {
  const db = await openDB()
  const tx = db.transaction(EMBEDDINGS_STORE, 'readwrite')
  tx.objectStore(EMBEDDINGS_STORE).put({ url, vector: new Float32Array(vector) })
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** Fetch a single embedding vector from OpenAI-compatible /embeddings endpoint. */
async function fetchEmbeddingRemote(
  text: string,
  baseUrl: string,
  apiKey: string,
  model: string,
  signal?: AbortSignal,
): Promise<number[]> {
  const res = await fetch(`${baseUrl}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({ model, input: text }),
    signal: signal ?? AbortSignal.timeout(20_000),
  })
  if (!res.ok) throw new Error(`Embeddings request failed: ${res.status}`)
  const json = (await res.json()) as { data: { embedding: number[] }[] }
  const vec = json.data[0]?.embedding
  if (!vec?.length) throw new Error('Empty embedding response')
  return vec
}

export async function fetchEmbedding(
  text: string,
  settings: LlmSettings,
  signal?: AbortSignal,
): Promise<number[]> {
  const provider = settings.tasks.embedding.provider

  if (provider === 'browser-ml') {
    const model = settings.providers.browserMl.embeddingModel
    return webgpuEmbed(text, model || DEFAULT_TRANSFORMERS_EMBEDDING_MODEL)
  }
  if (provider === 'lmstudio') {
    const { baseUrl, apiKey, embeddingModel } = settings.providers.lmstudio
    return fetchEmbeddingRemote(text, baseUrl, apiKey, embeddingModel || '', signal)
  }
  if (provider === 'openrouter') {
    const { apiKey, embeddingModel } = settings.providers.openrouter
    return fetchEmbeddingRemote(text, 'https://openrouter.ai/api/v1', apiKey, embeddingModel || '', signal)
  }
  throw new Error('Unsupported embedding provider')
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
): Promise<void> {
  await fetchAndCacheEmbeddings(items, settings, onProgress)
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
): Promise<Map<string, number[]>> {
  const provider = settings.tasks.embedding.provider
  if (provider === 'lmstudio') {
    if (!settings.providers.lmstudio.baseUrl) return new Map()
    if (!settings.providers.lmstudio.embeddingModel) return new Map()
  }
  if (provider === 'openrouter') {
    if (!settings.providers.openrouter.apiKey) return new Map()
    if (!settings.providers.openrouter.embeddingModel) return new Map()
  }

  const cachedEmbeddings = await loadCachedEmbeddings()
  const result = new Map<string, number[]>()
  for (const item of items) {
    const cached = cachedEmbeddings.get(item.url)
    if (cached) result.set(item.url, cached)
  }

  const cachedUrls = new Set(result.keys())
  try {
    const db = await openDB()
    const rows = await getAllFromStore<EmbeddingRow>(db, EMBEDDINGS_STORE)
    for (const row of rows ?? []) {
      if (row.url && row.vector && (Array.isArray(row.vector) ? row.vector.length > 0 : row.vector.byteLength > 0)) {
        cachedUrls.add(row.url)
      }
    }
  } catch (err) {
    embedderLog.warn('failed to read cached embedding urls', {
      err: err instanceof Error ? err.message : String(err),
    })
  }

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
      const embedding = await fetchEmbedding(text, settings)
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
 * Re-project all cached embeddings to 2D and update the projection cache.
 */
export async function reprojectAllEmbeddings(): Promise<Map<string, [number, number]>> {
  const embeddings = await loadCachedEmbeddings()
  if (embeddings.size < 2) return new Map()

  const items = Array.from(embeddings.entries()).map(([url, embedding]) => ({ url, embedding }))
  const points = projectTo2D(items)
  await saveCached2D(points)
  return new Map(points.map(p => [p.url, [p.x, p.y] as [number, number]]))
}
