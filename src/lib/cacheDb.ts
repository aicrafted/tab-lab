/**
 * IndexedDB-backed storage for AI classification data (categories, tags, intents, embeddings).
 * Replaces chrome.storage.local for per-URL cache entries — avoids the 10MB quota limit.
 *
 * chrome.storage.local is only used for LLM settings (small, single key).
 */

import type { PageIntent } from './types'

import { getPageCache, setPageCache, getAllPageCache, clearPageCache } from './db/page-cache-repo'


/** One cached entry per URL. */
export interface CacheEntry {
  category: string
  parentCategory?: string
  clusterId?: number
  processedAt: number
  tags?: string[]
  embedding?: number[]    // legacy support (migrated to embeddings-repo)
  intent?: PageIntent
}


/** Get a single cached entry by prefix+url. Primary: tab-lab, Fallback: legacy. */
export async function getCached(prefix: 'tab' | 'bm', url: string): Promise<CacheEntry | null> {
  const key = `${prefix}:${url}`
  try {
    const row = await getPageCache(key)
    return row as CacheEntry ?? null
  } catch (err) {
    console.warn('[cacheDb] getCached failed', { prefix, url, err })
    return null
  }
}

/** Store a single cached entry. Writes only to tab-lab. */
export async function setCached(prefix: 'tab' | 'bm', url: string, entry: CacheEntry): Promise<void> {
  const key = `${prefix}:${url}`
  const { embedding, ...rest } = entry as any
  await setPageCache({
    key,
    ...rest,
    processedAt: entry.processedAt || Date.now()
  })
}

/** Batch get: returns Map<url, CacheEntry> for existing entries. */
export async function getCachedBatch(prefix: 'tab' | 'bm', urls: string[]): Promise<Map<string, CacheEntry>> {
  // Optimization: for batch we just use the existing logic but maybe we should just load all new ones?
  // Since this is used on initial load, it's safer to try new first, then old.
  const result = new Map<string, CacheEntry>()
  for (const url of urls) {
    const entry = await getCached(prefix, url)
    if (entry) result.set(url, entry)
  }
  return result
}

/** Clear all cached entries (both new and legacy). */
export async function clearAll(): Promise<void> {
  try {
    await clearPageCache()
  } catch (err) {
    console.warn('[cacheDb] clearAll failed', err)
  }
}

/** Get all entries as a Map<key, CacheEntry>. */
export async function getAll(): Promise<Map<string, CacheEntry>> {
  try {
    const rows = await getAllPageCache()
    const map = new Map<string, CacheEntry>()
    for (const row of rows) {
      map.set(row.key, row as CacheEntry)
    }
    
    // Fallback? getAll is mostly for taxonomy centroids.
    // If we haven't migrated yet, this might return partial data.
    // But migration should be triggered early.
    return map
  } catch (err) {
    console.warn('[cacheDb] getAll failed', err)
    return new Map()
  }
}
