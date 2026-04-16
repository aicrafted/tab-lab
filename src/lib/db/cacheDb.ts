/**
 * IndexedDB-backed storage for AI classification data (categories, tags, intents, embeddings).
 * Replaces chrome.storage.local for per-URL cache entries and avoids the 10MB quota limit.
 */

import type { PageIntent } from '../core/types'
import { normalizeUrlForCache } from '../core/url-utils'
import { clearPageCache, deletePageCache, getAllPageCache, getPageCache, setPageCache } from '../db/page-cache-repo'

/** One cached entry per normalized URL. */
export interface CacheEntry {
  category: string
  parentCategory?: string
  clusterId?: number
  processedAt: number
  tags?: string[]
  embedding?: number[] // legacy support (migrated to embeddings-repo)
  intent?: PageIntent
}

/** Get a single cached entry by URL. */
export async function getCached(url: string): Promise<CacheEntry | null> {
  const key = normalizeUrlForCache(url)
  try {
    const row = await getPageCache(key)
    return (row as CacheEntry) ?? null
  } catch (err) {
    console.warn('[cacheDb] getCached failed', { url, err })
    return null
  }
}

/** Store a single cached entry by URL. */
export async function setCached(url: string, entry: CacheEntry): Promise<void> {
  const key = normalizeUrlForCache(url)
  const { embedding, ...rest } = entry as any
  await setPageCache({
    key,
    ...rest,
    processedAt: entry.processedAt || Date.now(),
  })
}

/** Clear all cached entries. */
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
    return map
  } catch (err) {
    console.warn('[cacheDb] getAll failed', err)
    return new Map()
  }
}

const PAGE_CACHE_MIGRATION_FLAG = 'pageCacheMigrated_v1'

function isLegacyPrefixedKey(key: string): boolean {
  return key.startsWith('tab:') || key.startsWith('bm:')
}

function mergeCacheEntries(existing: CacheEntry | null, incoming: CacheEntry): CacheEntry {
  if (!existing) return incoming
  const incomingAt = incoming.processedAt ?? 0
  const existingAt = existing.processedAt ?? 0
  const newer = incomingAt >= existingAt ? incoming : existing
  const older = incomingAt >= existingAt ? existing : incoming

  return {
    category: newer.category || older.category || 'Other',
    parentCategory: newer.parentCategory ?? older.parentCategory,
    clusterId: newer.clusterId ?? older.clusterId,
    processedAt: Math.max(incomingAt, existingAt, Date.now()),
    tags: newer.tags?.length ? newer.tags : older.tags,
    intent: newer.intent ?? older.intent,
  }
}

export async function migratePageCacheKeys(): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return
  const migrationFlag = await chrome.storage.local.get(PAGE_CACHE_MIGRATION_FLAG)
  if (migrationFlag[PAGE_CACHE_MIGRATION_FLAG]) return

  const allRows = await getAllPageCache()
  const legacyRows = allRows.filter((row) => isLegacyPrefixedKey(row.key))

  if (legacyRows.length === 0) {
    await chrome.storage.local.set({ [PAGE_CACHE_MIGRATION_FLAG]: true })
    return
  }

  const byNormalizedUrl = new Map<string, CacheEntry>()
  for (const row of legacyRows) {
    const rawUrl = row.key.replace(/^(tab|bm):/, '')
    const normalizedUrl = normalizeUrlForCache(rawUrl)
    const current = byNormalizedUrl.get(normalizedUrl) ?? null
    byNormalizedUrl.set(normalizedUrl, mergeCacheEntries(current, row as CacheEntry))
  }

  for (const [url, entry] of byNormalizedUrl.entries()) {
    const existing = await getCached(url)
    const merged = mergeCacheEntries(existing, entry)
    await setPageCache({
      key: url,
      ...merged,
      processedAt: merged.processedAt || Date.now(),
    })
  }

  for (const row of legacyRows) {
    await deletePageCache(row.key)
  }

  await chrome.storage.local.set({ [PAGE_CACHE_MIGRATION_FLAG]: true })
}
